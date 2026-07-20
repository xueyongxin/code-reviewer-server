import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OrgRolesGuard, PlatformAdmin } from '../common/org-roles.guard';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrgsService } from '../orgs/orgs.service';
import { BillingService } from './billing.service';

class AssignPlanDto {
  @IsString()
  orgId!: string;

  @IsString()
  planKey!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class CreateOrderDto {
  /** 企业套餐可无组织先下单；个人套餐需 orgId */
  @IsOptional()
  @IsString()
  orgId?: string;

  @IsString()
  planKey!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class MarkPaidDto {
  @IsString()
  orderId!: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}

@Controller('api/v1/billing')
@UseGuards(JwtAuthGuard, OrgRolesGuard)
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgs: OrgsService,
  ) {}

  @Get('plans')
  plans() {
    return this.billing.listPlans();
  }

  @Get('usage')
  usage(
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Query('orgId') orgId: string,
  ) {
    return this.billing.getOrgBilling(
      orgId,
      req.user.userId,
      req.user.isPlatformAdmin,
    );
  }

  @Get('orders')
  async orders(
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Query('orgId') orgId?: string,
  ) {
    // 无 orgId：查本人订单（含待建企业组织的已付单）
    if (!orgId) {
      return this.prisma.order.findMany({
        where: { createdBy: req.user.userId },
        include: { plan: true, org: true },
        orderBy: { createdAt: 'desc' },
      });
    }
    if (!req.user.isPlatformAdmin) {
      const m = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: req.user.userId } },
      });
      if (!m) {
        throw new ForbiddenException('无权查看订单');
      }
    }
    return this.prisma.order.findMany({
      where: { orgId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('orders')
  async createOrder(
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Body() dto: CreateOrderDto,
  ) {
    const plan = await this.prisma.plan.findUnique({
      where: { key: dto.planKey },
    });
    if (!plan) throw new NotFoundException('套餐不存在');

    const isEnterprise =
      plan.key === 'enterprise' || plan.key === 'team';

    // 企业套餐：允许无组织下单（开通后去「组织」页创建）
    if (isEnterprise && !dto.orgId) {
      const inEnterprise = await this.prisma.orgMember.findFirst({
        where: {
          userId: req.user.userId,
          org: {
            subscription: {
              plan: { key: { in: ['enterprise', 'team'] } },
            },
          },
        },
      });
      if (inEnterprise) {
        throw new ForbiddenException('已加入企业组织，请在本组织下增购席位');
      }
      const openOrder = await this.prisma.order.findFirst({
        where: {
          createdBy: req.user.userId,
          planId: plan.id,
          orgId: null,
          status: { in: ['pending', 'paid'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (openOrder?.status === 'pending') {
        throw new BadRequestException(
          '已有待确认的企业套餐订单，请等待开通后再下单',
        );
      }
      if (openOrder?.status === 'paid') {
        throw new BadRequestException(
          '已有已支付的企业套餐订单，请先到「组织」页创建企业组织',
        );
      }
      const order = await this.prisma.order.create({
        data: {
          orgId: null,
          planId: plan.id,
          amountCents: plan.priceCents,
          status: 'pending',
          note: dto.note || '企业套餐待确认付款（开通后创建组织）',
          createdBy: req.user.userId,
        },
        include: { plan: true },
      });
      await this.audit.log({
        actorId: req.user.userId,
        action: 'billing.create_order',
        resourceType: 'order',
        resourceId: order.id,
        detail: { planKey: plan.key, noOrg: true },
      });
      return order;
    }

    if (!dto.orgId) {
      throw new ForbiddenException('请指定组织后再下单');
    }

    if (!req.user.isPlatformAdmin) {
      const m = await this.prisma.orgMember.findUnique({
        where: {
          orgId_userId: { orgId: dto.orgId, userId: req.user.userId },
        },
      });
      if (!m) {
        throw new ForbiddenException('无权下单');
      }
      if (m.role !== 'org_owner' && m.role !== 'org_admin') {
        throw new ForbiddenException('仅组织管理员或创建者可下单');
      }
    }
    const order = await this.prisma.order.create({
      data: {
        orgId: dto.orgId,
        planId: plan.id,
        amountCents: plan.priceCents,
        status: 'pending',
        note: dto.note || '待人工确认付款',
        createdBy: req.user.userId,
      },
      include: { plan: true },
    });
    await this.audit.log({
      orgId: dto.orgId,
      actorId: req.user.userId,
      action: 'billing.create_order',
      resourceType: 'order',
      resourceId: order.id,
    });
    return order;
  }

  @Post('orders/mark-paid')
  @PlatformAdmin()
  async markPaid(
    @Req() req: { user: { userId: string } },
    @Body() dto: MarkPaidDto,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: { plan: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    const paymentMethod = dto.paymentMethod || PaymentMethod.manual;
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        paymentMethod,
      },
      include: { plan: true },
    });
    // 已有组织：直接开通套餐
    // 个人单无 orgId：落到下单人个人工作区
    // 企业单无组织：仅标记已付，等用户创建组织
    if (order.orgId) {
      await this.billing.assignPlan(
        order.orgId,
        order.plan.key,
        req.user.userId,
        `订单 ${order.id} 已确认付款（${paymentMethod}）`,
      );
    } else {
      const isEnterprise =
        order.plan.key === 'enterprise' || order.plan.key === 'team';
      if (!isEnterprise && order.createdBy) {
        const ws = await this.orgs.ensurePersonalWorkspace(order.createdBy);
        await this.billing.assignPlan(
          ws.id,
          order.plan.key,
          req.user.userId,
          `订单 ${order.id} 已确认付款（${paymentMethod}）`,
        );
        return this.prisma.order.update({
          where: { id: order.id },
          data: { orgId: ws.id },
          include: { plan: true },
        });
      }
    }
    return updated;
  }

  @Post('assign-plan')
  @PlatformAdmin()
  assign(
    @Req() req: { user: { userId: string } },
    @Body() dto: AssignPlanDto,
  ) {
    return this.billing.assignPlan(
      dto.orgId,
      dto.planKey,
      req.user.userId,
      dto.note,
    );
  }
}

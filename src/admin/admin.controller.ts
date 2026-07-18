import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus, Prisma, SubscriptionStatus, UserStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OrgRolesGuard, PlatformAdmin } from '../common/org-roles.guard';
import { AuditService } from '../audit/audit.service';
import { OrgsService } from '../orgs/orgs.service';
import { PrismaService } from '../prisma/prisma.service';

class PatchUserDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  /** 设为异常/封禁时必填；恢复正常可选备注 */
  @ValidateIf((o: PatchUserDto) => o.status === 'abnormal' || o.status === 'banned')
  @IsString()
  @MinLength(2, { message: '请填写状态变更原因（至少 2 字）' })
  statusReason?: string;

  @IsOptional()
  @IsBoolean()
  isPlatformAdmin?: boolean;
}

class CreatePlanDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,62}$/, {
    message: 'key 须为小写字母开头，仅含小写字母/数字/下划线',
  })
  key!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(0)
  maxMembers!: number;

  @IsInt()
  @Min(0)
  maxReviewsMonth!: number;

  @IsInt()
  @Min(0)
  retentionDays!: number;

  @IsInt()
  @Min(0)
  storageMb!: number;

  /** 价格（分） */
  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class PatchPlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxMembers?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxReviewsMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  retentionDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  storageMb?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@PlatformAdmin()
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgs: OrgsService,
  ) {}

  /** 平台超管：全站用户 */
  @Get('users')
  async listUsers(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const statusFilter =
      status && ['normal', 'abnormal', 'banned'].includes(status)
        ? { status: status as UserStatus }
        : {};

    const where = {
      ...statusFilter,
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' as const } },
              { phone: { contains: q } },
              { displayName: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * size,
        take: size,
        select: {
          id: true,
          email: true,
          phone: true,
          displayName: true,
          avatarUrl: true,
          isPlatformAdmin: true,
          isActive: true,
          status: true,
          statusReason: true,
          statusChangedAt: true,
          statusChangedBy: true,
          createdAt: true,
          memberships: {
            select: {
              role: true,
              org: { select: { id: true, name: true, slug: true } },
            },
          },
          _count: { select: { uploadedReports: true } },
        },
      }),
    ]);

    return { total, page: p, pageSize: size, items };
  }

  @Patch('users/:id')
  async patchUser(
    @Param('id') id: string,
    @Body() dto: PatchUserDto,
    @Req() req: { user: { userId: string } },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');

    if (dto.status === undefined && dto.isPlatformAdmin === undefined) {
      throw new BadRequestException('没有可更新的字段');
    }

    if (id === req.user.userId && dto.status && dto.status !== 'normal') {
      throw new BadRequestException('不能将自己设为异常或封禁');
    }

    const data: Prisma.UserUpdateInput = {};

    if (dto.status !== undefined) {
      if (dto.status !== 'normal') {
        const reason = dto.statusReason?.trim();
        if (!reason || reason.length < 2) {
          throw new BadRequestException('设为异常或封禁时必须填写原因');
        }
        data.status = dto.status;
        data.statusReason = reason;
        data.isActive = false;
      } else {
        data.status = 'normal';
        data.statusReason = dto.statusReason?.trim() || null;
        data.isActive = true;
      }
      data.statusChangedAt = new Date();
      data.statusChangedBy = req.user.userId;
    }

    if (dto.isPlatformAdmin !== undefined) {
      data.isPlatformAdmin = dto.isPlatformAdmin;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        phone: true,
        displayName: true,
        isPlatformAdmin: true,
        isActive: true,
        status: true,
        statusReason: true,
        statusChangedAt: true,
        statusChangedBy: true,
      },
    });

    await this.audit.log({
      actorId: req.user.userId,
      action: 'admin.user.update',
      resourceType: 'user',
      resourceId: id,
      detail: {
        status: dto.status ?? null,
        statusReason: dto.statusReason ?? null,
        isPlatformAdmin: dto.isPlatformAdmin ?? null,
      } as Prisma.InputJsonValue,
    });

    return updated;
  }

  /** 平台超管：全部企业组织（免费/个人套餐工作区不在此展示） */
  @Get('orgs')
  async listOrgs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
  ) {
    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const where: Prisma.OrganizationWhereInput = {
      subscription: {
        plan: { key: { in: ['enterprise', 'team'] } },
      },
    };
    if (q) {
      where.AND = [
        {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
            {
              owner: {
                OR: [
                  { displayName: { contains: q, mode: 'insensitive' } },
                  { phone: { contains: q } },
                ],
              },
            },
          ],
        },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * size,
        take: size,
        include: {
          owner: {
            select: { id: true, email: true, phone: true, displayName: true },
          },
          subscription: { include: { plan: true } },
          _count: { select: { members: true, reports: true } },
        },
      }),
    ]);

    return { total, page: p, pageSize: size, items };
  }

  /** 平台超管：禁用组织（不可删除、不可移除成员） */
  @Patch('orgs/:id/status')
  async setOrgStatus(
    @Param('id') id: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Body() body: { disabled: boolean },
  ) {
    if (!req.user.isPlatformAdmin) {
      throw new ForbiddenException('仅平台管理员可操作');
    }
    return this.orgs.setDisabled(id, req.user.userId, Boolean(body.disabled));
  }

  /** 平台超管：全站订阅 */
  @Get('subscriptions')
  async listSubscriptions(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('planKey') planKey?: string,
  ) {
    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const where: Prisma.SubscriptionWhereInput = {};
    if (status && Object.values(SubscriptionStatus).includes(status as SubscriptionStatus)) {
      where.status = status as SubscriptionStatus;
    }
    if (planKey) {
      where.plan = { key: planKey };
    }
    if (q) {
      where.OR = [
        { org: { name: { contains: q, mode: 'insensitive' } } },
        { org: { slug: { contains: q, mode: 'insensitive' } } },
        { org: { owner: { displayName: { contains: q, mode: 'insensitive' } } } },
        { org: { owner: { phone: { contains: q, mode: 'insensitive' } } } },
        { org: { owner: { email: { contains: q, mode: 'insensitive' } } } },
        { plan: { name: { contains: q, mode: 'insensitive' } } },
        { plan: { key: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (p - 1) * size,
        take: size,
        include: {
          plan: true,
          org: {
            select: {
              id: true,
              name: true,
              slug: true,
              owner: {
                select: {
                  id: true,
                  displayName: true,
                  phone: true,
                  email: true,
                },
              },
              _count: { select: { members: true } },
            },
          },
        },
      }),
    ]);

    return { total, page: p, pageSize: size, items };
  }

  /** 平台超管：全站订单 */
  @Get('orders')
  async listOrders(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('planKey') planKey?: string,
  ) {
    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const where: Prisma.OrderWhereInput = {};
    if (status && Object.values(OrderStatus).includes(status as OrderStatus)) {
      where.status = status as OrderStatus;
    }
    if (planKey) {
      where.plan = { key: planKey };
    }
    if (q) {
      where.OR = [
        { org: { name: { contains: q, mode: 'insensitive' } } },
        { org: { slug: { contains: q, mode: 'insensitive' } } },
        { org: { owner: { displayName: { contains: q, mode: 'insensitive' } } } },
        { org: { owner: { phone: { contains: q, mode: 'insensitive' } } } },
        { plan: { name: { contains: q, mode: 'insensitive' } } },
        { plan: { key: { contains: q, mode: 'insensitive' } } },
        { id: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * size,
        take: size,
        include: {
          plan: true,
          org: {
            select: {
              id: true,
              name: true,
              slug: true,
              owner: {
                select: {
                  id: true,
                  displayName: true,
                  phone: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return { total, page: p, pageSize: size, items };
  }

  /** 平台超管：订单详情 */
  @Get('orders/:id')
  async getOrder(@Param('id') id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        plan: true,
        org: {
          select: {
            id: true,
            name: true,
            slug: true,
            owner: {
              select: {
                id: true,
                displayName: true,
                phone: true,
                email: true,
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');

    let creator: {
      id: string;
      displayName: string;
      phone: string | null;
      email: string | null;
    } | null = null;
    if (order.createdBy) {
      creator = await this.prisma.user.findUnique({
        where: { id: order.createdBy },
        select: {
          id: true,
          displayName: true,
          phone: true,
          email: true,
        },
      });
    }

    return { ...order, creator };
  }

  /** 平台超管：套餐列表（含下架） */
  @Get('plans')
  listPlans() {
    return this.prisma.plan.findMany({
      orderBy: [{ isActive: 'desc' }, { priceCents: 'asc' }],
      include: {
        _count: { select: { subscriptions: true, orders: true } },
      },
    });
  }

  /** 平台超管：创建套餐 */
  @Post('plans')
  async createPlan(
    @Req() req: { user: { userId: string } },
    @Body() dto: CreatePlanDto,
  ) {
    const exists = await this.prisma.plan.findUnique({ where: { key: dto.key } });
    if (exists) throw new BadRequestException(`套餐 key 已存在：${dto.key}`);

    const plan = await this.prisma.plan.create({
      data: {
        key: dto.key,
        name: dto.name,
        maxMembers: dto.maxMembers,
        maxReviewsMonth: dto.maxReviewsMonth,
        retentionDays: dto.retentionDays,
        storageMb: dto.storageMb,
        priceCents: dto.priceCents,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.log({
      actorId: req.user.userId,
      action: 'plan.create',
      resourceType: 'plan',
      resourceId: plan.id,
      detail: { key: plan.key, name: plan.name },
    });
    return plan;
  }

  /** 平台超管：更新套餐（key 不可改） */
  @Patch('plans/:id')
  async updatePlan(
    @Param('id') id: string,
    @Req() req: { user: { userId: string } },
    @Body() dto: PatchPlanDto,
  ) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('套餐不存在');

    const updated = await this.prisma.plan.update({
      where: { id },
      data: {
        name: dto.name,
        maxMembers: dto.maxMembers,
        maxReviewsMonth: dto.maxReviewsMonth,
        retentionDays: dto.retentionDays,
        storageMb: dto.storageMb,
        priceCents: dto.priceCents,
        isActive: dto.isActive,
      },
    });
    await this.audit.log({
      actorId: req.user.userId,
      action: 'plan.update',
      resourceType: 'plan',
      resourceId: id,
      detail: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  /**
   * 平台超管：删除套餐
   * - 默认软删（isActive=false）
   * - ?hard=1 且无订阅/订单引用时可物理删除
   */
  @Delete('plans/:id')
  async deletePlan(
    @Param('id') id: string,
    @Query('hard') hard: string | undefined,
    @Req() req: { user: { userId: string } },
  ) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: true, orders: true } } },
    });
    if (!plan) throw new NotFoundException('套餐不存在');

    if (hard === '1' || hard === 'true') {
      if (plan._count.subscriptions > 0 || plan._count.orders > 0) {
        throw new BadRequestException(
          `仍有 ${plan._count.subscriptions} 个订阅、${plan._count.orders} 个订单引用，无法物理删除；请先下架`,
        );
      }
      await this.prisma.plan.delete({ where: { id } });
      await this.audit.log({
        actorId: req.user.userId,
        action: 'plan.delete',
        resourceType: 'plan',
        resourceId: id,
        detail: { key: plan.key, hard: true },
      });
      return { ok: true, hard: true };
    }

    const updated = await this.prisma.plan.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      actorId: req.user.userId,
      action: 'plan.deactivate',
      resourceType: 'plan',
      resourceId: id,
      detail: { key: plan.key },
    });
    return updated;
  }
}

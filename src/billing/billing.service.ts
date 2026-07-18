import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private periodKey(d = new Date()): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  async listPlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceCents: 'asc' },
    });
  }

  async getOrgBilling(orgId: string, userId: string, isPlatformAdmin: boolean) {
    // 订阅管理对组织内任意成员开放（含普通 member）
    if (!isPlatformAdmin) {
      const m = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId } },
      });
      if (!m) {
        throw new ForbiddenException('无权查看计费信息');
      }
    }
    const sub = await this.prisma.subscription.findUnique({
      where: { orgId },
      include: { plan: true },
    });
    const period = this.periodKey();
    const usage = await this.prisma.usageRecord.groupBy({
      by: ['metric'],
      where: { orgId, period },
      _sum: { amount: true },
    });
    return {
      subscription: sub,
      period,
      usage: usage.map((u) => ({
        metric: u.metric,
        amount: u._sum.amount ?? 0,
      })),
    };
  }

  /** 平台管理员人工开通/切换套餐 */
  async assignPlan(
    orgId: string,
    planKey: string,
    actorId: string,
    note?: string,
  ) {
    const plan = await this.prisma.plan.findUnique({ where: { key: planKey } });
    if (!plan) throw new NotFoundException('套餐不存在');
    const sub = await this.prisma.subscription.upsert({
      where: { orgId },
      create: {
        orgId,
        planId: plan.id,
        status: 'active',
        note: note || '人工开通',
      },
      update: {
        planId: plan.id,
        status: 'active',
        note: note || '人工开通',
        startedAt: new Date(),
      },
      include: { plan: true },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'billing.change_plan',
      resourceType: 'subscription',
      resourceId: sub.id,
      detail: { planKey, note },
    });
    return sub;
  }
}

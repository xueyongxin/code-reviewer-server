import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole, Prisma, ReportStatus, ReportVisibility } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const READ_ONLY_ROLES: OrgRole[] = ['billing_viewer', 'auditor'];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertMember(orgId: string, userId: string, admin: boolean) {
    if (admin) return 'org_owner' as const;
    const m = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!m) throw new ForbiddenException('你不是该组织成员');
    return m.role;
  }

  private assertNotReadOnly(role: OrgRole | 'org_owner') {
    if (READ_ONLY_ROLES.includes(role as OrgRole)) {
      throw new ForbiddenException('只读角色（账单查看/审计）不可上传或删除审查记录');
    }
  }

  /** 禁用组织不可写入审查记录 */
  private async assertOrgWritable(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, status: true },
    });
    if (!org) throw new NotFoundException('组织不存在');
    if (org.status === 'disabled') {
      throw new ForbiddenException('组织已禁用，无法同步审查记录');
    }
  }

  private periodKey(d = new Date()): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private async resolvePlanLimits(orgId: string): Promise<{
    maxReviewsMonth: number;
    retentionDays: number;
    storageMb: number;
  }> {
    const sub = await this.prisma.subscription.findUnique({
      where: { orgId },
      include: { plan: true },
    });
    if (sub?.plan) {
      return {
        maxReviewsMonth: sub.plan.maxReviewsMonth,
        retentionDays: sub.plan.retentionDays,
        storageMb: sub.plan.storageMb,
      };
    }
    const free = await this.prisma.plan.findUnique({ where: { key: 'free' } });
    return {
      maxReviewsMonth: free?.maxReviewsMonth ?? 50,
      retentionDays: free?.retentionDays ?? 30,
      storageMb: free?.storageMb ?? 500,
    };
  }

  private retentionCutoff(retentionDays: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - Math.max(1, retentionDays));
    return d;
  }

  private payloadBytes(payload: unknown): number {
    try {
      return Buffer.byteLength(JSON.stringify(payload ?? null), 'utf8');
    } catch {
      return 0;
    }
  }

  private async orgStorageBytes(orgId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ bytes: bigint | number }>>`
      SELECT COALESCE(SUM(octet_length(payload::text)), 0) AS bytes
      FROM review_reports
      WHERE org_id = ${orgId}
    `;
    const raw = rows[0]?.bytes ?? 0;
    return typeof raw === 'bigint' ? Number(raw) : Number(raw);
  }

  async upload(
    orgId: string,
    userId: string,
    isPlatformAdmin: boolean,
    body: {
      clientReportId?: string;
      repoUrl: string;
      branch?: string;
      prNumber?: string;
      commitSha?: string;
      status?: ReportStatus;
      visibility?: ReportVisibility;
      issueCount?: number;
      totalDurationMs?: number;
      clientVersion?: string;
      summary?: string;
      payload: unknown;
    },
  ) {
    const role = await this.assertMember(orgId, userId, isPlatformAdmin);
    this.assertNotReadOnly(role);
    await this.assertOrgWritable(orgId);

    const limits = await this.resolvePlanLimits(orgId);
    const period = this.periodKey();
    const used = await this.prisma.usageRecord.aggregate({
      where: { orgId, period, metric: 'reviews' },
      _sum: { amount: true },
    });
    const count = used._sum.amount ?? 0;
    if (count >= limits.maxReviewsMonth) {
      throw new ForbiddenException(
        `本月审查次数已达套餐上限（${limits.maxReviewsMonth}），请联系管理员升级`,
      );
    }

    const newBytes = this.payloadBytes(body.payload);
    let oldBytes = 0;
    let existing:
      | { id: string; payload: Prisma.JsonValue }
      | null = null;
    if (body.clientReportId) {
      existing = await this.prisma.reviewReport.findUnique({
        where: {
          orgId_clientReportId: {
            orgId,
            clientReportId: body.clientReportId,
          },
        },
        select: { id: true, payload: true },
      });
      if (existing) oldBytes = this.payloadBytes(existing.payload);
    }
    const usedBytes = await this.orgStorageBytes(orgId);
    const nextBytes = usedBytes - oldBytes + newBytes;
    const capBytes = limits.storageMb * 1024 * 1024;
    if (nextBytes > capBytes) {
      throw new ForbiddenException(
        `云端存储已达套餐上限（${limits.storageMb} MB），请删除旧报告或升级套餐`,
      );
    }

    const data = {
      orgId,
      uploaderId: userId,
      clientReportId: body.clientReportId || null,
      repoUrl: body.repoUrl,
      branch: body.branch,
      prNumber: body.prNumber,
      commitSha: body.commitSha,
      status: body.status ?? 'success',
      visibility: body.visibility ?? 'private',
      issueCount: body.issueCount ?? 0,
      totalDurationMs: body.totalDurationMs,
      clientVersion: body.clientVersion,
      summary: body.summary,
      payload: body.payload as Prisma.InputJsonValue,
    };

    let report;
    const isNew = !existing;
    if (body.clientReportId) {
      report = await this.prisma.reviewReport.upsert({
        where: {
          orgId_clientReportId: {
            orgId,
            clientReportId: body.clientReportId,
          },
        },
        create: data,
        update: {
          ...data,
          clientReportId: body.clientReportId,
        },
      });
    } else {
      report = await this.prisma.reviewReport.create({ data });
    }

    // 仅首次创建计费，重复同步同一 clientReportId 不计用量
    if (isNew) {
      await this.prisma.usageRecord.create({
        data: {
          orgId,
          metric: 'reviews',
          amount: 1,
          period: this.periodKey(),
          meta: { reportId: report.id },
        },
      });
    }

    await this.audit.log({
      orgId,
      actorId: userId,
      action: isNew ? 'report.upload' : 'report.resync',
      resourceType: 'review_report',
      resourceId: report.id,
      detail: {
        repoUrl: body.repoUrl,
        issueCount: report.issueCount,
        billed: isNew,
        payloadBytes: newBytes,
      },
    });

    return report;
  }

  async list(
    orgId: string,
    userId: string,
    isPlatformAdmin: boolean,
    query: { page?: number; pageSize?: number; repoUrl?: string },
  ) {
    const role = await this.assertMember(orgId, userId, isPlatformAdmin);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 20));
    const limits = await this.resolvePlanLimits(orgId);
    const cutoff = this.retentionCutoff(limits.retentionDays);

    // 懒清理：删除超出保留期的报告
    await this.prisma.reviewReport.deleteMany({
      where: { orgId, createdAt: { lt: cutoff } },
    });

    const where: Prisma.ReviewReportWhereInput = {
      orgId,
      createdAt: { gte: cutoff },
      ...(query.repoUrl ? { repoUrl: { contains: query.repoUrl } } : {}),
    };
    // 非管理员只看自己的 private + 组织可见；auditor 可看全部
    if (!isPlatformAdmin && !['org_owner', 'org_admin', 'auditor'].includes(role)) {
      where.OR = [
        { visibility: 'org' },
        { uploaderId: userId },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.reviewReport.count({ where }),
      this.prisma.reviewReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          clientReportId: true,
          repoUrl: true,
          branch: true,
          prNumber: true,
          commitSha: true,
          status: true,
          visibility: true,
          issueCount: true,
          totalDurationMs: true,
          summary: true,
          createdAt: true,
          uploader: {
            select: { id: true, displayName: true, email: true },
          },
        },
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async get(id: string, userId: string, isPlatformAdmin: boolean) {
    const report = await this.prisma.reviewReport.findUnique({
      where: { id },
      include: {
        uploader: {
          select: { id: true, displayName: true, email: true },
        },
      },
    });
    if (!report) throw new NotFoundException('报告不存在');
    const role = await this.assertMember(
      report.orgId,
      userId,
      isPlatformAdmin,
    );
    const limits = await this.resolvePlanLimits(report.orgId);
    const cutoff = this.retentionCutoff(limits.retentionDays);
    if (report.createdAt < cutoff) {
      await this.prisma.reviewReport.delete({ where: { id } }).catch(() => null);
      throw new NotFoundException('报告已超过套餐保留期并已清理');
    }
    if (
      report.visibility === 'private' &&
      report.uploaderId !== userId &&
      !isPlatformAdmin &&
      !['org_owner', 'org_admin', 'auditor'].includes(role)
    ) {
      throw new ForbiddenException('无权查看该报告');
    }
    return report;
  }

  async remove(id: string, userId: string, isPlatformAdmin: boolean) {
    const report = await this.prisma.reviewReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('报告不存在');
    const role = await this.assertMember(
      report.orgId,
      userId,
      isPlatformAdmin,
    );
    this.assertNotReadOnly(role);
    if (
      report.uploaderId !== userId &&
      !isPlatformAdmin &&
      !['org_owner', 'org_admin'].includes(role)
    ) {
      throw new ForbiddenException('无权删除');
    }
    await this.prisma.reviewReport.delete({ where: { id } });
    await this.audit.log({
      orgId: report.orgId,
      actorId: userId,
      action: 'report.delete',
      resourceType: 'review_report',
      resourceId: id,
    });
    return { ok: true };
  }
}

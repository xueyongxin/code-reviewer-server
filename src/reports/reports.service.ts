import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReportStatus, ReportVisibility } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

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

  private periodKey(d = new Date()): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
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
    await this.assertMember(orgId, userId, isPlatformAdmin);

    // 配额：月审查次数
    const sub = await this.prisma.subscription.findUnique({
      where: { orgId },
      include: { plan: true },
    });
    if (sub) {
      const period = this.periodKey();
      const used = await this.prisma.usageRecord.aggregate({
        where: { orgId, period, metric: 'reviews' },
        _sum: { amount: true },
      });
      const count = used._sum.amount ?? 0;
      if (count >= sub.plan.maxReviewsMonth) {
        throw new ForbiddenException(
          `本月审查次数已达套餐上限（${sub.plan.maxReviewsMonth}），请联系管理员升级`,
        );
      }
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

    await this.prisma.usageRecord.create({
      data: {
        orgId,
        metric: 'reviews',
        amount: 1,
        period: this.periodKey(),
        meta: { reportId: report.id },
      },
    });

    await this.audit.log({
      orgId,
      actorId: userId,
      action: 'report.upload',
      resourceType: 'review_report',
      resourceId: report.id,
      detail: { repoUrl: body.repoUrl, issueCount: report.issueCount },
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

    const where: Prisma.ReviewReportWhereInput = {
      orgId,
      ...(query.repoUrl ? { repoUrl: { contains: query.repoUrl } } : {}),
    };
    // 非管理员只看自己的 private + 组织可见
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

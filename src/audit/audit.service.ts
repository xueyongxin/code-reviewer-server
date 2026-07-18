import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    orgId?: string | null;
    actorId?: string | null;
    action: string;
    resourceType?: string;
    resourceId?: string;
    ip?: string;
    userAgent?: string;
    requestId?: string;
    detail?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        orgId: input.orgId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
        detail: input.detail ?? undefined,
      },
    });
  }

  async list(params: {
    orgId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const where = params.orgId ? { orgId: params.orgId } : {};
    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actor: { select: { id: true, email: true, displayName: true } },
        },
      }),
    ]);
    return { total, page, pageSize, items };
  }
}

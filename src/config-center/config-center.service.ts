import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** 递归剥离疑似密钥字段，云端不存明文 Token */
function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (
      /token|secret|password|apikey|api_key|access_key|private_key/i.test(k)
    ) {
      continue;
    }
    if (k === 'env' && v && typeof v === 'object') {
      const envOut: Record<string, unknown> = {};
      for (const [ek, ev] of Object.entries(v as Record<string, unknown>)) {
        if (/token|secret|password|key/i.test(ek)) {
          envOut[ek] = ''; // 仅保留键名，值为空
        } else {
          envOut[ek] = ev;
        }
      }
      out[k] = envOut;
      continue;
    }
    out[k] = stripSecrets(v);
  }
  return out;
}

@Injectable()
export class ConfigCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertMember(orgId: string, userId: string, admin: boolean) {
    if (admin) return;
    const m = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!m) throw new ForbiddenException('你不是该组织成员');
  }

  private async assertAdmin(orgId: string, userId: string, admin: boolean) {
    if (admin) return;
    const m = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!m || !['org_owner', 'org_admin'].includes(m.role)) {
      throw new ForbiddenException('需要组织管理员权限');
    }
  }

  async get(orgId: string, userId: string, isPlatformAdmin: boolean) {
    await this.assertMember(orgId, userId, isPlatformAdmin);
    const config = await this.prisma.orgConfig.findUnique({ where: { orgId } });
    if (!config) throw new NotFoundException('组织配置不存在');
    return config;
  }

  async put(
    orgId: string,
    userId: string,
    isPlatformAdmin: boolean,
    payload: unknown,
  ) {
    await this.assertAdmin(orgId, userId, isPlatformAdmin);
    const safe = stripSecrets(payload) as Prisma.InputJsonValue;
    const current = await this.prisma.orgConfig.findUnique({ where: { orgId } });
    if (!current) throw new NotFoundException('组织配置不存在');

    const nextVersion = current.version + 1;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orgConfigVersion.create({
        data: {
          orgId,
          version: current.version,
          payload: current.payload as Prisma.InputJsonValue,
          updatedBy: current.updatedBy,
        },
      });
      return tx.orgConfig.update({
        where: { orgId },
        data: {
          version: nextVersion,
          payload: safe,
          updatedBy: userId,
        },
      });
    });

    await this.audit.log({
      orgId,
      actorId: userId,
      action: 'config.update',
      resourceType: 'org_config',
      resourceId: updated.id,
      detail: { version: nextVersion },
    });
    return updated;
  }

  async versions(orgId: string, userId: string, isPlatformAdmin: boolean) {
    await this.assertMember(orgId, userId, isPlatformAdmin);
    return this.prisma.orgConfigVersion.findMany({
      where: { orgId },
      orderBy: { version: 'desc' },
      take: 50,
      select: {
        id: true,
        version: true,
        updatedBy: true,
        createdAt: true,
        payload: true,
      },
    });
  }

  async getVersion(
    orgId: string,
    version: number,
    userId: string,
    isPlatformAdmin: boolean,
  ) {
    await this.assertMember(orgId, userId, isPlatformAdmin);
    const row = await this.prisma.orgConfigVersion.findUnique({
      where: { orgId_version: { orgId, version } },
    });
    if (!row) throw new NotFoundException('配置版本不存在');
    return row;
  }

  /** 将历史版本 payload 写回当前配置（会再归档现版本） */
  async rollback(
    orgId: string,
    version: number,
    userId: string,
    isPlatformAdmin: boolean,
  ) {
    const row = await this.getVersion(orgId, version, userId, isPlatformAdmin);
    return this.put(
      orgId,
      userId,
      isPlatformAdmin,
      row.payload as Record<string, unknown>,
    );
  }
}

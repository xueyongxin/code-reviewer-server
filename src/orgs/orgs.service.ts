import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole, OrgStatus } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { normalizePhone } from '../auth/phone.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLIENT_AUTH_WEB_BASE_KEY,
  DEFAULT_CLIENT_AUTH_WEB_BASE,
} from '../public/client-config.keys';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MANAGE_ROLES: OrgRole[] = ['org_owner', 'org_admin'];
const INVITE_ROLES: OrgRole[] = ['org_admin', 'member'];

@Injectable()
export class OrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private slugify(name: string): string {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'org';
    return `${base}-${randomUUID().slice(0, 8)}`;
  }

  private inviteToken(): string {
    return createHash('sha256')
      .update(randomBytes(32))
      .digest('hex')
      .slice(0, 32);
  }

  private async notifyUser(
    userId: string,
    orgId: string | null,
    title: string,
    body: string,
  ) {
    try {
      await this.prisma.notification.create({
        data: { userId, orgId, title, body },
      });
    } catch {
      // 站内信失败不阻断主流程
    }
  }

  /** 邀请链接域名：优先配置中心 client.auth_web_base */
  private async webBase(): Promise<string> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: CLIENT_AUTH_WEB_BASE_KEY },
    });
    const fromDb =
      typeof row?.value === 'string' && row.value.trim()
        ? row.value.trim()
        : '';
    return (
      fromDb ||
      process.env.ADMIN_WEB_BASE ||
      process.env.CLIENT_AUTH_WEB_BASE ||
      DEFAULT_CLIENT_AUTH_WEB_BASE
    ).replace(/\/$/, '');
  }

  private isEnterprisePlanKey(key?: string | null) {
    return key === 'enterprise' || key === 'team';
  }

  /**
   * 确保用户有个人工作区（free 套餐）：用于订阅计费 / Sync / 审查记录。
   * 不出现在「组织」菜单与超管企业组织列表（按套餐 key 过滤）。
   * 若已是企业成员则原样返回企业组织。
   */
  async ensurePersonalWorkspace(userId: string): Promise<{
    id: string;
    name: string;
    slug: string;
    planKey: string;
    kind: 'personal' | 'enterprise';
  }> {
    const existing = await this.prisma.orgMember.findUnique({
      where: { userId },
      include: {
        org: {
          include: { subscription: { include: { plan: true } } },
        },
      },
    });
    if (existing) {
      const planKey = existing.org.subscription?.plan?.key || 'free';
      return {
        id: existing.org.id,
        name: existing.org.name,
        slug: existing.org.slug,
        planKey,
        kind: this.isEnterprisePlanKey(planKey) ? 'enterprise' : 'personal',
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, phone: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const freePlan = await this.prisma.plan.findUnique({
      where: { key: 'free' },
    });
    if (!freePlan) {
      throw new BadRequestException('免费套餐未配置，请先执行 seed');
    }

    const label =
      (user.displayName && user.displayName.trim()) ||
      (user.phone ? `用户${user.phone.slice(-4)}` : '用户');
    const name = `${label}的个人工作区`;

    const created = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name,
          slug: this.slugify(`personal-${userId.slice(0, 8)}`),
          ownerId: userId,
          status: 'active',
        },
      });
      await tx.orgMember.create({
        data: { orgId: org.id, userId, role: 'org_owner' },
      });
      await tx.orgConfig.create({
        data: {
          orgId: org.id,
          version: 1,
          payload: {
            llmPolicy: { providers: [] },
            mcpTemplates: [],
            rulePack: { enabledRuleIds: [], customRules: [] },
            methodIds: [],
            pipelineTemplates: [],
            reportFormats: ['md', 'html'],
            notifyOnComplete: true,
          },
        },
      });
      await tx.subscription.create({
        data: {
          orgId: org.id,
          planId: freePlan.id,
          status: 'active',
          note: '注册自动开通免费个人工作区',
        },
      });
      return org;
    });

    await this.audit.log({
      orgId: created.id,
      actorId: userId,
      action: 'org.personal_workspace_create',
      resourceType: 'organization',
      resourceId: created.id,
      detail: { planKey: 'free' },
    });

    return {
      id: created.id,
      name: created.name,
      slug: created.slug,
      planKey: 'free',
      kind: 'personal',
    };
  }

  /** 用户当前是否已在某个企业组织 */
  private async findEnterpriseMembership(userId: string) {
    const m = await this.prisma.orgMember.findUnique({
      where: { userId },
      include: {
        org: {
          include: {
            subscription: { include: { plan: true } },
            _count: { select: { members: true } },
          },
        },
      },
    });
    if (!m) return null;
    if (!this.isEnterprisePlanKey(m.org.subscription?.plan?.key)) return null;
    return m;
  }

  /** 新建企业组织资格 */
  async createEligibility(userId: string) {
    const enterpriseMem = await this.findEnterpriseMembership(userId);
    if (enterpriseMem) {
      return {
        canCreate: false,
        reason: '已加入企业组织，不可再创建',
        hasPaidEnterpriseOrder: false,
      };
    }
    const enterprisePlan = await this.prisma.plan.findUnique({
      where: { key: 'enterprise' },
    });
    if (!enterprisePlan) {
      return {
        canCreate: false,
        reason: '企业套餐未配置',
        hasPaidEnterpriseOrder: false,
      };
    }
    // 仅未挂靠组织的已付企业单可用来新建（防止转让退出后复用旧单再建组织）
    const paid = await this.prisma.order.findFirst({
      where: {
        createdBy: userId,
        status: 'paid',
        planId: enterprisePlan.id,
        orgId: null,
      },
      orderBy: { paidAt: 'desc' },
    });
    if (!paid) {
      return {
        canCreate: false,
        reason: '请先在订阅管理购买企业套餐并完成开通',
        hasPaidEnterpriseOrder: false,
      };
    }
    return {
      canCreate: true,
      reason: null as string | null,
      hasPaidEnterpriseOrder: true,
      orderId: paid.id,
    };
  }

  /** 用户侧「组织」菜单：仅企业组织 */
  async listForUser(userId: string) {
    const rows = await this.prisma.orgMember.findMany({
      where: { userId },
      include: {
        org: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
                phone: true,
                email: true,
              },
            },
            subscription: { include: { plan: true } },
            _count: { select: { members: true, reports: true } },
          },
        },
      },
    });
    return rows.filter((r) =>
      this.isEnterprisePlanKey(r.org.subscription?.plan?.key),
    );
  }

  /** 新建企业组织：仅已购企业套餐且当前无企业组织 */
  async create(userId: string, name: string) {
    const elig = await this.createEligibility(userId);
    if (!elig.canCreate) {
      throw new BadRequestException(elig.reason || '无法创建企业组织');
    }

    const enterprisePlan = await this.prisma.plan.findUniqueOrThrow({
      where: { key: 'enterprise' },
    });
    const paid = await this.prisma.order.findFirst({
      where: {
        createdBy: userId,
        status: 'paid',
        planId: enterprisePlan.id,
        orgId: null,
      },
      orderBy: { paidAt: 'desc' },
    });
    if (!paid) {
      throw new BadRequestException('未找到可用于开通的企业套餐订单');
    }

    // 若仍挂着非企业占位成员关系，先清掉
    const existing = await this.prisma.orgMember.findUnique({
      where: { userId },
      include: {
        org: {
          include: {
            subscription: { include: { plan: true } },
            _count: { select: { members: true } },
          },
        },
      },
    });
    if (existing && this.isEnterprisePlanKey(existing.org.subscription?.plan?.key)) {
      throw new BadRequestException('已加入企业组织，不可再创建');
    }

    const org = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        const leaveOrgId = existing.orgId;
        const sole =
          existing.org.ownerId === userId && existing.org._count.members <= 1;
        await tx.orgMember.delete({ where: { userId } });
        if (sole) {
          await tx.organization.delete({ where: { id: leaveOrgId } }).catch(() => undefined);
        }
      }
      const created = await tx.organization.create({
        data: {
          name: name.trim(),
          slug: this.slugify(name),
          ownerId: userId,
          status: 'active',
        },
      });
      await tx.orgMember.create({
        data: { orgId: created.id, userId, role: 'org_owner' },
      });
      await tx.orgConfig.create({
        data: {
          orgId: created.id,
          version: 1,
          payload: {
            llmPolicy: { providers: [] },
            mcpTemplates: [],
            rulePack: { enabledRuleIds: [], customRules: [] },
            methodIds: [],
            pipelineTemplates: [],
            reportFormats: ['md', 'html'],
            notifyOnComplete: true,
          },
        },
      });
      await tx.subscription.create({
        data: {
          orgId: created.id,
          planId: enterprisePlan.id,
          status: 'active',
          note: `订单 ${paid.id} 开通企业组织`,
        },
      });
      // 把已支付企业订单挂到新组织
      await tx.order.update({
        where: { id: paid.id },
        data: { orgId: created.id },
      });
      return created;
    });

    await this.audit.log({
      orgId: org.id,
      actorId: userId,
      action: 'org.create',
      resourceType: 'organization',
      resourceId: org.id,
    });
    return org;
  }

  async rename(orgId: string, actorId: string, name: string) {
    await this.assertOrgActive(orgId);
    await this.assertRole(orgId, actorId, ['org_owner'], false);
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('组织名称不能为空');
    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { name: trimmed },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'org.rename',
      resourceType: 'organization',
      resourceId: orgId,
      detail: { name: trimmed },
    });
    return updated;
  }

  async get(orgId: string, userId: string, isPlatformAdmin: boolean) {
    await this.assertMember(orgId, userId, isPlatformAdmin);
    return this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        owner: {
          select: {
            id: true,
            displayName: true,
            phone: true,
            email: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        subscription: { include: { plan: true } },
        config: true,
      },
    });
  }

  async listMembers(orgId: string, userId: string, isPlatformAdmin: boolean) {
    await this.assertMember(orgId, userId, isPlatformAdmin);
    return this.prisma.orgMember.findMany({
      where: { orgId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 邀请：分享链接 和/或 手机号。
   * 未注册不报错，返回邀请链接；注册登录后自动加入。
   */
  async invite(
    orgId: string,
    actorId: string,
    params: { phone?: string; role?: OrgRole },
    isPlatformAdmin: boolean,
  ) {
    await this.assertOrgActive(orgId);
    await this.assertRole(orgId, actorId, MANAGE_ROLES, isPlatformAdmin, {
      allowPlatformAdmin: false,
    });

    const role = params.role || 'member';
    if (!INVITE_ROLES.includes(role)) {
      throw new BadRequestException('邀请角色仅可为组织管理员或成员');
    }

    const phone = params.phone ? normalizePhone(params.phone) : undefined;
    if (phone) {
      const user = await this.prisma.user.findUnique({ where: { phone } });
      if (user) {
        const enterpriseMem = await this.findEnterpriseMembership(user.id);
        if (enterpriseMem && enterpriseMem.orgId !== orgId) {
          throw new BadRequestException(
            '该用户已加入其他企业组织，须先退出后再邀请',
          );
        }
        if (enterpriseMem?.orgId === orgId) {
          throw new BadRequestException('该用户已是本组织成员');
        }
      }
    }

    await this.assertSeatAvailable(orgId);

    const token = this.inviteToken();
    const invite = await this.prisma.orgInvite.create({
      data: {
        id: randomUUID(),
        orgId,
        token,
        phone: phone || null,
        role,
        status: 'pending',
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        createdBy: actorId,
      },
    });

    // 已注册：直接加入
    if (phone) {
      const user = await this.prisma.user.findUnique({ where: { phone } });
      if (user) {
        await this.joinOrgAs(orgId, user.id, role, actorId);
        await this.prisma.orgInvite.update({
          where: { id: invite.id },
          data: {
            status: 'accepted',
            acceptedBy: user.id,
            acceptedAt: new Date(),
          },
        });
        await this.audit.log({
          orgId,
          actorId,
          action: 'member.invite_direct',
          resourceType: 'org_member',
          detail: { phone, role, userId: user.id },
        });
        const org = await this.prisma.organization.findUnique({
          where: { id: orgId },
          select: { name: true },
        });
        await this.notifyUser(
          user.id,
          orgId,
          '已加入组织',
          `你已加入「${org?.name || '组织'}」，角色：${role}`,
        );
        const base = await this.webBase();
        return {
          mode: 'joined' as const,
          phone,
          role,
          inviteId: invite.id,
          inviteUrl: `${base}/invite/${token}`,
        };
      }
    }

    await this.audit.log({
      orgId,
      actorId,
      action: 'member.invite_link',
      resourceType: 'org_invite',
      resourceId: invite.id,
      detail: { phone: phone || null, role },
    });

    const base = await this.webBase();
    return {
      mode: 'link' as const,
      phone: phone || null,
      role,
      inviteId: invite.id,
      token,
      expiresAt: invite.expiresAt,
      inviteUrl: `${base}/invite/${token}`,
      message: phone
        ? '该手机号尚未注册，已生成邀请链接；对方注册登录后将自动加入'
        : '已生成邀请链接，分享给对方即可',
    };
  }

  async listInvites(orgId: string, actorId: string, isPlatformAdmin: boolean) {
    await this.assertRole(orgId, actorId, MANAGE_ROLES, isPlatformAdmin, {
      allowPlatformAdmin: false,
    });
    return this.prisma.orgInvite.findMany({
      where: { orgId, status: 'pending', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phone: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        createdBy: true,
      },
    });
  }

  async revokeInvite(
    orgId: string,
    inviteId: string,
    actorId: string,
    isPlatformAdmin: boolean,
  ) {
    await this.assertRole(orgId, actorId, MANAGE_ROLES, isPlatformAdmin, {
      allowPlatformAdmin: false,
    });
    const invite = await this.prisma.orgInvite.findFirst({
      where: { id: inviteId, orgId },
    });
    if (!invite) throw new NotFoundException('邀请不存在');
    if (invite.status !== 'pending') {
      throw new BadRequestException('仅待处理邀请可撤销');
    }
    await this.prisma.orgInvite.update({
      where: { id: inviteId },
      data: { status: 'revoked' },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'member.invite_revoke',
      resourceType: 'org_invite',
      resourceId: inviteId,
    });
    return { ok: true };
  }

  async getInvitePreview(token: string) {
    const invite = await this.prisma.orgInvite.findUnique({
      where: { token },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            status: true,
            owner: { select: { displayName: true } },
          },
        },
      },
    });
    if (!invite) throw new NotFoundException('邀请不存在或已失效');
    if (invite.status !== 'pending') {
      throw new BadRequestException('邀请已使用或已撤销');
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      await this.prisma.orgInvite.update({
        where: { id: invite.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('邀请已过期');
    }
    if (invite.org.status === 'disabled') {
      throw new BadRequestException('该组织已被禁用，无法加入');
    }
    return {
      token: invite.token,
      orgName: invite.org.name,
      ownerName: invite.org.owner.displayName,
      role: invite.role,
      phone: invite.phone,
      expiresAt: invite.expiresAt,
    };
  }

  /** 登录用户接受邀请链接 */
  async acceptInvite(token: string, userId: string) {
    const invite = await this.prisma.orgInvite.findUnique({
      where: { token },
    });
    if (!invite || invite.status !== 'pending') {
      throw new BadRequestException('邀请无效');
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      await this.prisma.orgInvite.update({
        where: { id: invite.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('邀请已过期');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    if (invite.phone && user.phone && normalizePhone(user.phone) !== invite.phone) {
      throw new BadRequestException('请使用邀请所绑定的手机号登录后再加入');
    }

    await this.joinOrgAs(invite.orgId, userId, invite.role, userId);
    await this.prisma.orgInvite.update({
      where: { id: invite.id },
      data: {
        status: 'accepted',
        acceptedBy: userId,
        acceptedAt: new Date(),
      },
    });
    await this.audit.log({
      orgId: invite.orgId,
      actorId: userId,
      action: 'member.accept_invite',
      resourceType: 'org_invite',
      resourceId: invite.id,
    });
    const org = await this.prisma.organization.findUnique({
      where: { id: invite.orgId },
      select: { name: true },
    });
    if (invite.createdBy) {
      await this.notifyUser(
        invite.createdBy,
        invite.orgId,
        '邀请已接受',
        `${user.displayName || user.phone || '成员'} 已加入「${org?.name || '组织'}」`,
      );
    }
    return { ok: true, orgId: invite.orgId };
  }

  /** 注册/登录后：按手机号消费待处理邀请 */
  async consumePendingInvitesForUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.phone) return null;

    const phone = normalizePhone(user.phone);
    const invite = await this.prisma.orgInvite.findFirst({
      where: {
        phone,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!invite) return null;

    try {
      await this.joinOrgAs(invite.orgId, userId, invite.role, userId);
      await this.prisma.orgInvite.update({
        where: { id: invite.id },
        data: {
          status: 'accepted',
          acceptedBy: userId,
          acceptedAt: new Date(),
        },
      });
      await this.audit.log({
        orgId: invite.orgId,
        actorId: userId,
        action: 'member.auto_join_invite',
        resourceType: 'org_invite',
        resourceId: invite.id,
      });
      const org = await this.prisma.organization.findUnique({
        where: { id: invite.orgId },
        select: { name: true },
      });
      if (invite.createdBy) {
        await this.notifyUser(
          invite.createdBy,
          invite.orgId,
          '邀请已接受',
          `${user.displayName || user.phone || '成员'} 已通过邀请加入「${org?.name || '组织'}」`,
        );
      }
      await this.notifyUser(
        userId,
        invite.orgId,
        '已加入组织',
        `你已加入「${org?.name || '组织'}」，角色：${invite.role}`,
      );
      return { orgId: invite.orgId, role: invite.role };
    } catch {
      return null;
    }
  }

  async updateMemberRole(
    orgId: string,
    actorId: string,
    targetUserId: string,
    role: OrgRole,
    isPlatformAdmin: boolean,
  ) {
    await this.assertOrgActive(orgId);
    await this.assertRole(orgId, actorId, MANAGE_ROLES, isPlatformAdmin, {
      allowPlatformAdmin: false,
    });
    if (!['org_admin', 'member', 'billing_viewer', 'auditor'].includes(role)) {
      throw new BadRequestException(
        '仅可调整为组织管理员、成员、账单查看或审计',
      );
    }
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('组织不存在');
    if (targetUserId === org.ownerId) {
      throw new BadRequestException('不能变更创建者角色，请先转让所有权');
    }
    const member = await this.prisma.orgMember.update({
      where: { orgId_userId: { orgId, userId: targetUserId } },
      data: { role },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'member.update_role',
      resourceType: 'org_member',
      resourceId: member.id,
      detail: { targetUserId, role },
    });
    return member;
  }

  async removeMember(
    orgId: string,
    actorId: string,
    targetUserId: string,
    isPlatformAdmin: boolean,
  ) {
    // 超管不可移除成员
    if (isPlatformAdmin) {
      const m = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: actorId } },
      });
      if (!m || !MANAGE_ROLES.includes(m.role)) {
        throw new ForbiddenException('平台管理员不可移除组织成员');
      }
    } else {
      await this.assertRole(orgId, actorId, MANAGE_ROLES, false);
    }
    await this.assertOrgActive(orgId);

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('组织不存在');
    if (targetUserId === org.ownerId) {
      throw new BadRequestException('不能移除组织创建者');
    }
    if (targetUserId === actorId) {
      throw new BadRequestException('请使用「退出组织」');
    }
    await this.prisma.orgMember.delete({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'member.remove',
      resourceType: 'user',
      resourceId: targetUserId,
    });
    return { ok: true };
  }

  /** 成员 / 组织管理员自行退出；所有者须先转让 */
  async leaveOrg(orgId: string, userId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('组织不存在');
    if (org.ownerId === userId) {
      throw new BadRequestException(
        '创建者不能直接退出，请先转让所有权或解散组织',
      );
    }
    const m = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!m) throw new ForbiddenException('你不是该组织成员');

    await this.prisma.orgMember.delete({
      where: { orgId_userId: { orgId, userId } },
    });
    await this.audit.log({
      orgId,
      actorId: userId,
      action: 'member.leave',
      resourceType: 'user',
      resourceId: userId,
    });
    return { ok: true };
  }

  async transferOwnership(
    orgId: string,
    actorId: string,
    targetUserId: string,
  ) {
    await this.assertOrgActive(orgId);
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('组织不存在');
    if (org.ownerId !== actorId) {
      throw new ForbiddenException('仅创建者可转让所有权');
    }
    if (targetUserId === actorId) {
      throw new BadRequestException('不能转让给自己');
    }
    const target = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!target) throw new BadRequestException('目标用户不是本组织成员');

    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: orgId },
        data: { ownerId: targetUserId },
      });
      await tx.orgMember.update({
        where: { orgId_userId: { orgId, userId: targetUserId } },
        data: { role: 'org_owner' },
      });
      await tx.orgMember.update({
        where: { orgId_userId: { orgId, userId: actorId } },
        data: { role: 'org_admin' },
      });
    });

    await this.audit.log({
      orgId,
      actorId,
      action: 'org.transfer_ownership',
      resourceType: 'organization',
      resourceId: orgId,
      detail: { from: actorId, to: targetUserId },
    });
    return { ok: true, ownerId: targetUserId };
  }

  /** 超管禁用/启用组织 */
  async setDisabled(
    orgId: string,
    actorId: string,
    disabled: boolean,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('组织不存在');

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: disabled
        ? {
            status: 'disabled' as OrgStatus,
            disabledAt: new Date(),
            disabledBy: actorId,
          }
        : {
            status: 'active' as OrgStatus,
            disabledAt: null,
            disabledBy: null,
          },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: disabled ? 'org.disable' : 'org.enable',
      resourceType: 'organization',
      resourceId: orgId,
    });
    return updated;
  }

  /**
   * 删除/解散组织：仅所有者；有其他成员时禁止。
   * 超管请使用禁用，不走删除。
   */
  async deleteOrg(orgId: string, actorId: string, isPlatformAdmin: boolean) {
    if (isPlatformAdmin) {
      throw new ForbiddenException('平台管理员请使用禁用组织，不可删除');
    }
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: { _count: { select: { members: true } } },
    });
    if (!org) throw new NotFoundException('组织不存在');
    if (org.ownerId !== actorId) {
      throw new ForbiddenException('仅组织创建者可解散组织');
    }
    if (org._count.members > 1) {
      throw new BadRequestException(
        `组织下仍有 ${org._count.members} 名成员，请先移除其他成员后再解散`,
      );
    }

    await this.prisma.organization.delete({ where: { id: orgId } });
    await this.audit.log({
      actorId,
      action: 'org.delete',
      resourceType: 'organization',
      resourceId: orgId,
      detail: { name: org.name, slug: org.slug },
    });
    return { ok: true, id: orgId };
  }

  /**
   * 加入企业组织：
   * - 已在其他企业组织 → 拒绝（须先退出）
   * - 仅挂非企业占位 → 清掉再加入
   */
  private async joinOrgAs(
    orgId: string,
    userId: string,
    role: OrgRole,
    actorId: string,
  ) {
    await this.assertOrgActive(orgId);
    await this.assertSeatAvailable(orgId, userId);

    const existing = await this.prisma.orgMember.findUnique({
      where: { userId },
      include: {
        org: {
          include: {
            subscription: { include: { plan: true } },
            _count: { select: { members: true } },
          },
        },
      },
    });

    if (existing?.orgId === orgId) {
      return existing;
    }

    if (
      existing &&
      this.isEnterprisePlanKey(existing.org.subscription?.plan?.key)
    ) {
      throw new BadRequestException(
        '你已加入其他企业组织，须先退出后再接受邀请',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        const leaveOrgId = existing.orgId;
        const wasSoleOwner =
          existing.org.ownerId === userId && existing.org._count.members <= 1;
        await tx.orgMember.delete({ where: { userId } });
        if (wasSoleOwner) {
          await tx.organization
            .delete({ where: { id: leaveOrgId } })
            .catch(() => undefined);
        }
      }
      await tx.orgMember.create({
        data: { orgId, userId, role },
      });
    });

    await this.audit.log({
      orgId,
      actorId,
      action: 'member.join',
      resourceType: 'user',
      resourceId: userId,
      detail: { role },
    });
  }

  private async assertSeatAvailable(orgId: string, joiningUserId?: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { members: true } },
      },
    });
    if (!org) throw new NotFoundException('组织不存在');
    if (joiningUserId) {
      const already = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: joiningUserId } },
      });
      if (already) return;
    }
    const max = org.subscription?.plan?.maxMembers ?? 3;
    if (org._count.members >= max) {
      throw new BadRequestException(`组织席位已满（上限 ${max}）`);
    }
    if (!this.isEnterprisePlanKey(org.subscription?.plan?.key)) {
      throw new BadRequestException('仅企业组织可邀请成员');
    }
  }

  private async assertOrgActive(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('组织不存在');
    if (org.status === 'disabled') {
      throw new ForbiddenException('组织已禁用');
    }
  }

  private async assertMember(
    orgId: string,
    userId: string,
    isPlatformAdmin: boolean,
  ) {
    if (isPlatformAdmin) return;
    const m = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!m) throw new ForbiddenException('你不是该组织成员');
  }

  private async assertRole(
    orgId: string,
    userId: string,
    roles: OrgRole[],
    isPlatformAdmin: boolean,
    opts?: { allowPlatformAdmin?: boolean },
  ) {
    const allowPlatformAdmin = opts?.allowPlatformAdmin !== false;
    if (isPlatformAdmin && allowPlatformAdmin) return;
    const m = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!m || !roles.includes(m.role)) {
      throw new ForbiddenException('权限不足');
    }
  }
}

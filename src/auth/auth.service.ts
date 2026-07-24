import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { OrgsService } from '../orgs/orgs.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  LoginDto,
  LoginPhoneDto,
  LoginSmsDto,
  RegisterDto,
  RegisterPhoneDto,
  SendEmailCodeDto,
  SendSmsDto,
} from './auth.dto';
import { normalizePhone } from './phone.util';

export const SMS_TTL_MS = 5 * 60 * 1000;
export const EMAIL_CODE_TTL_MS = 5 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;

type DesktopAuthPayload = {
  state: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: string | number;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    displayName: string;
    avatarUrl?: string | null;
    isPlatformAdmin: boolean;
  };
  /** 个人工作区或企业组织；桌面端落盘用，避免再依赖仅含企业的 /orgs */
  org?: { id: string; name: string; slug?: string } | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly orgs: OrgsService,
  ) {}

  private hashCode(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** 登录/注册后：消费邀请 → 企业组织；否则确保个人工作区并返回 */
  private async resolveOrgAfterAuth(userId: string) {
    const joined = await this.orgs.consumePendingInvitesForUser(userId);
    if (joined?.orgId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: joined.orgId },
        select: { id: true, name: true, slug: true },
      });
      if (org) return org;
    }
    const workspace = await this.orgs.ensurePersonalWorkspace(userId);
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    };
  }

  /** 非正常状态禁止登录；附带管理员备注原因 */
  private assertAccountUsable(user: {
    status?: string;
    isActive: boolean;
    statusReason?: string | null;
  }) {
    const status = user.status || (user.isActive ? 'normal' : 'banned');
    if (status === 'normal' && user.isActive) return;
    if (status === 'abnormal') {
      const reason = user.statusReason?.trim();
      throw new UnauthorizedException(
        reason ? `账号异常，无法登录：${reason}` : '账号异常，无法登录',
      );
    }
    if (status === 'banned') {
      const reason = user.statusReason?.trim();
      throw new UnauthorizedException(
        reason ? `账号已封禁：${reason}` : '账号已封禁',
      );
    }
    throw new UnauthorizedException('账号不可用');
  }

  /** 供换绑手机等场景复用 */
  async verifySmsCode(phone: string, input: string) {
    return this.assertChallengeCode('sms', phone, input);
  }

  /** 供换绑邮箱等场景复用 */
  async verifyEmailCode(email: string, input: string) {
    return this.assertChallengeCode('email', email.toLowerCase(), input);
  }

  private async assertChallengeCode(
    kind: string,
    subject: string,
    input: string,
  ) {
    const codeHash = this.hashCode(input.trim());
    // 单步原子消费：codeHash 在 WHERE 中，并发请求只有一个 count>0
    const occupied = await this.prisma.authChallenge.updateMany({
      where: {
        kind,
        subject,
        codeHash,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (occupied.count > 0) return;
    // 区分「码错误」与「过期/已用」
    const anyValid = await this.prisma.authChallenge.findFirst({
      where: { kind, subject, consumedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    throw new BadRequestException(
      anyValid ? '验证码错误' : '验证码已过期，请重新获取',
    );
  }

  private isOtpDebug(): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    return (
      process.env.SMS_DEBUG === '1' || process.env.EMAIL_DEBUG === '1'
    );
  }

  private async saveChallenge(
    kind: string,
    subject: string,
    rawCode: string,
    ttlMs: number,
    payload?: DesktopAuthPayload,
  ) {
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.prisma.authChallenge.deleteMany({
      where: { kind, subject, consumedAt: null },
    });
    await this.prisma.authChallenge.create({
      data: {
        kind,
        subject,
        codeHash: this.hashCode(rawCode),
        payload: payload
          ? (JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        expiresAt,
      },
    });
  }

  private async consumeChallenge(
    kind: string,
    rawCode: string,
  ): Promise<DesktopAuthPayload | null> {
    const codeHash = this.hashCode(rawCode);
    // 事务内 find → consume，避免并发双花
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.authChallenge.findFirst({
        where: {
          kind,
          codeHash,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!row) return null;
      const occupied = await tx.authChallenge.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (occupied.count === 0) return null;
      return (row.payload as DesktopAuthPayload | null) ?? null;
    });
  }

  private async issueTokens(user: {
    id: string;
    email: string | null;
    phone: string | null;
    displayName: string;
    avatarUrl?: string | null;
    isPlatformAdmin: boolean;
  }) {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
    });
    const refreshRaw = randomUUID() + randomUUID();
    const tokenHash = createHash('sha256').update(refreshRaw).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });
    return {
      accessToken,
      refreshToken: refreshRaw,
      expiresIn: this.config.get('JWT_EXPIRES_IN') || '7d',
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? null,
        isPlatformAdmin: user.isPlatformAdmin,
      },
    };
  }

  /** 注册建账号；个人工作区在发 token 后由 resolveOrgAfterAuth / ensurePersonalWorkspace 创建 */
  private async createUserOnly(params: {
    email?: string | null;
    phone?: string | null;
    passwordHash?: string | null;
    displayName: string;
  }) {
    const user = await this.prisma.user.create({
      data: {
        email: params.email ?? null,
        phone: params.phone ?? null,
        passwordHash: params.passwordHash ?? null,
        displayName: params.displayName,
      },
    });
    return { user };
  }

  async register(dto: RegisterDto, meta?: { ip?: string; ua?: string }) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (exists) throw new BadRequestException('邮箱已被注册');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const result = await this.createUserOnly({
      email: dto.email.toLowerCase(),
      passwordHash,
      displayName: dto.displayName,
    });

    await this.audit.log({
      actorId: result.user.id,
      action: 'auth.register',
      resourceType: 'user',
      resourceId: result.user.id,
      ip: meta?.ip,
      userAgent: meta?.ua,
    });

    const tokens = await this.issueTokens(result.user);
    const org = await this.resolveOrgAfterAuth(result.user.id);
    return { ...tokens, org };
  }

  async sendSms(dto: SendSmsDto) {
    const phone = normalizePhone(dto.phone);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.saveChallenge('sms', phone, code, SMS_TTL_MS);

    await this.audit.log({
      action: 'auth.sms_send',
      detail: { phone, expiresIn: SMS_TTL_MS / 1000 },
    });

    /**
     * 验证码回传仅允许本地联调：
     * - SMS_DEBUG=1 或 EMAIL_DEBUG=1
     * - 且 NODE_ENV 不得为 production（生产误开也不回传）
     * 真实短信网关未接入前，非 DEBUG 环境用户无法收到验证码。
     */
    const isProd = process.env.NODE_ENV === 'production';
    const debugSms = this.isOtpDebug();
    return {
      ok: true,
      message: debugSms
        ? '验证码已生成（联调模式：响应含 code，未发真实短信）'
        : isProd
          ? '验证码已受理（请查收短信；若未配置短信通道请联系管理员）'
          : '验证码已生成（未开启 SMS_DEBUG/EMAIL_DEBUG，响应不含 code，且未发真实短信）',
      phone,
      expiresIn: SMS_TTL_MS / 1000,
      debug: debugSms,
      ...(debugSms ? { code } : {}),
    };
  }

  async sendEmailCode(dto: SendEmailCodeDto) {
    const email = dto.email.toLowerCase().trim();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.saveChallenge('email', email, code, EMAIL_CODE_TTL_MS);

    await this.audit.log({
      action: 'auth.email_send',
      detail: { email, expiresIn: EMAIL_CODE_TTL_MS / 1000 },
    });

    const isProd = process.env.NODE_ENV === 'production';
    const debugEmail = this.isOtpDebug();
    return {
      ok: true,
      message: debugEmail
        ? '验证码已生成（联调模式：响应含 code，未发真实邮件）'
        : isProd
          ? '验证码已受理（请查收邮件；若未配置邮件通道请联系管理员）'
          : '验证码已生成（未开启 SMS_DEBUG/EMAIL_DEBUG，响应不含 code，且未发真实邮件）',
      email,
      expiresIn: EMAIL_CODE_TTL_MS / 1000,
      debug: debugEmail,
      ...(debugEmail ? { code } : {}),
    };
  }

  async registerPhone(
    dto: RegisterPhoneDto,
    meta?: { ip?: string; ua?: string },
  ) {
    const phone = normalizePhone(dto.phone);
    await this.assertChallengeCode('sms', phone, dto.code);

    const exists = await this.prisma.user.findUnique({ where: { phone } });
    if (exists) throw new BadRequestException('手机号已注册');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const result = await this.createUserOnly({
      phone,
      passwordHash,
      displayName: dto.displayName,
    });

    await this.audit.log({
      actorId: result.user.id,
      action: 'auth.register_phone',
      resourceType: 'user',
      resourceId: result.user.id,
      detail: { phone },
      ip: meta?.ip,
      userAgent: meta?.ua,
    });

    const tokens = await this.issueTokens(result.user);
    const org = await this.resolveOrgAfterAuth(result.user.id);
    return { ...tokens, org };
  }

  async login(dto: LoginDto, meta?: { ip?: string; ua?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user || !user.passwordHash) {
      await this.audit.log({
        action: 'auth.login_failed',
        detail: { email: dto.email },
        ip: meta?.ip,
        userAgent: meta?.ua,
      });
      throw new UnauthorizedException('邮箱或密码错误');
    }
    this.assertAccountUsable(user);
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.audit.log({
        actorId: user.id,
        action: 'auth.login_failed',
        ip: meta?.ip,
        userAgent: meta?.ua,
      });
      throw new UnauthorizedException('邮箱或密码错误');
    }

    await this.audit.log({
      actorId: user.id,
      action: 'auth.login',
      ip: meta?.ip,
      userAgent: meta?.ua,
    });
    const tokens = await this.issueTokens(user);
    const org = await this.resolveOrgAfterAuth(user.id);
    return { ...tokens, org };
  }

  async loginPhone(dto: LoginPhoneDto, meta?: { ip?: string; ua?: string }) {
    const phone = normalizePhone(dto.phone);
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !user.passwordHash) {
      await this.audit.log({
        action: 'auth.login_phone_failed',
        detail: { phone },
        ip: meta?.ip,
        userAgent: meta?.ua,
      });
      throw new UnauthorizedException('手机号或密码错误');
    }
    this.assertAccountUsable(user);
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.audit.log({
        actorId: user.id,
        action: 'auth.login_phone_failed',
        detail: { phone },
        ip: meta?.ip,
        userAgent: meta?.ua,
      });
      throw new UnauthorizedException('手机号或密码错误');
    }

    await this.audit.log({
      actorId: user.id,
      action: 'auth.login_phone',
      detail: { phone },
      ip: meta?.ip,
      userAgent: meta?.ua,
    });
    const tokens = await this.issueTokens(user);
    const org = await this.resolveOrgAfterAuth(user.id);
    return { ...tokens, org };
  }

  async loginSms(dto: LoginSmsDto, meta?: { ip?: string; ua?: string }) {
    const phone = normalizePhone(dto.phone);
    await this.assertChallengeCode('sms', phone, dto.code);

    let user = await this.prisma.user.findUnique({ where: { phone } });
    let isNew = false;

    if (!user) {
      // 首次验证码登录 = 自动注册（随后 resolveOrgAfterAuth 会建个人工作区）
      isNew = true;
      const displayName = `用户${phone.slice(0, 3)}****${phone.slice(-4)}`;
      const created = await this.createUserOnly({
        phone,
        displayName,
      });
      user = created.user;
      await this.audit.log({
        actorId: user.id,
        action: 'auth.register_sms',
        resourceType: 'user',
        resourceId: user.id,
        detail: { phone },
        ip: meta?.ip,
        userAgent: meta?.ua,
      });
    } else if (user.status !== 'normal' || !user.isActive) {
      this.assertAccountUsable(user);
    }

    await this.audit.log({
      actorId: user.id,
      action: 'auth.login_sms',
      detail: { phone, isNew },
      ip: meta?.ip,
      userAgent: meta?.ua,
    });

    const tokens = await this.issueTokens(user);
    const org = await this.resolveOrgAfterAuth(user.id);
    return { ...tokens, org, isNew };
  }

  async refresh(refreshToken: string) {
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const row = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: { user: true },
    });
    if (!row || row.expiresAt < new Date()) {
      throw new UnauthorizedException('刷新令牌无效');
    }
    this.assertAccountUsable(row.user);
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(row.user);
  }

  async logout(refreshToken?: string) {
    if (!refreshToken) return { ok: true };
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * 网页登录成功后签发一次性桌面授权码（约 2 分钟有效），
   * 用于跳转 codereviewer://auth/callback
   */
  async issueDesktopCode(userId: string, state: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户无效');
    }
    this.assertAccountUsable(user);
    const tokens = await this.issueTokens(user);
    const org = await this.resolveOrgAfterAuth(userId);
    const code = randomUUID().replace(/-/g, '');
    await this.saveChallenge('desktop', state, code, CODE_TTL_MS, {
      state,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: tokens.user,
      org,
    });

    const redirectUri = `codereviewer://auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    return {
      code,
      expiresIn: 120,
      redirectUri,
      org,
    };
  }

  async exchangeDesktopCode(code: string, state: string) {
    const entry = await this.consumeChallenge('desktop', code);
    if (!entry) {
      throw new UnauthorizedException('授权码无效或已过期，请重新登录');
    }
    if (entry.state !== state) {
      throw new UnauthorizedException('授权状态不匹配，请从桌面端重新发起登录');
    }
    return {
      accessToken: entry.accessToken,
      refreshToken: entry.refreshToken,
      expiresIn: entry.expiresIn,
      user: entry.user,
      org: entry.org ?? null,
    };
  }

  /**
   * 桌面端已登录时签发网页交接码，浏览器用它换取会话并进入控制台。
   */
  async issueWebHandoff(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户无效');
    }
    this.assertAccountUsable(user);
    const tokens = await this.issueTokens(user);
    const org = await this.resolveOrgAfterAuth(userId);
    const code = randomUUID().replace(/-/g, '');
    await this.saveChallenge('web_handoff', 'web', code, CODE_TTL_MS, {
      state: 'web',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: tokens.user,
      org,
    });
    return { code, expiresIn: 120, org };
  }

  async exchangeWebHandoff(code: string) {
    const entry = await this.consumeChallenge('web_handoff', code);
    if (!entry) {
      throw new UnauthorizedException('交接码无效或已过期，请重新从桌面端打开');
    }
    return {
      accessToken: entry.accessToken,
      refreshToken: entry.refreshToken,
      expiresIn: entry.expiresIn,
      user: entry.user,
      org: entry.org ?? null,
    };
  }
}

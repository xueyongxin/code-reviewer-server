import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
  SendSmsDto,
} from './auth.dto';
import { normalizePhone } from './phone.util';

export const SMS_TTL_MS = 5 * 60 * 1000;

type SmsEntry = { code: string; expiresAt: number };

type DesktopAuthEntry = {
  state: string;
  expiresAt: number;
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    displayName: string;
    isPlatformAdmin: boolean;
  };
};

@Injectable()
export class AuthService {
  /** 内存验证码：手机号 → 码 + 过期时间（开发态假短信） */
  private readonly smsCodes = new Map<string, SmsEntry>();
  /** 桌面端一次性授权码 */
  private readonly desktopAuthCodes = new Map<string, DesktopAuthEntry>();
  /** 桌面端跳转网页控制台的一次性交接码 */
  private readonly webHandoffCodes = new Map<string, DesktopAuthEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly orgs: OrgsService,
  ) {}

  /** 登录/注册后消费手机号邀请，返回当前应落地的组织 */
  private async resolveOrgAfterAuth(userId: string) {
    const joined = await this.orgs.consumePendingInvitesForUser(userId);
    if (joined?.orgId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: joined.orgId },
        select: { id: true, name: true, slug: true },
      });
      return org;
    }
    const m = await this.prisma.orgMember.findUnique({
      where: { userId },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            slug: true,
            subscription: { select: { plan: { select: { key: true } } } },
          },
        },
      },
    });
    const key = m?.org?.subscription?.plan?.key;
    if (key === 'enterprise' || key === 'team') {
      return { id: m!.org.id, name: m!.org.name, slug: m!.org.slug };
    }
    return null;
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

  private assertSmsCode(phone: string, input: string) {
    const entry = this.smsCodes.get(phone);
    if (!entry || entry.expiresAt < Date.now()) {
      this.smsCodes.delete(phone);
      throw new BadRequestException('验证码已过期，请重新获取');
    }
    if (input.trim() !== entry.code) {
      throw new BadRequestException('验证码错误');
    }
    this.smsCodes.delete(phone);
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

  /** 注册只建账号，不建组织（加入/购买企业后再有组织） */
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
    const expiresAt = Date.now() + SMS_TTL_MS;
    this.smsCodes.set(phone, { code, expiresAt });

    await this.audit.log({
      action: 'auth.sms_send',
      detail: { phone, expiresIn: SMS_TTL_MS / 1000 },
    });

    // 开发态：把验证码返回给客户端，由右上角假短信弹窗展示
    return {
      ok: true,
      message: '验证码已发送',
      phone,
      code,
      expiresIn: SMS_TTL_MS / 1000,
    };
  }

  async registerPhone(
    dto: RegisterPhoneDto,
    meta?: { ip?: string; ua?: string },
  ) {
    const phone = normalizePhone(dto.phone);
    this.assertSmsCode(phone, dto.code);

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
    this.assertSmsCode(phone, dto.code);

    let user = await this.prisma.user.findUnique({ where: { phone } });
    let isNew = false;

    if (!user) {
      // 首次验证码登录 = 自动注册（不建组织）
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
    const code = randomUUID().replace(/-/g, '');
    const expiresAt = Date.now() + 2 * 60 * 1000;
    this.desktopAuthCodes.set(code, {
      state,
      expiresAt,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: tokens.user,
    });

    const redirectUri = `codereviewer://auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    return {
      code,
      expiresIn: 120,
      redirectUri,
    };
  }

  async exchangeDesktopCode(code: string, state: string) {
    const entry = this.desktopAuthCodes.get(code);
    if (!entry || entry.expiresAt < Date.now()) {
      this.desktopAuthCodes.delete(code);
      throw new UnauthorizedException('授权码无效或已过期，请重新登录');
    }
    if (entry.state !== state) {
      throw new UnauthorizedException('授权状态不匹配，请从桌面端重新发起登录');
    }
    this.desktopAuthCodes.delete(code);
    return {
      accessToken: entry.accessToken,
      refreshToken: entry.refreshToken,
      expiresIn: entry.expiresIn,
      user: entry.user,
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
    const code = randomUUID().replace(/-/g, '');
    const expiresAt = Date.now() + 2 * 60 * 1000;
    this.webHandoffCodes.set(code, {
      state: 'web',
      expiresAt,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: tokens.user,
    });
    return { code, expiresIn: 120 };
  }

  async exchangeWebHandoff(code: string) {
    const entry = this.webHandoffCodes.get(code);
    if (!entry || entry.expiresAt < Date.now()) {
      this.webHandoffCodes.delete(code);
      throw new UnauthorizedException('交接码无效或已过期，请重新从桌面端打开');
    }
    this.webHandoffCodes.delete(code);
    return {
      accessToken: entry.accessToken,
      refreshToken: entry.refreshToken,
      expiresIn: entry.expiresIn,
      user: entry.user,
    };
  }
}

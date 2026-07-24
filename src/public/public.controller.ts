import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OrgRolesGuard, PlatformAdmin } from '../common/org-roles.guard';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLIENT_API_BASE_KEY,
  CLIENT_AUTH_WEB_BASE_KEY,
  CLIENT_CORS_ORIGINS_KEY,
  CLIENT_DOWNLOAD_KEY,
  CLIENT_UPDATE_FEED_KEY,
  DEFAULT_CLIENT_API_BASE,
  DEFAULT_CLIENT_AUTH_WEB_BASE,
  DEFAULT_SITE_BRANDING,
  LEGAL_TERMS_KEY,
  SITE_BRANDING_KEY,
  type SiteBranding,
} from './client-config.keys';
import {
  DEFAULT_PRIVACY_POLICY,
  DEFAULT_USER_AGREEMENT,
} from './legal-terms.defaults';

export {
  CLIENT_API_BASE_KEY,
  CLIENT_AUTH_WEB_BASE_KEY,
  CLIENT_CORS_ORIGINS_KEY,
  CLIENT_DOWNLOAD_KEY,
  CLIENT_UPDATE_FEED_KEY,
  DEFAULT_CLIENT_API_BASE,
  DEFAULT_CLIENT_AUTH_WEB_BASE,
  DEFAULT_SITE_BRANDING,
  LEGAL_TERMS_KEY,
  SITE_BRANDING_KEY,
} from './client-config.keys';
export type { SiteBranding } from './client-config.keys';

export {
  DEFAULT_PRIVACY_POLICY,
  DEFAULT_USER_AGREEMENT,
} from './legal-terms.defaults';

class PatchClientConfigDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  apiBase?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  authWebBase?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v != null)
  @IsString()
  @MinLength(8)
  mac?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v != null)
  @IsString()
  @MinLength(8)
  win?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v != null)
  @IsString()
  @MinLength(8)
  linux?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** 桌面端自动更新 feed（electron-updater） */
  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v != null)
  @IsString()
  @MinLength(8)
  updateFeedUrl?: string;

  /** CORS 允许来源，逗号分隔；空则仅允许登录网页地址 */
  @IsOptional()
  @IsString()
  corsOrigins?: string;

  /** 网站 ICP 备案号 */
  @IsOptional()
  @IsString()
  icpBeian?: string;

  /** 站点名称 */
  @IsOptional()
  @IsString()
  brandName?: string;

  /** 站点 Logo 地址 */
  @IsOptional()
  @IsString()
  logoUrl?: string;

  /** 备案号跳转链接 */
  @IsOptional()
  @IsString()
  icpUrl?: string;

  /** 公安备案号 */
  @IsOptional()
  @IsString()
  psbBeian?: string;

  /** 公安备案跳转链接 */
  @IsOptional()
  @IsString()
  psbUrl?: string;

  /** 公安备案图标图片地址 */
  @IsOptional()
  @IsString()
  psbLogoSrc?: string;

  /** 公安备案图标跳转链接（单独） */
  @IsOptional()
  @IsString()
  psbLogoUrl?: string;

  /** 页脚版权文案 */
  @IsOptional()
  @IsString()
  copyright?: string;

  /** 联系邮箱 */
  @IsOptional()
  @IsString()
  contactEmail?: string;
}

class PatchLegalTermsDto {
  @IsOptional()
  @IsString()
  userAgreement?: string;

  @IsOptional()
  @IsString()
  privacyPolicy?: string;
}

type DownloadConfig = {
  version: string;
  mac: string;
  win: string;
  linux: string;
  notes: string;
};

type LegalTerms = {
  userAgreement: string;
  privacyPolicy: string;
  userAgreementUpdatedAt: string | null;
  privacyPolicyUpdatedAt: string | null;
};

@Controller()
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private asString(v: unknown, fallback: string) {
    return typeof v === 'string' && v.trim()
      ? v.trim().replace(/\/$/, '')
      : fallback;
  }

  private parseDownload(value: unknown): DownloadConfig {
    const obj =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const str = (k: string) =>
      typeof obj[k] === 'string' ? String(obj[k]).trim() : '';
    return {
      version: str('version') || '0.1.0',
      mac: str('mac'),
      win: str('win'),
      linux: str('linux'),
      notes: str('notes'),
    };
  }

  private parseSiteBranding(value: unknown): SiteBranding {
    const obj =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const str = (k: keyof SiteBranding, fallback: string) =>
      typeof obj[k] === 'string' ? String(obj[k]).trim() : fallback;
    return {
      brandName:
        str('brandName', DEFAULT_SITE_BRANDING.brandName) ||
        DEFAULT_SITE_BRANDING.brandName,
      logoUrl:
        str('logoUrl', DEFAULT_SITE_BRANDING.logoUrl) ||
        DEFAULT_SITE_BRANDING.logoUrl,
      icpBeian: str('icpBeian', DEFAULT_SITE_BRANDING.icpBeian),
      icpUrl:
        str('icpUrl', DEFAULT_SITE_BRANDING.icpUrl) ||
        DEFAULT_SITE_BRANDING.icpUrl,
      psbBeian: str('psbBeian', DEFAULT_SITE_BRANDING.psbBeian),
      psbUrl:
        str('psbUrl', DEFAULT_SITE_BRANDING.psbUrl) ||
        DEFAULT_SITE_BRANDING.psbUrl,
      psbLogoSrc:
        str('psbLogoSrc', DEFAULT_SITE_BRANDING.psbLogoSrc) ||
        DEFAULT_SITE_BRANDING.psbLogoSrc,
      psbLogoUrl:
        str('psbLogoUrl', DEFAULT_SITE_BRANDING.psbLogoUrl) ||
        DEFAULT_SITE_BRANDING.psbLogoUrl,
      copyright:
        str('copyright', DEFAULT_SITE_BRANDING.copyright) ||
        DEFAULT_SITE_BRANDING.copyright,
      contactEmail:
        str('contactEmail', DEFAULT_SITE_BRANDING.contactEmail) ||
        DEFAULT_SITE_BRANDING.contactEmail,
    };
  }

  private async readClientConfig() {
    const [apiRow, authRow, dlRow, feedRow, corsRow, brandingRow] =
      await Promise.all([
        this.prisma.systemSetting.findUnique({
          where: { key: CLIENT_API_BASE_KEY },
        }),
        this.prisma.systemSetting.findUnique({
          where: { key: CLIENT_AUTH_WEB_BASE_KEY },
        }),
        this.prisma.systemSetting.findUnique({
          where: { key: CLIENT_DOWNLOAD_KEY },
        }),
        this.prisma.systemSetting.findUnique({
          where: { key: CLIENT_UPDATE_FEED_KEY },
        }),
        this.prisma.systemSetting.findUnique({
          where: { key: CLIENT_CORS_ORIGINS_KEY },
        }),
        this.prisma.systemSetting.findUnique({
          where: { key: SITE_BRANDING_KEY },
        }),
      ]);
    const download = this.parseDownload(dlRow?.value);
    const branding = this.parseSiteBranding(brandingRow?.value);
    const updateFeedUrl =
      typeof feedRow?.value === 'string' ? feedRow.value.trim() : '';
    const corsOrigins =
      typeof corsRow?.value === 'string' ? corsRow.value.trim() : '';
    return {
      apiBase: this.asString(apiRow?.value, DEFAULT_CLIENT_API_BASE),
      authWebBase: this.asString(authRow?.value, DEFAULT_CLIENT_AUTH_WEB_BASE),
      updateFeedUrl,
      corsOrigins,
      ...download,
      ...branding,
    };
  }

  private parseLegalTerms(
    value: unknown,
    rowUpdatedAt?: Date | null,
  ): LegalTerms {
    const obj =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const str = (k: string, fallback: string) =>
      typeof obj[k] === 'string' && String(obj[k]).trim()
        ? String(obj[k]).trim()
        : fallback;
    const iso = (k: string) => {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      return rowUpdatedAt?.toISOString?.() ?? null;
    };
    return {
      userAgreement: str('userAgreement', DEFAULT_USER_AGREEMENT),
      privacyPolicy: str('privacyPolicy', DEFAULT_PRIVACY_POLICY),
      userAgreementUpdatedAt: iso('userAgreementUpdatedAt'),
      privacyPolicyUpdatedAt: iso('privacyPolicyUpdatedAt'),
    };
  }

  private async readLegalTerms(): Promise<LegalTerms> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: LEGAL_TERMS_KEY },
    });
    return this.parseLegalTerms(row?.value, row?.updatedAt ?? null);
  }

  /** 桌面端启动/登录前拉取；官网下载中心也用此接口（无需登录） */
  @Get('api/v1/public/client-config')
  getClientConfig() {
    return this.readClientConfig();
  }

  /** 官网文档页：用户协议 / 隐私协议（无需登录） */
  @Get('api/v1/public/legal-terms')
  getLegalTerms() {
    return this.readLegalTerms();
  }

  @Get('api/v1/admin/legal-terms')
  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  adminGetLegalTerms() {
    return this.readLegalTerms();
  }

  @Patch('api/v1/admin/legal-terms')
  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  async adminPatchLegalTerms(
    @Body() dto: PatchLegalTermsDto,
    @Req() req: { user: { userId: string } },
  ) {
    const current = await this.readLegalTerms();
    const now = new Date().toISOString();
    const next: LegalTerms = {
      userAgreement:
        dto.userAgreement !== undefined
          ? dto.userAgreement.trim() || DEFAULT_USER_AGREEMENT
          : current.userAgreement,
      privacyPolicy:
        dto.privacyPolicy !== undefined
          ? dto.privacyPolicy.trim() || DEFAULT_PRIVACY_POLICY
          : current.privacyPolicy,
      userAgreementUpdatedAt:
        dto.userAgreement !== undefined
          ? now
          : current.userAgreementUpdatedAt,
      privacyPolicyUpdatedAt:
        dto.privacyPolicy !== undefined
          ? now
          : current.privacyPolicyUpdatedAt,
    };

    await this.prisma.systemSetting.upsert({
      where: { key: LEGAL_TERMS_KEY },
      create: {
        key: LEGAL_TERMS_KEY,
        value: next,
        updatedBy: req.user.userId,
      },
      update: { value: next, updatedBy: req.user.userId },
    });

    await this.audit.log({
      actorId: req.user.userId,
      action: 'admin.legal_terms.update',
      resourceType: 'system_setting',
      detail: {
        key: LEGAL_TERMS_KEY,
        touched: {
          userAgreement: dto.userAgreement !== undefined,
          privacyPolicy: dto.privacyPolicy !== undefined,
        },
      },
    });

    return next;
  }

  /** 平台超管：查看/修改桌面端入口与下载地址 */
  @Get('api/v1/admin/client-config')
  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  adminGetClientConfig() {
    return this.readClientConfig();
  }

  @Patch('api/v1/admin/client-config')
  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  async adminPatchClientConfig(
    @Body() dto: PatchClientConfigDto,
    @Req() req: { user: { userId: string } },
  ) {
    const current = await this.readClientConfig();
    const apiBase = (dto.apiBase?.trim() || current.apiBase).replace(/\/$/, '');
    const authWebBase = (dto.authWebBase?.trim() || current.authWebBase).replace(
      /\/$/,
      '',
    );
    const download: DownloadConfig = {
      version:
        dto.version !== undefined ? dto.version.trim() || '0.1.0' : current.version,
      mac: dto.mac !== undefined ? dto.mac.trim() : current.mac,
      win: dto.win !== undefined ? dto.win.trim() : current.win,
      linux: dto.linux !== undefined ? dto.linux.trim() : current.linux,
      notes: dto.notes !== undefined ? dto.notes.trim() : current.notes,
    };
    const updateFeedUrl =
      dto.updateFeedUrl !== undefined
        ? dto.updateFeedUrl.trim().replace(/\/$/, '')
        : current.updateFeedUrl;
    const corsOrigins =
      dto.corsOrigins !== undefined
        ? dto.corsOrigins.trim()
        : current.corsOrigins;
    const branding: SiteBranding = {
      brandName:
        dto.brandName !== undefined
          ? dto.brandName.trim() || DEFAULT_SITE_BRANDING.brandName
          : current.brandName,
      logoUrl:
        dto.logoUrl !== undefined
          ? dto.logoUrl.trim() || DEFAULT_SITE_BRANDING.logoUrl
          : current.logoUrl,
      icpBeian:
        dto.icpBeian !== undefined ? dto.icpBeian.trim() : current.icpBeian,
      icpUrl:
        dto.icpUrl !== undefined
          ? dto.icpUrl.trim() || DEFAULT_SITE_BRANDING.icpUrl
          : current.icpUrl,
      psbBeian:
        dto.psbBeian !== undefined ? dto.psbBeian.trim() : current.psbBeian,
      psbUrl:
        dto.psbUrl !== undefined
          ? dto.psbUrl.trim() || DEFAULT_SITE_BRANDING.psbUrl
          : current.psbUrl,
      psbLogoSrc:
        dto.psbLogoSrc !== undefined
          ? dto.psbLogoSrc.trim() || DEFAULT_SITE_BRANDING.psbLogoSrc
          : current.psbLogoSrc,
      psbLogoUrl:
        dto.psbLogoUrl !== undefined
          ? dto.psbLogoUrl.trim() || DEFAULT_SITE_BRANDING.psbLogoUrl
          : current.psbLogoUrl,
      copyright:
        dto.copyright !== undefined
          ? dto.copyright.trim() || DEFAULT_SITE_BRANDING.copyright
          : current.copyright,
      contactEmail:
        dto.contactEmail !== undefined
          ? dto.contactEmail.trim() || DEFAULT_SITE_BRANDING.contactEmail
          : current.contactEmail,
    };

    await Promise.all([
      this.prisma.systemSetting.upsert({
        where: { key: CLIENT_API_BASE_KEY },
        create: {
          key: CLIENT_API_BASE_KEY,
          value: apiBase,
          updatedBy: req.user.userId,
        },
        update: { value: apiBase, updatedBy: req.user.userId },
      }),
      this.prisma.systemSetting.upsert({
        where: { key: CLIENT_AUTH_WEB_BASE_KEY },
        create: {
          key: CLIENT_AUTH_WEB_BASE_KEY,
          value: authWebBase,
          updatedBy: req.user.userId,
        },
        update: { value: authWebBase, updatedBy: req.user.userId },
      }),
      this.prisma.systemSetting.upsert({
        where: { key: CLIENT_DOWNLOAD_KEY },
        create: {
          key: CLIENT_DOWNLOAD_KEY,
          value: download,
          updatedBy: req.user.userId,
        },
        update: { value: download, updatedBy: req.user.userId },
      }),
      this.prisma.systemSetting.upsert({
        where: { key: CLIENT_UPDATE_FEED_KEY },
        create: {
          key: CLIENT_UPDATE_FEED_KEY,
          value: updateFeedUrl,
          updatedBy: req.user.userId,
        },
        update: { value: updateFeedUrl, updatedBy: req.user.userId },
      }),
      this.prisma.systemSetting.upsert({
        where: { key: CLIENT_CORS_ORIGINS_KEY },
        create: {
          key: CLIENT_CORS_ORIGINS_KEY,
          value: corsOrigins,
          updatedBy: req.user.userId,
        },
        update: { value: corsOrigins, updatedBy: req.user.userId },
      }),
      this.prisma.systemSetting.upsert({
        where: { key: SITE_BRANDING_KEY },
        create: {
          key: SITE_BRANDING_KEY,
          value: branding,
          updatedBy: req.user.userId,
        },
        update: { value: branding, updatedBy: req.user.userId },
      }),
    ]);

    await this.audit.log({
      actorId: req.user.userId,
      action: 'admin.client_config.update',
      resourceType: 'system_setting',
      detail: {
        apiBase,
        authWebBase,
        updateFeedUrl,
        corsOrigins,
        download,
        branding,
      },
    });

    return {
      apiBase,
      authWebBase,
      updateFeedUrl,
      corsOrigins,
      ...download,
      ...branding,
    };
  }
}

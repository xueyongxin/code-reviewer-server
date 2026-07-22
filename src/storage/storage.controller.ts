import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OrgRolesGuard, PlatformAdmin } from '../common/org-roles.guard';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLIENT_DOWNLOAD_KEY,
  CLIENT_UPDATE_FEED_KEY,
} from '../public/client-config.keys';
import { StorageService } from './storage.service';
import { normalizePublicDomain } from './storage.keys';

class PatchQiniuDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  accessKey?: string;

  @IsOptional()
  @IsString()
  secretKey?: string;

  @IsOptional()
  @IsString()
  bucket?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  region?: string;
}

class UploadTokenDto {
  @IsString()
  @MinLength(1)
  fileName!: string;

  @IsOptional()
  @IsString()
  keyPrefix?: string;
}

class CreateClientReleaseDto {
  @IsString()
  @MinLength(1)
  version!: string;

  @IsIn(['mac', 'win', 'linux'])
  platform!: 'mac' | 'win' | 'linux';

  @IsString()
  @MinLength(1)
  fileName!: string;

  @IsString()
  @MinLength(8)
  fileUrl!: string;

  @IsOptional()
  @IsString()
  fileKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  fileSize?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /** 设为该平台当前对外下载版本（默认 true） */
  @IsOptional()
  @IsBoolean()
  setAsLatest?: boolean;

  @IsOptional()
  @IsString()
  updateFeedUrl?: string;
}

@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@PlatformAdmin()
export class StorageController {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('storage/qiniu')
  async getQiniu() {
    return this.storage.getPublicConfig();
  }

  @Patch('storage/qiniu')
  async patchQiniu(
    @Body() dto: PatchQiniuDto,
    @Req() req: { user: { userId: string } },
  ) {
    const data = await this.storage.saveConfig(dto, req.user.userId);
    await this.audit.log({
      action: 'admin.storage_qiniu.update',
      actorId: req.user.userId,
      resourceType: 'system_setting',
      resourceId: 'storage.qiniu',
      detail: {
        enabled: data.enabled,
        bucket: data.bucket,
        domain: data.domain,
        region: data.region,
      },
    });
    return data;
  }

  @Post('storage/qiniu/upload-token')
  async uploadToken(@Body() dto: UploadTokenDto) {
    return this.storage.createUploadToken({
      fileName: dto.fileName,
      keyPrefix: dto.keyPrefix || 'client-releases',
    });
  }

  @Get('client-releases')
  async listReleases(
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('platform') platform?: string,
    @Query('version') version?: string,
  ) {
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw) || 20));
    const where: {
      platform?: string;
      version?: { contains: string; mode: 'insensitive' };
    } = {};
    if (platform && ['mac', 'win', 'linux'].includes(platform)) {
      where.platform = platform;
    }
    const ver = (version || '').trim();
    if (ver) {
      where.version = { contains: ver, mode: 'insensitive' };
    }
    const [total, items] = await Promise.all([
      this.prisma.clientRelease.count({ where }),
      this.prisma.clientRelease.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((r) => ({
        ...r,
        fileSize: r.fileSize == null ? null : Number(r.fileSize),
      })),
    };
  }

  @Post('client-releases')
  async createRelease(
    @Body() dto: CreateClientReleaseDto,
    @Req() req: { user: { userId: string } },
  ) {
    const version = dto.version.trim();
    const fileUrl = dto.fileUrl.trim();
    if (!/^https?:\/\//i.test(fileUrl)) {
      throw new BadRequestException('fileUrl 必须是 http(s) 地址');
    }
    const setAsLatest = dto.setAsLatest !== false;

    if (setAsLatest) {
      await this.prisma.clientRelease.updateMany({
        where: { platform: dto.platform, isLatest: true },
        data: { isLatest: false },
      });
    }

    const row = await this.prisma.clientRelease.create({
      data: {
        version,
        platform: dto.platform,
        fileName: dto.fileName.trim(),
        fileUrl,
        fileKey: dto.fileKey?.trim() || null,
        fileSize:
          dto.fileSize != null ? BigInt(dto.fileSize) : null,
        notes: dto.notes?.trim() || '',
        isLatest: setAsLatest,
        createdBy: req.user.userId,
      },
    });

    if (setAsLatest) {
      await this.syncDownloadConfig({
        platform: dto.platform,
        version,
        fileUrl,
        notes: dto.notes,
        updateFeedUrl: dto.updateFeedUrl,
        updatedBy: req.user.userId,
      });
    }

    await this.audit.log({
      action: 'admin.client_release.create',
      actorId: req.user.userId,
      resourceType: 'client_release',
      resourceId: row.id,
      detail: {
        version,
        platform: dto.platform,
        fileUrl,
        setAsLatest,
      },
    });

    return {
      ...row,
      fileSize: row.fileSize == null ? null : Number(row.fileSize),
    };
  }

  @Delete('client-releases/:id')
  async deleteRelease(
    @Param('id') id: string,
    @Req() req: { user: { userId: string } },
  ) {
    const existing = await this.prisma.clientRelease.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new BadRequestException('发布记录不存在');
    }
    await this.prisma.clientRelease.delete({ where: { id } });
    await this.audit.log({
      action: 'admin.client_release.delete',
      actorId: req.user.userId,
      resourceType: 'client_release',
      resourceId: id,
      detail: {
        version: existing.version,
        platform: existing.platform,
      },
    });
    return { ok: true };
  }

  /** 将某条记录设为该平台最新，并同步公开下载配置 */
  @Post('client-releases/:id/set-latest')
  async setLatest(
    @Param('id') id: string,
    @Req() req: { user: { userId: string } },
  ) {
    const row = await this.prisma.clientRelease.findUnique({ where: { id } });
    if (!row) throw new BadRequestException('发布记录不存在');

    await this.prisma.clientRelease.updateMany({
      where: { platform: row.platform, isLatest: true },
      data: { isLatest: false },
    });
    const updated = await this.prisma.clientRelease.update({
      where: { id },
      data: { isLatest: true },
    });
    await this.syncDownloadConfig({
      platform: row.platform as 'mac' | 'win' | 'linux',
      version: row.version,
      fileUrl: row.fileUrl,
      notes: row.notes,
      updatedBy: req.user.userId,
    });
    await this.audit.log({
      action: 'admin.client_release.set_latest',
      actorId: req.user.userId,
      resourceType: 'client_release',
      resourceId: id,
      detail: { platform: row.platform, version: row.version },
    });
    return {
      ...updated,
      fileSize: updated.fileSize == null ? null : Number(updated.fileSize),
    };
  }

  private async syncDownloadConfig(opts: {
    platform: 'mac' | 'win' | 'linux';
    version: string;
    fileUrl: string;
    notes?: string;
    updateFeedUrl?: string;
    updatedBy: string;
  }) {
    const prev = await this.prisma.systemSetting.findUnique({
      where: { key: CLIENT_DOWNLOAD_KEY },
    });
    const obj: Record<string, string> =
      prev?.value && typeof prev.value === 'object' && !Array.isArray(prev.value)
        ? Object.fromEntries(
            Object.entries(prev.value as Record<string, unknown>)
              .filter(([, v]) => typeof v === 'string')
              .map(([k, v]) => [k, String(v)]),
          )
        : {};
    obj.version = opts.version;
    obj[opts.platform] = opts.fileUrl;
    if (opts.notes != null && opts.notes.trim()) {
      obj.notes = opts.notes.trim();
    }
    await this.prisma.systemSetting.upsert({
      where: { key: CLIENT_DOWNLOAD_KEY },
      create: {
        key: CLIENT_DOWNLOAD_KEY,
        value: obj,
        updatedBy: opts.updatedBy,
      },
      update: {
        value: obj,
        updatedBy: opts.updatedBy,
      },
    });

    if (opts.updateFeedUrl != null) {
      const feed = opts.updateFeedUrl.trim();
      if (feed) {
        const domain = normalizePublicDomain(feed);
        await this.prisma.systemSetting.upsert({
          where: { key: CLIENT_UPDATE_FEED_KEY },
          create: {
            key: CLIENT_UPDATE_FEED_KEY,
            value: domain,
            updatedBy: opts.updatedBy,
          },
          update: {
            value: domain,
            updatedBy: opts.updatedBy,
          },
        });
      }
    }
  }
}

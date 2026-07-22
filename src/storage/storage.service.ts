import { BadRequestException, Injectable } from '@nestjs/common';
import * as qiniu from 'qiniu';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_QINIU_CONFIG,
  normalizePublicDomain,
  qiniuUploadHost,
  STORAGE_QINIU_KEY,
  type QiniuStorageConfig,
} from './storage.keys';

export type QiniuPublicConfig = Omit<QiniuStorageConfig, 'secretKey'> & {
  secretKeyConfigured: boolean;
  /** 掩码后的 secret，仅展示用 */
  secretKeyMasked: string;
};

@Injectable()
export class StorageService {
  private cache: QiniuStorageConfig | null = null;
  private cacheAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  private parseConfig(value: unknown): QiniuStorageConfig {
    const obj =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const str = (k: string) =>
      typeof obj[k] === 'string' ? String(obj[k]).trim() : '';
    return {
      enabled: obj.enabled === true || obj.enabled === 'true' || obj.enabled === 1,
      accessKey: str('accessKey'),
      secretKey: str('secretKey'),
      bucket: str('bucket'),
      domain: str('domain'),
      region: str('region') || 'z2',
    };
  }

  async getRawConfig(force = false): Promise<QiniuStorageConfig> {
    const now = Date.now();
    if (!force && this.cache && now - this.cacheAt < 30_000) {
      return this.cache;
    }
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: STORAGE_QINIU_KEY },
    });
    const cfg = row ? this.parseConfig(row.value) : { ...DEFAULT_QINIU_CONFIG };
    this.cache = cfg;
    this.cacheAt = now;
    return cfg;
  }

  toPublic(cfg: QiniuStorageConfig): QiniuPublicConfig {
    const configured = Boolean(cfg.secretKey);
    return {
      enabled: cfg.enabled,
      accessKey: cfg.accessKey,
      bucket: cfg.bucket,
      domain: cfg.domain,
      region: cfg.region || 'z2',
      secretKeyConfigured: configured,
      secretKeyMasked: configured ? '********' : '',
    };
  }

  async getPublicConfig(): Promise<QiniuPublicConfig> {
    return this.toPublic(await this.getRawConfig(true));
  }

  async saveConfig(
    input: Partial<QiniuStorageConfig> & { secretKey?: string },
    updatedBy?: string,
  ): Promise<QiniuPublicConfig> {
    const prev = await this.getRawConfig(true);
    const nextSecret =
      input.secretKey && input.secretKey.trim() && input.secretKey !== '********'
        ? input.secretKey.trim()
        : prev.secretKey;

    const next: QiniuStorageConfig = {
      enabled: input.enabled ?? prev.enabled,
      accessKey:
        input.accessKey !== undefined ? String(input.accessKey).trim() : prev.accessKey,
      secretKey: nextSecret,
      bucket: input.bucket !== undefined ? String(input.bucket).trim() : prev.bucket,
      domain: input.domain !== undefined ? String(input.domain).trim() : prev.domain,
      region:
        input.region !== undefined
          ? String(input.region).trim() || 'z2'
          : prev.region || 'z2',
    };

    if (next.enabled) {
      if (!next.accessKey || !next.secretKey || !next.bucket || !next.domain) {
        throw new BadRequestException(
          '启用七牛云时需填写 AccessKey、SecretKey、Bucket、访问域名',
        );
      }
    }

    await this.prisma.systemSetting.upsert({
      where: { key: STORAGE_QINIU_KEY },
      create: {
        key: STORAGE_QINIU_KEY,
        value: next as object,
        updatedBy: updatedBy ?? null,
      },
      update: {
        value: next as object,
        updatedBy: updatedBy ?? null,
      },
    });

    this.cache = next;
    this.cacheAt = Date.now();
    return this.toPublic(next);
  }

  assertReady(cfg: QiniuStorageConfig) {
    if (!cfg.enabled) {
      throw new BadRequestException('请先在配置中心启用并保存七牛云存储');
    }
    if (!cfg.accessKey || !cfg.secretKey || !cfg.bucket || !cfg.domain) {
      throw new BadRequestException('七牛云配置不完整，请检查 AccessKey / SecretKey / Bucket / 域名');
    }
  }

  /** 按 AK+Bucket 查询真实上传域名，避免选错区域导致 incorrect region */
  private async resolveUploadUrl(cfg: QiniuStorageConfig): Promise<{
    uploadUrl: string;
    region: string;
  }> {
    try {
      const getZoneInfo = (
        qiniu.zone as unknown as {
          getZoneInfo: (
            ak: string,
            bucket: string,
            cb: (
              err: Error | null,
              zoneInfo: { srcUpHosts?: string[] } | null,
            ) => void,
          ) => void;
        }
      ).getZoneInfo;

      if (typeof getZoneInfo === 'function') {
        const zoneInfo = await new Promise<{ srcUpHosts?: string[] } | null>(
          (resolve) => {
            getZoneInfo(cfg.accessKey, cfg.bucket, (err, info) => {
              if (err) resolve(null);
              else resolve(info);
            });
          },
        );
        if (zoneInfo?.srcUpHosts?.length) {
          const host = zoneInfo.srcUpHosts[0].replace(/^https?:\/\//, '');
          return {
            uploadUrl: `https://${host}`,
            region: cfg.region || 'auto',
          };
        }
      }
    } catch {
      // fall through
    }

    // 兜底：直接打 UC v4 query
    try {
      const url = `https://uc.qiniuapi.com/v4/query?ak=${encodeURIComponent(cfg.accessKey)}&bucket=${encodeURIComponent(cfg.bucket)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          hosts?: Array<{ up?: { domains?: string[] } }>;
        };
        const domain = data.hosts?.[0]?.up?.domains?.[0];
        if (domain) {
          return {
            uploadUrl: `https://${domain.replace(/^https?:\/\//, '')}`,
            region: cfg.region || 'auto',
          };
        }
      }
    } catch {
      // fall through
    }

    return {
      uploadUrl: qiniuUploadHost(cfg.region),
      region: cfg.region || 'z2',
    };
  }

  async createUploadToken(opts: {
    fileName: string;
    keyPrefix?: string;
    expiresSec?: number;
  }): Promise<{
    token: string;
    key: string;
    uploadUrl: string;
    publicUrl: string;
    bucket: string;
    region: string;
  }> {
    const cfg = await this.getRawConfig(true);
    this.assertReady(cfg);

    const safeName = (opts.fileName || 'file')
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, '-');
    const prefix = (opts.keyPrefix || 'uploads').replace(/^\/+|\/+$/g, '');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `${prefix}/${stamp}-${safeName}`;

    const mac = new qiniu.auth.digest.Mac(cfg.accessKey, cfg.secretKey);
    const putPolicy = new qiniu.rs.PutPolicy({
      scope: `${cfg.bucket}:${key}`,
      expires: opts.expiresSec ?? 7200,
    });
    const token = putPolicy.uploadToken(mac);
    const domain = normalizePublicDomain(cfg.domain);
    const publicUrl = `${domain}/${key}`;
    const { uploadUrl, region } = await this.resolveUploadUrl(cfg);

    return {
      token,
      key,
      uploadUrl,
      publicUrl,
      bucket: cfg.bucket,
      region,
    };
  }
}

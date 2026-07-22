export const STORAGE_QINIU_KEY = 'storage.qiniu';

export type QiniuStorageConfig = {
  enabled: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  /** 对外访问域名，如 https://cdn.example.com（可带或不带协议） */
  domain: string;
  /**
   * 上传区域（可选，仅作兜底）：z0 华东 / z1 华北 / z2 华南 / na0 北美 / as0 东南亚
   * 实际上传域名会按 AccessKey+Bucket 向七牛查询，避免选错区域。
   */
  region: string;
};

export const DEFAULT_QINIU_CONFIG: QiniuStorageConfig = {
  enabled: false,
  accessKey: '',
  secretKey: '',
  bucket: '',
  domain: '',
  region: 'z2',
};

/**
 * 七牛源站上传域名（表单直传请用 up-*，与官方「源站上传」一致）。
 * 勿用已弃用/易报 incorrect region 的 upload-* 作为唯一地址。
 */
export function qiniuUploadHost(region: string): string {
  switch ((region || 'z2').toLowerCase()) {
    case 'z0':
    case 'cn-east-1':
      return 'https://up-z0.qiniup.com';
    case 'cn-east-2':
      return 'https://up-cn-east-2.qiniup.com';
    case 'z1':
      return 'https://up-z1.qiniup.com';
    case 'na0':
      return 'https://up-na0.qiniup.com';
    case 'as0':
      return 'https://up-as0.qiniup.com';
    case 'z2':
    default:
      return 'https://up-z2.qiniup.com';
  }
}

export function normalizePublicDomain(domain: string): string {
  const d = (domain || '').trim().replace(/\/$/, '');
  if (!d) return '';
  if (/^https?:\/\//i.test(d)) return d;
  return `https://${d}`;
}

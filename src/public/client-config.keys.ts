export const CLIENT_API_BASE_KEY = 'client.api_base';
export const CLIENT_AUTH_WEB_BASE_KEY = 'client.auth_web_base';
export const CLIENT_DOWNLOAD_KEY = 'client.download';
export const CLIENT_UPDATE_FEED_KEY = 'client.update_feed_url';
export const CLIENT_CORS_ORIGINS_KEY = 'client.cors_origins';
export const LEGAL_TERMS_KEY = 'legal.terms';
/** 官网页脚：备案号、版权、联系邮箱等（配置中心动态维护） */
export const SITE_BRANDING_KEY = 'site.branding';

/** 仅本地开发回退；正式环境以配置中心 / 环境变量为准 */
export const DEFAULT_CLIENT_API_BASE = 'http://localhost:3100';
export const DEFAULT_CLIENT_AUTH_WEB_BASE = 'http://localhost:3000';

export type SiteBranding = {
  /** 站点名称（导航 / 后台 / 登录页） */
  brandName: string;
  /** 站点 Logo 图片地址 */
  logoUrl: string;
  /** ICP 备案号，如「粤ICP备xxxxxxxx号」 */
  icpBeian: string;
  /** 备案跳转链接，默认工信部 */
  icpUrl: string;
  /** 公安备案号，如「粤公网安备4401xxxxxxxx号」 */
  psbBeian: string;
  /** 公安备案号文字跳转链接 */
  psbUrl: string;
  /** 公安备案图标图片地址 */
  psbLogoSrc: string;
  /** 公安备案图标跳转链接（与文字链接分开配置） */
  psbLogoUrl: string;
  /** 页脚版权文案（不含年份前缀 © YYYY） */
  copyright: string;
  /** 页脚 / 联系邮箱 */
  contactEmail: string;
};

export const DEFAULT_SITE_BRANDING: SiteBranding = {
  brandName: 'Code Reviewer',
  logoUrl: '/brand-mark.svg',
  icpBeian: '',
  icpUrl: 'https://beian.miit.gov.cn/',
  psbBeian: '',
  psbUrl: 'https://www.beian.gov.cn/portal/registerSystemInfo',
  psbLogoSrc: 'https://beian.mps.gov.cn/img/logo01.dd7ff50e.png',
  psbLogoUrl: 'https://www.beian.gov.cn/portal/registerSystemInfo',
  copyright: 'Code Reviewer 版权所有',
  contactEmail: 'support@codereviewer.cn',
};

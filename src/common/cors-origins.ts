import { PrismaClient } from '@prisma/client';
import {
  CLIENT_AUTH_WEB_BASE_KEY,
  CLIENT_CORS_ORIGINS_KEY,
  DEFAULT_CLIENT_AUTH_WEB_BASE,
} from '../public/client-config.keys';

/** 从配置中心加载 CORS 允许来源；开发环境未配置时放宽 */
export async function resolveCorsOriginOption(): Promise<
  boolean | string[] | ((origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void)
> {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const prisma = new PrismaClient();
  try {
    const [authRow, corsRow] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: CLIENT_AUTH_WEB_BASE_KEY } }),
      prisma.systemSetting.findUnique({ where: { key: CLIENT_CORS_ORIGINS_KEY } }),
    ]);
    const authWeb =
      typeof authRow?.value === 'string' && authRow.value.trim()
        ? authRow.value.trim().replace(/\/$/, '')
        : DEFAULT_CLIENT_AUTH_WEB_BASE;
    const extra =
      typeof corsRow?.value === 'string' && corsRow.value.trim()
        ? corsRow.value
            .split(/[,;\n]/)
            .map((s) => s.trim().replace(/\/$/, ''))
            .filter(Boolean)
        : [];
    const envExtra = (process.env.CORS_ORIGINS || '')
      .split(/[,;\n]/)
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean);
    const list = Array.from(new Set([authWeb, ...extra, ...envExtra]));

    if (nodeEnv !== 'production') {
      // 开发：配置列表 + 任意 localhost
      return (origin, cb) => {
        if (!origin) return cb(null, true);
        if (list.includes(origin)) return cb(null, true);
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
          return cb(null, true);
        }
        return cb(null, false);
      };
    }

    // 生产：仅白名单；无 Origin（桌面/服务端）放行
    return (origin, cb) => {
      if (!origin) return cb(null, true);
      return cb(null, list.includes(origin));
    };
  } catch (e) {
    console.warn('[cors] 读取配置中心失败，开发放宽 / 生产拒绝跨域', e);
    return nodeEnv !== 'production';
  } finally {
    await prisma.$disconnect();
  }
}

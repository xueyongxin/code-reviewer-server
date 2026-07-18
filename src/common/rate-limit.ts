import { HttpException, HttpStatus } from '@nestjs/common';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** 简易进程内限流（单实例有效；多实例请换 Redis） */
export function assertRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message = '请求过于频繁，请稍后再试',
): void {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || cur.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  cur.count += 1;
  if (cur.count > limit) {
    throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** 偶尔清理过期桶，避免 Map 无限增长 */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}, 60_000).unref?.();

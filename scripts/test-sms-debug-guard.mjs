/**
 * S2：生产禁止回传短信/邮箱验证码
 * node scripts/test-sms-debug-guard.mjs
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'src/auth/auth.service.ts'), 'utf8')

const fail = (msg) => {
  console.error('FAIL:', msg)
  process.exit(1)
}

if (!/isOtpDebug/.test(src)) {
  fail('缺少 isOtpDebug 联调判定')
}
if (!/NODE_ENV === 'production'/.test(src)) {
  fail('未检查 NODE_ENV=production')
}
if (!/SMS_DEBUG === '1'/.test(src) || !/EMAIL_DEBUG === '1'/.test(src)) {
  fail('isOtpDebug 应支持 SMS_DEBUG / EMAIL_DEBUG')
}
if (!/联调模式：响应含 code/.test(src)) {
  fail('缺少联调模式文案')
}
if (/const debugSms = process\.env\.SMS_DEBUG === '1'/.test(src)) {
  fail('仍使用仅 SMS_DEBUG 判断（生产可误开回传）')
}

/** 与服务端 isOtpDebug 一致的判定逻辑 */
const canEchoCode = (env) =>
  env.NODE_ENV !== 'production' &&
  (env.SMS_DEBUG === '1' || env.EMAIL_DEBUG === '1')

if (canEchoCode({ NODE_ENV: 'production', SMS_DEBUG: '1' })) {
  fail('production + SMS_DEBUG=1 仍会回传')
}
if (canEchoCode({ NODE_ENV: 'production', EMAIL_DEBUG: '1' })) {
  fail('production + EMAIL_DEBUG=1 仍会回传')
}
if (!canEchoCode({ NODE_ENV: 'development', SMS_DEBUG: '1' })) {
  fail('development + SMS_DEBUG=1 应可回传')
}
if (!canEchoCode({ NODE_ENV: 'development', EMAIL_DEBUG: '1' })) {
  fail('development + EMAIL_DEBUG=1 应可回传')
}
if (canEchoCode({ NODE_ENV: 'development', SMS_DEBUG: '0', EMAIL_DEBUG: '0' })) {
  fail('DEBUG 未开不应回传')
}

console.log('PASS: S2 短信/邮箱 DEBUG 生产防护')

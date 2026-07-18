import { ConfigService } from '@nestjs/config';

/** 生产环境必须配置 JWT_SECRET；开发未配置时使用弱密钥并告警 */
export const resolveJwtSecret = (config: ConfigService): string => {
  const secret = config.get<string>('JWT_SECRET')?.trim()
  const nodeEnv = config.get<string>('NODE_ENV') || process.env.NODE_ENV
  if (secret) return secret
  if (nodeEnv === 'production') {
    throw new Error('生产环境必须设置环境变量 JWT_SECRET')
  }
  console.warn(
    '[auth] JWT_SECRET 未配置，开发环境使用弱密钥 dev-secret（切勿用于生产）',
  )
  return 'dev-secret'
}

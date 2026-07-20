/**
 * S1 冒烟：新用户短信登录后必须有个人工作区；企业组织列表为空。
 * 用法：node scripts/test-personal-workspace.mjs
 */
const BASE = process.env.API_BASE || 'http://localhost:3100'

const phone = `138${String(Date.now()).slice(-8)}`

const req = async (path, opts = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`${opts.method || 'GET'} ${path} → ${res.status} ${JSON.stringify(body)}`)
  }
  return body.data !== undefined ? body.data : body
}

const main = async () => {
  console.log('phone =', phone)

  const sent = await req('/api/v1/auth/sms/send', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
  if (!sent.code) {
    throw new Error('需要 SMS_DEBUG=1 才能拿到验证码做联调')
  }
  console.log('sms ok, code received')

  const login = await req('/api/v1/auth/login/sms', {
    method: 'POST',
    body: JSON.stringify({ phone, code: sent.code }),
  })
  if (!login.accessToken) throw new Error('无 accessToken')
  if (!login.org?.id) throw new Error('登录响应缺少 org（个人工作区）')
  console.log('login org =', login.org.id, login.org.name)

  const me = await req('/api/v1/me', {
    headers: { Authorization: `Bearer ${login.accessToken}` },
  })
  const mem = me.memberships?.[0]
  if (!mem?.org?.id) throw new Error('/me 无 memberships')
  if (mem.org.id !== login.org.id) throw new Error('/me org 与登录 org 不一致')
  const planKey = mem.org.subscription?.plan?.key
  if (planKey !== 'free') throw new Error(`期望 free 套餐，实际 ${planKey}`)
  console.log('me workspace plan =', planKey)

  const orgs = await req('/api/v1/orgs', {
    headers: { Authorization: `Bearer ${login.accessToken}` },
  })
  if (!Array.isArray(orgs)) throw new Error('/orgs 应返回数组')
  if (orgs.length !== 0) {
    throw new Error(`个人工作区不应出现在企业组织列表，实际 ${orgs.length} 条`)
  }
  console.log('GET /orgs = [] （个人工作区已正确隐藏）')

  // 老用户再次登录：不应重复建第二个工作区
  const sent2 = await req('/api/v1/auth/sms/send', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
  const login2 = await req('/api/v1/auth/login/sms', {
    method: 'POST',
    body: JSON.stringify({ phone, code: sent2.code }),
  })
  if (login2.org?.id !== login.org.id) {
    throw new Error('二次登录 orgId 变化，可能重复创建工作区')
  }
  console.log('re-login same org ok')

  console.log('\nPASS: S1 个人工作区')
}

main().catch((e) => {
  console.error('\nFAIL:', e.message || e)
  process.exit(1)
})

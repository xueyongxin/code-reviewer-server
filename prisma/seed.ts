import { OrgRole, PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { readFileSync } from 'fs'
import { join } from 'path'

const prisma = new PrismaClient()

const DEFAULT_ORG_CONFIG = {
  llmPolicy: { providers: [] },
  mcpTemplates: [],
  rulePack: { enabledRuleIds: [], customRules: [] },
  methodIds: [],
  pipelineTemplates: [],
  reportFormats: ['md', 'html'],
  notifyOnComplete: true,
}

type SeedUser = {
  email: string
  phone: string
  displayName: string
  isPlatformAdmin?: boolean
  /** 企业组织内角色；空 = 未加入企业（仅个人免费工作区，无组织菜单） */
  orgRole?: OrgRole
}

/**
 * 初始化账号（保留超管，其余按三国人物）
 * 企业组织「蜀汉」：
 *   - 创建者 org_owner：刘备
 *   - 组织管理员 org_admin：诸葛亮、庞统、法正
 *   - 成员 member：关羽…李严 等
 * 未入企业（无组织，测邀请加入）：刘禅、姜维、黄月英
 */
const SEED_USERS: SeedUser[] = [
  {
    email: 'admin@local.dev',
    phone: '13800000000',
    displayName: '平台管理员',
    isPlatformAdmin: true,
  },
  // —— 创建者 ——
  { email: 'liubei@shu.dev', phone: '13800000001', displayName: '刘备', orgRole: 'org_owner' },
  // —— 组织管理员 ——
  { email: 'zhugeliang@shu.dev', phone: '13800000002', displayName: '诸葛亮', orgRole: 'org_admin' },
  { email: 'pangtong@shu.dev', phone: '13800000003', displayName: '庞统', orgRole: 'org_admin' },
  { email: 'fazheng@shu.dev', phone: '13800000004', displayName: '法正', orgRole: 'org_admin' },
  // —— 成员 ——
  { email: 'guanyu@shu.dev', phone: '13800000005', displayName: '关羽', orgRole: 'member' },
  { email: 'zhangfei@shu.dev', phone: '13800000006', displayName: '张飞', orgRole: 'member' },
  { email: 'zhaoyun@shu.dev', phone: '13800000007', displayName: '赵云', orgRole: 'member' },
  { email: 'huangzhong@shu.dev', phone: '13800000008', displayName: '黄忠', orgRole: 'member' },
  { email: 'machao@shu.dev', phone: '13800000009', displayName: '马超', orgRole: 'member' },
  { email: 'weiyan@shu.dev', phone: '13800000010', displayName: '魏延', orgRole: 'member' },
  { email: 'madai@shu.dev', phone: '13800000011', displayName: '马岱', orgRole: 'member' },
  { email: 'guanping@shu.dev', phone: '13800000012', displayName: '关平', orgRole: 'member' },
  { email: 'zhangbao@shu.dev', phone: '13800000013', displayName: '张苞', orgRole: 'member' },
  { email: 'guanxing@shu.dev', phone: '13800000014', displayName: '关兴', orgRole: 'member' },
  { email: 'liaohua@shu.dev', phone: '13800000015', displayName: '廖化', orgRole: 'member' },
  { email: 'yanyan@shu.dev', phone: '13800000016', displayName: '严颜', orgRole: 'member' },
  { email: 'wangping@shu.dev', phone: '13800000017', displayName: '王平', orgRole: 'member' },
  { email: 'liyan@shu.dev', phone: '13800000018', displayName: '李严', orgRole: 'member' },
  // —— 未入企业（测邀请）——
  { email: 'liushan@shu.dev', phone: '13800000019', displayName: '刘禅' },
  { email: 'jiangwei@shu.dev', phone: '13800000020', displayName: '姜维' },
  { email: 'huangyueying@shu.dev', phone: '13800000021', displayName: '黄月英' },
]

const ENTERPRISE_ORG_SLUG = 'shu-han'
const ENTERPRISE_ORG_NAME = '蜀汉'

async function upsertUser(
  u: SeedUser,
  passwordHash: string,
): Promise<{ id: string; phone: string | null; email: string | null; displayName: string }> {
  // 优先按 phone，其次 email（避免唯一冲突）
  const existing =
    (await prisma.user.findUnique({ where: { phone: u.phone } })) ||
    (await prisma.user.findUnique({ where: { email: u.email } }))

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        email: u.email,
        phone: u.phone,
        passwordHash,
        displayName: u.displayName,
        isPlatformAdmin: Boolean(u.isPlatformAdmin),
        isActive: true,
      },
      select: { id: true, phone: true, email: true, displayName: true },
    })
  }

  return prisma.user.create({
    data: {
      email: u.email,
      phone: u.phone,
      passwordHash,
      displayName: u.displayName,
      isPlatformAdmin: Boolean(u.isPlatformAdmin),
      isActive: true,
    },
    select: { id: true, phone: true, email: true, displayName: true },
  })
}

/** 一人一组织：先清掉该用户其他成员关系再写入 */
async function ensureSoleOrgMember(
  orgId: string,
  userId: string,
  role: OrgRole,
) {
  await prisma.orgMember.deleteMany({
    where: { userId, NOT: { orgId } },
  })
  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId, userId } },
    create: { orgId, userId, role },
    update: { role },
  })
}

/** 清理除平台超管外的用户与全部组织，再重建演示数据 */
async function purgeNonAdminAccounts() {
  const admins = await prisma.user.findMany({
    where: { isPlatformAdmin: true },
    select: { id: true },
  })
  const adminIds = admins.map((a) => a.id)

  await prisma.orgInvite.deleteMany({})
  await prisma.refreshToken.deleteMany({
    where: adminIds.length ? { userId: { notIn: adminIds } } : undefined,
  })
  await prisma.notification.deleteMany({
    where: adminIds.length ? { userId: { notIn: adminIds } } : undefined,
  })
  await prisma.userCustomRule.deleteMany({
    where: adminIds.length ? { userId: { notIn: adminIds } } : undefined,
  })
  await prisma.reviewReport.deleteMany({
    where: adminIds.length
      ? { uploaderId: { notIn: adminIds } }
      : undefined,
  })
  // 审计可保留超管操作；非超管 actor 置空或删除
  await prisma.auditLog.deleteMany({
    where: adminIds.length
      ? { OR: [{ actorId: null }, { actorId: { notIn: adminIds } }] }
      : undefined,
  })
  await prisma.organization.deleteMany({})
  await prisma.user.deleteMany({
    where: { isPlatformAdmin: false },
  })
  console.log('Purged non-admin users and all organizations')
}

async function main() {
  // —— 套餐（对齐仓库根目录《权限与套餐.md》）——
  const plans = [
    {
      key: 'free',
      name: '免费',
      maxMembers: 1,
      maxReviewsMonth: 50,
      retentionDays: 30,
      storageMb: 500,
      priceCents: 0,
      isActive: true,
    },
    {
      key: 'personal_month',
      name: '个人付费（月）',
      maxMembers: 1,
      maxReviewsMonth: 500,
      retentionDays: 90,
      storageMb: 5000,
      priceCents: 990, // ¥9.9
      isActive: true,
    },
    {
      key: 'personal_quarter',
      name: '个人付费（季）',
      maxMembers: 1,
      maxReviewsMonth: 500,
      retentionDays: 90,
      storageMb: 5000,
      priceCents: 2690, // ¥26.9
      isActive: true,
    },
    {
      key: 'personal_year',
      name: '个人付费（年）',
      maxMembers: 1,
      maxReviewsMonth: 500,
      retentionDays: 90,
      storageMb: 5000,
      priceCents: 8900, // ¥89
      isActive: true,
    },
    {
      key: 'enterprise',
      name: '企业付费',
      maxMembers: 100,
      maxReviewsMonth: 5000,
      retentionDays: 365,
      storageMb: 50000,
      priceCents: 29900, // ¥299 / 席位 / 年
      isActive: true,
    },
  ]

  for (const p of plans) {
    await prisma.plan.upsert({
      where: { key: p.key },
      create: p,
      update: p,
    })
  }
  // 旧套餐下线（保留历史订单关联）
  for (const legacy of ['pro', 'team'] as const) {
    await prisma.plan.updateMany({
      where: { key: legacy },
      data: { isActive: false },
    })
  }
  console.log(`Plans seeded: ${plans.length}`)

  // —— 审查规则目录（对齐客户端 review-methods +《代码审查.md》）——
  const reviewMethods = [
    { key: 'null-check', name: '空指针 / 判空检测', groupName: '功能逻辑', description: '入参判空：空串、null、空数组、0、负数、超长参数', staticRuleIds: [] as string[], sortOrder: 10 },
    { key: 'exception-handling', name: '异常处理', groupName: '功能逻辑', description: '外部调用（DB/接口/缓存/文件）异常捕获、超时重试熔断', staticRuleIds: [], sortOrder: 20 },
    { key: 'business-logic', name: '业务逻辑正确性', groupName: '功能逻辑', description: '分支完整、计算精度、状态流转闭环', staticRuleIds: [], sortOrder: 30 },
    { key: 'concurrency', name: '并发安全', groupName: '功能逻辑', description: '锁与原子操作，防超卖、重复创建、重复扣款', staticRuleIds: [], sortOrder: 40 },
    { key: 'auth-check', name: '权限控制', groupName: '功能逻辑', description: '登录态、角色、数据权限，后端二次校验防越权', staticRuleIds: [], sortOrder: 50 },
    { key: 'sql-injection', name: 'SQL 注入', groupName: '安全漏洞', description: '禁止拼接 SQL，使用预编译参数化查询', staticRuleIds: [], sortOrder: 60 },
    { key: 'xss-csrf', name: 'XSS / CSRF', groupName: '安全漏洞', description: '输入过滤转义、接口 token 校验', staticRuleIds: [], sortOrder: 70 },
    { key: 'hardcoded-secret', name: '硬编码密钥', groupName: '安全漏洞', description: '密钥、token、连接串禁止硬编码', staticRuleIds: ['no-hardcoded-secret'], sortOrder: 80 },
    { key: 'sensitive-data', name: '敏感信息处理', groupName: '安全漏洞', description: '密码证件不明文、不落日志、不回传前端', staticRuleIds: ['no-hardcoded-secret'], sortOrder: 90 },
    { key: 'memory-leak', name: '内存泄漏', groupName: '性能资源', description: '连接关闭、无全局大集合膨胀、流式/分页处理', staticRuleIds: [], sortOrder: 100 },
    { key: 'db-performance', name: '数据库性能', groupName: '性能资源', description: '索引、禁循环查库、分页与事务范围', staticRuleIds: [], sortOrder: 110 },
    { key: 'code-style', name: '代码规范可读性', groupName: '规范可读', description: '命名、函数行数、注释、魔法数字、格式化', staticRuleIds: ['no-console-log', 'no-debugger', 'no-todo-fix', 'no-any-type'], sortOrder: 120 },
    { key: 'maintainability', name: '复用与可维护性', groupName: '可维护性', description: '去重、去硬编码、分层与解耦', staticRuleIds: [], sortOrder: 130 },
    { key: 'api-test', name: '接口测试覆盖', groupName: '测试覆盖', description: '新增/修改接口补充自动化用例，禁跳过关键测试', staticRuleIds: [], sortOrder: 140 },
    { key: 'unit-test', name: '单元测试覆盖', groupName: '测试覆盖', description: '核心业务/工具函数覆盖正常、异常、边界', staticRuleIds: [], sortOrder: 150 },
    { key: 'compat-ops', name: '兼容与运维', groupName: '兼容运维', description: '版本兼容、日志规范、告警埋点、回滚友好', staticRuleIds: [], sortOrder: 160 },
  ]
  for (const m of reviewMethods) {
    await prisma.reviewMethod.upsert({
      where: { key: m.key },
      create: { ...m, published: true },
      update: {
        name: m.name,
        groupName: m.groupName,
        description: m.description,
        staticRuleIds: m.staticRuleIds,
        sortOrder: m.sortOrder,
        published: true,
      },
    })
  }
  console.log(`Review methods seeded: ${reviewMethods.length}`)

  // —— MCP 目录 ——
  try {
    const seedPath = join(
      __dirname,
      '../../code-reviewer-client/src/main/config/mcp-marketplace-seed.json',
    )
    const items = JSON.parse(readFileSync(seedPath, 'utf8')) as Array<{
      key: string
      name: string
      description?: string
      transport?: string
      command?: string
      args?: string[]
      url?: string
      env?: Record<string, string>
      tags?: string[]
      verified?: boolean
      badge?: string
    }>
    for (const item of items) {
      await prisma.mcpCatalogItem.upsert({
        where: { key: item.key },
        create: {
          key: item.key,
          name: item.name,
          description: item.description,
          transport: item.transport || 'stdio',
          command: item.command,
          args: item.args ?? [],
          url: item.url || null,
          envKeys: Object.keys(item.env || {}),
          tags: item.tags ?? [],
          verified: Boolean(item.verified),
          published: true,
          badge: item.badge,
        },
        update: {
          name: item.name,
          description: item.description,
          transport: item.transport || 'stdio',
          command: item.command,
          args: item.args ?? [],
          url: item.url || null,
          envKeys: Object.keys(item.env || {}),
          tags: item.tags ?? [],
          verified: Boolean(item.verified),
          badge: item.badge,
          published: true,
        },
      })
    }
    console.log(`MCP catalog seeded: ${items.length}`)
  } catch (e) {
    console.warn('MCP catalog seed skipped:', e)
  }

  // —— Chat 命令目录 ——
  const chatCommands = [
    {
      key: 'review',
      slash: '/review',
      name: '代码审查',
      description: '针对当前报告做审查建议',
      promptTemplate:
        '请基于报告 {{reportId}} 给出审查建议。用户补充：{{args}}',
      sortOrder: 10,
    },
    {
      key: 'explain',
      slash: '/explain',
      name: '解释问题',
      description: '解释选中问题的原因与修复',
      promptTemplate: '请解释以下问题并给出修复建议：{{args}}',
      sortOrder: 20,
    },
    {
      key: 'help',
      slash: '/help',
      name: '帮助',
      description: '列出可用命令',
      promptTemplate: '',
      sortOrder: 100,
    },
  ]
  for (const c of chatCommands) {
    await prisma.chatCommand.upsert({
      where: { key: c.key },
      create: { ...c, published: true },
      update: { ...c, published: true },
    })
  }
  console.log(`Chat commands seeded: ${chatCommands.length}`)

  // —— LLM 目录 ——
  const llmItems = [
    {
      key: 'openai-compatible',
      name: 'OpenAI 兼容',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      models: ['gpt-4o-mini', 'gpt-4o'],
      fallbackModels: [],
      apiKeyUrl: 'https://platform.openai.com/api-keys',
      description: '标准 OpenAI Compatible API',
      sortOrder: 10,
    },
    {
      key: 'ollama',
      name: 'Ollama 本地',
      protocol: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'llama3.2',
      models: ['llama3.2', 'qwen2.5'],
      fallbackModels: [],
      apiKeyUrl: null as string | null,
      description: '本机 Ollama',
      sortOrder: 20,
    },
  ]
  for (const item of llmItems) {
    await prisma.llmCatalogItem.upsert({
      where: { key: item.key },
      create: { ...item, published: true },
      update: { ...item, published: true },
    })
  }
  console.log(`LLM catalog seeded: ${llmItems.length}`)

  // —— 清理旧账号：仅显式 SEED_PURGE=1 时执行（避免误删生产数据）——
  if (process.env.SEED_PURGE === '1') {
    await purgeNonAdminAccounts()
  } else {
    console.log('Skip purge (set SEED_PURGE=1 to wipe non-admin users/orgs)')
  }

  const seedPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123'
  if (seedPassword === 'admin123') {
    console.warn(
      '[seed] Using default password admin123 — set SEED_ADMIN_PASSWORD in production',
    )
  }
  const passwordHash = await bcrypt.hash(seedPassword, 10)
  const users: Record<string, Awaited<ReturnType<typeof upsertUser>>> = {}
  for (const u of SEED_USERS) {
    users[u.phone] = await upsertUser(u, passwordHash)
  }
  console.log(`Users seeded: ${SEED_USERS.length}`)

  const platformAdmin = users['13800000000']
  const liubei = users['13800000001']
  const enterprise = await prisma.plan.findUniqueOrThrow({
    where: { key: 'enterprise' },
  })

  // 超管不加入任何组织
  await prisma.orgMember.deleteMany({ where: { userId: platformAdmin.id } })

  // —— 企业组织「蜀汉」（仅企业套餐；一人一组织）——
  const shuOrg = await prisma.organization.upsert({
    where: { slug: ENTERPRISE_ORG_SLUG },
    create: {
      name: ENTERPRISE_ORG_NAME,
      slug: ENTERPRISE_ORG_SLUG,
      ownerId: liubei.id,
      status: 'active',
    },
    update: {
      name: ENTERPRISE_ORG_NAME,
      ownerId: liubei.id,
      status: 'active',
    },
  })

  for (const u of SEED_USERS) {
    if (!u.orgRole || u.isPlatformAdmin) continue
    await ensureSoleOrgMember(shuOrg.id, users[u.phone].id, u.orgRole)
  }

  await prisma.orgConfig.upsert({
    where: { orgId: shuOrg.id },
    create: {
      orgId: shuOrg.id,
      version: 1,
      payload: DEFAULT_ORG_CONFIG,
    },
    update: {
      version: 1,
      payload: DEFAULT_ORG_CONFIG,
    },
  })

  await prisma.subscription.upsert({
    where: { orgId: shuOrg.id },
    create: {
      orgId: shuOrg.id,
      planId: enterprise.id,
      status: 'active',
      note: 'seed · 蜀汉 · Enterprise ¥299/席/年',
    },
    update: {
      planId: enterprise.id,
      status: 'active',
      note: 'seed · 蜀汉 · Enterprise ¥299/席/年',
    },
  })

  // 企业开通对应订单：仅 purge 后补一笔，避免重复刷单
  if (process.env.SEED_PURGE === '1') {
    const seatCount = 20
    const paidAt = new Date('2026-07-01T10:00:00+08:00')
    await prisma.order.create({
      data: {
        orgId: shuOrg.id,
        planId: enterprise.id,
        amountCents: enterprise.priceCents * seatCount,
        status: 'paid',
        paymentMethod: 'manual',
        note: `seed · 刘备为「蜀汉」开通企业套餐 ${seatCount} 席`,
        createdBy: liubei.id,
        paidAt,
        createdAt: paidAt,
      },
    })
  }

  // 刘禅/姜维/黄月英：无任何组织（测邀请加入；不建免费「假组织」）

  const rbacValue = {
    platform: [
      {
        key: 'platform_admin',
        field: 'users.isPlatformAdmin',
        label: '平台超管',
        desc: '全部企业组织只读+禁用；不可移除成员',
      },
    ],
    org: [
      {
        key: 'org_owner',
        label: '创建者',
        desc: '邀请、成员、转让、解散；本组织最高权',
      },
      {
        key: 'org_admin',
        label: '组织管理员',
        desc: '邀请与成员管理、组织配置；不可解散/转让',
      },
      {
        key: 'member',
        label: '成员',
        desc: '组织只读；可自行退出',
      },
    ],
  }

  await prisma.systemSetting.upsert({
    where: { key: 'rbac.roles' },
    create: {
      key: 'rbac.roles',
      value: rbacValue,
      updatedBy: platformAdmin.id,
    },
    update: {
      value: rbacValue,
      updatedBy: platformAdmin.id,
    },
  })

  await prisma.systemSetting.upsert({
    where: { key: 'client.api_base' },
    create: {
      key: 'client.api_base',
      value: 'http://localhost:3100',
      updatedBy: platformAdmin.id,
    },
    update: {},
  })
  await prisma.systemSetting.upsert({
    where: { key: 'client.auth_web_base' },
    create: {
      key: 'client.auth_web_base',
      value: 'http://localhost:3000',
      updatedBy: platformAdmin.id,
    },
    update: {},
  })

  const memberCount = await prisma.orgMember.count({
    where: { orgId: shuOrg.id },
  })
  const roleCount = (role: OrgRole) =>
    SEED_USERS.filter((u) => u.orgRole === role).length

  console.log('Seed OK')
  console.log('─'.repeat(56))
  console.log('登录：手机号 + 短信验证码（开发 SMS_DEBUG=1 时可复制）')
  console.log(`演示密码：${seedPassword}`)
  console.log('')
  console.log(`企业组织：${ENTERPRISE_ORG_NAME}（${ENTERPRISE_ORG_SLUG}）`)
  console.log(
    `  创建者 ${roleCount('org_owner')} · 管理员 ${roleCount('org_admin')} · 成员 ${roleCount('member')} · 合计 ${memberCount}`,
  )
  if (process.env.SEED_PURGE === '1') {
    console.log('  订单：已在 purge 模式下重建演示支付单')
  }
  console.log('')
  console.log('手机号 / 姓名 / 身份：')
  for (const u of SEED_USERS) {
    let roleLabel = '未入企业（测邀请）'
    if (u.isPlatformAdmin) roleLabel = '平台超管'
    else if (u.orgRole === 'org_owner') roleLabel = '蜀汉 · 创建者'
    else if (u.orgRole === 'org_admin') roleLabel = '蜀汉 · 组织管理员'
    else if (u.orgRole === 'member') roleLabel = '蜀汉 · 成员'
    console.log(`  ${u.phone}  ${u.displayName.padEnd(4, '　')}  ${roleLabel}`)
  }
  console.log('─'.repeat(56))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

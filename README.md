# code-reviewer-server

Code Reviewer **云端 API**：账号与鉴权、组织协作、套餐计费、平台目录、审查记录同步、客户端发版与对象存储等。

审查默认在**桌面端本机**执行；本服务不做云端代跑源代码。拉码主路径由桌面端经「设置 → 代码仓库」鉴权后 **Git 克隆**完成（MCP 仅作工具扩展，不是拉码主路径）。大模型记忆默认存本机 SQLite，**账号级云端记忆同步尚未开放**。

## 技术栈

| 类别 | 选型 |
| :--- | :--- |
| 运行时 | Node.js 20+、TypeScript 5.7 |
| 框架 | NestJS 11（Express） |
| ORM / 数据库 | Prisma 5、PostgreSQL |
| 鉴权 | `@nestjs/jwt` + Passport JWT、Refresh Token |
| 校验 | `class-validator` / `class-transformer` |
| 安全 | bcrypt（密码哈希）、配置同步时剥离敏感密钥字段 |
| 对象存储 | 七牛云 SDK（`qiniu`，客户端发版包上传） |
| 统一响应 | `{ code, message, data, requestId }`（`ResponseInterceptor`） |

相关仓库：`code-reviewer-client`（Electron 桌面端）、`code-reviewer-admin`（Next.js 官网 / Web 控制台）。

## 功能概览

| 领域 | 说明 |
| :--- | :--- |
| 认证 | 邮箱注册登录、手机短信注册/登录、桌面端授权码兑换、Web handoff、refresh / logout |
| 个人账号 | 资料、头像、手机/邮箱换绑、注销；用户级 MCP 配置云端读写 |
| 组织 | 创建/转让/解散、成员角色、邀请链接、组织配置与版本回滚 |
| 审查记录 | 桌面端上传报告摘要、列表/详情/删除；按可见性（个人 / 组织） |
| 同步 | 拉取组织配置与报告列表（供桌面端同步） |
| 计费 | 套餐、用量、下单、标记已付、超管指派套餐 |
| 平台目录 | MCP / LLM / 审查方式 / 对话命令 / 代码仓库平台（公开已发布 + 超管 CRUD） |
| 用户规则 | 自定义审查规则 CRUD |
| 通知 | 站内通知列表与已读 |
| 审计 | 组织审计日志；超管全平台审计 |
| 平台维护 | 用户/组织状态、订阅与订单、套餐 CRUD |
| 公开配置 | 桌面端入口（API / 鉴权 Web / 下载 / 更新源 / CORS）、用户协议与隐私政策 |
| 存储与发版 | 七牛配置、上传凭证；客户端版本记录（列表 / 发布 / 设为最新 / 删除） |

## 本地启动

```bash
cd code-reviewer-server

# .env 参考 .env.example
# DATABASE_URL=postgresql://lance:lance@localhost:5432/code_reviewer
# PORT=3100
# JWT_SECRET=...
# SMS_DEBUG=1          # 本地联调回传验证码；生产勿依赖

npx prisma migrate dev
npm run db:seed
npm run start:dev
```

| 检查项 | 地址 |
| :--- | :--- |
| 存活 | `GET http://localhost:3100/health` |
| 就绪 | `GET http://localhost:3100/ready` |
| 客户端公开配置 | `GET http://localhost:3100/api/v1/public/client-config` |
| 法律条款 | `GET http://localhost:3100/api/v1/public/legal-terms` |

静态上传目录：`/uploads/`（头像等）。

## 默认种子

- 平台超管：`admin@local.dev` / `admin123`（可用 `SEED_ADMIN_PASSWORD` 覆盖）
- 演示组织 slug：`demo-org`
- 代码仓库目录默认 key：`github` `gitlab` `gitee` `bitbucket` `coding` `gitcode` `azure` `gitea` `other`
- 法律条款默认正文：`src/public/legal-terms.defaults.ts`（库内 `system_settings.legal.terms` 可覆盖）

> `SEED_PURGE=1` 会清理非超管用户与全部组织，仅限受控环境使用。

## 主要 API

均前缀 `/api/v1`（健康检查除外），统一响应 `{ code, message, data, requestId }`。

| 模块 | 路径前缀 / 要点 |
| :--- | :--- |
| Auth | `/auth` — `register` `login` `sms/send` `email/send` `register/phone` `login/phone` `login/sms` `desktop/issue-code` `desktop/exchange` `web/handoff` `web/exchange` `refresh` `logout` |
| Me | `/me` — `GET/PATCH`、头像、手机/邮箱换绑、注销 |
| 用户 MCP | `/me/mcp-servers` — `GET/PUT` 及单条增删改 |
| Orgs | `/orgs` — 组织 CRUD、成员、邀请、转让、离开；`/invites/:token` 接受邀请 |
| Config | `/orgs/:orgId/config` — 读写配置、版本列表、回滚 |
| Sync | `/sync/config` `GET /sync/reports` |
| Reports | `POST /sync/reports`、`GET/DELETE /reports` `GET /reports/:id` |
| Billing | `/billing` — `plans` `usage` `orders` `orders/mark-paid` `assign-plan`（超管） |
| 目录（公开列表 + 超管管理） | `/mcp-catalog` `/llm-catalog` `/review-methods` `/chat-commands` `/code-repo-catalog` |
| 用户规则 | `/user-rules` |
| 通知 | `/notifications` |
| 审计 | `/audit-logs`、`/audit-logs/admin` |
| Admin | `/admin` — 用户/组织/订阅/订单/套餐 |
| 公开 / 条款 | `/public/client-config` `/public/legal-terms`；超管 `PATCH /admin/client-config` `PATCH /admin/legal-terms` |
| 存储与发版 | `/admin/storage/qiniu`、`/admin/client-releases` |

### 代码托管平台目录（桌面端「设置 → 代码仓库」）

| 方法 | 路径 | 鉴权 |
| :--- | :--- | :--- |
| `GET` | `/api/v1/code-repo-catalog` | 公开（仅已发布；可选 `?q=`） |
| `GET` | `/api/v1/code-repo-catalog/admin/all` | JWT + 平台超管 |
| `POST` | `/api/v1/code-repo-catalog` | JWT + 平台超管 |
| `PUT` | `/api/v1/code-repo-catalog/:id` | JWT + 平台超管 |
| `DELETE` | `/api/v1/code-repo-catalog/:id` | JWT + 平台超管 |

表模型：`CodeRepoCatalogItem`（见 `prisma/schema.prisma`）。

## 约定与安全

- **密钥策略**：组织配置上传会剥离 `token` / `secret` / `apiKey` 等字段；MCP `env` 中密钥键只保留空值占位。
- **时间展示**：各端统一 `YYYY-MM-DD HH:mm:ss`（本地时区）；服务端工具见 `src/common/datetime.ts`。
- **CORS**：主来源读配置中心 `client.cors_origins`，可用环境变量 `CORS_ORIGINS` 追加。
- **生产**：必须设置强随机 `JWT_SECRET`；`SMS_DEBUG` / `EMAIL_DEBUG` 在 `NODE_ENV=production` 下不会回传验证码。

## 常用脚本

```bash
npm run start:dev       # 开发热重载
npm run build && npm run start:prod
npm run prisma:migrate  # 等价 prisma migrate dev
npm run prisma:deploy   # 生产迁移
npm run db:seed
npm run lint
npm test
```

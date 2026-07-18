# code-reviewer-server

Code Reviewer 云端 API（NestJS + Prisma + PostgreSQL）。

## 本地启动

```bash
export PATH="/Volumes/data/workspace/cursor/code/.tools/node-v20.19.3-darwin-arm64/bin:$PATH"
cd code-reviewer-server

# .env 已约定
# DATABASE_URL=postgresql://lance:lance@localhost:5432/code_reviewer
# PORT=3100

npx prisma migrate dev
npm run db:seed
npm run start:dev
```

健康检查：`GET http://localhost:3100/health`

## 默认种子账号

- 平台管理员：`admin@local.dev` / `admin123`
- 演示组织 slug：`demo-org`

## 主要 API（均前缀 `/api/v1`，统一响应 `{ code, message, data, requestId }`）

| 模块 | 方法 |
| :--- | :--- |
| Auth | `POST /auth/register` `login` `refresh` `logout` |
| Me | `GET/PATCH /me` |
| Orgs | `GET/POST /orgs` `GET /orgs/:id` 成员 CRUD |
| Config | `GET/PUT /orgs/:id/config` `GET .../versions` |
| Sync | `GET /sync/config` `POST /sync/reports` `GET /sync/reports` |
| Reports | `GET /reports` `GET/DELETE /reports/:id` |
| Billing | `GET /billing/plans` `GET /billing/usage` `POST /billing/assign-plan`（超管） |
| Audit | `GET /audit-logs?orgId=` |

密钥策略：配置上传会剥离 `token/secret/apiKey` 等字段，MCP `env` 中密钥键只保留空值占位。

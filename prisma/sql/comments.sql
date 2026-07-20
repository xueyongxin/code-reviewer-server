-- 表与字段备注（PostgreSQL COMMENT）
-- 对齐业务语义，便于在库里直接查看含义

-- ========== Prisma 内部 ==========
COMMENT ON TABLE _prisma_migrations IS 'Prisma 迁移记录表（框架内部使用，记录已执行的 schema 迁移，勿当业务表改）';
COMMENT ON COLUMN _prisma_migrations.id IS '迁移记录主键';
COMMENT ON COLUMN _prisma_migrations.checksum IS '迁移文件内容校验和，用于检测迁移文件是否被篡改';
COMMENT ON COLUMN _prisma_migrations.finished_at IS '迁移成功完成时间（空表示未完成或失败）';
COMMENT ON COLUMN _prisma_migrations.migration_name IS '迁移目录名，如 20260717153941_init';
COMMENT ON COLUMN _prisma_migrations.logs IS '迁移执行日志/错误信息';
COMMENT ON COLUMN _prisma_migrations.rolled_back_at IS '回滚时间（若曾回滚）';
COMMENT ON COLUMN _prisma_migrations.started_at IS '迁移开始执行时间';
COMMENT ON COLUMN _prisma_migrations.applied_steps_count IS '已成功应用的步骤数';

-- ========== 枚举类型 ==========
COMMENT ON TYPE "OrgRole" IS '组织内角色：org_owner所有者 / org_admin管理员 / member成员 / billing_viewer账单只读 / auditor审计员';
COMMENT ON TYPE "ReportVisibility" IS '审查报告可见性：private仅自己 / org组织内';
COMMENT ON TYPE "ReportStatus" IS '审查报告状态：pending待执行 / running执行中 / success成功 / failed失败 / cancelled已取消';
COMMENT ON TYPE "SubscriptionStatus" IS '订阅状态：active生效 / past_due逾期 / cancelled已取消 / trial试用';
COMMENT ON TYPE "UserStatus" IS '用户账号状态：normal正常 / abnormal异常 / banned封禁';
COMMENT ON TYPE "OrderStatus" IS '订单状态：pending待支付 / paid已支付 / cancelled已取消';
COMMENT ON TYPE "PaymentMethod" IS '支付方式：alipay支付宝 / wechat微信 / manual人工确认 / other其他';

-- ========== users ==========
COMMENT ON TABLE users IS '用户账号表（登录身份、资料、平台超管标记、账号状态）';
COMMENT ON COLUMN users.id IS '用户主键 UUID';
COMMENT ON COLUMN users.email IS '邮箱（可选，唯一）';
COMMENT ON COLUMN users.phone IS '手机号（可选，唯一；短信登录主标识）';
COMMENT ON COLUMN users.password_hash IS '密码哈希（bcrypt；可空表示仅验证码登录）';
COMMENT ON COLUMN users.display_name IS '显示昵称';
COMMENT ON COLUMN users.avatar_url IS '头像 URL';
COMMENT ON COLUMN users.is_platform_admin IS '是否平台超管（运营后台权限）';
COMMENT ON COLUMN users.is_active IS '是否可用（与 status=normal 同步，兼容旧逻辑）';
COMMENT ON COLUMN users.status IS '账号状态枚举：normal/abnormal/banned';
COMMENT ON COLUMN users.status_reason IS '状态变更原因（异常/封禁必填）';
COMMENT ON COLUMN users.status_changed_at IS '状态最近变更时间';
COMMENT ON COLUMN users.status_changed_by IS '状态变更操作人用户ID';
COMMENT ON COLUMN users.created_at IS '创建时间';
COMMENT ON COLUMN users.updated_at IS '更新时间';

-- ========== system_settings ==========
COMMENT ON TABLE system_settings IS '系统级键值配置（如 RBAC 说明、桌面端入口等）';
COMMENT ON COLUMN system_settings.key IS '配置键（主键）';
COMMENT ON COLUMN system_settings.value IS '配置值 JSON';
COMMENT ON COLUMN system_settings.updated_at IS '更新时间';
COMMENT ON COLUMN system_settings.updated_by IS '最近更新人用户ID';

-- ========== refresh_tokens ==========
COMMENT ON TABLE refresh_tokens IS '刷新令牌表（登录会话续期）';
COMMENT ON COLUMN refresh_tokens.id IS '主键 UUID';
COMMENT ON COLUMN refresh_tokens.user_id IS '所属用户ID';
COMMENT ON COLUMN refresh_tokens.token_hash IS 'Refresh Token 的 SHA256 哈希（不存明文）';
COMMENT ON COLUMN refresh_tokens.expires_at IS '过期时间';
COMMENT ON COLUMN refresh_tokens.revoked_at IS '吊销时间（登出或轮转时写入）';
COMMENT ON COLUMN refresh_tokens.created_at IS '创建时间';

-- ========== organizations ==========
COMMENT ON TABLE organizations IS '组织/团队（工作区）';
COMMENT ON COLUMN organizations.id IS '组织主键 UUID';
COMMENT ON COLUMN organizations.name IS '组织名称';
COMMENT ON COLUMN organizations.slug IS '组织唯一短标识（URL/引用用）';
COMMENT ON COLUMN organizations.owner_id IS '组织所有者用户ID';
COMMENT ON COLUMN organizations.created_at IS '创建时间';
COMMENT ON COLUMN organizations.updated_at IS '更新时间';

-- ========== org_members ==========
COMMENT ON TABLE org_members IS '组织成员关系（用户在组织内的角色与席位占用）';
COMMENT ON COLUMN org_members.id IS '主键 UUID';
COMMENT ON COLUMN org_members.org_id IS '组织ID';
COMMENT ON COLUMN org_members.user_id IS '用户ID';
COMMENT ON COLUMN org_members.role IS '组织内角色 OrgRole';
COMMENT ON COLUMN org_members.created_at IS '加入时间';
COMMENT ON COLUMN org_members.updated_at IS '更新时间';

-- ========== org_config ==========
COMMENT ON TABLE org_config IS '组织当前配置（团队级审查模板，版本化；不含明文密钥）';
COMMENT ON COLUMN org_config.id IS '主键 UUID';
COMMENT ON COLUMN org_config.org_id IS '组织ID（一对一）';
COMMENT ON COLUMN org_config.version IS '配置版本号（每次保存递增）';
COMMENT ON COLUMN org_config.payload IS '配置 JSON：LLM策略/MCP模板/规则包/流水线/通知等（无明文Token）';
COMMENT ON COLUMN org_config.updated_by IS '最近更新人用户ID';
COMMENT ON COLUMN org_config.updated_at IS '更新时间';
COMMENT ON COLUMN org_config.created_at IS '创建时间';

-- ========== org_config_versions ==========
COMMENT ON TABLE org_config_versions IS '组织配置历史版本快照';
COMMENT ON COLUMN org_config_versions.id IS '主键 UUID';
COMMENT ON COLUMN org_config_versions.org_id IS '组织ID';
COMMENT ON COLUMN org_config_versions.version IS '历史版本号';
COMMENT ON COLUMN org_config_versions.payload IS '该版本配置 JSON 快照';
COMMENT ON COLUMN org_config_versions.updated_by IS '保存该版本的用户ID';
COMMENT ON COLUMN org_config_versions.created_at IS '归档时间';

-- ========== review_reports ==========
COMMENT ON TABLE review_reports IS '云端审查报告（桌面端上传/同步的审查结果）';
COMMENT ON COLUMN review_reports.id IS '报告主键 UUID';
COMMENT ON COLUMN review_reports.org_id IS '所属组织ID';
COMMENT ON COLUMN review_reports.uploader_id IS '上传者用户ID';
COMMENT ON COLUMN review_reports.client_report_id IS '桌面端本地报告ID（组织内幂等）';
COMMENT ON COLUMN review_reports.repo_url IS '代码仓库地址';
COMMENT ON COLUMN review_reports.branch IS '分支名';
COMMENT ON COLUMN review_reports.pr_number IS 'Pull Request 编号（可选）';
COMMENT ON COLUMN review_reports.commit_sha IS '提交 SHA（可选）';
COMMENT ON COLUMN review_reports.status IS '报告状态 ReportStatus';
COMMENT ON COLUMN review_reports.visibility IS '可见性 ReportVisibility';
COMMENT ON COLUMN review_reports.issue_count IS '问题条数汇总';
COMMENT ON COLUMN review_reports.total_duration_ms IS '审查总耗时（毫秒）';
COMMENT ON COLUMN review_reports.client_version IS '上传时桌面端版本';
COMMENT ON COLUMN review_reports.summary IS '摘要文本';
COMMENT ON COLUMN review_reports.payload IS '完整报告 JSON（issues/流水线时间线等）';
COMMENT ON COLUMN review_reports.created_at IS '创建时间';
COMMENT ON COLUMN review_reports.updated_at IS '更新时间';

-- ========== plans ==========
COMMENT ON TABLE plans IS '套餐定义（免费/个人付费月季年/企业席位等，见《权限与套餐.md》）';
COMMENT ON COLUMN plans.id IS '套餐主键 UUID';
COMMENT ON COLUMN plans.key IS '套餐唯一键：free/personal_month/personal_quarter/personal_year/enterprise';
COMMENT ON COLUMN plans.name IS '套餐展示名称';
COMMENT ON COLUMN plans.max_members IS '成员/席位上限';
COMMENT ON COLUMN plans.max_reviews_month IS '每月审查次数上限';
COMMENT ON COLUMN plans.retention_days IS '报告保留天数';
COMMENT ON COLUMN plans.storage_mb IS '存储配额（MB）';
COMMENT ON COLUMN plans.price_cents IS '标价（分）；企业为每席位每年价格';
COMMENT ON COLUMN plans.is_active IS '是否对用户可见/可购（旧套餐可下线）';
COMMENT ON COLUMN plans.created_at IS '创建时间';

-- ========== subscriptions ==========
COMMENT ON TABLE subscriptions IS '组织当前订阅（一组织一条）';
COMMENT ON COLUMN subscriptions.id IS '主键 UUID';
COMMENT ON COLUMN subscriptions.org_id IS '组织ID（唯一）';
COMMENT ON COLUMN subscriptions.plan_id IS '当前套餐ID';
COMMENT ON COLUMN subscriptions.status IS '订阅状态 SubscriptionStatus';
COMMENT ON COLUMN subscriptions.started_at IS '订阅开始时间';
COMMENT ON COLUMN subscriptions.ends_at IS '订阅结束时间（可空表示未设到期）';
COMMENT ON COLUMN subscriptions.note IS '备注（开通说明等）';
COMMENT ON COLUMN subscriptions.created_at IS '创建时间';
COMMENT ON COLUMN subscriptions.updated_at IS '更新时间';

-- ========== usage_records ==========
COMMENT ON TABLE usage_records IS '用量流水（按账期与指标累计）';
COMMENT ON COLUMN usage_records.id IS '主键 UUID';
COMMENT ON COLUMN usage_records.org_id IS '组织ID';
COMMENT ON COLUMN usage_records.metric IS '用量指标名，如 reviews';
COMMENT ON COLUMN usage_records.amount IS '本次计入数量';
COMMENT ON COLUMN usage_records.period IS '账期标识，如 2026-07';
COMMENT ON COLUMN usage_records.meta IS '扩展元数据 JSON';
COMMENT ON COLUMN usage_records.created_at IS '记录时间';

-- ========== audit_logs ==========
COMMENT ON TABLE audit_logs IS '审计日志（组织或平台操作留痕）';
COMMENT ON COLUMN audit_logs.id IS '主键 UUID';
COMMENT ON COLUMN audit_logs.org_id IS '关联组织ID（平台级操作可空）';
COMMENT ON COLUMN audit_logs.actor_id IS '操作人用户ID（可空）';
COMMENT ON COLUMN audit_logs.action IS '动作标识，如 user.ban / config.update';
COMMENT ON COLUMN audit_logs.resource_type IS '资源类型，如 user/org/config';
COMMENT ON COLUMN audit_logs.resource_id IS '资源ID';
COMMENT ON COLUMN audit_logs.ip IS '客户端 IP';
COMMENT ON COLUMN audit_logs.user_agent IS 'User-Agent';
COMMENT ON COLUMN audit_logs.request_id IS '请求追踪ID';
COMMENT ON COLUMN audit_logs.detail IS '详情 JSON';
COMMENT ON COLUMN audit_logs.created_at IS '发生时间';

-- ========== notifications ==========
COMMENT ON TABLE notifications IS '站内通知';
COMMENT ON COLUMN notifications.id IS '主键 UUID';
COMMENT ON COLUMN notifications.user_id IS '接收用户ID';
COMMENT ON COLUMN notifications.org_id IS '关联组织ID（可选）';
COMMENT ON COLUMN notifications.title IS '标题';
COMMENT ON COLUMN notifications.body IS '正文';
COMMENT ON COLUMN notifications.read_at IS '已读时间（空=未读）';
COMMENT ON COLUMN notifications.created_at IS '创建时间';

-- ========== review_methods ==========
COMMENT ON TABLE review_methods IS '平台审查规则/审查方式目录（桌面端勾选后驱动 LLM 审查重点）';
COMMENT ON COLUMN review_methods.id IS '主键 UUID';
COMMENT ON COLUMN review_methods.key IS '业务唯一键，客户端 methodIds 存此值';
COMMENT ON COLUMN review_methods.name IS '展示名称';
COMMENT ON COLUMN review_methods.group_name IS '分组：功能逻辑/安全漏洞等';
COMMENT ON COLUMN review_methods.description IS '说明文案';
COMMENT ON COLUMN review_methods.static_rule_ids IS '映射静态规则 id 列表 JSON';
COMMENT ON COLUMN review_methods.sort_order IS '排序（越小越靠前）';
COMMENT ON COLUMN review_methods.published IS '是否对客户端可见';
COMMENT ON COLUMN review_methods.created_at IS '创建时间';
COMMENT ON COLUMN review_methods.updated_at IS '更新时间';

-- ========== mcp_catalog_items ==========
COMMENT ON TABLE mcp_catalog_items IS 'MCP 目录项（平台发布的可安装 MCP 模板）';
COMMENT ON COLUMN mcp_catalog_items.id IS '主键 UUID';
COMMENT ON COLUMN mcp_catalog_items.key IS '目录唯一键';
COMMENT ON COLUMN mcp_catalog_items.name IS '展示名称';
COMMENT ON COLUMN mcp_catalog_items.description IS '描述';
COMMENT ON COLUMN mcp_catalog_items.transport IS '传输方式：stdio/sse/http 等';
COMMENT ON COLUMN mcp_catalog_items.command IS 'stdio 启动命令';
COMMENT ON COLUMN mcp_catalog_items.args IS '命令参数 JSON 数组';
COMMENT ON COLUMN mcp_catalog_items.url IS '远程 MCP URL（非 stdio 时）';
COMMENT ON COLUMN mcp_catalog_items.env_keys IS '所需环境变量键名列表（不含密钥值）';
COMMENT ON COLUMN mcp_catalog_items.tags IS '标签 JSON 数组';
COMMENT ON COLUMN mcp_catalog_items.verified IS '是否官方/已校验';
COMMENT ON COLUMN mcp_catalog_items.published IS '是否上架对用户可见';
COMMENT ON COLUMN mcp_catalog_items.badge IS '角标文案（如推荐）';
COMMENT ON COLUMN mcp_catalog_items.created_at IS '创建时间';
COMMENT ON COLUMN mcp_catalog_items.updated_at IS '更新时间';

-- ========== orders ==========
COMMENT ON TABLE orders IS '套餐订单（当前为人审开通；在线支付后置）';
COMMENT ON COLUMN orders.id IS '订单主键 UUID';
COMMENT ON COLUMN orders.org_id IS '购买组织ID';
COMMENT ON COLUMN orders.plan_id IS '目标套餐ID';
COMMENT ON COLUMN orders.amount_cents IS '订单金额（分）';
COMMENT ON COLUMN orders.status IS '订单状态 OrderStatus';
COMMENT ON COLUMN orders.payment_method IS '支付方式：alipay/wechat/manual/other';
COMMENT ON COLUMN orders.note IS '备注';
COMMENT ON COLUMN orders.created_by IS '下单人用户ID';
COMMENT ON COLUMN orders.paid_at IS '支付确认时间';
COMMENT ON COLUMN orders.created_at IS '创建时间';
COMMENT ON COLUMN orders.updated_at IS '更新时间';

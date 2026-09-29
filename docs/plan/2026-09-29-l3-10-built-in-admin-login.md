# L3-10 设计：后台内置账号登录与员工账号

> 日期：2026-09-29 · 执行：Claude（Windows 端） · 决策：[ADR-021](../decisions/021-built-in-admin-accounts.md) 及其增补 · 进度：[launch-progress.md](../progress/launch-progress.md) 的 L3-10 行
>
> 本文件冻结 L3-10 的合同、数据、流程和界面边界。其他条目需要改动这里涉及的共享文件时，先在进度表说明。

## 1. 运行模式与配置

- **后台前端**：`FAN_SUPPORT_ADMIN_MODE=LOCAL_ACCOUNT`。
  - 正式环境要求 `NODE_ENV=production`、部署环境为 staging/production、站点和内部 API 使用公网 HTTPS，校验方式与 `OIDC` 相同。
  - 远程测试环境 stg 以开发模式运行（公网 HTTPS 站点 + 回环 HTTP 内部 API），校验方式与 `LOCAL_OIDC` 相同。
  - 两种情况都需要 `FAN_SUPPORT_ADMIN_ACCESS_KEY`，不需要 OIDC issuer。
  - `TEST`、`LOCAL_OIDC`、`OIDC` 三种模式保持不变。
- **API**：
  - 新增 `FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS=ENABLED` 打开内置账号路由，沿用已有的 admin origin、access key、token pepper 和 subject pepper；
  - 新增可选的 `FAN_SUPPORT_ADMIN_TOTP_ISSUER`，是验证器 App 里显示的名称，默认 `Studio Admin`。
  - 这两个新变量都要登记进 `packages/config/src/config-layers.ts`。
- **TOTP 密钥加密**：走现有的 `KeyManagementPort` 信封加密，新增用途 `ADMIN_TOTP_SECRET`，`subjectId` 为账号 id。正式环境用 KMS，本地和 stg 用现有的模拟 KMS。
  - 这样不必新增密钥配置。①里写的 AES 封装函数因此不再使用，将在 ② 中删除。

## 2. 数据（迁移 0052_admin-local-accounts）

- **`permissions`**：只新增 `staff.manage`。
- **权限目录与标准角色**：0052 起初在迁移里预置了完整权限目录和 `studio:owner` / `studio:operator`，但仓库惯例是迁移只登记自己引入的键（如 0035–0037），其余权限键由测试夹具和部署初始化创建，16 个夹具因此在全新库上撞唯一约束。0052 已推送并在 stg 执行，不能修改，所以用修正迁移 0054 撤下预置的目录和两个未分配的角色，只保留 `staff.manage`。完整目录（合同中的 `adminPermissionKeySchema`）和两个标准角色，改由服务器命令在创建首个管理员时幂等补齐。
- **`admin_local_accounts`**，一个账号对应一个 `admin_identities` 行：
  - 身份字段：`admin_identity_id`（唯一），对应身份行的 issuer 必须为 `urn:fan-support:local`，由触发器校验。
  - `login_name`：唯一，规则为 `^[a-z0-9][a-z0-9._-]{2,63}$`，存储前统一转小写。
  - `display_name`：1–80 个字符。
  - 密码：`password_hash`（第 ① 段的 scrypt 格式，带 CHECK）、`password_changed_at`、`must_change_password`。
  - 锁定：`failed_attempts`、`locked_until`。
  - 已生效的 TOTP：`totp_ciphertext`、`totp_encrypted_data_key`、`totp_key_version`、`totp_enabled_at`、`totp_last_step`，这几列要么全空要么全有。
  - 待确认的 TOTP：`totp_pending_ciphertext`、`totp_pending_encrypted_data_key`、`totp_pending_key_version`、`totp_pending_expires_at`，同样全空或全有，有效期不超过 10 分钟。
  - 其他：`last_login_at`、`version`、`created_at`、`updated_at`。
  - 禁止 DELETE 和 TRUNCATE；停用账号通过身份行的 `status` 表示。
- **0055 修正（第 ③ 段发现）**：0052 给四个 TOTP 密文列写的 CHECK 正则是 `{32,4096}`，但 PostgreSQL 正则的重复次数上限是 255，任何非空值都会报 2201B，也就是 TOTP 根本存不进去。0052 已部署到 stg，不能改，所以用 0055 换成等价规则：`^enc:v1:[A-Za-z0-9_-]+$` 加长度 39–4103。已存有 TOTP 时 0055 拒绝降级。stg 要先部署 0055，两步验证才能用。
- **`admin_local_recovery_codes`**：
  - 字段：`account_id`、`batch_id`、`code_digest`（32 字节，唯一）、`created_at`、`used_at`、`revoked_at`。
  - 已用或已作废的码不能恢复；只追加，不删除。
- **`admin_local_logins`**：一次登录尝试一行，它是会话的签发凭据。
  - 字段：`account_id`、`challenge_digest`（多步登录时用，唯一）、`locale`、`needs_second_factor`、`needs_new_password`、`second_factor`（`NONE`/`TOTP`/`RECOVERY_CODE`）、`step_attempts`（每次登录最多 5 次）、`state`（`PENDING`→`CONSUMED`，只能消费一次）、`expires_at`（≤ 创建后 300 秒）、`completed_at`、`session_id`、`audit_log_id`。
  - 消费时必须有同一事务内精确对应的审计：
    - 成功：`ADMIN_LOCAL_LOGIN_SUCCEEDED`，原因码为 `AUTHENTICATED_PASSWORD`、`AUTHENTICATED_TOTP` 或 `AUTHENTICATED_RECOVERY_CODE`，并且会话合格、身份为 ACTIVE、TTL 在 60–28800 秒之间。
    - 失败：`ADMIN_LOCAL_LOGIN_REJECTED`，原因码为 `LOGIN_EXPIRED`、`SECOND_FACTOR_FAILED`、`ACCOUNT_LOCKED` 或 `ACCESS_DENIED`。
- **会话保护**：
  - 用 `CREATE OR REPLACE` 重写 `guard_linked_admin_session()`，把由 `admin_local_logins` 签发的会话也视为"已签发"：绑定信息不可改、吊销是最终状态、不能删除。
  - 新增约束触发器：吊销这些会话必须有精确审计，原因码为 `USER_LOGOUT`、`PASSWORD_CHANGED`、`PASSWORD_RESET`、`ACCOUNT_SUSPENDED`、`SECOND_FACTOR_CHANGED` 之一。执行者可以是 ADMIN（本人或员工管理员），也可以是 SYSTEM（服务器命令）。
  - 降级迁移会还原原函数；只要已有内置账号数据就拒绝降级。
- **会话门槛字段**：按 ADR-021 增补第 1 条，内置会话满足平台登录策略时，`authenticated_with_mfa=true`；实际使用的认证因素记录在 `admin_local_logins.second_factor` 和审计原因码里。

## 3. 登录流程（服务端状态机）

1. **提交账号密码**：`login(loginName, password, locale)`。
   - 登录名先规范化。账号不存在也照常执行一次 scrypt 计算，然后统一返回 `INVALID_CREDENTIALS`。
   - 账号被锁定时返回 `ACCOUNT_LOCKED`，此时不校验密码。
   - 密码错误：失败次数加一，到 5 次时锁定 15 分钟，并写入 `ADMIN_LOCAL_LOGIN_REJECTED` 审计（SYSTEM，`task_name=admin-local-access`）。
   - 身份不是 ACTIVE：返回 `INVALID_CREDENTIALS`，不泄露账号状态。
   - 密码正确：清零失败计数，新建一条 `admin_local_logins`：
     - 不需要后续步骤时，立刻消费并签发会话，返回 `SESSION_CREATED`；
     - 否则返回 `STEP_REQUIRED`，附带 `SECOND_FACTOR` 或 `NEW_PASSWORD` 和一次性的 `challengeToken`（数据库只存它的摘要）。
2. **提交后续步骤**：`step(challengeToken, …)`。
   - `TOTP`：校验验证码，并拒绝重放的时间步。
   - `RECOVERY_CODE`：恢复码只能使用一次。
   - `NEW_PASSWORD`：校验密码策略，写入新哈希，清除 `must_change_password`。
   - 每次登录最多尝试 5 次，超过即消费为拒绝。验证码连续错误也计入账号的失败次数。
   - 所有步骤完成后签发会话。
3. **会话与登出**：会话 TTL 沿用 8 小时上限，Cookie 沿用 `__Host-fan-admin-session/-csrf`。多步登录期间，challenge token 放在 `__Host-fan-admin-local-login` Cookie 里（HttpOnly、SameSite=Strict、300 秒）。登出复用现有的 `revoke`。

## 4. 接口

- **登录前**：前缀 `/api/v1/admin/local-access`，照 `admin-access-route.ts` 的做法校验 access key 和 Origin。
  - `POST /login`、`POST /step`。
- **已登录**：都走 `registerPrivateAdminEndpoint`，需要会话和 CSRF。
  - 账号设置，前缀 `/api/v1/admin/account/`：
    - `context`：非内置账号返回 `NOT_LOCAL`，页面据此隐藏；
    - `change-password`：需要当前密码，成功后吊销本账号其他会话；
    - `totp-begin`：需要当前密码，返回 otpauth URI 和手动输入用的密钥，有效 10 分钟；
    - `totp-confirm`：需要验证码，成功后生效，返回 10 个恢复码（只返回这一次）；
    - `totp-disable`：需要当前密码和验证码，成功后吊销本账号其他会话；
    - `recovery-codes`：需要当前密码和验证码，重新生成恢复码，旧批次作废。
  - 员工账号，前缀 `/api/v1/admin/staff/`，需要 `staff.manage`：
    - `context`、`list`、`roles`；
    - `create`：返回一次性临时密码，同时授予 7 种语言的内容与留言权限；
    - `update-roles`、`reset-password`（返回临时密码）、`clear-totp`、`set-status`（暂停时吊销该账号全部会话）。
    - 不能暂停自己，也不能移除自己最后一个 `staff.manage`，避免把自己锁在外面。
- **BFF**：
  - 新路由 `/api/admin/local-auth/{login,step}`，在 `next.config.ts` 中从日志里排除；
  - 账号设置和员工账号走现有的 `[operation]` 注册表（`admin-operations.ts`）；
  - 登出路由在 `LOCAL_ACCOUNT` 模式下同样可用。

## 4.1 第 ③ 段实现约定（2026-09-29 开工时核对代码后确定）

- **慢操作不进事务**：scrypt 和 KMS（正式环境是网络调用）都在数据库事务之外完成。每个写操作分两步：先只读取出哈希或密文，事务外校验，再在事务里锁行，确认密码哈希、TOTP 密文仍与校验时一致（比较后写入），才落库。并发改密、并发解绑时，旧的校验结果自动作废。
- **事务隔离**：用 READ COMMITTED 加显式行锁（先身份行，再账号行，再登录记录），不用 SERIALIZABLE。并发输错密码时计数逐一累加，不会因为序列化冲突报"服务不可用"。
- **步骤顺序**：先验证码，再设新密码。只拿到临时密码、没有验证码的人不能先把密码改掉。
- **失败计数**：连续 5 次失败锁 15 分钟，锁定时计数清零，锁到期后重新计。登录密码错误、登录验证码或恢复码错误、账号设置里当前密码或验证码错误，都计入同一个计数。为此给账号设置的失败码增加 `ACCOUNT_LOCKED`。绑定时输错验证码不计数（密钥只有本人看得到）。
- **登录名不存在**：照常算一次 scrypt，统一返回 `INVALID_CREDENTIALS`。没有账号可挂，因此不写审计。
- **内置身份摘要**：现有身份摘要函数要求 issuer 是 https 地址，内置账号改用专用函数，构造相同（subjectPepper 对 `[urn:fan-support:local, 账号 id]` 做 HMAC）。`mfa_required` 如实写 false。
- **会话**：内置账号会话时长 8 小时（数据库上限）。登出新增 `/api/v1/admin/local-access/logout`，复用现有吊销逻辑，不依赖 OIDC 配置。
- **API 配置**：打开 `FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS=ENABLED` 后，OIDC 配置变为可选，两者至少要有一个；只有配置了 OIDC 才注册 `/api/v1/admin/access/*`。
- **员工管理防自锁**：对自己不能重置密码、清除两步验证或暂停（改用账号设置），统一返回 `SELF_LOCKOUT`；改自己的角色时，新角色里必须仍有 `staff.manage`。
- **接口精简**：`LIST` 已同时返回员工和可选角色，不再单设 `roles` 接口。
- **临时密码**：16 个无歧义字符分 4 组（约 80 位随机性），只在创建或重置的响应里出现一次。

## 5. 服务器命令

`apps/api/scripts/admin-account.mjs`：

- 子命令：`create`、`reset-password`、`clear-2fa`、`suspend`、`reactivate`、`list`。
- 数据库连接沿用 API 的配置；本地体验和 stg 用 `--instance <name>`。
- 密码只从标准输入读取，支持 `--password-stdin`，不回显，不写入参数、历史或日志。
- 审计记为 SYSTEM，`task_name=admin-account-cli`。
- 首个管理员使用 `studio:owner` 角色，并自授 7 种语言权限。

## 6. 标准角色（默认值，可调整）

- **`studio:owner`（工作室管理员）**：全部权限，包括员工管理、财务、支付配置和异常重放。
- **`studio:operator`（日常运营）**：
  - 包含：内容与媒体全部权限、礼物/价格/库存、`management.direct`、订单查看/留言/履约/备注/通知重发、`payments.read`、`exceptions.read`。
  - 不含：`orders.manage`、`finance.manage`、`payments.configure/review/publish`、`exceptions.replay`、`staff.manage`。

## 7. 界面

- **登录页**：替换未登录时的单按钮。
  - 品牌区与黑金主题；登录名/密码表单，可切换显示密码；
  - 验证码步骤：6 位数字，`autocomplete=one-time-code`，可以改用恢复码；
  - 临时密码登录后，在登录流程里直接设置新密码；
  - 统一的错误提示和锁定提示，七语言，适配键盘、390×844 与 1440×900 以及 reduced motion。
- **账号设置**（侧栏新区）：
  - 修改密码；
  - 两步验证：状态、扫码绑定（二维码用 `qrcode-generator` 算点阵、React 画 SVG，同时显示手动输入密钥）、恢复码展示与下载、解绑；
  - 未绑定时醒目提示。
- **员工账号**（侧栏新区，需要 `staff.manage`）：
  - 列表显示登录名、显示名、状态、两步验证状态、角色和最近登录；
  - 支持新建、改角色、重置密码、清除两步验证、暂停和恢复；
  - 临时密码只显示一次，并提供复制按钮。

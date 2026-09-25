# 管理中心本地登录与权限验证

本入口用于 P5-01 的本地 OIDC、PostgreSQL 会话和现有内容权限验证。运营仍从 `/:locale` 的一个管理中心点击「登录」，进入已有艺人、礼物、海报操作；本轮没有新增人员管理界面。任务状态以 [Phase 5](../progress/phase-5-operations-payments.md) 和 [MASTER](../progress/MASTER.md) 为准，本地验证不代表生产身份接入或上线批准。

## 验证命令

在仓库根目录执行；Node/pnpm 版本沿用仓库工具链。

```sh
# 真实临时 PG + 本地 HTTPS IdP + Admin 浏览器，覆盖七语言和两个尺寸
mise exec node@24.20.0 -- corepack pnpm verify:admin-access:browser

# 相同登录协议、角色矩阵和审计的 API 验证，不启动浏览器
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:admin-access

# 只验证持久化层：挑战领取、并发、会话撤销及审计约束
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:admin-access

# 现有简单表单的完整图片上传、处理、发布、海报恢复回归
mise exec node@24.20.0 -- corepack pnpm verify:management-center
```

这些入口创建自有临时数据库和测试身份，不连接生产账户。浏览器命令使用已安装的 Chrome、本地临时 TLS 证书和仅映射到 loopback 的测试域名；不录制 HAR、trace 或凭据。验收生成 `output/checks/p5-01-admin-access/integration-*/validation.json`；浏览器完整结果与截图在其中的 `browser-access/`。失败保留固定阶段及脱敏检查结果。PostgreSQL 层命令单独输出检查结果。

登录浏览器验收只检查鉴权、空列表、短表单可见性及登录/退出错误恢复，不执行上传；完整上传回归必须另跑 `verify:management-center`，不能互相代替。人工翻译、屏幕阅读器和实体手机验收也不能由自动化截图替代。

## 仅供开发的开关

未配置时 `FAN_SUPPORT_ADMIN_MODE=DISABLED`。`LOCAL_OIDC` 只接受 `NODE_ENV=development`、`FAN_SUPPORT_DEPLOYMENT_ENV=development`；Admin 必须是配置校验允许的规范 HTTPS origin，内部 API 必须是 loopback HTTP origin。生产环境不能用该开关开启本地接入。

| Admin 进程变量 | 用途 |
| :-- | :-- |
| `FAN_SUPPORT_ADMIN_MODE=LOCAL_OIDC` | 启用本地真实 OIDC 登录入口 |
| `FAN_SUPPORT_SITE_ORIGIN` | 本次 Admin 的精确 HTTPS origin |
| `FAN_SUPPORT_INTERNAL_API_ORIGIN` | 本次内部 API 的 loopback HTTP origin |
| `FAN_SUPPORT_ADMIN_ACCESS_KEY` | 独立随机 32 字节值的 64 位小写 hex；仅 BFF/API 共享 |
| `FAN_SUPPORT_ADMIN_OIDC_ISSUER` | 与服务端 provider 完全一致的 issuer |

这些配置只在服务端读取；页面仅接收「是否可以登录」布尔值。不得使用 `NEXT_PUBLIC_*` 暴露密钥。旧 `TEST` 夹具保留原行为，不替代真实 OIDC 验证。推荐直接运行上面的验收命令，由脚本分配临时端口、凭据与 TLS 材料；不复制脚本生成的值作为正式配置。

API 通过 [createLocalOidcAdminAccessComposition](../../apps/api/src/admin-access-composition.ts) 显式组合，普通启动不会自动启用该接入。调用者提供 `environment: "LOCAL_OIDC"`、数据库、`allowedOrigin`、`settings`、`provider`、`accessKey`、`tokenPepper` 和独立 `subjectPepper`，并把返回的路由与生命周期资源交给 `createApiApplication`。三个秘密都应独立随机生成、仅服务端持有；`tokenPepper` 与 `subjectPepper` 不得相同。

`settings` 包含 `schemaVersion`、issuer、clientId、精确 callback URI、policyVersion、登录/会话 TTL 和最大认证年龄；callback 固定为 `${allowedOrigin}/api/admin/auth/callback`。`provider` 包含同一 issuer/clientId/callback、客户端认证方式及明确的 MFA ACR/AMR 接受策略。使用仓库合同校验，不把任意 IdP 声明当作 MFA 或平台权限。本地 IdP 的客户端认证及 MFA 声明只是夹具值，不能直接视作真实供应商配置。

## 身份与当前权限

登录前必须已有平台授权身份：`admin_identities` 的 issuer 加 `external_subject_hash` 识别账号。摘要使用 [digestAdminIdentitySubject](../../packages/application/src/admin-access-tokens.ts) 对 issuer 和 subject 做带独立 `subjectPepper` 的 HMAC；预授权与登录必须使用相同规则。不得按邮箱自动关联、自动创建人员或直接采纳 IdP 的角色声明。未知身份即使签名和 MFA 正确也不能获得会话。

角色、权限、语言授权、身份暂停及会话撤销以 PostgreSQL 当前状态为准；下面是 [本地六角色夹具](../../apps/api/scripts/admin-access-fixtures.mjs) 的内容权限矩阵，不是后续业务已实现的承诺。

| 角色 | 当前内容权限 | 当前边界 |
| :-- | :-- | :-- |
| Daily Operator | 内容读取/编辑/预览、媒体操作、`management.direct` | 通过简单管理中心操作；没有翻译审核、政策管理或通用 `content.publish` 权限 |
| Content Editor | 内容读取/编辑/预览、媒体操作 | 没有简单管理中心直发、翻译审核、政策管理或发布权限 |
| Translation Reviewer | 内容读取、译文审核、预览、媒体读取 | 仅获授语言；夹具只授予 `ja`，其他语言拒绝；不能编辑或发布 |
| Order Operator | 无内容读取/写入权限 | 订单工作区在后续任务实现，本验收不证明查单或履约能力 |
| Manager | 当前全部内容权限及 `management.direct` | 不因此获得尚未实现的退款、渠道开关或密钥访问能力 |
| Developer/Admin | 无内容读取/写入权限 | 部署/运维能力不由本登录矩阵授予，不能借技术身份绕过业务审计 |

## 会话与恢复

- 浏览器登录绑定和会话令牌仅保存在有有效期的 `Secure`、`HttpOnly`、`__Host-` Cookie；一次性登录绑定为 `SameSite=Lax`，会话和 CSRF Cookie 为 `SameSite=Strict`。CSRF 值通过同源、禁止缓存的会话读取进入内存，不能写入本地存储、HTML、URL、日志或截图。
- 登录按钮用同源 fetch 提交，再跳转合同校验后的 HTTPS 授权地址；开始登录的 JSON 不含浏览器绑定、会话或 CSRF 凭据。这样在 `no-referrer` 下仍保留浏览器的精确 Origin，不接受原生表单可能发送的 `Origin: null`，不放宽服务端校验。
- callback 的 state、nonce、PKCE、浏览器绑定、配置与一次性 PG 挑战一起验证。授权码兑换不会盲目重试；回调丢失、兑换失败或结果不确定时重新登录，不复用旧 code，也不绕过已领取挑战。
- 会话失效后重新登录；服务不可用则显示重试。退出当前会话先等待 API 的数据库撤销确认，再清 Cookie。网络或数据库失败不得显示退出成功或先清掉当前凭据；稍后可再次尝试。平台退出不等于退出身份供应商的 SSO 会话。
- 原始凭据不进入数据库记录或持久化测试证据；数据库保留摘要、会话事实和审计。Next 的身份路由原始 URL 日志被禁用；验收须同时检查实际运行日志中的 callback canary，不能只检查配置对象。

正式 IdP 的客户端注册与 MFA 语义、人员预授权流程、账户恢复、紧急访问、Secret Manager 接入及密钥轮换仍需正式 UAT 和发布门。`subjectPepper` 关联既有账号，不能当普通会话密钥随意更换；本轮未交付其在线迁移或轮换工具。退款、渠道启停、强制履约等高风险确认和审计由各后续任务验收，本入口不提前解锁或宣称通过。

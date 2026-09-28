# 生产配置：API 与 Worker 的配置组

> 适用：staging / production 部署，以及任何通过 `node dist/main.js` 启动的 API/Worker。
> 本地体验（`local:start`）走 `apps/api/src/testing/` 中的 TEST 组合，不读这里的配置组。

## 基本规则

- 进程启动时一次性读取并校验全部配置，校验通过后才创建连接池、KMS 与 S3 客户端和定时任务。
- 每个可选配置组：**全部缺失 = 该能力明确不可用；只填一部分 = 启动失败**。不会出现"配了一半、静默关闭"的情况。
- 未登记的 `FAN_SUPPORT_*` 变量一律导致启动失败（`packages/config/src/config-layers.ts`），拼错的键不会被悄悄忽略。
- 密钥值只能通过 Secrets Manager 注入（OpenTofu `secret_references`），普通环境变量（`application_environment`）里禁止出现。键名含 `TOKEN`/`SECRET`/`ACCESS_KEY` 的变量会被 OpenTofu 校验拒绝放进普通环境变量。

## 配置组

| 组 | 键 | 缺失时的行为 | 注入方式 |
|:--|:--|:--|:--|
| 核心（必填） | `NODE_ENV`、`FAN_SUPPORT_DEPLOYMENT_ENV`、`FAN_SUPPORT_SITE_ORIGIN`、`FAN_SUPPORT_DATABASE_URL`、对象存储组 | 启动失败 | 数据库 URL 走 Secrets Manager，其余为普通变量 |
| 密钥管理（KMS） | `FAN_SUPPORT_CART_KMS_REGION`、`FAN_SUPPORT_CART_ENCRYPTION_KEY_VERSION`、`FAN_SUPPORT_CART_ENCRYPTION_KEY_IDS_JSON`、`FAN_SUPPORT_CART_BLIND_INDEX_KEY_VERSION`、`FAN_SUPPORT_CART_BLIND_INDEX_KEY_IDS_JSON` | 购物车、结账返回 503 | 普通变量（只含 KMS 密钥 ARN 引用） |
| 订单查询 | `FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON` | 查单接口返回 503 | 普通变量 |
| 支付 | `FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON`、`FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON`、`FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON`、`FAN_SUPPORT_PAYMENT_WEBHOOK_ENDPOINTS_JSON` | 没有运行时配置时，结账支付接口返回 503；没有账户连接时处于"已部署但休眠" | 普通变量（不含凭据，凭据用 `secret-ref:v1:env:PAYMENT_SECRET_…` 引用，值由 Secrets Manager 注入） |
| 管理后台 | 普通变量：`FAN_SUPPORT_ADMIN_ORIGIN`、`FAN_SUPPORT_ADMIN_OIDC_ISSUER`、`FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON`；密钥：`FAN_SUPPORT_ADMIN_ACCESS_KEY`、`FAN_SUPPORT_ADMIN_TOKEN_PEPPER`、`FAN_SUPPORT_ADMIN_SUBJECT_PEPPER`、`FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET`（仅机密客户端） | `/api/v1/admin/*` 不注册（404） | 见左列 |

依赖关系：管理后台、订单查询、支付运行时都依赖密钥管理组；缺少它时，这三组中任何一组有配置都会启动失败。

管理后台组由 API 专属的键决定是否启用（源站、两个 pepper、OIDC 配置、客户端密钥）。`FAN_SUPPORT_ADMIN_ACCESS_KEY` 和 `FAN_SUPPORT_ADMIN_OIDC_ISSUER` 与 Admin 应用共用，单独出现不会启用 API 的后台接口。三个 64 位十六进制密钥（访问密钥、会话 pepper、主体 pepper）必须互不相同。

### 商城装修预览

Storefront 进程单独接收公开的 `FAN_SUPPORT_ADMIN_ORIGIN`（准确 HTTPS origin，不带路径），用于限制预览的嵌入来源和消息来源；不要将 API/Admin 的访问密钥、pepper 或 OIDC 凭据一起传入商城。缺省时预览路由不可用，正常首页仍可读取已发布布局。代理/CDN 必须保留预览的 `private, no-store`、`noindex` 和限定 `frame-ancestors`；首页布局数据接口也不得缓存。数据库先升级到迁移 0044，再部署依赖该接口的前后台/API。参见 [本地操作](local-experience.md)。

### OIDC 配置示例（不含任何密钥）

```json
{
  "schemaVersion": 1,
  "clientId": "fan-support-admin",
  "clientAuthentication": "CLIENT_SECRET_BASIC",
  "acceptedAcrValues": [],
  "requiredAmrValues": ["mfa"],
  "policyVersion": "admin-mfa-v1",
  "loginTtlSeconds": 300,
  "sessionTtlSeconds": 3600,
  "maxAuthenticationAgeSeconds": 300
}
```

回调地址固定为 `${FAN_SUPPORT_ADMIN_ORIGIN}/api/admin/auth/callback`，需要在 IdP 登记。`acceptedAcrValues` 和 `requiredAmrValues` 至少填一个，不能关闭 MFA。`clientAuthentication` 为 `NONE` 时不得提供客户端密钥；为 `CLIENT_SECRET_BASIC` 时必须提供。

### 管理 Web 的正式登录

正式构建使用显式 `FAN_SUPPORT_ADMIN_MODE=OIDC`。只接受 `NODE_ENV=production` 与 `FAN_SUPPORT_DEPLOYMENT_ENV=staging` 或 `production`。未设置模式仍为 `DISABLED`；`TEST` 和 `LOCAL_OIDC` 仍限于原开发环境，不能作为配置失败后的回退。启用 OIDC 后配置不完整或不合法会使 Node 初始化校验失败，服务不能进入就绪状态。

就绪以带超时的 `/healthz` HTTP 200 为准，不能只看 PID 或 Next 控制台的 “Ready”。当前 Next 版本在 `instrumentation.register` 抛错后可能保留进程而不服务请求；因此裸 `next start` 的非零退出不是唯一判据。已有 Docker/ECS 健康检查有超时并检查 HTTP 成功，正式部署必须保留，缺配置时不可放行流量。此行为符合 [Next 的 register 就绪约定](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation#register-optional)；实际拒流与恢复还需在 L4 部署验收。

| Admin 进程变量 | 要求 |
| :-- | :-- |
| `FAN_SUPPORT_SITE_ORIGIN` | 管理站精确 HTTPS origin，与 API 的 `FAN_SUPPORT_ADMIN_ORIGIN` 一致 |
| `FAN_SUPPORT_INTERNAL_API_ORIGIN` | 后台 BFF 使用的规范 HTTPS API origin；不含路径、账号、查询或片段；不是浏览器请求地址 |
| `FAN_SUPPORT_ADMIN_ACCESS_KEY` | 仅 Admin/API 共享的独立随机 32 字节小写 hex，由秘密管理注入 |
| `FAN_SUPPORT_ADMIN_OIDC_ISSUER` | 与 API 及 IdP discovery 完全相同的 HTTPS issuer，可包含 IdP 的 realm 路径 |
| `FAN_SUPPORT_STOREFRONT_ORIGIN` | 可选的商城 HTTPS origin，用于真实页面预览 |

Admin 不接收客户端密钥、会话 pepper、主体 pepper、数据库或支付密钥；这些仍由 API 持有。不得把上述秘密加入 `NEXT_PUBLIC_*`。OIDC 模式继续使用同一个服务端 BFF、HttpOnly Cookie、CSRF 和 PostgreSQL 权限检查；根地址进入默认英语管理中心，语言入口仍为七个固定 `/:locale` 路由。

部署代理必须保留公开 Host / HTTPS 协议及 Cookie，身份与后台接口禁止缓存、不得记录 callback 查询参数。Next 内部监听必须保持私有；代理必须覆盖而非追加客户端的 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto`，三者分别与配置的管理 host、host、`https` 完全一致。Next 若用内部监听构造 Request URL，后台按这些固定值识别公开入口；这不授予身份，原 Origin、Fetch Metadata、Cookie、CSRF 和数据库权限仍分别检查。应用不通过关闭 TLS 验证或信任任意转发地址适配错误的代理配置。平台退出撤销本平台会话，不承诺退出 IdP 的 SSO 会话。

配置可用不表示人员已经获权。正式开通前必须记录并核验：IdP 客户端及精确回调、真实 MFA 声明、至少一名获准操作者和恢复负责人的账户恢复流程、平台人员的 issuer/subject 预授权、订单与财务角色隔离，以及暂停账号/撤销会话后的实际拒绝。平台以独立 HMAC 摘要关联 subject，不按邮箱自动开户、不接受 IdP 角色覆盖业务权限；参见 [身份与权限](admin-access-local.md#身份与当前权限)。首次正式人员预授权及恢复操作尚需受控实施和实际验收，本次本地接线没有预建正式管理员或交付自助人员管理界面。

L3-05 的隔离验证入口见 [管理登录验证](admin-access-local.md#正式构建的隔离验证)。自有 HTTPS IdP、临时 PostgreSQL 与 `next start` 只能证明工程接线，不替代真实 IdP/MFA、经营方授权或生产发布验收。

## 支付：代码与激活分离

- 支付适配器代码随版本发布，清单在 `apps/api/src/payment-deployed-adapters.ts`。当前已部署两家，都只支持刷卡：
  - Stripe Checkout（`stripe` / `1.0.0` / `stripe-checkout-v1`），托管页跳转，设计见 `docs/plan/r1-03-stripe-adapter.md`。
  - Airwallex 托管支付页（`airwallex` / `1.0.0` / `airwallex-hpp-v1`），前台加载官方 SDK 后跳转，设计见 `docs/plan/r1-03b-airwallex-adapter.md`。

  PayPal 随后加入。
- 凭据：账户连接的 `credentialRef` 与端点的 `secretRef` 写成 `secret-ref:v1:env:<变量名>`，变量名必须以 `PAYMENT_SECRET_` 开头，由 Secrets Manager 注入。webhook 轮换期可以在同一变量里用逗号并列最多 3 把密钥，新的在前。
  - Stripe：API 密钥的模式必须与账户环境一致（TEST 账户只接受 `sk_test_`/`rk_test_`）。
  - Airwallex：API 凭据是一个值 `<client_id>:<api_key>`。API 源站按环境固定：TEST 为 `https://api.sandbox.airwallex.com`，LIVE 为 `https://api.airwallex.com`。`allowedActionOrigins` 写托管页源站：TEST 为 `https://checkout.sandbox.airwallex.com`，LIVE 为 `https://checkout.airwallex.com`。语言映射只能用托管页支持的语言：zh-CN→`zh`，th 回退到 `en` 并标记回退。部署了 Airwallex 账户时，`FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON` 的 `actionTtlMs` 不能超过 3,300,000（55 分钟）。Airwallex 的 client_secret 只有 60 分钟有效，超过这个值启动失败。
- `FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON` 是 `PaymentAccountConnection` 数组，描述不可变的已部署账户：商户号、环境、协议版本、API 源站、凭据引用。每个账户必须在 `FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON` 中有且只有一条健康策略。账户的回跳源站必须等于 `FAN_SUPPORT_SITE_ORIGIN`。
- 账户找不到对应的已部署适配器代码（按适配器键、版本、协议三者匹配）时，启动失败。
- 哪些账户可以收款、适用哪些市场、灰度比例是多少，都由管理中心"支付设置"发布到 PostgreSQL（P5-05）。各实例每 10 秒同步一次，不需要重新部署。
- 已淘汰：`FAN_SUPPORT_PAYMENT_PROVIDER_BINDINGS_JSON`（P4-04 的静态绑定路径），已被账户连接取代。继续设置它会导致启动失败。

## Webhook

- 入口是 `POST /api/v1/webhooks/payments/:endpointId`。`FAN_SUPPORT_PAYMENT_WEBHOOK_ENDPOINTS_JSON` 里的每个端点必须绑定一个已部署账户，并有该适配器的验签代码，否则启动失败。只有这些端点会继续做 PostgreSQL 端点预检；其余端点在内存中直接返回 404，不访问数据库。
- Stripe 端点需要订阅的事件：`checkout.session.completed`、`checkout.session.async_payment_succeeded`、`checkout.session.async_payment_failed`、`checkout.session.expired`、`refund.created`、`refund.updated`、`refund.failed`、`charge.dispute.created`、`charge.dispute.updated`、`charge.dispute.closed`。
- Airwallex 端点：
  - 订阅的 API 版本必须选 `2026-08-21`，与适配器调用时钉死的版本一致；旧版本的载荷字段不同。
  - 需要订阅的事件：
    - `payment_intent.succeeded`、`payment_intent.cancelled`、`payment_intent.pending`、`payment_intent.pending_review`；
    - `refund.received`、`refund.accepted`、`refund.settled`、`refund.failed`；
    - 全部 9 个 `payment_dispute.*` 事件。
  - 验签头是 `x-timestamp` 和 `x-signature`。
  - Airwallex 没有内置密钥轮换：新建订阅拿到新密钥，两把并列，确认新密钥生效后再删除旧订阅。
- 运营约束：退款只能从平台后台发起。在 Stripe 或 Airwallex 后台直接退款不会带平台引用，会被当作不支持的事件，需要人工处理。
- Airwallex 前台依赖：结账页在粉丝点"去支付"时才加载 `https://static.airwallex.com/components/sdk/v1/index.js`，SDK 再从托管页源站加载支付主包。R1-6 收紧 CSP 时必须放行：
  - `script-src`：`https://static.airwallex.com` 与两个托管页源站；
  - `connect-src`：`https://o11y.airwallex.com`。

  这个 SDK 由 Airwallex 原地更新，无法固定 SRI 哈希。
- webhook 原始报文先用密钥管理组加密再入库。缺少该组时，webhook 入库返回 `CONFIGURATION_ERROR`。

## 连接池

| 进程 | 连接池 | 说明 |
|:--|:--|:--|
| API | `fan-support-api` | 公开、商城、后台请求共用；获取连接超时 5 秒 |
| API | `fan-support-api-payment-configuration` | 支付配置投影及其后台；获取 3 秒、语句 5 秒、查询 6 秒 |
| API | `fan-support-api`（webhook）+ pg-boss | webhook 收件箱与队列，与请求池隔离 |
| Worker | 可靠事件、媒体处理、缓存清除、管理中心各一个 | 管理中心任务（上传海报后的准备与发布）只在 Worker 中处理 |

连接池按引用计数关闭：所有借用方停止后才会真正关闭，与停止顺序无关。

## 验证入口

- 单元测试与真实 Fastify 路由测试：`apps/api/src/production-*.test.ts`、`apps/worker/src/management-center-composition.test.ts`。
- 本机没有 PostgreSQL 时，无法验证真实数据库行为，这部分由 CI 的 `test:postgres` 系列承担。

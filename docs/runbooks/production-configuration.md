# 生产配置：API 与 Worker 的配置组

> 适用：staging / production 部署，以及任何通过 `node dist/main.js` 启动的 API/Worker。
> 本地体验（`local:start`）走 `apps/api/src/testing/` 中的 TEST 组合，不读这里的配置组。

## 基本规则

- 进程启动时一次性读取并校验全部配置，校验通过后才创建连接池、KMS 与 S3 客户端和定时任务。
- 每个可选配置组：**全部缺失 = 该能力明确不可用；只填一部分 = 启动失败**。不会出现"配了一半、静默关闭"的情况。
- 未登记的 `FAN_SUPPORT_*` 变量一律导致启动失败（`packages/config/src/config-layers.ts`），拼错的键不会被悄悄忽略。
- 密钥值不得入库、写入普通配置示例或传给前端。使用仓库现有 OpenTofu 部署时，通过 Secrets Manager（`secret_references`）注入，普通配置（`application_environment`）里禁止出现；键名含 `TOKEN`/`SECRET`/`ACCESS_KEY` 的变量会被该部署校验拒绝。这是现有部署方式的约束，不把整套云拓扑恢复为首发前置条件；下表的生产 API KMS 依赖仍然适用。

## 配置组

| 组                       | 键                                                                                                                                                                                                                                 | 缺失时的行为                                                             | 注入方式                                                                                          |
| :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| 核心（必填）             | `NODE_ENV`、`FAN_SUPPORT_DEPLOYMENT_ENV`、`FAN_SUPPORT_SITE_ORIGIN`、`FAN_SUPPORT_DATABASE_URL`、对象存储组                                                                                                                        | 启动失败                                                                 | 数据库 URL 走 Secrets Manager，其余为普通变量                                                     |
| 密钥管理（KMS）          | `FAN_SUPPORT_CART_KMS_REGION`、`FAN_SUPPORT_CART_ENCRYPTION_KEY_VERSION`、`FAN_SUPPORT_CART_ENCRYPTION_KEY_IDS_JSON`、`FAN_SUPPORT_CART_BLIND_INDEX_KEY_VERSION`、`FAN_SUPPORT_CART_BLIND_INDEX_KEY_IDS_JSON`                      | 购物车、结账返回 503                                                     | 普通变量（只含 KMS 密钥 ARN 引用）                                                                |
| 订单查询                 | `FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON`                                                                                                                                                                                             | 查单接口返回 503                                                         | 普通变量                                                                                          |
| 支付                     | `FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON`、`FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON`、`FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON`、`FAN_SUPPORT_PAYMENT_WEBHOOK_ENDPOINTS_JSON`                                                | 没有运行时配置时，结账支付接口返回 503；没有账户连接时处于"已部署但休眠" | 普通变量（不含凭据，凭据用 `secret-ref:v1:env:PAYMENT_SECRET_…` 引用，值由 Secrets Manager 注入） |
| 管理后台（首发内置账号） | 普通变量：`FAN_SUPPORT_ADMIN_ORIGIN`、`FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS=ENABLED`，可选 `FAN_SUPPORT_ADMIN_TOTP_ISSUER`；密钥：`FAN_SUPPORT_ADMIN_ACCESS_KEY`、`FAN_SUPPORT_ADMIN_TOKEN_PEPPER`、`FAN_SUPPORT_ADMIN_SUBJECT_PEPPER` | 后台组全部缺失时 `/api/v1/admin/*` 不注册（404）                         | 三个密钥经秘密管理注入，其他为普通变量；可选 OIDC 见下文                                          |

依赖关系：管理后台、订单查询、支付运行时都依赖密钥管理组；缺少它时，这三组中任何一组有配置都会启动失败。

艺人账目（ADR-022 / L3-12）的“今天、本周、本月”和自定义日期按 `FAN_SUPPORT_LEDGER_TIME_ZONE` 指定的 IANA 时区划分，缺省 `Asia/Shanghai`（北京时间，用户决定）；它是普通变量，只在管理后台组启用时生效，写错（不是真实时区）会让启动失败。页面与导出表头都会写明所用时区。

管理后台组由 API 专属的键决定是否启用（源站、两个 pepper、内置账号开关、TOTP 标签、OIDC 配置、客户端密钥）。`FAN_SUPPORT_ADMIN_ACCESS_KEY` 和 `FAN_SUPPORT_ADMIN_OIDC_ISSUER` 单独出现不会启用 API 的后台接口。三个 64 位小写十六进制密钥（访问密钥、会话 pepper、主体 pepper）必须互不相同。

### 首发内置账号：API 最小配置

首发身份源为 `LOCAL_ACCOUNT`（ADR-021），不需要外部 IdP。以下为 API 后台组，仍须同时具备上表的核心、对象存储与完整 KMS 配置；API 的 `FAN_SUPPORT_SITE_ORIGIN` 是商城源站，不是后台源站。

| API 进程变量                       | 要求                                                                                                                                |
| :--------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `FAN_SUPPORT_ADMIN_ORIGIN`         | 后台精确 HTTPS origin，不带路径；与 Admin 进程的 `FAN_SUPPORT_SITE_ORIGIN` 一致                                                     |
| `FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS` | 固定为 `ENABLED`，其他值均拒绝；Admin Web 的 `FAN_SUPPORT_ADMIN_MODE` 不能替代这个 API 开关                                         |
| `FAN_SUPPORT_ADMIN_ACCESS_KEY`     | 与 Admin 共享的独立随机 32 字节小写 hex，由秘密管理注入                                                                             |
| `FAN_SUPPORT_ADMIN_TOKEN_PEPPER`   | API 专用的独立随机 32 字节小写 hex，会话用途                                                                                        |
| `FAN_SUPPORT_ADMIN_SUBJECT_PEPPER` | API 专用的独立随机 32 字节小写 hex，身份摘要用途；初始化账号命令必须使用同一值                                                      |
| `FAN_SUPPORT_ADMIN_TOTP_ISSUER`    | 可选的验证器显示标签；省略使用代码默认值。允许 1–64 个字母、数字、空格、点、下划线或连字符，不能含冒号；不能脱离 `ENABLED` 单独配置 |

只用内置账号时不设置 `FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON`、`FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET` 或 `FAN_SUPPORT_ADMIN_OIDC_ISSUER`。如果同时配置 OIDC，API 会继续完整验证该组，错误的可选 OIDC 配置不会被忽略。内置账号两步验证由人员自行启用，已有绑定、恢复码、会话吊销和角色权限仍须实际验收；不把可选 OIDC 的 MFA 要求套到内置账号首次登录。

配置核对依据为 `apps/api/src/admin-runtime-config.ts`、`apps/api/src/production-config.ts` 和 `apps/api/src/production-admin-composition.ts`，配置键登记在 `packages/config/src/config-layers.ts`。

### 商城装修预览

Storefront 进程单独接收公开的 `FAN_SUPPORT_ADMIN_ORIGIN`（准确 HTTPS origin，不带路径），用于限制预览的嵌入来源和消息来源；不要将 API/Admin 的访问密钥、pepper 或 OIDC 凭据一起传入商城。缺省时预览路由不可用，正常首页仍可读取已发布布局。代理/CDN 必须保留预览的 `private, no-store`、`noindex` 和限定 `frame-ancestors`；首页布局数据接口也不得缓存。数据库先升级到迁移 0044，再部署依赖该接口的前后台/API。参见 [本地操作](local-experience.md)。

### 可选 OIDC 配置（不属于首发前置条件）

仅接入外部身份服务时，API 才额外配置 `FAN_SUPPORT_ADMIN_OIDC_ISSUER`、`FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON`，以及机密客户端所需的 `FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET`。下面仅示意 JSON 结构；`<OIDC_CLIENT_ID>`、`<OIDC_POLICY_VERSION>` 必须替换为实际已核验的配置，时限与 MFA 声明也须按该接入验收。

```json
{
  "schemaVersion": 1,
  "clientId": "<OIDC_CLIENT_ID>",
  "clientAuthentication": "CLIENT_SECRET_BASIC",
  "acceptedAcrValues": [],
  "requiredAmrValues": ["mfa"],
  "policyVersion": "<OIDC_POLICY_VERSION>",
  "loginTtlSeconds": 300,
  "sessionTtlSeconds": 3600,
  "maxAuthenticationAgeSeconds": 300
}
```

回调地址固定为 `${FAN_SUPPORT_ADMIN_ORIGIN}/api/admin/auth/callback`，需要在 IdP 登记。`acceptedAcrValues` 和 `requiredAmrValues` 至少填一个，不能关闭 MFA。`clientAuthentication` 为 `NONE` 时不得提供客户端密钥；为 `CLIENT_SECRET_BASIC` 时必须提供。

### 管理 Web 的正式登录

首发正式构建使用显式 `FAN_SUPPORT_ADMIN_MODE=LOCAL_ACCOUNT`。正式部署要求 `NODE_ENV=production` 与 `FAN_SUPPORT_DEPLOYMENT_ENV=staging` 或 `production`，后台源站与内部 API 源站均为通过公开源站校验的 HTTPS origin。仅选择外部身份服务时改用 `OIDC`。未设置模式仍为 `DISABLED`；`TEST` 和 `LOCAL_OIDC` 不能作为正式配置失败后的回退。配置不完整或不合法会使 Node 初始化校验失败，服务不能进入就绪状态。

公开 TEST 的 PREBUILT 实例另有仅限 `LOCAL_ACCOUNT`、test 层和回环 API 的窄配置入口，不能将它当作正式 staging/production 配置。对应校验见 `packages/config/src/server-config.ts` 的 `resolveAdminRuntimeConfig`。

就绪以带超时的 `/healthz` HTTP 200 为准，不能只看 PID 或 Next 控制台的 “Ready”。当前 Next 版本在 `instrumentation.register` 抛错后可能保留进程而不服务请求；因此裸 `next start` 的非零退出不是唯一判据。已有 Docker/ECS 健康检查有超时并检查 HTTP 成功，正式部署必须保留，缺配置时不可放行流量。此行为符合 [Next 的 register 就绪约定](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation#register-optional)；实际拒流与恢复还需在 L4 部署验收。

| Admin 进程变量                           | 要求                                                                                    |
| :--------------------------------------- | :-------------------------------------------------------------------------------------- |
| `NODE_ENV`、`FAN_SUPPORT_DEPLOYMENT_ENV` | 正式部署分别为 `production` 与 `staging` 或 `production`                                |
| `FAN_SUPPORT_ADMIN_MODE`                 | 首发为 `LOCAL_ACCOUNT`；选用外部身份服务时为 `OIDC`                                     |
| `FAN_SUPPORT_SITE_ORIGIN`                | 管理站精确 HTTPS origin，与 API 的 `FAN_SUPPORT_ADMIN_ORIGIN` 一致                      |
| `FAN_SUPPORT_INTERNAL_API_ORIGIN`        | 后台 BFF 使用的规范 HTTPS API origin；不含路径、账号、查询或片段；不是浏览器请求地址    |
| `FAN_SUPPORT_ADMIN_ACCESS_KEY`           | 仅 Admin/API 共享的独立随机 32 字节小写 hex，由秘密管理注入                             |
| `FAN_SUPPORT_ADMIN_OIDC_ISSUER`          | 仅 OIDC 模式必需，与 API 及 IdP discovery 完全相同的 HTTPS issuer；LOCAL_ACCOUNT 不需要 |
| `FAN_SUPPORT_STOREFRONT_ORIGIN`          | 可选的商城 HTTPS origin，用于真实页面预览                                               |

Admin 不接收客户端密钥、会话 pepper、主体 pepper、数据库或支付密钥，也不需要 API 的内置账号开关与 TOTP 标签；这些仍由 API 持有。不得把上述秘密加入 `NEXT_PUBLIC_*`。两种登录模式共用服务端 BFF、HttpOnly Cookie、CSRF 和 PostgreSQL 权限检查；根地址进入默认英语管理中心，语言入口仍为七个固定 `/:locale` 路由。

部署代理必须保留公开 Host / HTTPS 协议及 Cookie，身份与后台接口禁止缓存、不得记录 callback 查询参数。Next 内部监听必须保持私有；代理必须覆盖而非追加客户端的 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto`，三者分别与配置的管理 host、host、`https` 完全一致。Next 若用内部监听构造 Request URL，后台按这些固定值识别公开入口；这不授予身份，原 Origin、Fetch Metadata、Cookie、CSRF 和数据库权限仍分别检查。应用不通过关闭 TLS 验证或信任任意转发地址适配错误的代理配置。平台退出撤销本平台会话，不承诺退出 IdP 的 SSO 会话。

配置可用不表示人员已经获权。内置账号首次初始化及紧急恢复沿用 `apps/api/scripts/admin-account.mjs`，日常人员管理沿用后台“员工账号”；命令不带 `--instance` 时从 API 同一数据库与主体 pepper 配置读取，密码只通过交互或 stdin 输入，不进参数或日志。正式开通前仍须核验获准操作者、恢复负责人及流程、角色隔离和暂停/撤销会话后的实际拒绝；本文不预建账号或批准任何实际恢复操作。

若选择 OIDC，再核验 IdP 客户端、精确回调、真实 MFA 声明及 issuer/subject 预授权。平台以独立 HMAC 摘要关联 subject，不按邮箱自动开户、不接受 IdP 角色覆盖业务权限；其隔离验证见 [管理登录验证](admin-access-local.md#正式构建的隔离验证)。LOCAL_ACCOUNT 已补真实 production Next、staging 配置与 HTTPS API 接线的隔离验收（[复验入口](admin-access-local.md#内置账号的正式配置验证)）；API 仍注入 TEST KMS，正式 API/Worker 资源、真实人员及恢复操作仍须在目标环境验收。自有 IdP、临时 PostgreSQL或公开 TEST 均不替代经营方授权或生产发布。

## 支付：代码与激活分离

- 支付适配器代码随版本发布，清单在 `apps/api/src/payment-deployed-adapters.ts`。当前已部署两家，都只支持刷卡：
  - Stripe Checkout（`stripe` / `1.0.0` / `stripe-checkout-v1`），托管页跳转，设计见 `docs/plan/r1-03-stripe-adapter.md`。
  - Airwallex 托管支付页（`airwallex` / `1.0.0` / `airwallex-hpp-v1`），前台加载官方 SDK 后跳转，设计见 `docs/plan/r1-03b-airwallex-adapter.md`。

  首发只要求一家已获准且验收通过的 PSP；其他已有通道在获准后单独验收启用，不作为首发前提。

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

| 进程   | 连接池                                       | 说明                                                     |
| :----- | :------------------------------------------- | :------------------------------------------------------- |
| API    | `fan-support-api`                            | 公开、商城、后台请求共用；获取连接超时 5 秒              |
| API    | `fan-support-api-payment-configuration`      | 支付配置投影及其后台；获取 3 秒、语句 5 秒、查询 6 秒    |
| API    | `fan-support-api`（webhook）+ pg-boss        | webhook 收件箱与队列，与请求池隔离                       |
| Worker | 可靠事件、媒体处理、缓存清除、管理中心各一个 | 管理中心任务（上传海报后的准备与发布）只在 Worker 中处理 |

连接池按引用计数关闭：所有借用方停止后才会真正关闭，与停止顺序无关。

## 验证入口

- 单元测试与真实 Fastify 路由测试：`apps/api/src/production-*.test.ts`、`apps/worker/src/management-center-composition.test.ts`。
- 本机没有 PostgreSQL 时，无法验证真实数据库行为，这部分由 CI 的 `test:postgres` 系列承担。

## 下一步：正式部署与恢复的最小准备

2026-10-02：应用源 `a03ee294` 已通过完整 CI（run `36988895653`）。现有公开 TEST 站暂不部署；本节是待执行清单，不表示正式环境或恢复已验收。正式部署位置、域名与资源引用尚需确认，不默认把 `stg` 原地转正。

1. **固定发布版本**：记录候选 commit、锁文件、迁移 manifest、四个应用产物与旧版身份。复用 `infra/docker/Dockerfile` 的 Storefront/Admin/API/Worker 目标；正式 API/Worker 运行 `node dist/main.js`。现有 `local:start`、PREBUILT 和 remote-test systemd 仍是 TEST 组合，preview compose 的临时存储也不能作为正式持久存储。
2. **补齐实际配置**：按本文逐进程填写精确 HTTPS origin、持久 PostgreSQL、私有原图/衍生图存储、KMS 密钥版本及权限、LOCAL_ACCOUNT 三个独立秘密引用、单一首发 PSP、事务邮件与告警负责人。值通过秘密管理提供，不贴聊天、不入 Git；未知值保持待填，不用 TEST 值代替。
3. **单独升级数据库**：正式 main 不自动迁移。发布前须以持久层 `runMigrations` 在受控的一次性任务中执行最新 `up`，记录源版本、manifest 与结果，再启动应用。不能用 TEST bootstrap 初始化正式内容，也不能手工运行散落 SQL 绕过迁移锁及历史校验。
4. **验明就绪后放行**：获准执行后先在独立目标核对配置、备份、数据库及媒体，再启动四个产物。以带超时的 HTTP 健康检查、正式登录/撤权、媒体与一次完整下单查单验收为准；失败停在本步骤，不降级成 TEST。切换期间明确新单入口、存量 webhook/查询、队列的处理负责人，避免遗失未决付款。
5. **从备份真实恢复**：保留源实例，在隔离目标还原同一恢复点的完整 PG/迁移历史、对象版本、可用的解密密钥版本与配置/发布版本；备份加密并校验。还原时隔离对外邮件与 PSP，业务 Worker 验明前不启动，防止旧队列重复执行。核对订单金额/入账/退款计数、库存、私文解密、媒体、登录及安全查单，记录实际恢复点和耗时。单纯重启原实例、迁移往返或 `diagnostics/copy-database.sh` 的临时库复制均不算完成此项。
6. **明确回退选择**：0065 在已有人工重发或相关审计时会以 `55000` 拒绝 down，包括旧实体订单历史；不得清记录绕过。优先前向修复；只回应用须先证实旧构建兼容当前 schema。必要的数据恢复在新库进行，原库保留，备份后已发生的真实支付/退款依 PSP 认证证据补对账，不能靠恢复数据库撤销资金事实。可接受的数据损失窗口与正式切换由经营方批准。

下一轮只针对上述尚缺接线或恢复演练推进，不重复已通过的完整业务矩阵。正式资源、实际发信及活动 v2 的 21 份人工审校、获准商户实付退款、正式内容、备份恢复、基本告警和发布批准仍按[首发验收清单](../plan/2026-09-28-flexible-storefront-launch.md)分别收口。

# R1-3b Airwallex 沙盒适配器：实现设计

> 日期：2026-09-26 · 依据：V2 方案 §3、`2026-09-26-psp-integration-research.md` Airwallex 节、Stripe 适配器设计（`r1-03-stripe-adapter.md`）、Airwallex 官方文档（2026-09-26 抓取的 markdown 版本与 SDK 源码）
> Airwallex API 版本钉死为 `2026-08-21`（官方 Versioning 页标注的最新版本），每次调用都带 `x-api-version` 头

## 0. 与调研记录不一致的两点（已按官方文档核实）

1. **托管支付页（HPP）不能由服务端直接生成跳转 URL。** 官方唯一的接入方式是浏览器加载 Airwallex.js，再调用 `redirectToCheckout({intent_id, client_secret, currency, env, ...})`。调研记录写的"精确映射 REDIRECT"不成立。另外两种能在服务端拿到 URL 的方式都不适合：
   - Payment Links：只支持英文和简体中文，并且强制粉丝先填姓名和邮箱。
   - Hosted Billing Checkout：要求预建商品价格，会自动生成发票和客户记录，链接 1 小时固定过期。

   SDK 实际做的事是拼出 `checkout(.sandbox).airwallex.com/#/standalone/checkout?…` 再跳转，但这个 URL 格式没有公开文档。服务端自己拼这个 URL，Airwallex 一旦调整就会无预警断付，所以不采用。
   **决定**：适配器下发端口动作 `PROVIDER_COMPONENT`（`componentKey=airwallex-hpp`）。前台补一个通用的组件动作分派，`airwallex-hpp` 启动器在粉丝点"去支付"时才加载官方 SDK，并由它跳转到托管页。卡数据仍然只进 Airwallex 页面。PayPal 也需要 `PROVIDER_COMPONENT`，这部分前台支持一次做好。
2. **`request_id` 重复不会重放原响应。** 创建 PaymentIntent、取消、退款在 `request_id` 重复时都返回 400 `duplicate_request`。所以恢复不能依赖重放：
   - 创建按 `merchant_order_id`（等于尝试 ID）列表反查。
   - 退款按 `request_id` 或平台 metadata 反查。
   - 取消遇到重复或状态冲突时，读取当前状态再报告。

## 1. 形态与边界

- 新包 `packages/payment-airwallex`（`@fan-support/payment-airwallex`）实现七个端口操作和 webhook 验签。部署描述符为 `adapterKey=airwallex`、`adapterVersion=1.0.0`、`protocol=airwallex-hpp-v1`，只支持 `CARD`，幂等级别为 `DURABLE` + `referenceLookup`。
- 不用 Airwallex 服务端 SDK，用原生 `fetch` 调 JSON API：
  - 钉死 `x-api-version`；
  - 每次调用设超时，禁止跟随重定向；
  - 响应体上限 1 MB，只接受 JSON；
  - 不自动重试。
- API 源站必须与账户环境一致：TEST 用 `https://api.sandbox.airwallex.com`，LIVE 用 `https://api.airwallex.com`。`allowedActionOrigins` 记托管页源站：TEST 为 `https://checkout.sandbox.airwallex.com`，LIVE 为 `https://checkout.airwallex.com`。
- 认证：用 `POST /api/v1/authentication/login`（头 `x-client-id` / `x-api-key`）换取 30 分钟的 Bearer token。
  - token 只存进程内存，按凭据值分别缓存，距过期 60 秒内就续换；并发请求共用同一次登录。
  - 业务调用返回 401 时作废 token，重新登录后原样重试一次。401 表示请求未被处理，所以写操作重试也安全。

## 2. 标识与金额

| 平台字段 | Airwallex | 说明 |
|:--|:--|:--|
| `externalReference` | PaymentIntent ID（`int_…`） | 与 Stripe 相同，用 `_`↔`.` 可逆映射进平台引用字符集（Airwallex ID 不含 `.`） |
| `attemptId` | `merchant_order_id`、`request_id`（创建）、`metadata.fan_support_attempt_id` | 反查与早到 webhook 关联都靠它 |
| 取消幂等键 | 取消的 `request_id` | 重复时读当前状态 |
| `refundId` / `refundReference` | 退款 `request_id` = `refundId`；`metadata.fan_support_refund_id` / `fan_support_refund_reference` / `fan_support_attempt_id` | 退款事件自带 `payment_intent_id`，不需要像 Stripe 那样反查会话 |
| CAPTURE 交易号 | PaymentIntent ID | 自动扣款下一个 intent 只有一笔成功扣款；webhook 与对账都能确定性地得到同一个值 |
| `providerEventId` | 事件 `id`（`evt_…`，同样映射） | 验签通过后才从正文读取 |

- **金额**：Airwallex 用主单位小数（如 `16.66`），平台用最小单位整数。适配器内置显式币种表，只放已核对官方"Decimal precision"的币种：USD/CAD/MXN/BRL/EUR/GBP/AUD/SGD/HKD/THB 为 2 位，JPY 为 0 位。
  - 发出时用 `minor / 10^e`，JSON 序列化后正好是最短十进制表示。
  - 收到时用 `major × 10^e`，与最近整数的偏差必须小于 1e-6，否则按畸形响应处理，不猜测。
  - 表外币种一律 `CAPABILITY_UNAVAILABLE`。
- **最低金额**：Airwallex 没有公布按币种的最低扣款额，所以下限是 1 个最小单位，业务下限由 P5-05 支付规则控制。上限沿用 99,999,999 最小单位。

## 3. 七操作映射

| 操作 | Airwallex 调用 | 归一化 |
|:--|:--|:--|
| getCapabilities | 无网络调用 | 按账户已部署的 CARD 返回静态能力，动作类型为 `PROVIDER_COMPONENT`。客户端未声明支持该动作时返回空列表 |
| createPayment | `POST /api/v1/pa/payment_intents/create`（`request_id`、`amount`、`currency`、`merchant_order_id`、`return_url`、`metadata`） | 返回 `REQUIRES_ACTION` 与组件动作。遇到 `duplicate_request` 时，先按 `merchant_order_id` 列表反查，再读取详情拿 `client_secret` |
| getPayment | `GET /api/v1/pa/payment_intents/{id}` | 见 §4；等待付款时回带新鲜的组件动作 |
| cancelPayment | `POST /api/v1/pa/payment_intents/{id}/cancel` | 取消成功返回 `CANCELED`。遇到 `invalid_status_for_operation` 或 `duplicate_request` 时读取当前状态：已取消则报 `CANCELED`，已成功则报真实状态（取消输给了付款） |
| refundPayment | 先读 intent（必须 SUCCEEDED 且币种一致）；再 `GET /api/v1/pa/refunds?payment_intent_id=` 查同一 `request_id` / `fan_support_refund_id`；没有才 `POST /api/v1/pa/refunds/create` | 返回 `PROCESSING`；遇到 `duplicate_request` 时再查一次 |
| reconcilePayment | 有外部引用则读 intent；没有则按 `merchant_order_id` 列表反查（精确匹配，最多 1 条），查不到返回 `PAYMENT_NOT_FOUND` | 只返回 `MATCHED` 事件；金额、币种、尝试 ID 必须一致 |
| reconcileRefund | 列出该 intent 的退款，按 `request_id` / metadata 精确匹配 | RECEIVED→`PROCESSING`，ACCEPTED/SETTLED→`SUCCEEDED`（带 REFUND 交易号），FAILED→`FAILED` |

错误归一化与 Stripe 一致：
- 429→`RATE_LIMITED`。
- 5xx：写操作→`TIMEOUT_OUTCOME_UNKNOWN`，读操作→`TEMPORARY_UNAVAILABLE`。
- 409→`TEMPORARY_UNAVAILABLE`。
- 401/403→`AUTHENTICATION_FAILED`。
- 404 或 `resource_not_found`→`PAYMENT_NOT_FOUND` / `REFUND_NOT_FOUND`。
- `provider_declined` / `issuer_declined`→`PROVIDER_DECLINED`。
- `currency_not_supported`→`CAPABILITY_UNAVAILABLE`。
- 其余 400→`CONFIGURATION_ERROR`。
- 传输失败时，写操作一律转对账。

## 4. 支付状态表

| PaymentIntent `status` | 端口状态 |
|:--|:--|
| `REQUIRES_PAYMENT_METHOD`、`REQUIRES_CUSTOMER_ACTION` | `REQUIRES_ACTION` + `PROVIDER_COMPONENT` |
| `PENDING`、`PENDING_REVIEW` | `PROCESSING` |
| `SUCCEEDED` | `SUCCEEDED`（CAPTURE） |
| `CANCELLED` | `CANCELED` |
| `REQUIRES_CAPTURE` 或未知状态 | 畸形响应（本适配器只用自动扣款），不猜测 |

托管页内的卡失败不是终态：intent 会回到 `REQUIRES_PAYMENT_METHOD`，粉丝可以换卡重试。Airwallex 的 PaymentIntent 不会自己过期，平台也没有自动取消清扫。粉丝过期后才付款时，走平台已有的迟到支付处理：记为 `LATE_PAYMENT_SUCCESS_APPLIED`，库存不足则挂起履约。

## 5. 组件动作与前台

- `clientToken` 是标准 base64（平台 token 字符集不含 `_`，不能用 base64url）编码的 JSON：`{v:1, env, intentId, clientSecret, currency, locale, cancelUrl}`。
  - `env`：TEST 为 `sandbox`，LIVE 为 `prod`，与 SDK 源码中的环境表一致。
  - 编码后超过 4096 字符按畸形响应处理。
  - 动作连同 client_secret 由平台用信封加密落库（与 Stripe 会话 URL 相同）。
  - client_secret 只有 60 分钟有效，而平台存下的动作在 `actionTtlMs` 内都会被复用（现有配置为 1–5 分钟，上限允许 24 小时）。所以适配器导出 `AIRWALLEX_MAX_ACTION_TTL_MS`（55 分钟，留 5 分钟余量）；只要部署了 Airwallex 账户、`actionTtlMs` 又超过它，生产入口就拒绝启动。动作过期后走平台原有的恢复路径，GET_PAYMENT 会取回新的 client_secret。
- 前台改动：
  - 能力查询和建单同时声明 `REDIRECT` 与 `PROVIDER_COMPONENT`。
  - 只展示能处理的能力。
  - "去支付"按钮按动作类型分派：`REDIRECT` 走原跳转；`PROVIDER_COMPONENT` 按 `componentKey` 查启动器注册表，未知组件视为不可用。
- `airwallex-hpp` 启动器：
  - 校验 token 字段（env 枚举、ID/币种/语言格式、`cancelUrl` 必须与当前站点同源）；
  - 从 `https://static.airwallex.com/components/sdk/v1/index.js` 按需加载 SDK（只加载一次）；
  - `init({env, enabledElements:["payments"]})` 后调用 `redirectToCheckout`。成功后的回跳地址用服务端写在 intent 上的 `return_url`，前台不传 `successUrl`。
- CSP：结账页目前没有 `script-src` 限制，SDK 可以直接加载。R1-6 收紧 CSP 时，结账页必须放行：
  - `script-src`：`https://static.airwallex.com`，以及托管页源站 `https://checkout.airwallex.com` 和沙盒的 `https://checkout.sandbox.airwallex.com`（SDK 主包从这里加载）；
  - `connect-src`：`https://o11y.airwallex.com`（SDK 遥测）。
- 不加 SRI：SDK 加载器是 Airwallex 原地更新的常青脚本，主包由加载器动态注入，固定哈希会在 Airwallex 更新时直接断付，也覆盖不到主包。Stripe.js 和 PayPal SDK 的官方要求也是始终从 PSP 源站加载。风险靠以下三点控制：
  - 只在粉丝点"去支付"时才加载，加载后立即离开本站；
  - 加载失败时粉丝留在结账页，可以重试；
  - R1-6 用 CSP 白名单收口。
- 首屏体积：token 解码（依赖 zod）和启动器放在单独的模块里按需动态加载，与已有的 `checkout-validation` 懒加载做法一致；首屏只有动作类型表和可启动组件键表。

## 6. Webhook 验签

- 头：`x-timestamp`（Unix 毫秒）和 `x-signature`（`HMAC-SHA256(secret, x-timestamp + 原始正文)` 的 hex）。
  - 先验签再解析 JSON，常量时间比较，容差 300 秒。
  - 轮换期最多 3 把密钥：Airwallex 没有内置轮换，做法是新建订阅、双收并存、摘掉旧的。
- 订阅的 API 版本必须设为 `2026-08-21`。旧版本载荷字段不同，例如争议对象用 `dispute_amount`；按旧格式解析失败的事件视为畸形。
- 事件映射：

| Airwallex 事件 | 候选 |
|:--|:--|
| `payment_intent.succeeded` | `SUCCEEDED`（CAPTURE） |
| `payment_intent.cancelled` | `CANCELED` |
| `payment_intent.pending` / `pending_review` | `PROCESSING` |
| `refund.received` / `accepted` / `settled` / `failed` | `REFUND_STATUS`：外部引用取自退款对象的 `payment_intent_id`，退款引用取自平台 metadata；缺少 metadata 的是在 Airwallex 后台发起的退款，返回 `UNSUPPORTED_EVENT` |
| `payment_dispute.*` | `DISPUTE_STATUS`：外部引用取自争议对象的 `payment_intent_id`。REQUIRES_RESPONSE/CHALLENGED/PENDING_CLOSURE/PENDING_DECISION/EXPIRED→OPEN，WON/REVERSED→WON，ACCEPTED/LOST→LOST。原交易是退款的争议返回 `UNSUPPORTED_EVENT` |
| 其他 | `UNSUPPORTED_EVENT` |

## 7. 凭据

- API 凭据是一个 secret 值：`<client_id>:<api_key>`。账户连接仍只有一个 `credentialRef`（`secret-ref:v1:env:PAYMENT_SECRET_*`）；轮换时写入多个值，取第一个。
- webhook 密钥由端点配置的 `secretRef` 引用。Airwallex 未公布两种凭据的字符格式，所以只校验可打印字符集和长度，沙盒联调时核对实际格式。

## 8. 测试与验收

- 单元测试（无网络）：
  - 录制响应夹具覆盖七个操作的全部分支：重复请求反查、先查后建、取消输给付款、状态组合、畸形响应、超时→`TIMEOUT_OUTCOME_UNKNOWN`、限流、认证失败；
  - token 缓存、续换、401 重试一次；
  - 金额换算边界。
- webhook 夹具：轮换、篡改、容差外、各事件映射、后台退款。
- 前台单测：组件分派、token 校验、SDK 加载失败的降级。
- 沙盒联调脚本：需要 `.env` 中的 `AIRWALLEX_TEST_CLIENT_ID`、`AIRWALLEX_TEST_API_KEY`，可选 `AIRWALLEX_TEST_WEBHOOK_SECRET`。流程：登录→创建→打印托管页启动信息→测试卡 `4035501000000008` 付款→对账→部分退款→取消另一笔。只在本机手动运行。
- **联调必须核对的点**：
  - 托管页回跳 `return_url` 时是否追加查询参数。前台返回页目前拒绝 `session`/`attempt` 之外的任何参数；如果有追加，需要调整为只读取定位参数；
  - client_secret 的长度，确认 token 在 4096 以内；
  - 两种凭据的实际格式；
  - SDK 的 `env: "sandbox"` 能正确打开沙盒托管页。官方快速入门写的是 `demo`，JS 参考写的是 `sandbox`，两者 SDK 都接受，但指向的托管页源站不同。
- 完成定义：单元测试与 `check:dev` 通过、沙盒联调通过、生产组合根接线测试通过，之后记为 `LOCAL_ACCEPTED`。

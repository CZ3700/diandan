# PSP 预置适配器调研全文（Airwallex / Stripe / PayPal）

> 来源：2026-09-26 并行调研（基于各 PSP 官方文档与本仓库 payment-port 合同）。配套方案：docs/plan/2026-09-26-v2-launch-plan.md

# Airwallex 接入调研（预置适配器 · 商户号下来即配置启用）

## 1. 推荐集成形态：Hosted Payment Page（HPP）首发，Drop-in 二期

- **HPP**：服务端建 PaymentIntent 拿 `client_secret`，浏览器重定向到 Airwallex 托管页，卡数据完全不经过我们（官方明示商户不收集/存储支付细节）→ 精确映射 `PaymentAction: REDIRECT`，符合规范 §13"敏感字段由 PSP 页面直接接收"。支持 25 种语言，我们 7 语言（en/zh-CN/th/vi/ja/es/pt）全覆盖。
- **Drop-in Element**：嵌入式预构建组件，映射 `PROVIDER_COMPONENT`，体验更好但需引入 Airwallex.js 并调整前台 CSP——而 CSP 目前大面积缺失（架构审查 B8）。两者服务端 API 完全相同，二期切 Drop-in 只换 next action 类型，adapter 服务端零改动。
- 依据：[HPP](https://www.airwallex.com/docs/payments/integration-options/web-checkout/hosted-payment-page)、[Drop-in](https://www.airwallex.com/docs/payments/integration-options/web-checkout/drop-in-element)

## 2. 七操作映射表

| 我们的端口 | Airwallex API | 备注/缺口 |
|:--|:--|:--|
| getCapabilities | `GET /api/v1/pa/config/payment_method_types` | 按 country/currency 过滤，与本地已发布 profile 取交集 |
| createPayment | `POST /api/v1/pa/payment_intents/create` | `request_id`=持久化幂等键，`merchant_order_id`=attempt UUID（§13.1 早到 webhook 关联）；返回 id+client_secret → 组装 REDIRECT |
| getPayment | `GET /api/v1/pa/payment_intents/{id}` | external reference = intent id |
| cancel | `POST /api/v1/pa/payment_intents/{id}/cancel` | |
| refund | `POST /api/v1/pa/refunds/create` | 支持一次/多次部分退款，不可超原额；`request_id` 幂等 |
| reconcilePayment | `GET /api/v1/pa/payment_intents/{id}`；无 external ref 时 `GET /api/v1/pa/payment_intents` 按 merchant_order_id 兜底 | 资源可查窗口 2 年 |
| reconcileRefund | `GET /api/v1/pa/refunds/{id}` + `refund.*` webhook | |

**缺口 1（认证形态）**：Airwallex 用 `POST /api/v1/authentication/login`（头 `x-client-id`/`x-api-key`）换 30 分钟 Bearer token，不是我们通用网关的"直接 Bearer 凭据"。方案：adapter 内做 token 缓存与到期续换，token 只存内存，Secret Store 只保存 client_id/api_key 引用。
**缺口 2（幂等语义）**：`request_id` 重放返回原响应，但保存期非永久，不等于我们协议的 `DURABLE`；崩溃恢复必须走 merchant_order_id 认证对账，不能只赌 request_id 重放（正合 §13.1 Saga 第 3/4 步）。
依据：[PaymentIntents](https://www.airwallex.com/docs/payments/get-started/using-payments-intent-api)、[API 参考](https://www.airwallex.com/docs/api/payments/payment_intents/api)、[Refunds](https://www.airwallex.com/docs/payments__native-api__refunds)

## 3. Webhook 验签 → PaymentWebhookVerifier

- 头：`x-timestamp`（Unix **毫秒**）、`x-signature`（**hex** 编码 HMAC-SHA256，非 base64）。
- 待签串：`x-timestamp 字符串 + 原始 body 字节`，先验签后解析 JSON——与我们"raw body 验签"边界一致。
- Secret：每个 webhook endpoint 在 dashboard 生成唯一 secret；官方**无内置轮换机制**，官方也未给固定时间容差（建议我们定 5 分钟）。
- 映射：endpoint-scoped verifier 持 secret-ref；轮换用我们已有的多密钥窗口（≤3 把）——新建第二个 endpoint 拿新 secret、双收并存、验证后摘旧。`providerEventId` 取 body 内 `id` 字段（在签名覆盖范围内，重试复用同一 id，可安全去重）；比较用 timingSafeEqual。注意 Airwallex 无 `webhook-id` 独立头，与 Standard Webhooks 不同，需专用 verifier 而非复用 fan-support-gateway-v1 的。
- 未及时 200 会重试，需先入 inbox 再 ACK。
- 依据：[Listen for webhook events](https://www.airwallex.com/docs/developer-tools/webhooks/listen-for-webhook-events)

## 4. 沙盒

- [自助注册](https://www.airwallex.com/docs/developer-tools/sandbox-environment)：邮箱+企业名+国家即建，**免费、即时、无审批**；API key 在沙盒 web app「Account > Developer > API keys」；API 域名 `api.sandbox.airwallex.com`（旧 SDK 写作 api-demo，以文档为准）。
- 能测：测试卡支付全流程、退款/部分退款、cancel、webhook 订阅与重试、各币种预充值钱包；Google Pay 可测，Apple Pay 沙盒受设备/测试卡限制。**结论：可以在商户号批下来之前就完成 adapter+conformance+联调，商户号只影响生产凭据。**

## 5. 配置项清单（只列名称）

`AIRWALLEX_CLIENT_ID`（secret-ref）、`AIRWALLEX_API_KEY`（secret-ref）、`AIRWALLEX_WEBHOOK_SECRET`（secret-ref，支持窗口多把）、`apiOrigin`、`checkoutOrigin`（HPP 托管 origin 白名单，checkout.airwallex.com）、`environment`（demo/prod）、`providerAccountId`、`webhookEndpointId`、`localeMapping`（7→25 语言表）、`successUrl/failUrl` 模板。

## 6. Apple Pay / Google Pay

HPP/Drop-in **原生内置**，默认排在支付方式顶部，`applePayRequestOptions`/`googlePayRequestOptions` 可微调；开通只需在 web app「Payments > Settings」启用并同意 Apple/Google 条款（托管流下 Apple Pay 域名验证由 Airwallex 托管域承担，无需我们传验证文件）；卡组织须在「Payments > Payment Methods」逐一激活，否则钱包内选卡在处理阶段失败。卡组织支持 Visa/MC/Amex/**JCB/UnionPay**/Discover/Diners（[Cards](https://www.airwallex.com/docs/payments/payment-methods/global/cards)、[Google Pay 开通](https://www.airwallex.com/docs/payments__global__google-paytm__enable-google-paytm)）。

## 7. 类目与合规

[Unsupported Industries](https://help.airwallex.com/hc/en-gb/articles/4410623274905-Unsupported-Industries) 未点名礼物/打赏，但有两条红线相关："Transactions Made for No Genuine Commercial Purpose" 和兜底的风险偏好条款；marketplace/分账类属受限行业需 EDD。**申报口径建议**：以"实物礼品零售+应援代购履约"为主体（有采购与交付证据，风险最低，正是我们对标 vividlivestar/starvideoai 两家已获批 Airwallex 的模式）；虚拟打赏/艺人心愿包装为**平台自营数字服务**（平台是 merchant of record，不向艺人分账、不用 donation/tipping 表述），否则可能被认定受限 marketplace。四分类里"艺人心愿"若涉及资金转交承诺，是审批最大变数，建议首发市场先以实物+周边过审，虚拟类目在同一商户下渐进开通。

## 8. 工作分解（人日粗估）

| 项 | 内容 | 估 |
|:--|:--|--:|
| adapter | 七操作+token 缓存+REDIRECT 组装+locale 映射+错误归一化 | 3–4 |
| webhook verifier | x-signature 验签+endpoint 接线+多密钥窗口 | 1–1.5 |
| conformance fixture | 对齐现有 conformance 套件（含 UNKNOWN/幂等/早到事件用例） | 2 |
| sandbox 联调 | 成功/失败/取消/部分退款/webhook 重放/崩溃恢复 | 2–3 |
| **合计** | 不含生产组合根接线（B1–B3，另列） | **8–10** |

沙盒零门槛意味着这条线**现在就能开工**，与商户申请并行。

---

# Stripe 接入调研（服务于"预置适配器、商户号下来即配置启用"）

## 1. 推荐集成形态：Stripe Checkout 托管页（stripe-hosted）

- 创建 Checkout Session 后拿到 `url`，把粉丝 302 到 Stripe 托管页，卡数据全程不经过我们，PCI 由 Stripe 承担（"PCI compliance: Built-in"）。精确对应 `PaymentAction: REDIRECT`，与规范 §13.1"敏感字段由 PSP 页面直接接收"完全一致。
- 不选 Payment Element/embedded：需要前端集成 Stripe.js、Apple Pay 需注册域名、CSP 白名单扩大，与我们"123 页零缓存 + CSP 未完成"的现状叠加风险；托管页零前端改造、SCA/3DS/风控/多语言内建。后续要提升转化再演进为 `PROVIDER_COMPONENT`（Element），端口无需改。
- Session 默认 24h 过期，可设 30min–24h（`expires_at`），与购物车预占 TTL 对齐；`checkout.session.expired` 事件可驱动库存回收。
- 依据：https://docs.stripe.com/payments/checkout/how-checkout-works

## 2. 七操作映射表

| 端口操作 | Stripe API/机制 | 备注/缺口 |
|:--|:--|:--|
| getCapabilities | 无逐笔查询 API。静态适配器声明 + Dashboard 支付方式设置（可读 `/v1/payment_method_configurations`） | 缺口：能力以配置投影为准，健康度靠对账/失败率自测 |
| createPayment | `POST /v1/checkout/sessions`（mode=payment，`price_data` 传固化金额）→ 返回 `url` 作 REDIRECT | `client_reference_id` + `payment_intent_data.metadata` 写入 attempt UUID（早到 webhook 关联）；携带 `Idempotency-Key` |
| getPayment | `GET /v1/checkout/sessions/{id}?expand[]=payment_intent` 或 `GET /v1/payment_intents/{id}` | 状态归一化：`requires_*→PENDING`、`processing→PENDING`、`succeeded→SUCCEEDED`、`canceled→CANCELED` |
| cancel | 未完成：`POST /v1/checkout/sessions/{id}/expire`；PI 非终态：`POST /v1/payment_intents/{id}/cancel` | succeeded 后不可 cancel，只能 refund（文档明确） |
| refund | `POST /v1/refunds`（`payment_intent` + `amount` 最小货币单位 = 部分退款；可多次，总额≤原额） | 状态 `pending/succeeded/failed/requires_action/canceled`；`refund.failed` 须回流异常中心 |
| reconcilePayment | 有 external ref：GET PI。无（Saga 第 2/3 步间崩溃）：同一 `Idempotency-Key` 重放创建（24h 内返回原 Session），或 `GET /v1/payment_intents/search?query=metadata['attempt']:'…'` | 缺口：Stripe 幂等键仅存 24h ≠ 我们 DURABLE 协议；Search 有约 1 分钟延迟。适配器须组合"幂等重放 + metadata 检索"兜底 |
| reconcileRefund | `GET /v1/refunds/{id}` 或按 PI list refunds；消费 `refund.updated`（含 ARN 追踪号） | 无缺口 |
| verifyPaymentWebhook | `Stripe-Signature` 手工验签（见 §3），产出 candidate，`provider_event_id = evt_…`（body 内 `event.id`） | 注意：Stripe 无独立 event-id 头，去重 ID 须验签通过后从 body 取 |

## 3. Webhook 验签（映射 PaymentWebhookVerifier）

- 头：`Stripe-Signature: t=<unix秒>,v1=<hex>,v0=<忽略>`；轮换窗口内可有多个 `v1`。
- 算法：`signed_payload = "<t>.<原始body字节>"`，HMAC-SHA256，密钥为端点专属 `whsec_…` 字符串本身；十六进制比对，官方要求常量时间比较、忽略非 v1 方案防降级。
- 容差：官方库默认 5 分钟，禁止设 0；重投递会重新生成 t 和签名。
- 轮换：Dashboard "Roll secret"，旧密钥可保留至多 24h，期间每个密钥各出一个 v1 签名——恰好落在我们 verifier"最多 3 把密钥、timingSafeEqual、原始 body"的既有边界内。
- 与我们 payment-gateway 的 Standard Webhooks 差异：头名不同、hex 而非 base64、签名串是 `t.body` 而非 `id.timestamp.body`、无 `webhook-id` 头。所以必须写 Stripe 专属 verifier，不能复用 fan-support-gateway-v1 的。test/live、每个端点、CLI 转发的 secret 互不相同。
- 依据：https://docs.stripe.com/webhooks?verify=verify-manually 、https://docs.stripe.com/webhooks/signature

## 4. 沙盒获取

- **免费、无需审批、无需商户资质**，注册即得 sandbox（甚至 CLI `stripe sandbox create` 可匿名开），与激活收款完全解耦——适配器可在商户号批下来之前全部做完。
- 可测：测试卡全流程支付、部分/全额退款、`stripe listen --forward-to localhost:…/webhook` 本地转发（打印专用 whsec）、`stripe trigger` 造事件、Dashboard 重发事件。沙盒重试策略为数小时内 3 次（live 为 3 天指数退避）。
- 限制：Apple/Google Pay 需真实设备+真卡（test key 下不实扣）；不可测 IC+ 计价。
- 依据：https://docs.stripe.com/sandboxes 、https://docs.stripe.com/webhooks#test-webhook

## 5. 配置项清单（只列名称，全部走 secret-ref/环境变量引用）

`STRIPE_ACCOUNT_ID`（acct_，校验用）、`STRIPE_SECRET_KEY_REF`、`STRIPE_WEBHOOK_SECRET_REFS`（端点级，≤3 把轮换）、`STRIPE_API_VERSION`（钉死版本）、`environment`（sandbox/live）、`checkoutSuccessUrl / checkoutCancelUrl`（回跳 origin 白名单）、`allowedHostedOrigin`（checkout.stripe.com）、`localeMapping`（七语言→Checkout locale，Stripe 支持 en/zh/th/vi/ja/es/pt 全部）、`statementDescriptor`、`sessionExpiresMinutes`、可选 `paymentMethodConfigurationId`。API origin 固定 `https://api.stripe.com`，无需配置。

## 6. Apple Pay / Google Pay

官方原文："For Payment Links or hosted Checkout, Apple Pay works with no additional configuration."（https://docs.stripe.com/apple-pay?platform=web）。托管页上两个钱包在 Dashboard 支付方式启用后，按设备/浏览器自动显示，**零域名注册、零前端代码**——这正是选托管页的加分项，直接补齐对标报告 B2 缺口。仅当以后改用 Element/embedded 或自定义结账域名时才需注册 payment method domain。

## 7. 类目与合规风险

- 实物礼物 + 平台代购交付 = 普通电商，风险最低；我们有采购与履约证据，比四个对标站的纯虚拟打赏更容易过审（guanlanvision 已实证 Stripe 可收此类款）。
- 风险点（https://stripe.com/legal/restricted-businesses）：游戏内货币/道具**禁止**；"创作者内容变现平台"属**需预先批准**类；成人内容禁止。我们的"虚拟打赏"若表述为向主播个人付费的内容打赏，会被归入需审批类目。
- 建议口径：以我们平台为唯一收款主体（merchant of record），四分类统一描述为"由工作室履约的礼物/应援服务"（虚拟礼物=工作室代为执行的应援展示服务，有交付凭证），不做向艺人分账；申请时主动披露业务模式。首发若担心卡审批，可先用实物+心愿+周边三类开 Stripe，虚拟打赏走 Airwallex 并行。
- 主体：Stripe 支持 46 个注册国家，香港、新加坡主体均可开户收 USD（https://stripe.com/global）。

## 8. 工作分解与粗估（人日）

| 项 | 内容 | 估算 |
|:--|:--|:--|
| adapter | 七操作 + Checkout Session 状态归一化 + 幂等/24h 兜底 + locale 映射 + Stripe 验签 verifier | 4–6 |
| conformance fixture | 端口契约测试；webhook 夹具（多 v1 轮换、容差过期、重放去重、乱序/退款早于回跳） | 2–3 |
| sandbox 联调 | CLI 转发跑通 Saga 全径：创建→跳转→成功/过期/取消→部分退款→对账；UNKNOWN 恢复演练 | 2–3 |
| 生产接线 | provider 注册进生产组合根 + 配置发布/灰度（依赖生产组合根工作，另计） | 1–2 |

合计约 **9–14 人日**，其中前三项不需要任何商户资料即可完成；商户号下来后仅剩"换 live 密钥 + 注册正式 webhook 端点 + 小额真实交易验收"，符合"批下来即配置接入"的目标。

Sources: [How Checkout works](https://docs.stripe.com/payments/checkout/how-checkout-works) · [Webhook 手工验签](https://docs.stripe.com/webhooks?verify=verify-manually) · [验签排错](https://docs.stripe.com/webhooks/signature) · [Refunds](https://docs.stripe.com/refunds) · [Sandboxes](https://docs.stripe.com/sandboxes) · [Apple Pay](https://docs.stripe.com/apple-pay?platform=web) · [Wallets 产品支持矩阵](https://docs.stripe.com/payments/wallets) · [受限业务](https://stripe.com/legal/restricted-businesses) · [全球可用性](https://stripe.com/global) · [幂等请求](https://docs.stripe.com/api/idempotent_requests)

---

# PayPal 接入调研（对接 `@fan-support/payment-port` 七操作端口）

## 1. 推荐集成形态
采用 **JS SDK 双轨 + Orders v2（intent=CAPTURE）**：① 品牌按钮（PayPal 钱包/Pay Later）；② Advanced Card Fields（托管 iframe 卡字段，买家**无需 PayPal 账号**即可游客刷卡）。卡数据只进 PayPal 域内 iframe，PayPal 自身是 PCI DSS 服务商，我们保持 SAQ A 口径、完全不碰卡数据；3DS 用 `SCA_WHEN_REQUIRED` 由 PayPal 托管。两轨共用服务端创建/捕获，金额权威在服务端，正好落进 `PaymentAction = PROVIDER_COMPONENT`。create 返回的 `rel=approve` 链接可作 `REDIRECT` 降级，不作首选。

## 2. 七操作映射

| 端口操作 | PayPal 对应 |
|:--|:--|
| getCapabilities | **缺口**：无实时能力查询 API。替代：由已发布连接配置静态声明（WALLET/CARD/APPLE_PAY/GOOGLE_PAY），`POST /v1/oauth2/token` 作凭据健康探测 |
| createPayment | `POST /v2/checkout/orders`（intent=CAPTURE；`invoice_id`/`custom_id` 写入 attempt UUID merchant reference；`PayPal-Request-Id` = 已固化幂等键）→ 返回 orderId 交给组件 |
| getPayment | `GET /v2/checkout/orders/{id}`（含 capture 与退款明细） |
| cancel | **缺口**：CAPTURE intent 无作废 API（void 仅限 AUTHORIZE）。替代：attempt 置本地终态 + 保证永不 capture，未捕获订单自然过期、不扣款 |
| refund | `POST /v2/payments/captures/{capture_id}/refund`（支持部分退：amount/invoice_id/note_to_payer；`PayPal-Request-Id` 幂等，Payments v2 保存 45 天）+ `GET /v2/payments/refunds/{id}` |
| reconcilePayment | `GET orders/{id}` + `GET /v2/payments/captures/{id}`。**缺口**：无按 merchant reference 直查；且 Orders 幂等窗仅 **6 小时**（可谈到 72h），不满足我们 DURABLE 语义。替代：创建崩溃后 6h 内用同 `PayPal-Request-Id` 重放取回同 orderId；超窗用 Transaction Search `GET /v1/reporting/transactions?invoice_id=`（延迟≤3h，需在账户启用）；幂等长期保证由本地持久回执承担 |
| reconcileRefund | `GET /v2/payments/refunds/{id}`（状态 COMPLETED/PENDING/CANCELLED/FAILED） |

**额外缺口**：买家在组件内 approve 后需服务端 `POST /v2/checkout/orders/{id}/capture`，端口无 "capture" 槽位。方案：approve 回调触发受控确认命令，adapter 内部以 attempt 级幂等键 capture；`CHECKOUT.ORDER.APPROVED` webhook 作崩溃兜底补捕获。此为 Saga 第 2/3 步之间的受控扩展，不改端口合同。

## 3. Webhook 验签 → PaymentWebhookVerifier
头：`paypal-transmission-id` / `paypal-transmission-time` / `paypal-transmission-sig` / `paypal-cert-url` / `paypal-auth-algo`（SHA256withRSA）。**本地证书验签（官方标注 preferred）**：待签串 = `transmissionId|transmissionTime|webhookId|crc32(原始body字节，十进制)`，用 cert-url 证书验 RSA-SHA256。要点：cert-url 必须强制 HTTPS + `paypal.com` 域白名单 + 证书链校验并缓存；**无商户侧对称密钥，轮换 = PayPal 换证书/cert-url**，缓存按 URL 键失效即可；官方未规定时间容差，由我们 verifier 强制（建议 300s）。备选 `POST /v1/notifications/verify-webhook-signature`（多一跳延迟，且不支持模拟器 mock 事件）。映射：verifier 输入原始字节 + 头 + endpoint 配置（webhook_id 引用），只产出 candidate；`providerEventId` 取事件体 `event.id`（重投递时 transmission-id 变、event.id 不变，去重以 event.id）。订阅：`CHECKOUT.ORDER.APPROVED`、`PAYMENT.CAPTURE.COMPLETED/DENIED/REFUNDED/REVERSED`。注意这是**非对称+证书**机制，与 gateway-v1 的 Standard Webhooks HMAC 完全不同，需独立 verifier 实现。

## 4. 沙盒
免费、注册开发者账号即得，**无审批**；自动附带 business + personal（模拟买家）账户，可再建任意测试账号；有测试卡生成器、负向测试（持卡人姓名触发拒绝码）、3DS 测试卡；退款、真实 webhook 投递与 Webhook 模拟器均可测。ACDC/Apple Pay/Google Pay 在 Dashboard→Apps & Credentials→Features 勾选即在沙盒可用；**live 开通需账户审核（vetting）**。

## 5. 配置项清单（只列名称）
`PAYPAL_ENVIRONMENT`、`PAYPAL_API_ORIGIN`、`PAYPAL_CLIENT_ID`、`secret-ref:PAYPAL_CLIENT_SECRET`、`PAYPAL_WEBHOOK_ID`（验签绑定）、`PAYPAL_MERCHANT_ID`、允许托管 origin 白名单（www.paypal.com 等）、启用支付方式列表、七语言→PayPal locale 映射、BN code（可选）。

## 6. Apple Pay / Google Pay
同一 JS SDK：`components=googlepay|applepay` + Dashboard Features 开通，**复用同一 Orders create→confirmOrder→capture 与同一 webhook**，无新增服务端协议。Google Pay 36 国；Apple Pay 34 国（表含 CN/HK），需托管 `/.well-known/apple-developer-merchantid-domain-association` 并在 PayPal 注册域名，沙盒用 Safari + 测试钱包。

## 7. 类目与合规口径
AUP 不禁止粉丝礼物，但"donation/打赏"措辞属敏感口径（捐赠需预审批）——页面必须呈现为**商品/服务购买**。我们"实物投喂 + 履约凭证"是低风险类目，争议时有物流证据，优于对标站；**纯虚拟礼物属无形商品**，拒付举证弱，易触发风控留置（最长 180 天资金保留），建议措辞为"数字商品交付"并可提前邮件 aupviolations@paypal.com 预沟通。主体口径：CN 主体走 paypal.cn（PPCN）商业账户，仅限跨境收款、CN 账户间不可互付（mxcheer 即此模式，实践可行但账户冻结风险自担）；ACDC/Apple Pay 国家表均含 CN 与 HK，**HK 主体更稳**。

## 8. 工作分解（人日粗估）
adapter（七操作 + capture 回调 + 幂等/恢复 + locale 映射）4–5；webhook verifier（证书链/缓存/容差 + 单测）2–3；conformance fixtures（成功/拒绝/UNKNOWN/部分退款/乱序重放）2；sandbox 联调（按钮 + 卡字段 + 3DS + GPay/APay + 退款 + webhook）3–4；生产注册 + 灰度门 1–2。**合计约 12–16 人日**（不含商户审批等待）。

依据：
- Orders v2：https://developer.paypal.com/docs/api/orders/v2/
- Payments v2 退款：https://developer.paypal.com/docs/api/payments/v2/
- Webhook 验签：https://developer.paypal.com/api/rest/webhooks/rest/
- Advanced Card Fields（游客免账号、SCA_WHEN_REQUIRED）：https://developer.paypal.com/docs/checkout/advanced/integrate/ 、国家表 https://developer.paypal.com/docs/checkout/advanced/
- 幂等窗口：https://developer.paypal.com/reference/guidelines/idempotency/
- 沙盒与测试卡：https://developer.paypal.com/tools/sandbox/ 、https://developer.paypal.com/tools/sandbox/card-testing/
- Google Pay：https://developer.paypal.com/docs/checkout/apm/google-pay/ ；Apple Pay：https://developer.paypal.com/docs/checkout/apm/apple-pay/
- AUP：https://www.paypal.com/us/legalhub/paypal/acceptableuse-full ；PPCN：https://www.paypal.cn/portal/acceptable-use?locale.x=en

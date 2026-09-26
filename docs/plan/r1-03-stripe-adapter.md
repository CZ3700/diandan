# R1-3 Stripe 沙盒适配器：实现设计

> 日期：2026-09-26 · 依据：V2 方案 §3、`2026-09-26-psp-integration-research.md` Stripe 节、支付端口合同（`packages/contracts/src/payment-port-contracts.ts`、`reliable-events.ts`）、应用层恢复语义（`packages/application/src/payment-runtime-execution.ts`）
> Stripe API 版本钉死为 `2026-08-26.dahlia`（2026-09-26 查阅 docs.stripe.com/upgrades 时的最新版本）

## 1. 形态与边界

- 新适配器包 `packages/payment-stripe`（`@fan-support/payment-stripe`），同时实现七个端口操作（`PaymentProvider`）和 webhook 验签（`PaymentWebhookVerifier`）。它提供一个部署工厂（`PaymentConnectorFactory`，描述符为 `adapterKey=stripe`、`adapterVersion=1.0.0`、`protocol=stripe-checkout-v1`），只支持 `CARD`。
- 集成形态：Checkout Session，`ui_mode=hosted_page`，`mode=payment`。端口动作固定为 `REDIRECT`，跳转目标是 `session.url`，源站必须命中账户绑定的 `allowedActionOrigins`（`https://checkout.stripe.com`）。卡数据全程不经过平台。
- 不使用 Stripe SDK，用原生 `fetch` 调 REST 接口：表单编码，`Stripe-Version` 头钉死版本，每次调用设超时，禁止跟随重定向，响应体大小设上限，不自动重试。这与现有的规范化网关适配器同构，也避免新增供应链依赖。
- `PaymentConnectorFactory` 与凭据解析接口是跨适配器的抽象，移入 `payment-port`。`payment-gateway` 保留同名再导出，已有代码不需要改。

## 2. 标识映射

| 平台字段 | Stripe | 说明 |
|:--|:--|:--|
| `externalReference` | Checkout Session ID | 平台 schema 不允许 `_`。Stripe ID 不含 `.`，所以 `_`↔`.` 是可逆的一一映射：`cs_test_x` 存为 `cs.test.x`，调用 Stripe 前再还原 |
| `attemptId`（= merchantReference = providerIdempotencyKey） | `client_reference_id`、`metadata.fan_support_attempt_id`、`payment_intent_data.metadata.fan_support_attempt_id`、`Idempotency-Key` | 早到的 webhook 和按 metadata 检索都靠它关联 |
| `refundReference` / `refundId` | Refund `metadata.fan_support_refund_reference` / `metadata.fan_support_refund_id`，外加 `metadata.fan_support_external_reference`（Session ID） | 退款事件只带 PaymentIntent，靠 metadata 找回 Session |
| `providerEventId` | Stripe `event.id`（同样做 `_`↔`.` 映射） | 验签通过后才从正文读取；Stripe 没有独立的事件 ID 头 |
| 对账证据 ID | `reconcile:<session>:<status>:<payment_intent 或 none>` | 同一状态的重复对账得到同一证据 ID |

## 3. 七操作映射

| 操作 | Stripe 调用 | 归一化 |
|:--|:--|:--|
| getCapabilities | 无网络调用 | 按账户已部署的 `instruments`（CARD）返回静态能力；请求的动作类型必须包含 `REDIRECT`，否则返回空列表 |
| createPayment | `POST /v1/checkout/sessions`，带 `Idempotency-Key` | open→`REQUIRES_ACTION`（REDIRECT）。所有参数都由冻结的创建命令确定性生成（不发送 `expires_at`，使用 Stripe 默认的 24 小时），保证同一键可以原样重放 |
| getPayment | `GET /v1/checkout/sessions/{id}?expand[]=payment_intent` | 见 §4 状态表；仍为 open 时回带 REDIRECT 动作 |
| cancelPayment | `POST /v1/checkout/sessions/{id}/expire`，带 `Idempotency-Key` | 过期→`CANCELED`。会话已完成或已过期时，不报错，改为返回当前真实状态（取消输给了付款） |
| refundPayment | 先 `GET` 会话拿到 PaymentIntent；再 `GET /v1/refunds?payment_intent=` 查有无同一 `fan_support_refund_id`；没有才 `POST /v1/refunds` | 提交成功返回 `PROCESSING`。"先查后建"把 Stripe 24 小时的幂等窗口补成持久幂等 |
| reconcilePayment | 有外部引用：`GET` 会话。没有外部引用：①按 metadata 检索 PaymentIntent，命中后用 `payment_intent` 过滤列出会话；②未命中则用同一 `Idempotency-Key` 原样重放创建请求，只接受响应头 `Idempotent-Replayed: true` 的结果；③都失败返回 `PAYMENT_NOT_FOUND` | 只返回 `MATCHED` 事件，金额、币种、尝试 ID 必须一致，否则按畸形响应处理，应用层会延后重试 |
| reconcileRefund | `GET` 会话拿 PaymentIntent，再 `GET /v1/refunds?payment_intent=`，按 `fan_support_refund_id` 精确匹配 | pending/requires_action→`PROCESSING`，succeeded→`SUCCEEDED`（带 REFUND 交易号），failed/canceled→`FAILED` |

## 4. 支付状态表

| Session `status` | `payment_status` | PaymentIntent | 端口状态 |
|:--|:--|:--|:--|
| open | unpaid | 无，或 `requires_payment_method`/`requires_action` | `REQUIRES_ACTION` + REDIRECT |
| open | unpaid | `processing` | `PROCESSING` |
| complete | paid | `succeeded` | `SUCCEEDED`（CAPTURE，交易号为 PaymentIntent 的 `latest_charge`） |
| complete | unpaid | 任意 | `PROCESSING`（异步支付方式；CARD 下极少出现） |
| expired | unpaid | 无或已取消 | `EXPIRED`；如果是我们主动 expire 的则为 `CANCELED`，只用于取消操作的返回 |
| 其他组合 | — | — | 畸形响应，不猜测 |

Checkout 会话内的卡失败不是终态：粉丝可以在同一页面换卡重试，所以失败事件不会产生 `FAILED`，只有会话结束时才出现 `EXPIRED`。

## 5. Webhook 验签

- 头：`stripe-signature: t=<秒>,v1=<hex>[,v1=…][,v0=…]`，只认 `v1`（防降级）。待签内容是 `<t>.` 加原始正文字节，HMAC-SHA256，密钥是 `whsec_…` 字符串本身（不做 base64 解码，这点与 Standard Webhooks 不同），用常量时间比较。轮换期最多 3 把密钥，容差 300 秒。
- 先验签再解析 JSON，并校验 `livemode` 与账户环境一致、`account`（如有）与部署账户一致。
- 事件映射：

| Stripe 事件 | 候选 |
|:--|:--|
| `checkout.session.completed` | paid→`SUCCEEDED`（CAPTURE）；unpaid→`PROCESSING` |
| `checkout.session.async_payment_succeeded` / `…_failed` | `SUCCEEDED` / `FAILED` |
| `checkout.session.expired` | `EXPIRED` |
| `refund.created` / `refund.updated` / `refund.failed` | `REFUND_STATUS`：外部引用和退款引用都取自我们写入的 metadata；缺少 metadata 的是在 Stripe 后台发起的退款，返回 `UNSUPPORTED_EVENT` |
| `charge.dispute.created` / `…closed` | `DISPUTE_STATUS`（OPEN/WON/LOST）：争议对象只带 PaymentIntent，需要在验签后按 `payment_intent` 列出会话来取得外部引用；查询失败返回 `TEMPORARY_UNAVAILABLE`，Stripe 会重投 |
| 其他 | `UNSUPPORTED_EVENT` |

- 运营约束：退款只能从平台后台发起。在 Stripe 后台直接退款不会进入平台账目，会以不支持事件的形式出现在异常中心，需要人工处理。

## 6. 凭据

- 账户连接里的 `credentialRef` 使用 `secret-ref:v1:env:<变量名>`，指向部署时由 Secrets Manager 注入的环境变量。变量名必须以 `PAYMENT_SECRET_` 开头，解析器拒绝读取任何其他变量，所以错误或恶意的引用读不到 `DATABASE_URL` 之类的值。
- 每次调用时才读取，滚动重启后新值即可生效。API 密钥必须以 `sk_test_`/`sk_live_`/`rk_test_`/`rk_live_` 开头，并与账户环境一致；webhook 密钥必须以 `whsec_` 开头。
- webhook 端点配置新增 `FAN_SUPPORT_PAYMENT_WEBHOOK_ENDPOINTS_JSON`：端点 ID、账户、`secretRef`、容差、报文上限。生产组合根按它生成验签器目录（R1-1 预留的接口）。

## 7. 测试与验收

- 单元测试（无网络）：用录制的 Stripe 响应夹具覆盖七个操作的全部分支（重放命中、重放未命中、先查后建、取消输给付款、各状态组合、畸形响应、超时→`TIMEOUT_OUTCOME_UNKNOWN`、限流、认证失败）。
- webhook 夹具：多 v1 轮换、v0 降级、容差外、正文篡改、环境不符、各事件映射、后台退款、争议反查。
- 沙盒联调脚本（需要 `.env` 中的 `STRIPE_TEST_SECRET_KEY` 和 `stripe listen` 输出的 `whsec_`）：创建→跳转→测试卡付款→webhook→部分退款→对账→过期。只在本机手动运行，不进 CI。
- 完成定义：单元测试与 `check:dev` 通过、沙盒联调通过、生产组合根接线测试通过，之后记为 `LOCAL_ACCEPTED`。live 密钥、正式 webhook 端点和小额真实交易仍需商户号，届时逐次确认。

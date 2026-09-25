# P4-04 API / TEST PSP / HTTP 验收审计

范围：`codex/p4-04-payment-runtime`，基线 `f1f702f`。本次仅阅读 SPEC §11–14、任务卡、项目 skill 与下列实现；未运行服务、浏览器、构建或测试。本文是实施建议，不是验收 PASS。沿用 root 已确认的 P4-04 / P4-05 边界。

## 当前可复用内容与缺口

| 实际文件 | 已有能力 / 本轮边界 |
| --- | --- |
| `packages/payment-port/src/index.ts`、`packages/contracts/src/payment-port-contracts.ts` | 原 PaymentProvider 已有 capability/create/get/cancel/refund/reconcile；reconcile 可无 externalReference，商户引用和 provider idempotency key 必须等于 attempt ID。无需修改旧 port roots。create 的 return/cancel URL 均要求 public HTTPS。 |
| `packages/payment-fake/src/index.ts`、`index.test.ts` | TEST-only、LIVE 拒绝；支持 REDIRECT、provider locale fallback、同命令重放、TIMEOUT_AFTER_ACCEPT、无外部引用 reconcile。当前 payments/cancellations/refunds 为进程内 Map，now 固定，reconcile 默认将非终态变 SUCCEEDED；这是确定性单测工具，不能原样充当跨进程持久 PSP。 |
| `packages/payment-fake/src/webhook.ts`、`webhook.test.ts` | 独立 endpoint-scoped HMAC 原始字节验签，先验签再解析；时间窗、账户/环境/endpoint 绑定；仅返回无持久身份的 candidate。旧 `verifyAndParseWebhook` 明确 UNSUPPORTED_EVENT，不能恢复为入口。当前 webhook candidate 通过 externalReference，尚无 merchantReference 字段；早到事件应诚实保留 UNMATCHED，不能从不可信字段猜 attempt。 |
| `apps/api/src/payment-webhook-route.ts`、`reliable-events-composition.ts`、`production-application.ts` | 固定 endpointId 路由、48 KiB raw body、验签 header allowlist；PG receipt 成功后才 ACK。默认 verifier 缺失且 KMS failclosed；production 当前没有真实 PSP 绑定。新支付 composition 必须有明确部署 adapter/config 来源，不能只在 TEST injection 可用。 |
| `packages/application/src/receive-payment-webhook.ts`、`process-webhook-inbox.ts`；`packages/persistence-postgres/src/reliable-event-repositories.ts` | 可复用 endpoint 查询、加密 payload + inbox + provider_event + association 的原子写入、去重与持久队列。现有 writer 是 VERIFIED_WEBHOOK receipt，不能伪造 webhook inbox 来代替 AUTHENTICATED_RECONCILE；后者需真实审计和新的窄持久接线。 |
| `packages/persistence-postgres/scripts/postgres-reliable-events.mjs`、`postgres-constraints.mjs` | 有验签、重复、并发、队列与可信来源拒绝的既有证明模式。`assertUnrelatedReconcileAuditRejected` 等可参考负例；部分 aggregate fixture 使用 replica seed，不能复制到本轮正常 checkout/payment 主链来当合法创建证据。 |
| `apps/api/src/checkout-composition.ts`、`checkout-preflight-route.ts`、`cart-session-credentials.ts` | 已有同 cookie 授权、Origin/CSRF、schema、私有响应、KMS purpose 隔离及生命周期模式。保留旧 cart/checkout 注入兼容，新增独立 payment composition。 |

## 建议最小公开端点

以 root 最终 schema 为准，body 不接受金额、账户、规则、provider locale 或原始 PSP 响应。

| 方法与路径 | 最小职责 |
| --- | --- |
| `GET /api/v1/checkout/current/status` | 仅由拥有的 cart cookie 找当前已锁定 checkout / attempt；解决 CREATE 响应全丢后刷新恢复。没有 cookie 不造新单。 |
| `GET /api/v1/checkout/sessions/:id/status` | 保留 P4-03 历史快照；可附安全支付摘要，不按新 locale 改订单。 |
| `GET /api/v1/checkout/sessions/:id/payment-capabilities` | 授权后以真实订单金额/范围和已发布配置返回当前方法；不是通用路由探针。 |
| `POST /api/v1/checkout/sessions/:id/payment-attempts` | Cookie + Origin + CSRF + Idempotency-Key；接方法选择及冻结合同要求的版本，服务端两事务创建。 |
| `GET /api/v1/checkout/sessions/:id/payment-attempts/:attemptId` | 纯数据库读取，仅匹配该 cookie/session/attempt；不得触发 create/reconcile。 |
| `POST /api/v1/checkout/sessions/:id/payment-attempts/:attemptId/recover` | 同授权、CSRF、幂等；CREATED 过期 lease 按相同冻结命令重放，持久 UNKNOWN 只 reconcile。后台同一持久 due/lease 机制在没有浏览器时仍能恢复。 |

取消可在同 scope 下使用已有建议 `POST .../:attemptId/cancel`，若本轮产品实际暴露才接 UI；不能借取消 UNKNOWN 释放库存并重付。公开错误与 DTO 保持严格白名单，私有 no-store/noindex/no-referrer，重定向目的地由冻结服务端配置生成。所有读写按 owning cookie 授权，UUID 仅定位。

收到可信 SUCCEEDED reconcile 后，本轮只持久审计、规范化事件和待处理任务，界面显示“确认中”；不提前把 attempt/order 写 SUCCEEDED/PAID，因为旧 PG success guard 要求 P4-05 完整聚合。PROCESSING 或缺 CAPTURE 的观察也不能宣称已支付。浏览器回跳只查询，不是可信事件。

## 最小持久 TEST PSP

保留旧 Fake 不变；新增附加 TEST-only adapter，复用原 PaymentProvider schemas。独立 HTTP PSP 进程和独立 TEST 数据库（同临时 PG 实例可建另库），与业务库只通过认证 HTTP 协议交互。持久键至少绑定 account/environment/merchantReference/providerIdempotencyKey；保存规范化 create fingerprint、冻结金额/币种/请求及实际 provider locale、externalReference、状态、native capture reference 与事件时间。唯一约束和事务决定“受理一次”，不能以 Map、浏览器按钮状态或 API 内存作为真相源。

故障控制仅 TEST harness 可用：受理前断开、受理并提交后断开、返回 malformed、延迟到 lease 竞争、重启 API、重启 PSP。PSP 重启仍读取同一存储；行为开关不进入生产 API 或普通网页请求。reconcile 必须经认证 HTTP 查询真实 PSP 持久状态后才生成规范化 evidence，并绑定本次真实 audit。状态变更由明确 TEST 模拟交互/控制触发，不能沿用“每次 reconcile 默认成功”。

托管页明确标 TEST，无卡号/CVV/钱包凭据输入。使用 `https://payments.example.invalid:<port>` 与独立 `https://storefront.example.invalid:<port>` 的临时 TLS 服务；证书 SAN、精确 SPKI pin 和局部 DNS 映射均由 harness 所有。API/Node 也只信任该 TEST CA/主机，不改 `publicHttpsUrlSchema`、不使用全局 `NODE_TLS_REJECT_UNAUTHORIZED=0`。PSP 和 storefront 分域以实测 host-only cookie 不泄露；回跳目标必须为配置的 storefront origin。

## 真实主链复用与必要新增

`apps/api/scripts/checkout-preflight-runtime.mjs` 的 `withCheckoutPreflightFixture` 可直接包装：真实 PG migrations、TLS S3、正常上传/处理/商品/政策发布、真实 cart HTTP，以及 TEST KMS 加密履约 profile。它本身不会自动跑旧 20-case 协议；本轮用 `checkout-preflight-client.mjs` 初始化独立购物车并真正 validate/create，保留 `checkout-preflight-proofs.mjs` 的金额/快照/隐私聚合检查。禁止直接 seed orders、attempts、reservations 或成功状态。需另加明确 TEST merchant/account/发布路由配置/endpoint 前置数据；其合法 seed 边界由 root/PG 合同确定。

浏览器不能直接调用现有 `context.startStorefront()` 就完成接线：它的 `cart-storefront-runtime.mjs` 闭包把 Next 代理固定到旧 cart API；`cart-storefront-gateway.mjs` 非 GET allowlist 会拒绝新 checkout/payment POST。新增固定 path → cart/checkout/payment API 的 TEST gateway，继续严格 cookie/header allowlist、大小界限和真实上游响应。复用 `checkout-preflight-gateway.mjs` 的提交成功后真实断 socket 模式，不能 stub 成功业务 JSON。

`gift-storefront-next.mjs` 可复用 owned production build/start/stop，但当前 origin 是 HTTP localhost；本轮需前置 TLS storefront gateway 并令应用 siteOrigin、Origin 检查和 return/cancel URL 全部一致。`storefront-acceptance-browser.mjs` 当前只 pin/map media；新浏览器 helper 必须明确加入两枚 TEST host/cert，而非忽略全部 TLS 错误。Next 构建与原 P2 collectors 串行，先 HTTP 通过，再一次编译跑浏览器；本轮不需重复长 63 次 Lighthouse。

## 必须保留的验收用例

1. 七语真实 checkout → capability → attempt；订单历史金额/币种/locale/政策不漂移，provider locale fallback 仅影响托管页。方法不可用/配置被禁用必须拒绝；旧 attempt 恢复仍用冻结账户/环境/规则/locale。
2. 同 key/body 并发及两 API 实例只一个 attempt/PSP 受理；同 key 改 body 冲突；同订单不同 key 并发仍只一个 active attempt。已知终态才允许新 attempt，SUCCEEDED 或 pending success evidence 不能重付。
3. 两事务各断点：第一 COMMIT 前/后、PSP 接受前/后、第二 COMMIT 前/响应丢失；真实进程重启和 worker 无浏览器恢复；永久 UNKNOWN 不重 create、不换 PSP、不释放再付。保留 attempt/provider 调用计数及关联哈希，不能用“重跑 PASS”代替根因。
4. 真实认证 reconcile：无 externalReference 可用 merchant/key 查回；错账户/金额/币种/审计拒绝；native capture 与 PENDING evidence 精确对应。重复观察不重复任务，普通 GET/回跳/query `success=true` 不改变任何业务状态。
5. 外部 cookie、缺 CSRF/坏 Origin、路径换 session/attempt、过期 cookie、非法 HTTPS action、跨域 cookie 泄露、redirect/oversized/malformed 响应全部 failclosed。未知结果时浏览器保留原命令/key恢复，不再创建第二笔。
6. 七语 × 390×844 / 1440×900 的真正创建、托管跳转、返回确认中、刷新/current 恢复、取消/错误/键盘/reduced motion；截图只拍已提交后的无私密内容界面，email/留言运行时构造，不输出到截图、HAR、trace、日志或 browser storage。保留 axe incomplete 的真实范围，不宣称人工读屏/实体手机通过。
7. 每个 run 独立保存 source manifest、fixture/协议/浏览器/安全错误摘要和 owned cleanup；原 evidence 不覆盖。数据库严格约束、拒退保护和旧正式检查均保留。

本报告不选择未经用户批准的 PSP。持久 TEST PSP 只能证明本仓库 Saga、网络恢复和界面链路；真实 PSP sandbox、小额支付、主体/KYC、staging 与 P4-05 成功聚合证据仍分别待完成。

# P4-04 PostgreSQL 只读设计审计

审计基线：`f1f702f`，分支 `codex/p4-04-payment-runtime`。已读 P4-04 执行卡、SPEC §11–14、task-breakdown、R-03/05/17 与项目 skill。此次只读源代码；未启动 PostgreSQL、Next、浏览器或检查程序。本文是设计依据，不是新实现通过证明。

## 结论

复用现有订单、付款表、可信事件与库存约束，追加 **0026 的持久调用/恢复记录、永久创建回执及待应用对账证据** 即可。无需重建活动 attempt 索引，不修改历史迁移，不扩大旧 `CREATE_RESULT` 为财务成功权限。Root 已明确 P4-05 保持未领取：可信 `SUCCEEDED` 先真实持久化为待应用证据，公共视图显示确认中；本阶段不单独把 attempt/order 改为成功。

## 已有可复用边界

| 证据入口                                                                                                    | 当前保证 / 本轮用法                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database/migrations/0005_payments-reliable-events.up.sql:293`                                              | attempt 已有 account/environment/config/rule/method、订单金额外键、真实平台/provider locale、external reference、调用标记、加密 action、return-state 摘要与到期时间。merchant reference 与 provider idempotency key 均必须等于 attempt UUID（394）。                                      |
| 同文件 `:432`、`:1752`                                                                                      | 单订单唯一索引覆盖 CREATED、REQUIRES_ACTION、PROCESSING、UNKNOWN **及 SUCCEEDED**。新建必须 uncalled CREATED/v1，锁订单且仅允许所有前驱 FAILED/CANCELED/EXPIRED。金额、路由、语言与身份不可改。                                                                                           |
| 同文件 `:1911`、`:3022`                                                                                     | 每次状态变化必须匹配 append-only `payment_attempt_events`，并同事务写旧 `PAYMENT_STATUS_CHANGED` outbox；初始 CREATED 也需要。aggregate/version/双 subject/request/correlation/时间/locale/market/currency 必须准确绑定。复用 `outbox-repository.ts:148` 的真实来源读取，不另造成功消息。 |
| 同文件 `:1476`、`:1530`、`:1936`                                                                            | reconcile 要真实 `PAYMENT_PROVIDER_RECONCILE` 成功 audit、同 account/environment 的 normalized provider event 与 MATCHED association；更新付款还要求 external reference、金额、币种、目标状态完全相等。association 可在 attempt 尚无 external reference 时绑定真实查询结果。              |
| 同文件 `:1973`、`:2129`                                                                                     | SUCCEEDED 必须与订单 OPEN/PAID、cart CONVERTED、真实 reservation/fulfillment 计划及确认 outbox 同事务；非终态不得取消订单/过期 cart/释放 reservation，UNKNOWN 只有已过保留窗口的 EXPIRED reservation 例外。不能删门来缩短 P4-04。                                                         |
| `database/migrations/0004_orders-fulfillment.up.sql:498`、`:795`、`:908`、`:938`                            | order 金额/locale/quote 不可变；首 attempt 用 UNPAID→PENDING 和 `ORDER_PAYMENT_ATTEMPT_CREATED`，后续失败重试用 `PAYMENT_ATTEMPT_BOUND`，逐版本 append order event。不得再次创建订单。                                                                                                    |
| `database/migrations/0025_checkout-preflight.up.sql:191`                                                    | P4-03 已完成锁 cart/intent、PENDING_PAYMENT/UNPAID 订单及真实 TRACKED 预占；原 checkout receipt 在其创建事务要求 order v2/currentAttempt NULL。支付应接续已提交订单，不能把旧 checkout.commit 与首 attempt 合并后破坏该证明。                                                             |
| `packages/persistence-postgres/src/checkout-preflight-data.ts:18`、`checkout-preflight-repository.ts:174`   | 可复用 Cookie/HMAC 多版本授权与 session→cart→order 归属；历史 GET 可读过期 session，但不能据此授权新扣款。新 CREATE 另锁 quote 与真实预占，并用实际 PG 时钟检查有效期。失效返回 RECHECKOUT_REQUIRED，不偷偷补订单或预占。                                                                 |
| `packages/contracts/src/payment-port-contracts.ts:240`                                                      | 现有 RECONCILE_PAYMENT 已支持省略 externalReference，并带 account/environment、attempt=merchantReference=providerIdempotencyKey、amount/currency/auditLogId。无需造占位 provider ID 或扩旧 PaymentProvider。GET/CANCEL 仍需要真实 external reference（194）。                             |
| `database/migrations/0006_publication-heads-outbox.up.sql:234`、`0005_payments-reliable-events.up.sql:1126` | 已有当前配置 head 与不可变规则/七语批准门。新 loader 需读 head、已发布配置、merchant/account/health、rule scope 与显示译文；现 PG 未有完整支付运行仓储。规则 UUID 可作 capabilityId，但它不是授权凭据，CREATE 仍重验当前 session/scope/config/rule 与实际 adapter capability。            |
| `packages/persistence-postgres/src/postgres-persistence.ts:984`、`transaction-runner.ts:500`                | 复用同 client SERIALIZABLE 装配及安全事务错误：确认 rollback 与未知 COMMIT 分开；外部 PSP/KMS 调用始终放在两次事务之间。                                                                                                                                                                  |

## 必须显式处理的缺口

1. **CREATED 调用窗口**：旧 `validate_payment_attempt_mutation`（0005:1817–1907）禁止同状态更新；不能只设 `provider_call_started=true`。新 operation 记录实际 dispatch 与租约，完成 create/UNKNOWN 转移时才同步该旧字段。0026 另加窄 guard：operation 已 dispatch 时，禁止借旧行仍为 false 走 SAFE_EXPIRY / pre-provider business-cancel 捷径。
2. **永久幂等身份**：旧 `idempotency-repository.ts:114` 会删除过期记录重建。付款创建另保存不可变 `(cart_id, checkout_session_id, idempotency_key)` 唯一回执及请求 hash/attempt，先查该回执；不能 TTL 到期后让旧键再生成付款。回执只保存安全引用，不放 action/Token。
3. **未知结果与 fencing**：租约含 generation、digest、到期、due、固定 phase、版本；每次 settle 必须锁 operation+attempt 并精确 CAS。CREATED crash 租约到期只能重放原冻结命令/账户/键；持久 UNKNOWN 只 reconcile。晚到 CREATE_RESULT 不能解锁 UNKNOWN，也不能覆盖较新 evidence。纯重复 PROCESSING/UNKNOWN 查询不强造相同状态的付款事件。
4. **不可变 provider locale**：旧 attempt 的 provider locale 在 INSERT 必填且不可变（0005:310、1807），旧 capabilities 未提供该映射。须在首事务前通过 adapter 的真实部署映射得到；create 返回须完全匹配，不能先猜 requestedLocale 再补改。
5. **审计不能预写成功**：`audit_logs`（0001:297）只有 SUCCEEDED/REJECTED/FAILED，且 append-only。claim 可预分配 audit UUID；真实认证查询完成后再原子写成功 audit+provider event+association/待应用记录。失败记 FAILED，不用虚构管理员身份；SYSTEM/WORKER 必须有真实 task_name 和 request/correlation。
6. **加密托管动作**：旧 action 字段已要求 envelope ciphertext/key；0007 允许真实 opaque KMS key version。复用 `PAYMENT_ACTION` / `PAYMENT_RETURN_STATE` purpose。冻结命令的 return/cancel URL 若带秘密 state，也必须加密持久化；不能因保存重试命令而把该值写普通 JSON、日志或队列。Cookie/return 验证只准读取状态，不产生财务 authority。
7. **Fake 的证据范围**：`packages/payment-fake/src/index.ts:115` 使用进程内 Map。平台崩溃试验须保持独立 Fake PSP 的事实存储存活，或使用可持久的 TEST 服务；把平台和该 Map 同时重启不能证明真实 PSP 接受后的恢复。当前无生产商户/首 PSP 证据。

## 建议冻结的最窄端口

所有 command/result 均新 `schemaVersion:1` 严格合同；失败抛安全 repository error，基础设施失败保留原 typed transaction failure。租期传受限 duration，event/lease/expiry 判定由 PG 取时；不接受客户端 provider、金额或外部身份。

```ts
PaymentRuntimeTransactionManager.runInPaymentRuntimeTransaction(
  work({ cartRuntime, paymentRuntime, idempotency, outbox })
)

paymentRuntime.loadContext(accesses, checkoutSessionId, country, deviceCapabilities)
paymentRuntime.findCreateReceipt(accesses, checkoutSessionId, idempotencyKey)
paymentRuntime.beginCreate(frozenCreatePlan)
paymentRuntime.settleCreate(fencedCreateResult)
paymentRuntime.claimRecovery(workerClaim)
paymentRuntime.recordReconcile(fencedAuthenticatedObservation)
paymentRuntime.deferRecovery(fencedSafeFailure)
paymentRuntime.readAttempt(accesses, checkoutSessionId, attemptId, expectedVersion?)
```

- `loadContext`：返回 PG evaluatedAt、真实 cart/session/order IDs+版本+金额/币种/locale/quoteExpiry、readiness、当前 attempt，以及当前 publication/config/rules/accounts/健康/译文；读不是付款许可。
- `beginCreate`：access/session、expectedOrderVersion、永久 receipt/operation/attempt UUID、原始请求 hash/key、选中 config publication/id/version 与 rule/id/version、真实 provider locale、冻结 `CreatePaymentCommand`、return-state 摘要/expiry、lease digest/duration、attempt/order/outbox event IDs、request/correlation。重读并锁真实事实后返回安全 receipt 和 `{operationId,generation,leaseDigest,attemptVersion,frozenCommand}` claim。同事务写 initial CREATED/event/outbox、order 绑定与永久回执；不创建 quote/order/reservation。
- `settleCreate`：上述 claim + 已验证 `CREATE_RESULT`（仅 REQUIRES_ACTION/PROCESSING、真实 external reference、精确 locale、加密 action）或 `NETWORK_UNCERTAINTY`；同事务更新 attempt/event/outbox/调度。STALE_CLAIM 不覆写。明确 terminal create response 也必须先经可信 reconcile，不用 CREATE_RESULT 直接成功或失败。
- `claimRecovery`：按 due/lease 使用行锁与 SKIP LOCKED，返回 CREATE 或 RECONCILE 及原冻结账户/命令；可预分配 reconcile auditId，不能提前落成功审计。`deferRecovery` 只记录安全 code/backoff，不释放付款锁或改路由。
- `recordReconcile`：真实 adapter response 与 claim/auditId/request/correlation 一致；落原 audit/provider_events/association。允许的非财务状态边沿旧 authority 更新；SUCCEEDED 持久独立 pending application receipt，本阶段不写付款成功/订单已付/已处理标志。未知/未找到不能据此新建付款。
- `readAttempt`：每次做 Cookie→cart→session→order→attempt 精确归属；内部返回加密 action 及版本。App 事务外解密，回送前再次核授权/版本/过期，避免把已失效动作当当前动作；普通 GET/return 只读已持久事实。

0026 建议最少三职责表：不可变 `payment_create_receipts`（可同时拥有冻结请求）、可 CAS 的 `payment_runtime_operations`（一 attempt 一恢复进度）、`payment_reconcile_receipts`（真实 provider event 的待应用/已应用历史边界，P4-04 仅 PENDING）。现有付款/action/event/audit/outbox 继续为对应事实权威。新表准确 FK/hash/lease/版本检查，append-only 回执与 deferred dispatch/receipt guard；DOWN 存在新增付款/恢复/证据历史即明确拒绝，不删除事实。若合同采用不同表名，仍保留这三项职责。

## 最小后续验证与所有权

PG 实现候选为新的 `payment-runtime-{data,config,repository,write,recovery}.ts`、专属 tests/probe、0026 up/down、PG composition/manifest/catalog；共享 contracts/exports 与 Application 由 root 冻结。复用既有 `scripts/postgres-repositories.mjs`、payment migration/authority tests，以及 P4-03 正常 checkout HTTP fixture；不直接塞假订单或假成功证据。

有效 RED 应覆盖：两并发创建只一个活动 attempt；首事务提交后/PSP 接受后/settle 提交丢响应三崩溃窗口；externalReference 为空的 UNKNOWN 查询；旧 lease 晚回包；旧键 TTL 后重放；冻结配置切换；quote/预占失效；action 加密与无授权/回跳；真实 reconcile 审计与成功 pending。全部原 0001–0025 SQL/hash、旧 JSON roots/Provider 接口与财务 authority 保留。后续实际 PG roundtrip/HTTP、检查和 S.U.P.E.R 10 项尚待实现验证；本次只确认上述职责、依赖方向和可序列化 port 方案，没有宣称测试通过或上线可用。

## 后续实现补充（保留上文只读审计时点）

实现结果与有效 RED/GREEN 范围见 `postgres-implementation.md`。审计后确认 MATCHED provider event 一旦带真实 transaction，旧 `assert_provider_transaction_ledger` 要求同事务写精确 payment_transactions；即使 SUCCEEDED 待 P4-05 应用，也不可漏实际 CAPTURE ledger。固定 return/cancel URL 已采用受保护 Cookie 和公开 UUID locator，不携带秘密 state。原 0005 UNKNOWN 列表缺失 REQUIRES_ACTION；经 root 按 SPEC §12.1 授权，0026 只前向增加“authenticated reconcile + 合法加密 action”这一分支，down 恢复原函数；不是绕过审核/金额/历史/outbox 权威。

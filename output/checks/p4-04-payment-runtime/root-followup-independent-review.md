# P4-04 root follow-up independent review

结论：**ACCEPT（以下三个切片的有界只读复核）**。未发现越权、重复创建支付、以浏览器回跳作为状态证据或关闭数据库约束的确定性阻断。本次未执行测试、数据库、PSP 或浏览器服务，也未修改产品源码。

## 永久回执与并发创建

审阅 `packages/application/src/payment-runtime-create.ts` 及 `payment-runtime.test.ts` 中 root 新增的并发回执用例。

- `replayCreateReceipt` 使用当前受信 accesses、checkoutSessionId、原 idempotencyKey 查询永久回执，严格解析并比较 canonicalRequestHash；不同正文仍拒绝 `IDEMPOTENCY_CONFLICT`。
- 回执只提供 attempt 定位；返回动作之前仍经过 `readAuthorizedPayment` 的同购物车、同 session 授权读取。回执本身不成为新授权凭据。
- `beginCreate` 仅在真正的 `PaymentRuntimeRepositoryError / STALE_CLAIM` 时重读；有回执直接 `REPLAYED`，没有则保留原错误。分支不进入 `executePaymentClaim`，不重新 dispatch 已有 claim。其它错误、未知 COMMIT 不被该 catch 当成可再次创建的许可。
- `application-concurrent-red.log` 保留有效 1 FAIL / 11 PASS；`application-concurrent-green.log` 为 2 files / 15 tests PASS。测试以受控 repository 边界重现首次查询未见回执、随后 begin 失去 claim 的窗口，并确认同 attempt 且 provider create 仅一次；它不是 PostgreSQL 并发连接集成证据。

## UNKNOWN 恢复到托管动作状态

审阅 `packages/domain/src/payment-state-machine.ts`、对应测试及 SPEC 12.1。

- 新增 `UNKNOWN → REQUIRES_ACTION` 仍先要求 `PROVIDER_EVIDENCE` 且 evidence kind 精确为 `AUTHENTICATED_RECONCILE`；随后继续经过已有 accepted-evidence 品牌、实际 attempt 绑定与目标 status 匹配检查。
- `CREATE_RESULT`、`BROWSER_RETURN` 和本边的普通 webhook 证据均拒绝。不是仅添加状态枚举就无条件放行；终态冲突、UNKNOWN 来源和其它旧转移检查仍在。
- SPEC 12.1 允许 UNKNOWN 由可信查询/对账证据回到明确状态，并禁止再创建第二次付款。本边采用其中更窄的认证 reconcile 入口，未授予 GET 或浏览器回跳独立状态权威。
- `domain-action-recovery-red.log` 有效 1 FAIL / 8 PASS；`domain-action-recovery-green.log` 为 1 file / 9 tests PASS。这里只接受纯领域决策；真实 audit、ledger、action envelope 和 SQL 原子性不由该单测证明。

## 正常约束下的合成 TEST 支付配置

审阅 `apps/api/scripts/payment-runtime-config-fixture.mjs`、`.test.mjs`、`payment-runtime-config-postgres.mjs`，并核对其现有 TEST runtime 调用和原 0002/0005 译审、发布约束。

- 入口先解析配置与显式 country/market/currency，拒绝 LIVE、空或重复 provider 绑定。独立 PG 入口使用 `withEphemeralPostgres`，该次证据显式迁移到 0025；不能将此日志描述为完整 0026 支付运行验收。
- seed 在正常事务中创建独立合成 reviewer、TEST account 与真实 health event；七语逐条写入 DRAFT → IN_REVIEW → APPROVED 事件。reviewer 与 editor 不同，源与内容 hash 真实计算，随后正常 VALIDATED → PUBLISHED、publication/head/audit/outbox，并执行 `SET CONSTRAINTS ALL IMMEDIATE` 后 COMMIT。
- 没有 `session_replication_role=replica`、关闭 trigger 或改写正式 SQL；真实 PG probe 还确认 `SHOW session_replication_role = origin`，且已发布路由修改被原 `55000` 拒绝。
- `config-seed-green.log` 为 2 tests PASS；`config-seed-postgres-green.log` 实际记录 1 publication、1 head、7 translations、21 reviews、1 health event、1 outbox，0 attempts、0 orders，以及 published-rule immutable 检查通过。
- 这些审批是**明确合成的 TEST 前提**：源码、manifest 和结果均标注 syntheticReviewOnly，支付文案明确测试资金。它不代表真人七语批准、正式政策译审、真实商户开通或真实 PSP sandbox/生产认证。

## 非作者与验收边界

本报告不对本人编写的 `payment-runtime-execution.ts`、新增 recovery-action provider helper、相应 harness 与测试给出非作者 ACCEPT；其结果属于 `application-action-recovery-verification.json` 的作者证据，交由其它代理独立审阅。P4-04 的可信支付成功仍仅持久化待处理证据，PAID/order 聚合与正式支付发布不由本报告宣告完成。

# P4-05 付款证据原子应用：恢复开发时的独立审查

结论：**ACCEPT（本地付款证据应用的源码及已保留真实协议范围）**。旧 `independent-review.md` 中两个 P1 可解除；本次未发现新的阻断缺陷。此结论不等于 P4-05 全任务 DONE。最终原七项质量后缀已通过，与此前原全仓前缀的 PG/API/S3 等证据分段覆盖完整原门；旧完整 `pnpm check` 实际 exit 1，不能改称单条通过。

审查者 `/root/checkpoint_review` 为该实现非作者；本次仅只读源码、旧失败/通过日志与结构化证据，只写本文件，没有改实现、SQL、测试或调度文档，没有启动服务或重跑昂贵测试。已按 AGENTS 顺序读取 SPEC、MASTER、Phase 4、P4-05/直接依赖与项目 skill；确认当前唯一执行任务仍为 P4-05，P4-04 商户门与 P3-06 验收保持待续。

## 实际证据与来源一致性

主证据为 `run-2026-09-09T19-07-38.723Z/protocol-results.json`、同目录 `run-result.json` 和 `http-sixth.log`：18 cases，5763 准备 + 1064 协议 = 6827 断言，96 checkout 请求、74 payment 请求，PASS；另 0027 直接 SQL/正常 migration runner 拒退 8 断言，35 张表前后计数和 SHA 完全一致。

这次运行确实使用实际 PostgreSQL、独立且持久化的 TEST PSP、真实 raw webhook HTTP route、原 API composition 与默认 Worker handler。它不是支付商 sandbox，也没有浏览器查单证据。源码中的 TEST clock barrier 只等待实际 Node/PG 时刻达到原已签名事件时间，最多 10 秒，不改 raw bytes、签名、发生时间或原认证 guard；endpoint 激活也只等真实时间生效。Telemetry 与 queue PROVISION 是夹具正常依赖准备，运行时继续 VERIFY。

将当前相关订单支付、inventory、migration、Application/Worker 及 TEST 协议文件逐 SHA 与 `source-final-candidate.json`（2026-09-09T19:10:59Z）比对，所审实现均一致；该清单晚于第六轮结束，不能假称它是第六轮启动前已冻结的清单。旧 `source-during-check-delta.json` 准确记录全仓检查期间仅三个协议 TEST 文件修改和一个短 TEST 新增。审查也逐字复核旧审查所列后期生产文件/协议 SHA 与当前文件一致。其余工作区输入由 Root 另行核对，本记录不替未审范围作结论。

## P1 解除：失败 webhook 先终结 attempt，再释放预占

当前 `order-payment-write.ts` 在失败分支先 `setAttempt`，随后才调用同 client 的 inventory RELEASE；成功分支的 commit 顺序保持。Attempt、history、Outbox、reservation、ledger、永久 application receipt 由同一 transaction runner / scope 提交，原 0005 非终态释放禁止和 deferred 金融证据 guard 未削弱。

第六轮 `WEBHOOK_FAILED_RELEASED` 与 `WEBHOOK_CANCELED_RELEASED` 不是 reconcile 先改变状态的假成功：正常限量礼物 checkout 创建真实 ACTIVE reservation，独立 PSP 托管表单提交 FAILED/CANCELED；验签 HTTP 返回 202 后，协议断言平台 attempt 仍为 REQUIRES_ACTION，再启动默认 Worker。随后真实 COMMIT 达到对应终态和一次 RELEASED，永久 receipt 重放 ALREADY_APPLIED/FAILED_RELEASED；零 CAPTURE、零 ORDER_PAYMENT_CONFIRMED，订单仍 PENDING_PAYMENT、车仍 LOCKED，重复应用前后 aggregate counters 相等。

旧 PROCESSING 顺序单元测试与真实 REQUIRES_ACTION 路径共同覆盖本缺陷；0005 同一非终态 guard 明确同时列出这两个状态。不要将本次真实 fixture 描述为 PROCESSING 起点。第六轮没有对这条失败释放分支另注入后续异常；它的同事务回滚性质由 composition/runner 和原 SQL guard 保证，独立 COMMIT 故障协议则测成功应用分支，二者不能合并夸称为“所有分支均注入故障”。

## P1 解除：MATCHED 证据恢复 NULL 外部引用

当前 apply 先用 event 的持久 MATCHED association，只有不存在 MATCHED 才按 account/environment/external reference 查找；锁 cart/order/attempt 后精确核验 account、environment、既有非 NULL 引用、金额、币种和唯一关联。已绑定不同引用不会被覆盖；新增身份只能由该已认证 event 在终态事务内通过 COALESCE 绑定。Domain 在 NULL 时省略 optional externalReference，不伪造字符串。

第六轮 `EXPIRED_LATE_CAPTURE` 走新 checkout → TEST PSP CREATE 成功后实际销毁响应 → 平台 UNKNOWN → 原 Domain/repository 真正过期 → PSP 已持久托管 action 实际 capture → 认证 reconcile → application PAID_REVIEW。已读 create fault、markPaymentUnknown、recordPaymentReconcile 源码：该丢响应支路不会写 external reference，SUCCEEDED reconcile 只存 MATCHED evidence/EVIDENCE_PENDING，不赋予外部引用；因此该成功路径确实需要当前 MATCHED/NULL 修正。这里 NULL 前态由已核对的执行支路证明，结构化报告没有另输出该字段快照，不能称为独立现场字段采样。

实际最终 PAID/OPEN、attempt SUCCEEDED、cart CONVERTED、fulfillment ON_HOLD、一次 capture/confirmation、零 committed reservation、零再次扣减；重放 ALREADY_APPLIED 且 aggregate 不变。有效旧 RED 及 `matched-reference-green.log` 8 PASS 保留；错误既有引用/账户的负例为单元范围，不冒称该两种不可能正常入库身份均做过真实 HTTP 金融提交。

## Inventory 精度与并发效果

`canonicalInventoryTimestamp` 只用 Date 处理整秒与 offset，原小数部分独立保留；`.000123` 不会被毫秒截断。`inventory-repository` 读取/比较/回执与订单桥均采用相同精确规范化，等价时区形式可匹配，1 微秒偏差拒绝。桥先按库存/地点稳定排序锁所有余额，再对同余额的多 reservation 逐次推进版本；每个响应的归属、数量、余额、流水及时间再次核验，失败抛错让整事务回滚。

真实 expiry helper 在第六轮依次执行 -1µs、+1µs 两个独立失败事务，要求 VERSION_CONFLICT 和零 expiry ledger 增长，之后使用等价 +08:00 表示在原 Domain/repository 成功过期；on-hand 保持，reserved 减准确数量，恰好一条 expiry ledger。这里是实际 PostgreSQL 探针，不只 PREPARE。已有 27 项 inventory 单元通过证据本次也已读取；审查者不是该五文件作者，可以对当前精度实现给非作者接受。

`SHARED_TRACKED` 真实证明同单两艺人共用一份有限库存，两个预占使用不同连续余额版本，恰好消耗 2+3=5；七语普通订单与 PREORDER 不伪造库存。三组双来源并发各保留第一次 40001/PERSISTENCE_FAILURE，至少一事务真实成功；随后默认 Worker/maintenance 从持久记录恢复至两份来源 receipt，一次 canonical capture、一次订单确认，aggregate counters 不再变化。没有隐藏自动重试、没有接受未知错误。三组双来源使用默认按单礼物，不能把它们额外称为“真实两付款并发抢同一有限余额”测试。

UNMATCHED 保持可重试而不落永久收据；真实非终态恢复后仍 PENDING、零 capture/confirmation。公平扫描实际使用 limit 2、三个前置 unmatched 和后置有效事件：第一批 2 unmatched，第二批 1 unmatched + 1 applied，证明已 claim 的持久 due 推进后不会永久饿死后续条目。

## COMMIT 与迁移保护

COMMIT 故障 helper 包装真实 manager：第一次在真实 repository work 后、COMMIT 前抛错，实际事务回滚且无 application receipt、aggregate 与原快照一致；第二次真实 COMMIT 返回后再抛错，下一正常 apply 读取永久 receipt，金融 aggregate 不变、PSP call counters 不增加。`actualPostgresCommit=true`、`actualNetworkDisconnect=false` 准确。该案例用按单礼物，因此不能独立证明注入故障时 TRACKED balance 行经历过一次写入再回滚。

0027 alias 必须精确指向非 alias canonical 的认证 evidence/MATCHED association/ledger，禁止链、自指、错 account/environment/reference/金额/币种和 alias 再造金融 ledger。Alias application 复用不可变 canonical receipt，不重新要求历史订单仍处于 PENDING fulfillment。本次真实协议覆盖 PAID 后的来源补齐/重放；PREPARING/DELIVERED 或 refund 之后的 alias 重放仅静态接受，真实后续履约场景留在后续阶段，不把它计入本轮运行。

Down 先取得三表 ACCESS EXCLUSIVE 锁，任意 alias/receipt/schedule 都拒绝；本次实际带数据通过直接 SQL 与正常 runner 两条拒退路径，35 表 hashes 保持。另用只读函数体提取逐字确认 down 恢复的 assert_provider_transaction_ledger 和 validate_payment_transaction_evidence 与 0005 原文一致。

## 完成边界与 S.U.P.E.R

本次对已审模块的单一职责、单向依赖、无环、schema/可序列化边界、环境配置、显式 workspace 依赖和可替换 Port 的九项静态检查接受；没有为精确金融顺序提出形式重构。第十项“全部测试通过”经下方最终原门分段证据复核，现为本地检查点范围内 PASS。旧全仓 check 1653.618 秒 exit 1 和本次第一次质量后缀的限时失败均保留，不称单条完整 check 全绿。

P4-05 安全查单/token exchange、成功 UI、历史时间线尚未实现；P4-06 通知与正式清理、P3 性能/人工验收、实际 PSP/商户/云 KMS、staging、真实小额与上线批准均不由本次接受解除。可完成当前技术检查点的本地提交，再在同一 P4-05 中继续安全查单。

## 最终质量后缀与测试修正复核（2026-09-15）

已独立读取 `git diff -- packages/persistence-postgres/src/postgres-persistence.test.ts`：唯一修正是在 reliable-event manager 的完整排序 key 预期内新增 `orderPaymentApplication`，与实际新增仓储接线一致。原 legacy transaction manager 预期 `idempotency / inventory / outbox` 三键仍原样保留；原 reliable-event 其他六键不删除、不放宽为部分包含，也没有改生产实现或 timeout。

已核对 `package.json` 的原 check 顺序与 `check-full.log`：首次完整链在单元测试该旧断言失败前已顺序通过全部原 PG/API/S3 节点，包括新 order-payment 6827 断言、TLS S3 以及媒体恢复 423 断言。旧首条 exit 1 的事实保持。补验使用原 quality 最后七项，未减少步骤：Prettier、ESLint、Turbo typecheck/test/build、adapter boundaries、Node build exports。

- 第一次补验 `resume-quality-suffix.json/.log`：47.446 秒 exit 1；artifact-documents 的 deterministic schema/OpenAPI 测试超原 5000ms，contracts 为 471 PASS / 1 FAIL。失败日志保留，没有改测试阈值。
- 同源单独 `resume-artifact-targeted.log`：原文件 6 PASS，2.84 秒运行时间（测试 2.36 秒），仅证明原阈值下复验通过，不声称首次超时根因已修。
- 第二次原后缀 `resume-quality-suffix-2.json/.log`：41.952 秒 exit 0，`changesSinceFirstSuffix=[]`。类型 61/61 成功，**61 缓存**；测试 61/61 成功，60 缓存；构建 36/36 成功，29 缓存；format/lint/adapter 门通过，32 个真实 Node exports 导入通过。不是冷缓存证据。

因此本次接受的是**原前缀 + 最终原七项后缀分段覆盖**。本审查未重新运行这些命令，只读原始输出、退出记录、命令列表和窄 diff；整个 P4-05 及生产门继续按上方边界保持未完成。

## 本次只读核验的关键 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `packages/persistence-postgres/src/order-payment-application.ts` | `7c7fb798ce213b1e7de8f1dea6391a4ccae69e37d53e584e21808ae88dc8bafc` |
| `packages/persistence-postgres/src/order-payment-write.ts` | `2df723540119155e4edc92d9be80dbea071ffd1be514bb1ccef833f98f623b5c` |
| `packages/persistence-postgres/src/order-payment-data.ts` | `47e145714a6fa72c7b67427faabebdd62d5f614411db32364eccac0189f41337` |
| `packages/persistence-postgres/src/payment-transaction-canonical.ts` | `67c9248b1ca664acf58760fe858a7135fe8d826f044b79b95aad62dff8b5bb97` |
| `packages/persistence-postgres/src/order-payment-inventory.ts` | `8138333e1063b31e4cbdaeace17ce4a7918b521739ab9b6e03171c89cb4e5d9f` |
| `packages/persistence-postgres/src/inventory-timestamp.ts` | `8f4a2636bea94cb6f67d98f12121bb3468b4e3e0ec82f951a64a669263b4d5f6` |
| `packages/persistence-postgres/src/inventory-repository.ts` | `51ffb6bddf4e670d45d454be466aee65b4b0c14feadd785a3c992b1149e7a3cd` |
| `packages/persistence-postgres/scripts/order-payment-expiry-fixture.mjs` | `8c7a86710a45966a4e939ce18221631d5377a63b2b1810a8171219b4f2ef280b` |
| `database/migrations/0027_order-payment-application.up.sql` | `750db6afe5e47760842e964755b4e27172ee2cc3e4d36a1898f3587b87a9966b` |
| `database/migrations/0027_order-payment-application.down.sql` | `026b13b7aec874baa3617707241ae31612b7b5c394b21e4894958a2fc525b009` |
| `apps/api/scripts/order-payment-protocol.mjs` | `3cbd0b20c8d979d7fefd32a3e8be1cdee08b2da9b7f6b404ba3592645b812f17` |
| `apps/api/scripts/order-payment-runtime.mjs` | `65c3b5f87149a59682395e36ac5cbaff937bc552397839b314a5587760158f69` |
| `apps/api/scripts/order-payment-commit-faults.mjs` | `142f244d13866bd814e0b998f8d680296363364427f0613d9400b3d5583a7735` |

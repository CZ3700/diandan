# P4-05 订单支付终结：独立复核

结论：**REQUEST_CHANGES，P1 尚未解除**。本记录是 `storefront_read` 对 PG 作者实现的只读审查，不代表本检查点整体通过。FAILED webhook 的事务顺序及 CREATE_UNKNOWN 后缺失外部引用的恢复问题，仍须保留有效 RED，并以真实 PostgreSQL / HTTP GREEN 解除阻断。尚未领取安全查单实现；本地顺序例外不解除 P4-04 真实商户及 PSP 验收门。

## P1：失败 webhook 必须先终结 attempt，再释放库存

触发条件是 TRACKED 订单的 attempt 仍为 PROCESSING（CREATED / REQUIRES_ACTION 同理），验签 webhook 首次报告 FAILED。初审的 `order-payment-write.ts` 先调用 `applyOrderPaymentInventory(RELEASED)`，随后才 `setAttempt`。原 [0005 guard](/Users/mario/Desktop/下单/database/migrations/0005_payments-reliable-events.up.sql:2152) 取得订单锁后检查非终态 attempt，明确拒绝释放，产生 23514；整笔事务应回滚，不会产生部分成功，但真实失败订单无法完成预占释放。

当前 [候选修正](/Users/mario/Desktop/下单/packages/persistence-postgres/src/order-payment-write.ts:347) 已把失败终态及对应 history / outbox 放到同一 client 的释放之前；成功分支仍先提交预占再记成功。修正不允许先提交独立支付事务，也不能削弱原 SQL guard。**已存在的顺序 mock 用例不足以解除此 P1**：需真实 TRACKED + PROCESSING + VERIFIED_WEBHOOK FAILED，验证完整 COMMIT、一次释放 ledger、零 CAPTURE / PAID；注入后续失败还应整笔回滚。PG 作者负责此 RED → GREEN；本记录不提前采纳未读的运行结果。

## P1：已认证 MATCHED 证据必须能恢复 NULL 外部引用

确定性路径：CREATE 响应丢失后 attempt 为 UNKNOWN、`external_reference=NULL`；[recordPaymentReconcile:117](/Users/mario/Desktop/下单/packages/persistence-postgres/src/payment-runtime-recovery.ts:117) 收到已认证 SUCCEEDED 时仅持久化真实 MATCHED event / audit / ledger 并置 EVIDENCE_PENDING，不单独赋予金融成功。初审 [apply:102](/Users/mario/Desktop/下单/packages/persistence-postgres/src/order-payment-application.ts:102) 只按外部引用反查，因此每次返回 UNMATCHED，扫描重试也无法补出该绑定。

PG 作者的候选方向静态可接受：优先取该持久 event 的唯一 MATCHED association，对 account / environment / 金额 / 币种精确核验，attempt 外部引用仅允许 NULL 或与 event 相同；无 MATCHED 时保留原真实外部引用定位。NULL 只能在同一终态事务 `COALESCE` 为已认证 event 的实际引用；Domain 的可选 `externalReference` 在 NULL 时省略，不传假字符串。不从 caller、浏览器、merchant hint 或同金额猜 attempt。

原 [association guard:1546](/Users/mario/Desktop/下单/database/migrations/0005_payments-reliable-events.up.sql:1546) 已支持外部引用尚未绑定的真实 MATCHED，并验证账户 / 环境 / 币种 / PAYMENT 金额；每 event 的 MATCHED [唯一且追加不可变](/Users/mario/Desktop/下单/database/migrations/0005_payments-reliable-events.up.sql:637)。外部引用一旦非 NULL [不可改写](/Users/mario/Desktop/下单/database/migrations/0005_payments-reliable-events.up.sql:1839)，且 [account / environment / external 唯一](/Users/mario/Desktop/下单/database/migrations/0005_payments-reliable-events.up.sql:389)；[终态 deferred evidence:1936](/Users/mario/Desktop/下单/database/migrations/0005_payments-reliable-events.up.sql:1936) 仍要求 event / association / attempt / 引用 / 金额全绑定。因此无需放宽旧 SQL 权限或证据门。待有效 NULL 恢复 RED / GREEN，及错误 MATCHED / 已有不同外部引用不能被覆盖的负例后复核；当前仍是待验候选，不是整体 ACCEPT。下方源码 SHA 表记录的是此前快照，不能覆盖本次后续修正。

冻结候选复读：上述四点现已落盘，**静态实现接受，两个 P1 的真实 HTTP 门仍保留**。lookup 的 MATCHED CTE 只使用实际 event ID；仅在无持久 MATCHED 时走旧 external fallback。匹配后依次锁 cart / order / attempt，再校验账户、环境、已有外部引用，随后保留原金额 / 币种与关联精确校验；身份冲突进入 REVIEW，不会被 WHERE 静默滤成永久 UNMATCHED。`setAttempt` 将 event 的外部引用作为参数，在原终态 UPDATE 内 `coalesce(external_reference,$7::text)`；已有值不会被覆盖。Domain 仅在原值不是 NULL 时传可选字段，没有伪造外部引用或引入调用方金融提示。

已实际阅读作者 `postgres-unit-red.log` 尾部：4 FAIL / 4 PASS，分别覆盖身份拒绝、持久关联选择与 NULL Domain 输入；`matched-reference-green.log`：2 files / 8 PASS。关联选择用例包含 SQL 结构断言，不能冒充真实查询行为。`matched-reference-parameters.log` 为实际 PostgreSQL 30 条源码 SQL PREPARE / 参数绑定通过，报告也明确金融行行为须正常 HTTP / PSP 夹具；不是完整 COMMIT 证明。PG types / build / scoped lint / format 的 exit 0 由作者与 Root 报告，本次没有重复执行。第三轮真实 HTTP 待结果后解除或继续保留 P1。

此次四文件冻结 SHA-256：`order-payment-application.ts` 为 `7c7fb798ce213b1e7de8f1dea6391a4ccae69e37d53e584e21808ae88dc8bafc`；`order-payment-write.ts` 为 `2df723540119155e4edc92d9be80dbea071ffd1be514bb1ccef833f98f623b5c`；application test 为 `b51f516e0753d492d4b7dde96bb27b94daf7a7847eb831f3b3885b0cad6fe852`；write test 为 `36966561ec3a4beaeb16d778b51bc9be77a4ce4a2b970722c82bc23224212892`。本段补充前次快照，不抹去初审缺口。

## 已排除的疑点

- **下单后库存策略变化**：[0020:31](/Users/mario/Desktop/下单/database/migrations/0020_gift-commerce.up.sql:31) 的 `gift_commerce_variant_policy_locked` 覆盖 quote line、order item、reservation 与 ledger 任一历史引用。相关 INSERT 对 variant 取 FOR SHARE；[同文件:47](/Users/mario/Desktop/下单/database/migrations/0020_gift-commerce.up.sql:47) 的 BEFORE UPDATE guard 禁止已交易 variant 改 SKU / inventory policy。0022 没有移除此保护，0002 另有 item / variant 策略一致性 deferred guard。因此 write 读取当前 variant policy 不会静默改变已下单含义。
- **预占快照读后被独立 expiry 改写**：新 [apply:120](/Users/mario/Desktop/下单/packages/persistence-postgres/src/order-payment-application.ts:120) 先锁 cart / order / attempt，随后读预占。原 [0005:2129](/Users/mario/Desktop/下单/database/migrations/0005_payments-reliable-events.up.sql:2129) 对 ACTIVE → RELEASED / EXPIRED 必须取得相同 order FOR UPDATE；UNKNOWN 到期分支也没有绕过该锁。若 expiry 先提交，新事务读取终态；若 apply 先持锁，expiry 无法在其快照与余额锁之间完成。逆序持余额锁可能导致死锁与整笔回滚，不能证明静默错账；本次不为未成立的 race 改桥的生命周期语义。
- **alias 在后续履约后不能重放**：当前实现已不要求历史 canonical 仍处于 PENDING 履约。新 alias 先取得永久 canonical application receipt，再写自己的历史关联收据；不重跑原金融效果。此项为已修的静态结论，后续真实历史推进场景仍需协议证据。

## 当前静态可接受的边界

- [canonical helper:32](/Users/mario/Desktop/下单/packages/persistence-postgres/src/payment-transaction-canonical.ts:32) 以真实 account / environment / CAPTURE / provider reference 取得事务 advisory lock；同引用的 event type、status、external reference、金额或币种不一致即拒绝。原 UNMATCHED 的补关联只接受唯一实际 attempt，已有不同 MATCHED 关联拒绝；ledger 从原持久 event 列生成，不从新候选金融正文生成。
- [0027 alias guard:8](/Users/mario/Desktop/下单/database/migrations/0027_order-payment-application.up.sql:8) 要求目标不是 alias、自身不是目标，且原认证事件、MATCHED association、ledger 精确一致；[ledger 分支:130](/Users/mario/Desktop/下单/database/migrations/0027_order-payment-application.up.sql:130) 与 [INSERT guard:177](/Users/mario/Desktop/下单/database/migrations/0027_order-payment-application.up.sql:177) 禁止 alias 再记金融 ledger。新增 alias 不替代旧验签 inbox / reconcile audit 约束。
- [apply:45](/Users/mario/Desktop/下单/packages/persistence-postgres/src/order-payment-application.ts:45) 优先读取不可变 receipt；[0027:76](/Users/mario/Desktop/下单/database/migrations/0027_order-payment-application.up.sql:76) 将后到来源绑定到永久 canonical receipt 的同 attempt / order / outcome。账户、环境和外部引用从 PG 定位；金额、币种、MATCHED association 再核；无 CAPTURE 的成功进入 REVIEW。
- [apply:109](/Users/mario/Desktop/下单/packages/persistence-postgres/src/order-payment-application.ts:109) 返回 UNMATCHED 时不落永久 receipt。[listPending:225](/Users/mario/Desktop/下单/packages/persistence-postgres/src/order-payment-application.ts:225) 在独立扫描事务持久推进 due 30 秒，SKIP LOCKED、有界批次；失败或早到事件不会永久占据最旧一批。真实批次公平 / 失败隔离仍须协议实测。
- [manager:316](/Users/mario/Desktop/下单/packages/persistence-postgres/src/postgres-persistence.ts:316) 与 [inbox 装配:405](/Users/mario/Desktop/下单/packages/persistence-postgres/src/postgres-persistence.ts:405) 均将 inventory、outbox、订单写端绑定同一 client；订单管理器使用 SERIALIZABLE。支付、订单、cart、intent、fulfillment、ledger、receipt / outbox 在原 deferred guards 下共同验收；回跳与调用方 payload 没有金融赋权路径。
- [0027 down:2](/Users/mario/Desktop/下单/database/migrations/0027_order-payment-application.down.sql:2) 先锁三表并拒绝存在任何 alias / receipt / schedule 的降级；没有静默删历史。只读提取函数体比较确认 `assert_provider_transaction_ledger` 与 `validate_payment_transaction_evidence` 的 down 恢复正文均与 0005 原文逐字相同。本复核未运行 DDL。

## 第六轮前的测试证据有效性复核

当前 `order-payment-runtime/client/protocol/http` 与短 ingress 测试的窄增量，**静态接受，仍不解除两个 P1**。前五次原入口失败均保留；已读 `http-fifth.log` 中真实 raw callback 的 400 / 404 / 202、default worker 入账后的推进及随后 40001 失败，不能把该次运行改写成整体通过。第六轮失败释放、late capture 与最终 COMMIT 结果尚待运行报告。

- [runtime:17](/Users/mario/Desktop/下单/apps/api/scripts/order-payment-runtime.mjs:17) 在取得独立 TEST PSP 原签名正文后，只读等待 Node 的实际收件时刻与 PG 实际时刻都到达原 `created_at`；performance deadline 最多 10 秒。它不改签名、正文、头、原事件时间或服务端 clock。endpoint 的 barrier 同样只等待原正常 COMMIT 的 `active_from` 对真实收件时钟生效，没有把激活时间改到过去。此为 TEST 因果时序准备，不声称修复宿主时钟原因或放宽正式 receipt 门。
- [runtime:107](/Users/mario/Desktop/下单/apps/api/scripts/order-payment-runtime.mjs:107) 先显式 PROVISION 自有 durable queue，实际 API / worker composition 继续 VERIFY；使用原 `createApiApplication` / raw webhook route 与真实默认 order handler。`startNodeTelemetry` 在该入口注册一次，并通过 fixture `own` 生命周期 shutdown；短 ingress 用 finally 关闭 app、composition、telemetry、PG client 及 TEST 密钥。没有替换业务 HTTP 返回或把调用方数据提升为已认证结果。
- [http:30](/Users/mario/Desktop/下单/apps/api/scripts/order-payment-http.mjs:30) 的 pg wrapper 不改变 query / manager，只记录允许的 SQLSTATE 后重抛原错误；每个 apply 由 AsyncLocalStorage 单独收集。[protocol:255](/Users/mario/Desktop/下单/apps/api/scripts/order-payment-protocol.mjs:255) 使用 allSettled，必须至少一个真实成功；失败项仅允许 PERSISTENCE_FAILURE 且该调用捕获非空、全部为 40001 的 SQLSTATE。没有泛化接受 TEMP、未知错或其他完整性失败。
- 初次并发结果保留在报告，随后启动原默认 worker 并调用真实 maintenance，有界等待两个独立来源的永久 receipt；再比较初次 PAID 后完整 aggregate counters 不变。没有重写订单 / attempt 状态，也没有把“重试成功”等同初次全成功。
- 已读 `webhook-capture-red.log`：原认证通过，但实际 occurred-minus-received 为 +59,785 微秒，原 receipt 拒绝并返回 503。`webhook-capture-final-green.log`：短实际入口 400 / 404 / 202、events=1 / inbox=1 / orders=0；同日志 12 条当时源码 SQL PREPARE 通过。短测试是自有签名的 TEST observation，证明原 raw ingress 与因果准备，不能替代完整独立 PSP / 订单 / 库存效果。初始 endpoint 404 与 telemetry 缺失的历史日志也保留，不混为同一生产根因。
- 后半协议静态绑定仍正确：FAILED / CANCELED 从实际 REQUIRES_ACTION + ACTIVE TRACKED reservation 直接签名 webhook 进入默认 worker，无预先 reconcile；late case 用原 Domain / repository 真正过期，再用 PSP 已存 action 实际 capture，期待 PAID_REVIEW / ON_HOLD、零重新扣库。commit fault 分别在原 repository work 后、真实 COMMIT 成功后抛错，明确 `actualNetworkDisconnect=false`；不能把这个注入称作真实网络断连。

本次只读快照 SHA-256：runtime `65c3b5f87149a59682395e36ac5cbaff937bc552397839b314a5587760158f69`；client `a1fc32aeb7a8b1805bc9b3c430c4b3c94b86643353c953903259e45708573aae`；protocol `3cbd0b20c8d979d7fefd32a3e8be1cdee08b2da9b7f6b404ba3592645b812f17`；webhook test `647dca7240b9fc8180f9c03d5b2554264844e3f6c5001067d27eee5089e8469f`；http `acf0db0213fe37f4217b7cdf4a064d1f971e5d3a4283adc3f549d0f25784a593`。未改源码、未开服务、未重复执行测试。

## S.U.P.E.R 十项与收敛

| 项             | 本轮范围内结论                                                                            |
| -------------- | ----------------------------------------------------------------------------------------- |
| 1 单一模块职责 | 静态接受：event 定位、canonical 身份、aggregate 写入、inventory 桥职责可分别说明。        |
| 2 单一概念操作 | aggregate 是一笔金融聚合事务；可由作者局部提取映射以减长，不把事务切碎。P1 修复优先。     |
| 3 单向依赖     | Domain / Port 不依赖 PG；服务端编排经 Port，未发现反向业务依赖。                          |
| 4 无环依赖     | 已审文件的 import 链未形成环；不声称代替全仓工具检查。                                    |
| 5 合同边界     | 外部 apply / batch 命令与结果严格 Zod；adapter 内部 typed facts 再受 SQL 身份与证据约束。 |
| 6 可序列化数据 | 命令、结果和持久 receipt 无私密明文；client / repository 是注入依赖，不是消息数据。       |
| 7 环境隔离     | 未新增生产账户、国家、币种、URL 或密钥常量；固定 task / reason / due 间隔是内部行为值。   |
| 8 显式依赖     | PG 对 Domain 的 workspace 依赖已声明；没有 App 反向导入来复用时间工具。                   |
| 9 可替换边界   | 库存操作复用既有 InventoryRepository；持久化实现封装在 PG 包，保留现有端口。              |
| 10 测试与完成  | **PENDING**：P1 真实 RED / GREEN、完整协议及最终统一门尚未由本审查确认。                  |

依据 code-simplifier 原则，不为短小精确时间 helper 的条件表达式做形式重构；不新增通用金融 planner、不合并验签与业务写端。当前不能给整体 ACCEPT。

## 作者证据与独立性边界

本审查者本人编写的 `order-payment-inventory`、旧 `inventory-repository` 微秒修正与新 `inventory-timestamp` 共五文件，**不纳入本人非作者 ACCEPT**。Root 已独立复核其实现设计；真实 PG 证明仍待协议。

- 桥有效 RED：`inventory-microsecond-red.log`，6 FAIL / 14 PASS；adapter 有效 RED：`inventory-adapter-microsecond-red-2.log`，7 FAIL。首 adapter RED 含三个夹具参数错误，已原样保留，不混算有效失败。
- `inventory-microsecond-green-final.log`：2 files / 27 PASS；`inventory-microsecond-types.log`：完整 PG typecheck exit 0；`inventory-microsecond-lint-final.log` 与 format 日志 exit 0。范围是严格合同、真实 Domain 和模拟仓储 / query layer；不是 PostgreSQL guard 或生产支付证明。
- 本轮只读复核未启动 PG、HTTP、浏览器或整仓检查，未改作者源码 / SQL。实际双来源并发、事务丢响应、历史推进、真实预占、非目标账户 / 金额拒绝、迁移拒退与完整门，均须最终实测证据后更新。

审查时源码 SHA-256（作者仍可能收尾；最终接受前须重新核对，不能把本表视作统一冻结）：

| 文件                                   | SHA-256                                                          |
| -------------------------------------- | ---------------------------------------------------------------- |
| order-payment-application.ts           | bc17fdb6996b15538b9a641c97981b4667d8883a61063a787d4be8c98f44f686 |
| order-payment-data.ts                  | 47e145714a6fa72c7b67427faabebdd62d5f614411db32364eccac0189f41337 |
| order-payment-write.ts（顺序修正候选） | 441dca2b7ae0a3358a0ed2e496d94b03f0fecc32814ec327455f03ff7c40c6b8 |
| payment-transaction-canonical.ts       | 67c9248b1ca664acf58760fe858a7135fe8d826f044b79b95aad62dff8b5bb97 |
| payment-runtime-evidence.ts            | 04983570b7a8264f255981781fcaa8d8af28240aef4cda858a87bf657028310e |
| 0027 up                                | 750db6afe5e47760842e964755b4e27172ee2cc3e4d36a1898f3587b87a9966b |
| 0027 down                              | 026b13b7aec874baa3617707241ae31612b7b5c394b21e4894958a2fc525b009 |

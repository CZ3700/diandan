# P4-03 HTTP 与最终应用层独立评审

最新状态：真实 HTTP 首轮 FAIL 于 observation INSERT 23514 / checkout_preflight_observations_check2；最小 canonical JSON 保存修复独立只读 ACCEPT，真实 HTTP 第五轮完整 PASS（7404 assertions + 拒退 8 assertions，20 cases / 195 请求）；root 单条 pnpm check 仍在运行。此前源码与验收覆盖设计 ACCEPT 未识别跨 JS/SQL 时间规范化差异，不等同端到端通过。审阅者未修改产品/脚本、未运行 PG、HTTP、S3、Next 或浏览器。该结论不表示 P4-03 DONE。

## 范围与发现

只读复核新增 `checkout-preflight-{protocol,changes,proofs,client,runtime,fixtures,gateway,http}.mjs`、实际复用的 daily gift fixture，以及 Application checkout 最新 canonical comparison、receipt mismatch/rollback 测试。沿用上一轮 App、PG/0025、合同/端口独立 ACCEPT。

发现并已由作者修正一个确定 oracle 错配：原 daily fixture 固定英文源稿，checkout 却断言中文原文。现在旧 helper 默认仍英文，checkout 显式提交 `sourceLocale=zh-CN` 及中文名字/描述，断言 English order 中实际中文与 `fallbackUsed=true`；没有通过改 public DTO 或伪造翻译使测试通过。已复读修正源码，真实中文发布结果仍待运行。

原价格修订用例只验证真实新 priceId/revision，金额不变。作者已另加正常 prices/read → create → publish 原 variant 金额 +137：旧确认/旧 observedPriceId 拒绝，新车通过真实加购与预检、明确确认后验证新报价及实际订单金额。参数已与正式合同逐项核对；该新增用例尚待第二轮实际执行，不记 PASS，也没有 PSP 扣款证据。

## 覆盖映射

| 要求               | 实际测试机制与范围                                                                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 真实身份与并发版本 | 无 cookie、错误 Origin/CSRF/cross-site、缺 key、伪客户端金额/scope/operation、错误 policy revision 与 expectedCartVersion 逐项精确状态/code；另一 cookie 先形成同版本车再尝试他人 observation/session，避免版本先拒绝掩盖授权路径。                                                      |
| 验证不产生订单     | VALIDATE 前后查询 order/session/quote-line/order-item/contact/acceptance/fulfillment/reservation/payment 表计数；observation 本身允许正常持久化。                                                                                                                                        |
| 同键不重复         | 两个真实并发 CREATE；只允许一个 CREATED 与一个 REPLAYED（若先 IN_PROGRESS，显式同键恢复）；实际订单只增加一条，KMS 加密停用后成功重放，改 email 同键冲突，新键锁车拒绝。                                                                                                                 |
| 网络未知结果       | 真实网关先等待上游 200/CREATED，再销毁下游 socket，验证未发送下游 headers；原 body/key 重试必须 REPLAYED、PG 只增一单。没有注入伪成功 DTO。                                                                                                                                              |
| UNKNOWN 不自动重试 | Application 单元实际注入 typed UNKNOWN，断言事务函数只调用一次；仅显式 TRANSACTION_ABORTED 最多三次。HTTP 网关证明客户端同键恢复，不等同真实 PostgreSQL COMMIT 协议丢包集成。                                                                                                            |
| 当前事实变化       | 正常运营 API 暂停/恢复艺人和礼物；正常库存 API 调整真实余额至零再恢复；正常七语 copy/approve/publish 艺人和 policy；旧确认拒绝且业务表计数不变。                                                                                                                                         |
| 两种库存           | 七语下单使用 PROCURE_ON_DEMAND/PREORDER，真实订单预占数为零；共享 TRACKED 两收礼人行 2+3 实际预占两条、总量5；两个真实并发车竞争库存1只允许一单成功，实际 on_hand/reserved 均为1。纯域另覆盖锁后数量减少与一行不得拆库位。                                                               |
| 历史快照           | 七语言各真实创建 order，状态读取加不同 Accept-Language，拒绝 query 改语言；艺人/policy/价簿重新发布前后，public view 全量相同且 orders/order_items/policy_acceptances 全量 JSON 指纹相同。                                                                                               |
| 私密最小化         | 每次严格 response schema，再递归拒内部字段并扫描运行时随机留言/署名/email canary；只保留安全 category/status/code。PG 联系邮箱通过实际 adapter 解密对比后清理 Buffer，并重新计算 purpose/key-version 正确的 HMAC；报告不含明文、密文、对象 key。                                         |
| 原子关联           | 成功查询实际 order/cart 状态、行/fulfillment数量、两个 order event、唯一 receipt/PENDING outbox、精确 policy revision/locale、实际总额和零 PSP attempt。真实 KMS failure 与 PG 到期轮询后失败均核无部分业务写入。完整延迟 SQL 守卫由实际 COMMIT 命中，破坏性负例范围以单独 PG 验证为准。 |

## 边界

- TEST fulfillment profile 是真实加密的合成先决条件；P5 正常 profile 管理未实现。未预造 checkout/order/quote 业务记录。
- 实际 KMS adapter + TEST backend 不等于真实 AWS KMS；原生 HTTP Cookie 检查不等于浏览器 Cookie/E2E；本轮没有 PSP、支付金额扣款、真实生产发布证据。
- runtime 将 API、composition、网关交给既有 owner 清理；bootstrap 注册 checkout lifecycle，API close 后停止持久化连接。运行报告目前只声称 cleanup attempted，实际成功/异常需结合最终运行结果。
- 只读检查未发现修正后的确定性参数/状态必败项。首轮真实 HTTP 已失败；后续完整 HTTP、最终 source/provenance、整仓与未完成阶段门仍由 root 统一收口。

## 首轮 23514 与规范化修复复核

原保存使用 `JSON.stringify(observation)`，而 consent hash 的 JS canonicalPublicationValue 会把 policy.effectiveAt 规范为六位微秒。数据库 canonical_publication_json 只进行 JSON 规范排序，不把三位毫秒文本转换为六位；因此相同时间的不同字符串导致原 CHECK 拒绝。此前静态评审核对了 hash 函数出口与 SQL 关系，却没有验证实际持久化字符串同为 canonical 表示，是本次漏判的具体范围。

已复读冻结修复：`checkout-preflight-repository.ts` 的保存参数仅由 `JSON.stringify(observation)` 改为 `canonicalPublicationValue(observation)`；仍先验证当前事务的 `verifiedConsents` 和同前缀 consent hash，保存后仍执行 `requireFresh`。没有修改合同、SQL CHECK、权限、expiry、head 或版本守卫。规范化后的保存表示与 hash 使用同一函数，保留日期实际含义。

证据与范围：

- `postgres-canonical-save-red.log`：真实 repository 调用的 INSERT bind 断言失败；`.000Z` 与无 fraction 的失败记录均保留。`postgres-canonical-save-green.log`：4 files / 10 tests PASS，断言实际参数为 canonical JSON 且 policy.effectiveAt 为 `.000000Z`。
- `postgres-canonical-actual-red.log`：最早 23502 是临时 LIKE 表缺 DEFAULTS 的探针夹具错误，不是根因证明；随后 `--raw-observation` 在实际迁移定义的 CHECK 上得到 23514。`postgres-canonical-actual-green.log`：32 assertions PASS，canonical 保存成功，raw 毫秒 JSON 与篡改 quantity 均被精确 `checkout_preflight_observations_check2` 拒绝。
- 实际 PG 探针先运行迁移，再对真实源码 SQL 做 PREPARE，并建立 `LIKE ... INCLUDING CONSTRAINTS INCLUDING DEFAULTS` 临时表；它不复制 FK/trigger。因此此证据证明 SQL 参数与原 observation CHECK 的规范化差异，不能替代完整授权/内容证明/订单 COMMIT 集成。
- `postgres-canonical-static.log` 保留首次两项 lint 失败；当前源码已去除对应 `structuredClone` / 未使用参数问题，作者报告随后 format/lint/types/build 通过。审阅者没有重跑这些命令。

修复结论：ACCEPT。首轮 HTTP FAIL 不改写成成功；后续完整 HTTP 尚待通过，新增数值变价、中文原文与 3 秒 TEST quote 过期历史稳定用例均须以实际后续结果判定。此前静态 ACCEPT 未覆盖实际序列化绑定差异的局限保留。

## 第三轮 outbox 时间与履约事件补齐复核

第三轮 `http-third.log` 实际首 CREATE 在 `outbox_events_time_check` 得到 23514，仍记 FAIL。旧通用 writer 省略 created_at，数据库默认 transaction_timestamp()；checkout receipt 的实际事件发生在事务开始之后，旧 CHECK 要求 created_at ≥ occurred_at。因此该修复有受控真实 PG 因果证据，不把一次自然通过当修复。

`checkout-outbox.ts` 在同一创建事务中，以真实 receipt.occurredAt、实际 fulfillmentId/orderId、sequence 1/PENDING、原 request/correlation 追加既有 durable event。它不发私密内容、不发支付事件；订单、库存应用和该追加均在完成幂等 receipt 之前。新测试覆盖事件只追加一次、成功重放不追加、追加失败回滚订单和当前创建 receipt；单元 fake transaction 的覆盖不代替真实 COMMIT。

已复读 PG 最终 diff：仅给 outbox INSERT 显式增加 `created_at = GREATEST(clock_timestamp(), event.occurredAt::timestamptz)`。occurredAt/availableAt 均保持原入参；不更改真实 event authority、market/currency/subject/version/status 验证、request/correlation/微秒发生时刻匹配、append-only、唯一键或精确 replay predicates。created_at 本来不属于重放身份，新增生成时刻不会把旧合法重放变成新事件。历史事件仍可补投；没有把非法提前 availableAt 自动夹到合法时间。

- `outbox-time-red.log`：保留先前 import/SQL 表达式夹具错误；有效 RED 是 AFTER_BEGIN_ACTUAL_WRITER、实际 writer 的 23514 / outbox_events_time_check。
- `outbox-time-green.log`：保留负例返回码 oracle 的首次错误；最终实际 4 cases / 19 assertions PASS。事件由真实 PG clock 取得，证明比 BEGIN 至少晚 20ms；新增事件及历史事件正常 COMMIT，提前 availableAt 被精确 time CHECK 拒绝并标 rollback-only，错误 source occurredAt 在 COMMIT 被原 authoritative-source 守卫拒绝且没有留下 outbox 行。
- 新 PG probe 使用既有 TEST replica seed 约定仅准备隔离的 source 数据；执行 writer 前显式恢复并断言 session_replication_role=origin，原 outbox 全部守卫开启。它不是完整 checkout/order source 历史的集成证明。
- `outbox-time-unit.log` 为 3 files / 16 tests PASS；作者报告 types/build/format/lint 通过。审阅者仅复读源码与已有日志，未启动运行程序。

独立结论：该 helper 与时间窄修 ACCEPT，第三轮失败不改写；数值变价后的原车 GET→QUANTITY PATCH（同数量、当前 priceId、双版本）→原 item CURRENT→重新预检确认参数已核对，真实运行仍待后续报告。`gate-coverage.json` 已从 root 原 check 和完整嵌套 PostgreSQL/S3 scripts 派生；新增 outbox-event-time 已确认正式注册，所有验收项仍 PENDING。

## 第四轮边界与后半段 oracle 复核

`http-fourth.log` 已实际执行七语订单、两类库存、并发、同键断线恢复、quote 真实到期及经营/库存变化；停在第 157 个请求后的 POLICY copy 预检，原守卫精确返回 POLICY_EFFECTIVE_TIME_INVALID。此前失败保留。原因是复制稿沿用早于新 revision.createdAt 的 effectiveAt；最新 TEST 修正仅给 POLICY changes.structure 提供真实 PG clock +2 秒，并在七语审批后有界等待 PG ≥ effectiveAt +1 秒才发布，沿用既有正常 seed 的语义，没有回填过去时间或修改发布门。

后半段源码复核 ACCEPT，以下是参数/预期检查，不能冒充第五轮执行 PASS：

- Daily：向正常 management publisher 明确提交中文 sourceLocale/name/description；helper 默认英文仍供旧调用者使用。新礼物真实 PRIMARY 处理图、PROCURE_ON_DEMAND、ALL_ACTIVE_ARTISTS 和当前 pricehead 来自正常业务写入。English checkout 的 gift provenance 明确检查 requested=en、source/resolved=zh-CN、fallbackUsed=true；没有伪造 APPROVED 译文。
- 价格：正常读取实际 published head 与 authoringVersion，使用当前 priceBookId/revision/contentHash 创建原 variant 金额 +137 的新 revision；发布时间携带原 headVersion。旧 observation 返回 PREFLIGHT_CHANGED，旧 observedPriceId 返回 PRICE_CHANGED。随后新车与原车均通过当前公开价格重新明确确认；原车 GET 回填最新双版本，QUANTITY PATCH 保留数量/原 item ID、提交实际 currentPriceId，以新 key 表达用户新的确认动作。
- 历史：最终重新读取最初七订单，并比较 orders/order_items/policy_acceptances/fulfillment outbox 的完整 JSON 指纹；只有摘要离开函数。复刊不会修改这些历史字段。公共 DTO 另含动态 expired，当前全量相等断言仅在默认 15 分钟 quote 未过期时成立；若一次长运行跨过期限，应单独按 PG 时钟核 expired，不能把合法到期误记为历史内容变更。该边界已告 root/e2e。
- 拒退：最后复用本轮已真实接受的 checkout，要求 receipts/orders/items 非空、每 receipt 对应 checkout outbox；执行原 0025 down 必须精确 SQLSTATE 55000/固定拒绝原因，ROLLBACK 后 21 张表计数和完整数据 hash 相等；正式 runMigrations(confirmVersion=0025) 同样拒绝并再比较全部指纹。当前 down 第一段确实先持锁拒绝任何 observation/receipt/outbox/schema2 历史，没有先删除数据，也不把空库 roundtrip 当已有订单拒退证明。

本次未修改源码、未启动服务或测试；最终完整运行和 gate-coverage 的 PENDING 状态继续等待实际结果。

## 第五轮完整实际结果与整仓待验收

已读取 `run-2026-09-08T14-44-01.620Z/protocol-results.json` 与 `http-fifth.log`：完整第五轮 PASS，总计 setup 5760 + protocol 1644 = 7404 assertions，20 cases / 195 HTTP requests；另实际 0025 拒退 8 assertions，21 表 before/after 计数与哈希完全一致。上述曾标“待运行”的中文 daily 原文、数值 +137、原车新价格明确确认、七语历史稳定和独立 cookie 同 key 均已在该完整运行实际通过。此前各轮 FAIL 与修复范围不改写。

证据明确 actualPostgres/actualTlsS3/actualKmsAdapter=true，actualAwsKms/browser/payment provider evidence=false。生产输入冻结采用 `source-final.json`：1856 files，SHA-256 `cd848a5ab50fd8f629c5a668068acde7465295827133c0d84507d148b3f0c95e`；旧 source-before-full-* 是较早快照，不混用。

root 已于 2026-09-08T14:47:39Z 启动原单条 pnpm check，记录 `check-full-1.log`，最终 metadata 预期 `check-full-1.json`。gate-coverage 当前 IN_PROGRESS，所有子门仍 PENDING，只有实际单条 exit 或原失败加精确后缀完整覆盖才可改验收状态；不能由局部 PASS 字样推断整仓完成。审阅者仅按约一分钟间隔读阶段与 Admin next-env 引用，不启动额外验证服务。

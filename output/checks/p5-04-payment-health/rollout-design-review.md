# P5-04 灰度执行设计审计（待 root 冻结）

日期：2026-09-22（Asia/Bangkok）。本次只读检查；未实现合同、Domain、SQL 或应用修改，也未运行构建/数据库。健康迁移0033和其他作者文件不动。

## 已核对的实际路径

- `payment-runtime-capabilities.ts:55–63` 在读取能力前拒绝两个非10000比例；`payment-runtime-write.ts:73–89` 首事务再次拒绝；0026 `assert_payment_runtime_receipt()` 的延迟约束（105–156行）在提交时第三次拒绝。
- 已完整读取该 guard：checkout/cart/order/version/quote、不可变配置发布 head、账户/商户/健康、精确金额/币种/locale、操作 generation/trace、create command、device/country/market 与库存/私密意图约束都需逐字保留，仅替换原两个比例等于10000的谓词。
- 永久 receipt 已保存 checkout_session_id；attempt 已固定 provider_account_id、route_rule_id、config_version_id/config_version/rule_version；关联的规则/配置保留原比例。这些事实足够重放算法v1，无需改旧 receipt/attempt/runtime roots、HTTP对象或新增前台字段。
- `createRuntimePayment()` 先 `replayCreateReceipt()` 再读取新规则；repository 同样先查永久 receipt。维持此顺序，比例改为0不会禁止旧key读回或 UNKNOWN 原账户恢复。
- `loadPaymentContext()` 通过访问凭据锁 cart、加载其 checkout receipt/session/order，再读取有共享锁的当前已发布配置。分桶只能使用此处受权PG读回的checkout与规则身份，不能直接接受请求携带的bucket。

## 推荐最小合同和算法

新增内部 `paymentRolloutInputSchema` / `paymentRolloutDecisionSchema`，注册两个新 roots，旧 roots 完全不变。输入为 `{schemaVersion:1, checkoutSessionId, providerAccountId, routeRuleId, providerRolloutBasisPoints, ruleRolloutBasisPoints}`；三个ID均UUID、两个比例为整数0..10000。

纯 Domain 导出 `evaluatePaymentRollout(unknown)`，返回合法输入的 `{schemaVersion:1, algorithmVersion:1, kind:"ELIGIBLE"|"EXCLUDED", providerBucket, ruleBucket}`；非法输入返回 `{schemaVersion:1, kind:"INVALID", reason:"INVALID_ROLLOUT_INPUT"}`。无时钟、随机数、网络或 Node imports；只有合同/Zod解析和确定性整数计算。

两组规范ASCII输入：

```text
payment-rollout:v1:provider:<lowercase checkout UUID>:<lowercase provider UUID>
payment-rollout:v1:rule:<lowercase checkout UUID>:<lowercase route-rule UUID>
```

建议冻结32位 FNV-1a 折叠再加两轮整数雪崩，避免简单线性hash在相近UUID上的明显相关性：初值2166136261，每ASCII字节 `h = uint32((h XOR byte) * 16777619)`；随后两次 `h = uint32((h XOR (h >>> 16)) * 73244475)`，最后 `h = uint32(h XOR (h >>> 16))`，bucket=`h % 10000`。TS 使用 `Math.imul`/`>>>0`，PG 用非负 bigint/XOR/右移及 `%4294967296`；两种乘法最大中间值均小于有符号bigint上限。

准入需 **providerBucket < provider比例 AND ruleBucket < rule比例**。0全闭、10000全开，500/2500分别是5%/25%桶阈值；两个domain前缀和两个target ID分离，不复用同一个bucket。两级都是5%时有效交集约0.25%，不是5%；不能在文案或测试中混淆。算法用于稳定流量分配，不是安全凭证或精准按人数配额；统计分布只是有限样本的辅助检查。

稳定范围必须明确：相同checkout/provider/rule身份不因重试、语言、进程、节点或比例变动改变bucket；不把locale、金额、country、attempt ID、idempotency key或config version加入hash。**routeRuleId 是不可变版本的行UUID**，重新发布若创建新rule行会更换规则bucket；不承诺跨新rule身份的队列不变。若需要跨版本固定群组，须另定义逻辑rule_key契约，不能偷偷改用其名字后又声称按routeRuleId审计。

SPEC §13.4当前列出的路由业务输入没有checkout身份。冻结时应明确：checkout ID仅是服务端生成且经PG授权绑定的已发布灰度规则技术分配上下文，不新增语言/人群/价格等业务资格条件；这是需要写清的架构解释，不能假称原文已逐字规定。无需引入正式PSP或商业选择。

## 三处一致消费及0034

1. Application：保留原 eligibility 的账户/商户/健康/部署检查，以该纯函数替换两个10000条件；输入只从 `current.checkout.receipt` 与已解析route取。`selectPaymentRoute` 旧输入、返回对象和规则排序不变。
2. PG repository：保留原检查和永久receipt优先；读取当前PG规则后用参数化SQL调用下面的PG函数分别重新计算两桶，再比较PG读回的两比例。不要信任Application的布尔值或新增客户端字段；分桶被排除仍返回现有 `CAPABILITY_UNAVAILABLE`。
3. 新迁移 `0034_payment-rollout`：增加 `public.payment_rollout_bucket_v1(scope text, checkout uuid, target uuid) RETURNS integer IMMUTABLE STRICT PARALLEL SAFE`，scope只准provider/rule；UUID规范文本作为ASCII。`CREATE OR REPLACE assert_payment_runtime_receipt` 只把两个10000判断改为从 `session.id/account.id/rule.id` 独立重算的两项比较，其余完整函数体/触发时机保持。
4. 不修改0026或0033，不新增表/列/外部API，schema catalogue和manifest由root在单一候选统一生成。算法v1的命名与已验收测试向量固定，以后不得就地改写v1。
5. down迁移恢复0026该guard原函数，再DROP新增helper（默认RESTRICT）。现存receipt/attempt不被删除或重写；已创建的部分灰度付款继续按原receipt恢复，旧代码仅拒绝新的非10000创建。须实测该回退性质，不能靠推断当通过。

## 先失败再实现的最小验证

- 合同：非UUID、大小写等价、比例越界/小数、未知字段/版本、JSON可序列化。新roots注册后旧roots/OpenAPI逐对象保持。
- Domain：固定独立预期向量；0/10000、500/2500在bucket-1/bucket/bucket+1的精确边界；同输入/大小写/同checkout重复等价；两个scope的分离；固定足量UUID样本检查分布与交集，不能只测“两个值通常不同”。无网络/环境依赖。
- SQL：TS/真实PG对固定向量及成批UUID逐值一致；PG scope非法/NULL/UUID类型失败或严格NULL；迁移up/down/up，旧全部SQL SHA保留。
- 首事务/延迟guard：真实正常checkout选入可创建、排除不能创建且PSP调用0；先能力可用再改变比例/发布head，首事务拒绝旧配置；模拟绕过repository直接写excluded receipt时延迟约束拒绝提交并完整回滚。继续复验其他原精确身份、金额、健康和库存守卫，不能只验证新bucket函数。
- 旧支付：创建后比例设0、重放同key仍回同attempt；UNKNOWN/重启/语言切换不重路由或二次扣款；不同新key只有原允许的失败终态才能创建。原10000路径完整保持。

拟所有权：本agent负责新rollout合同/Domain/tests、0034 up/down及新PG灰度测试、`payment-runtime-write.ts`的比例检查；root整合 Application eligibility、统一合同root注册/manifest/catalogue/构建和HTTP验收。实际编辑前以root冻结确认的文件表为准，避免与0033和健康接线作者冲突。此设计不包含P5-05管理UI/配置发布服务。

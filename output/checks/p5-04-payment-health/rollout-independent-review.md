# P5-04 灰度合同、Domain 与 PostgreSQL 独立复核

日期：2026-09-22（Asia/Bangkok）。Reviewer：`/root/health_storage`，不是本轮灰度合同、Domain、0034、`payment-runtime-write.ts` 灰度修改及 HTTP 灰度证明的作者。本人健康持久层代码不属于此独立结论范围。

## 结论

**ACCEPT：所复核的冻结本地灰度范围未发现剩余阻断缺陷。** 本轮只读源码、作者保存的 RED/GREEN 日志及真实协议结果，并执行纯文件内容/SHA 比对；没有重复运行 PG、HTTP、测试或构建，也没有改业务代码。root 的最终统一构建、全仓检查与生产发布门仍须独立满足。

## 独立核对

1. **内部合同与输入来源**：`packages/contracts/src/payment-rollout.ts` 严格限制 schemaVersion、三个 UUID 和两个 0..10000 的整数比例，不接受浏览器 seed/bucket、locale 或其他未知字段。决策保留 algorithmVersion=1 和有界桶。Application 从已经授权的 checkout receipt 与 PG 路由投影取身份；repository 再从自身 `loadPaymentContext()` 读取的当前数据计算，没有信任 Application 的 eligible 布尔值。公开 HTTP 合同没有增加灰度种子。
2. **TS/PG 算法同义**：Domain 先统一 UUID 小写，以固定 ASCII 前缀区分 provider/rule。TS `Math.imul(... ) >>> 0` 的模 2^32 结果，与 PG 非负 bigint XOR、numeric 乘法、mod 4294967296 一致；两轮右移混合及最后 `%10000` 相同。PG UUID 类型天然提供标准小写文本，严格 NULL 和非法 scope 保持拒绝/不可准入。不存在 Unicode 字节与 UTF-16 分歧，因为合法输入全是 ASCII。
3. **比例与稳定性**：两个独立桶都必须严格小于各自比例。任意一级0均关闭；两级10000保持全开；等于桶值时仍排除。比例变化、重复请求、locale 和节点变化不改变相同身份的桶；更换不可变 rule UUID 会改变该规则的分配身份。双5%是约0.25%的交集，不是总5%；hash用于非秘密分流，不被当作授权或精确配额。
4. **三道实际准入**：`payment-runtime-capabilities.ts` 的筛选、`payment-runtime-write.ts:90` 的参数化 PG 重算、0034 的 deferred receipt guard 各有独立计算。数据库路径继续锁当前 publication/config 与 account/merchant，且保留原身份、健康、金额、country/market/currency、device、订单版本、库存及私密意图限制。PG SQL返回非true就拒绝，不以模糊truthy值准入。
5. **迁移最小变更**：独立文本比对确认0034 receipt函数相对0026只替换原来两个比例=10000的谓词，其余函数体逐字相同；down恢复原函数，再移除v1 helper。既有触发器仍是 AFTER INSERT、DEFERRABLE INITIALLY DEFERRED。没有改旧迁移、receipt结构或历史attempt。
6. **永久回执优先**：`payment-runtime-create.ts:66` 在读取当前规则前查原永久receipt，并校验canonicalRequestHash；`payment-runtime-write.ts:37` 同样先判既有receipt，返回STALE_CLAIM供上层读取或IDEMPOTENCY_CONFLICT。现行比例0不会否定原key读回；hash不同的重用key仍拒绝。新key仍受currentAttempt.canRetry和当前全部准入条件限制。
7. **旧attempt恢复**：`claimPaymentRecovery()` 只从原operation/receipt重建被冻结的createCommand；资源失效按旧规则转UNKNOWN/reconcile。`executeReconcile()` 使用原provider、environment、attempt、幂等key、金额和币种，不再次挑选当前路由。健康观测结果也不覆盖原资金结果。新版灰度关闭不会将UNKNOWN换到新账户或创建第二笔付款。

## 已读取的验收证据

- `rollout-contract-red.log` / `rollout-domain-red.log` / `rollout-postgres-red-observed.log` 与其绿色日志：先证明缺少合同、算法与已迁移PG函数，再实现。本复核未将初次配置/启动错误当作行为RED。
- `rollout-domain-green-final.log`：9项通过；含3组冻结预期向量、精确边界、大小写、身份独立性、20,000固定checkout的分布与双门交集。分布检查只是辅助，没有替代逐值一致性。
- `rollout-postgres-green.log` 与 `.json`：退出码0，8,224计数断言、4,099组UUID逐值TS/PG一致；另外验证非法scope/UUID/NULL、0/10000/阈值相等、guard文本及隔离DDL down/up。已阅读对应脚本，固定向量有独立数字预期，不是只把同一实现和自身比较。
- `rollout-http-2026-09-21T18-28-05.419Z/protocol-results.json` 与 runner/helper 源码：343条协议断言加5,761条setup断言，真实PostgreSQL、两个HTTP API实例、TLS TEST PSP；发布比例provider=10000/rule=5000，普通真实checkout得到选入/排除两类，七语言保持分桶与金额/币种。
- 同一HTTP证据中的 `guardProof`：先只伪造应用读取投影，真实beginCreate通过PG独立重算拒绝；再额外伪造单个SQL admission返回值，真实写入完成但COMMIT的原deferred约束报23514。两种情况下订单版本、session、attempt、receipt、history/outbox与PSP调用数都保持原值。helper没有禁用触发器或替换写入。
- 同一HTTP证据中的 `closedPublication`：新DRAFT经独立模拟review、VALIDATED/PUBLISHED和普通约束提交，原发布行内容hash不变，新比例均0。新checkout不能创建付款；既有真实TEST PSP已接受但响应丢失的UNKNOWN，在另一API按原key回放并通过原账户reconcile恢复。最终payments=1、createCalls=1、reconcileCalls=1、captures=0。

## 明确保留的范围

- 上述最新HTTP结果是本地TEST PSP的真实协议，不是真实商户sandbox、小额资金、staging或生产灰度。模拟review夹具不是管理中心P5-05发布服务，也不是人员审核验收。
- 现有down/up证据证明隔离DDL函数往返；没有宣称已演练“数据库中已有partial receipt时降级到旧应用后再恢复”。从源码可确认旧回执读取/reconcile不调用新bucket helper，但正式回退演练仍需部署版本与迁移配套。**不能在仍运行新版beginCreate代码时单独移除0034 helper。** 本地功能验收不等于此部署演练已完成。
- v1算法与三个身份含义应保持冻结；未来规则发布若创建新UUID，不能宣称跨新规则身份保持相同群组。完整商户/策略热发布仍属于后继范围。

## 源码核对时点

只读SHA比对时，`rollout-owned-source.json` 中10个灰度所属文件均与当前文件一致。关键值：

| 文件 | SHA-256 |
| --- | --- |
| contracts/payment-rollout.ts | `3ef1d1d4fe8e77b970515395c5a73f8017ec1edcefa2e754656204a5b2af4d20` |
| domain/payment-rollout.ts | `4095b319dd9baee8dcc7be26e6136e0efdd5c92c01d420bf5d33a4d4656d1388` |
| persistence-postgres/payment-runtime-write.ts | `386be8181df9a5df211b67be459e4cd2e7c265c219f8376f1b159e0d9e0b80a7` |
| 0034 up | `4e3348e106b753573ac3465b1d14d3eab65c413c8c079ea01b1a20271761b075` |
| 0034 down | `aa36279d52058631cc948bdd6f5be8df0f57719f1e1467014f513123a3c2c9ba` |

此报告是非作者复核，不替代作者实现说明/S.U.P.E.R，亦不授权Git推送、云操作或真实资金。

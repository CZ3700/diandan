# P5-04 灰度实现交接

2026-09-22（Asia/Bangkok）。root 已冻结 `rollout-design-review.md` 的方案并授权实施；该文件保留冻结前审计历史。本报告只覆盖本代理有限实现，不将本地 TEST/模拟审核当真实商户或人员验收，不变更任务状态。

## 已实现

- 两个新内部 schema 和纯 Domain `evaluatePaymentRollout`；三个受权 UUID、两个整数比例；旧公开 HTTP 合同没有增加 seed/bucket 字段。root 统一合同 roots/exports/兼容性。
- v1 规范小写 ASCII、FNV-1a32 与两轮混合，provider/rule 独立桶且 AND；0 全闭、10000 全开，双5%有效交集约0.25%。同身份/比例变化不重新取样，新规则 UUID 更换规则群组；有限桶允许合法碰撞。
- 0034 新增不可变 PG 函数，乘法使用 numeric/mod；receipt guard 只替换原两个10000谓词。真实 PG 测试逐字比较其余函数体，并验证 down 恢复原函数、移除 helper，up 恢复。
- beginCreate 保留受权 checkout/current PG 配置与永久 receipt 优先顺序，用参数化 SQL 独立重算 admission；不信任 Application 的布尔值。原身份、健康、金额、范围、库存和事务写入条件未删除。
- SPEC 仅 §13.4 增加灰度技术上下文和规则身份稳定范围；管理中心日常原文模式不受影响。

## 已实际验证

| 项目 | 结果与证据 |
| --- | --- |
| 先失败的合同/Domain | `rollout-contract-red` 2 tests FAIL、`rollout-domain-red` 8 tests FAIL，缺失函数/schema 的断言失败 |
| 先失败的真实 PG | `rollout-postgres-red-observed`：已正常迁移，新增函数尚不存在，actual=false/expected=true |
| 合同与纯规则 | `rollout-contract-green` 2 PASS；`rollout-domain-green-final` 9 PASS，含20,000固定checkout分布、双5%交集、大小写、阈值、新身份隔离 |
| 真实 PG | `rollout-postgres-green` 8,224计数断言 PASS；4,099组 UUID 的 TS/PG 桶逐值相同；非法scope/UUID/NULL、0/10000、严格边界、完整guard与down/up |
| 定向静态 | `rollout-lint`、`rollout-contract-typecheck`、`rollout-domain-typecheck`、`rollout-format-final` exit 0；两 HTTP proof helpers 的 `rollout-proof-helpers-lint` exit 0 |

上述名称均位于本目录，对应 `.log` 原文和 `.json` 命令/退出码；未覆盖全仓最终检查。所有权 SHA 快照见 `rollout-owned-source.json`，共享 index/SPEC 仅有已授权小改。

## HTTP 证明的接口与范围

`payment-rollout-guard-proof.mjs` 导出 `verifyRolloutGuards({context,excluded,capability,healthPolicies,check,paymentClient})`，由 health_runtime 的真实 HTTP runner 调用：第一次只伪造 loadContext 比例读投影；第二次额外将已经实际查询为 false 的单个 admission 结果改为 true。全部真实写入、outbox 与 COMMIT/trigger 保留，要求 beginCreate 单独拒绝或原 receipt 函数报23514、资金调用0、所有订单/回执/历史计数回滚。

`payment-rollout-publish-fixture.mjs` 导出 `publishClosedPaymentRollout({context,check})`。仅在独占 TEST DB 复制原配置到新 DRAFT，创建七语言新 translation + 独立模拟 review，然后 VALIDATED→PUBLISHED、原版 SUPERSEDED、新 audit/publication/head/outbox 同事务提交。原已发布 provider/rule/translation/review/scope payload 哈希不变；账户保留，规则 UUID 更新、双比例0。此夹具不构成 P5-05 真实管理发布服务，也不假称模拟 review 是真人审阅。

**真实集成已通过并读回核对**：`rollout-http-2026-09-21T18-28-05.419Z/protocol-results.json` 与同目录 `run-result.json`，整轮6104断言，其中业务343、setup5761。真实 PG/HTTP/TLS TEST PSP、七语言和两个 API 实例。beginCreate 单独拒绝1次；额外伪造 admission 后 beginCreate 完整执行1次，原 receipt 约束在真实 COMMIT 拒绝23514一次。health 单安全探测1次。

比例0新发布 version2/ruleVersion2 已真实提交，旧 payload 保持不变；旧原key跨实例回放与 UNKNOWN 原账户 reconcile 成功，新checkout拒绝。最终 PSP payments=1、createCalls=1、reconcileCalls=1、captures=0，无第二次创建。证据明确 `actualMerchant:false`。发布夹具曾实际触发23505（单PUBLISHED唯一约束）及23514（head version需+1）；已按原约束修正事务语句顺序与head版本递增，失败轮日志由 health_runtime 保留，未修改任何生产约束。最终源码 SHA 见刷新后的 `rollout-owned-source.json`；`rollout-format-accepted` exit0。

## S.U.P.E.R 自检

1–2：合同、规则、SQL准入、迁移和两类独立测试证明各负单一责任。3–4：纯 Domain 仅依赖 contracts，没有 Node/PG/网络反向导入。5–6：内部边界 Zod/schemaVersion，决策可JSON序列化。7：产品无新增国家、金额、密钥、路径或客户 seed；算法常量固定版本，测试身份/环境只在测试夹具。8：本灰度无新依赖；conformance 的 testing devDependency 另由root统一lock。9：Domain/PG各实现同一冻结v1语义，可替换实现但不可静默改变v1结果。10：本子任务有限静态、单元、真实PG与完整HTTP集成均已PASS；root仍负责全仓合并候选检查与非作者最终复核，不以本报告代替全任务验收。

外部 PSP sandbox、真实小额/退款、staging/生产灰度、人类审核等真实证据仍由原任务门验收；本报告不批准资金、云apply、Git push 或生产发布。

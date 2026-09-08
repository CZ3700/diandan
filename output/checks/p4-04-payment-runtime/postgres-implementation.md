# P4-04 PostgreSQL 实现与验证范围

本报告是后端定向交付记录。实际 API/独立 TEST PSP 恢复协议、P2 门及完整仓库验收由 root/e2e 汇总；本报告不把定向验证当成 P4-04 完成或 LIVE 支付上线。

- 内部 `payment-runtime-internal.ts` 与 `persistence-port/payment-runtime.ts` 定义可序列化、严格版本化的 9 个仓库方法。首次合同冻结 `internal-contract-freeze.json` 为历史；root 后续追加了仅用于 UNKNOWN 恢复的可选加密 action。
- `payment-runtime-repository.ts` 统一解析与安全事务错误；data/config/context 读取真实 Cookie 归属、既有订单、当前发布路由及预占；write 原子首次回执/attempt/order 绑定/history/outbox；fence 从持久行核 generation、lease、phase、完整冻结命令；recovery 只恢复原 attempt；evidence 只写真实认证审计、provider event、association 和必要交易 ledger。
- `paymentRuntimeTransactionManager` 与 cart/idempotency/outbox 共用同一个 SERIALIZABLE client。PSP/KMS 在 Application 的事务之外调用。首次同 key/hash 的竞态返回 STALE_CLAIM，不再次返回可 dispatch 的旧 claim；不同 hash 返回 IDEMPOTENCY_CONFLICT。
- `0026` 追加永久创建回执、恢复操作和对账回执三表。已提交 dispatch 不能使用“尚未调用 provider”的旧取消/过期通道。CREATED 原 quote/预占失效时先以 NETWORK_UNCERTAINTY 转 UNKNOWN，随后仅 reconcile 原账户/键，不重建订单、续预占或把 NOT_FOUND 当失败。
- 唯一旧函数扩展是 UNKNOWN → REQUIRES_ACTION：必须 AUTHENTICATED_RECONCILE 且存在合法加密动作；其它原 158 行检查保留，down 恢复原函数。0001–0025 migration 文件未改。可信 SUCCEEDED 只写证据、必要真实 CAPTURE ledger 和 EVIDENCE_PENDING，未写 attempt SUCCEEDED/order PAID；财务聚合闭环仍属 P4-05。
- 8 个历史 probe 只追加正常空 0026 down → 0025 后原有退库链/拒退/历史比较，完整 up 终点更新 26；新 payment rollback helper 对 30 表仅输出 count/SHA，付款历史存在时 direct SQL 与正常 runner 均须拒退。其实际有数据证明由 HTTP 协议调用。

## 已执行的定向证据

固定命令前缀：`mise exec node@24.20.0 -- corepack pnpm`（Node 脚本用 `mise exec node@24.20.0 -- node`）。

| 范围                  | 命令/原始记录                                                                                                                                                                                     | 结果与边界                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 内部合同              | `internal-contract-*-red.log` / `internal-contract-final-green.log`                                                                                                                               | 首版 9 tests GREEN；binding/actions/adapter/delay 的有效 RED 保留。缺模块、错误 import 的历史日志不当作业务 RED。                                                                                                                         |
| PG 定向与 composition | `--filter @fan-support/persistence-postgres test src/payment-runtime-{repository,migration,evidence,recovery,action}.test.ts src/postgres-persistence.test.ts`；`postgres-scoped-final-tests.log` | 6 files / 42 tests PASS；含同 key race、过期 lease、原资源失效只 reconcile、回执与原子 history/outbox；模拟边界测试不冒充真实事务证明。                                                                                                   |
| PG 类型/构建          | `postgres-scoped-final-types.log` / `postgres-action-build.log`                                                                                                                                   | 完整 PG package tsc/typecheck、生产 build exit 0。                                                                                                                                                                                        |
| 格式/lint             | `postgres-scoped-final-format.log` / `postgres-final-lint.log`                                                                                                                                    | 新模块、composition、定向脚本与 8 个兼容 probe 全范围 exit 0；之后两个历史 helper 仅修正新增断言的报告计数。                                                                                                                              |
| 全新迁移往返          | `scripts/postgres-integration.mjs --write-catalog`；`migration-catalog-action.log`                                                                                                                | 实际临时 PG：26 migrations / 168 tables up/down/up PASS；manifest/catalog 已正常生成。                                                                                                                                                    |
| 实际 SQL 参数         | `scripts/postgres-payment-runtime-parameters.mjs`；`postgres-route-arrays-green.log`                                                                                                              | 37 条实际源码查询 PREPARE + 原 domain-array driver 行为 PASS；输出计数 39 为显式计数器，另含 3 条源码 cast 绑定检查。无完整商户/checkout fixture。                                                                                        |
| UNKNOWN 动作恢复 SQL  | `scripts/postgres-payment-runtime-action-guard.mjs`；`postgres-recovered-action-guard-red-2.log` → `...-green.log`                                                                                | 实际原 mutation 函数/真实 CHECK 的隔离 LIKE 表：旧合法动作 23514 有效 RED → 10 assertions PASS；CREATE_RESULT、VERIFIED_WEBHOOK、无 action、无 audit 仍拒绝。LIKE 不含完整 provider FK/延迟 evidence/outbox，因此完整真实性须 HTTP 另证。 |
| 独立源码复核          | read agent 消息                                                                                                                                                                                   | 最新函数提取比较仅一个 UNKNOWN 条件变更；down 原体完全一致；8 个迁移头适配保留旧门。未把非作者只读复核当重跑结果。                                                                                                                        |

真实发现及历史失败全部保留：0026 最初错误使用未安装的 pgcrypto `digest`（42883）已改为仓库内置 `sha256`；SQL 收集器最初误把 NOT EXISTS 片段当完整语句（42601）仅属 probe；action probe 首个 42P08 是 TEST 参数隐式 domain 推导，修正后得到有效旧 guard 23514。第一次正常 HTTP CAPABILITIES 503 的确定映射问题是 node-pg 将 country/market/currency 自定义 domain[] 读成字符串；`postgres-route-arrays-red.log` 已真实复现，产品只将 ARRAY 元素显式 `::text`，没有替换实际值或放宽 schema。

## S.U.P.E.R 与收敛

| #   | 实证                                                                                          | 状态                     |
| --- | --------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | 合同、读事实、配置、历史写入、fence、恢复、证据各为独立模块                                   | PASS                     |
| 2   | begin/settle/reconcile 各执行一个原子持久化职责，外部 PSP/KMS 无侵入                          | PASS                     |
| 3   | Application → Port → PG；PG 使用既有纯内容 canonical helper                                   | PASS                     |
| 4   | 新 factory 只向内部 helper 单向依赖；完整 package tsc 已过                                    | PASS（完整门另验）       |
| 5   | 9 个跨模块入参与返回使用新严格 Zod/schemaVersion                                              | PASS                     |
| 6   | Port 只传 JSON 安全记录和加密 envelope；Buffer 只在 SQL adapter 内                            | PASS                     |
| 7   | 账户、规则、locale、价格、URLs/keys 取真实配置或冻结命令，TEST 常量只在 fixture               | PASS                     |
| 8   | 无新增生产依赖；PG 复用已经声明的 content/contracts/port/pg；TEST TS 编译器由根工作区显式拥有 | PASS                     |
| 9   | 新仓库经独立 manager 接入；provider、KMS 和队列通过原端口替换                                 | PASS                     |
| 10  | 本报告定向门全绿；当前真实 HTTP 第二轮与原全仓门尚未全部完成                                  | PENDING，不能据此标 DONE |

已按 code-simplifier 对最近模块做小范围可读性审查；事务与证据分工已有明确边界，没有为减少行数重构正在真实验收的实现。剩余主要风险是完整真实提交/恢复约束交互、独立 PSP 崩溃窗口、实际历史拒退及后续 P4-05 聚合应用；本地 TEST 证据不等于 PSP sandbox/LIVE 商户验收。

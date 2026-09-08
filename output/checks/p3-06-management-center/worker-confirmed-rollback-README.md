# 发布事务明确回滚后的任务失败记录

root 的真实 runtime 4 已观察到媒体三个 job 成功、preparedMedia 完整，而最终发布校验失败后 operation 仍为 RUNNING 等租约。本文仅记录针对任务失败呈现的 Application 修复，不替代 directory 的实际读取时钟根因修复，不宣称 runtime 已通过。

## 最小处理边界

仅在最终 publication + complete 事务拒绝时处理真实 `PersistenceTransactionFailureError`：`INTEGRITY_VIOLATION`、`TRANSACTION_ABORTED`、`UNEXPECTED_ADAPTER_FAILURE` 且非 `RECONCILE_REQUIRED`，在新的事务中调用原 `operations.fail`。该仓储重新验证当前 lease fence 和实际权限；提交确认且返回同 operation 的 FAILED/PUBLICATION_FAILED/retryable 才向运行器报告 FAILED。

`UNEXPECTED_ADAPTER_FAILURE` 的依据不是错误文本或猜测。新 PG 单元测试实际调用仓库的 `createTransactionRunner` 与 `createResourceRun`：纯校验异常先回滚 savepoint、再完整 ROLLBACK，才以该类型抛出。相反，COMMIT 抛普通错误或 SQLSTATE 08006，即使后来执行清理 ROLLBACK，仍被现有 runner 映射为 `TRANSACTION_OUTCOME_UNKNOWN` / `RECONCILE_REQUIRED`。本轮没有修改这一分类或事务执行器。

未知提交、普通 Error、伪造 code 的普通对象不写 FAILED。claim 阶段异常不进入最终发布失败处理。新失败记录遇撤权或自身提交未知仍返回 UNAVAILABLE，不重复发布，不声称已记录失败。未增加非必要诊断 callback。

## 作者证据

- `worker-confirmed-rollback-red.log` 是最初测试构造记录，其中 TRANSACTION_ABORTED fixture 漏了既有合同必需的 retryAfterMs，不能全计为有效产品 RED。
- 修正测试对象后，`worker-confirmed-rollback-valid-red.log`：**5 FAIL / 15 PASS**，分别覆盖三类明确回滚及新失败记录的撤权/未知提交。
- `worker-confirmed-rollback-green.log`：**20 tests PASS**，保留原 11 个编排测试。
- `worker-transaction-outcome-contract.log`：实际 runner / resourceRun 的 **3 tests PASS**；使用受控 TransactionClient，无真实数据库服务。
- `worker-confirmed-rollback-format.log`、`worker-confirmed-rollback-lint.log`：exit 0。
- `worker-confirmed-rollback-types.log`：Application 全类型检查被 root 正在编辑的 `management-media.test.ts` 第 36 行 union fixture 阻断，本方新增代码没有报错。后续以 root 统一类型/构建结果为准。
- `worker-confirmed-rollback-pg-types.log`：PG 全类型检查 exit 0。

directory 已只读独立复核 ACCEPT：最终事务 catch 范围、重新 fence、错误分类和未知提交边界均保持；其未重复测试，不能将此复核标为真实 PostgreSQL COMMIT 集成证明。

改动仅 `packages/application/src/management-center.ts`、对应测试与新增 `packages/persistence-postgres/src/management-center-operation-rollback-outcome.test.ts`。无合同、数据库结构、未知提交规则或实际权限放宽。

S.U.P.E.R 补充：新增私有 helper 只负责将已证明回滚记录为安全失败；依赖仍为 Application → Port，无新依赖、配置或序列化对象。其余九项沿用 `backend-super-review.md` 的范围结论，**第 10 项仍 PARTIAL**，真实运行、整仓与人工验收不在本记录中冒称通过。

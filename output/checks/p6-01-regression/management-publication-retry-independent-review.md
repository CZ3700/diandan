# P6-01 发布事务有限重试独立复核

Reviewer `/root/regression_readiness`，2026-09-23。范围：`packages/application/src/management-center.ts` 与对应测试的已确定中止发布事务重试；作者为 `/root/regression_coverage_audit`。本 reviewer 不改作者源码，不启动真实服务/PG/浏览器；真实新实例冷启动与最终套件仍由 root/journey 验收。

## 已确认的 port 前提

`transaction-runner.ts` 对 COMMIT exception 先尝试 ROLLBACK，再由 `transactionErrorFromCommitFailure` 分类：SQLSTATE40001/40P01 映射 typed `PersistenceTransactionFailureError`、`TRANSACTION_ABORTED`、`RETRY_SAME_COMMAND`。连接失败/未知COMMIT报错或无法验证的提交结果映射 `TRANSACTION_OUTCOME_UNKNOWN` / `RECONCILE_REQUIRED`。resolved COMMIT 的 command=ROLLBACK 也只返回明确ABORTED，不当成成功。事务结束后 finally release client；外层应用在该 promise reject 后的delay位于锁释放之后。

原 `transaction-runner.test.ts` 实际独立 **59/59 PASS**，包括 callback已返回成功但COMMIT40001，以及08006/未知结果等反例。命令：`mise exec node@24.20.0 -- pnpm --filter @fan-support/persistence-postgres exec vitest run --config ../../vitest.config.ts --root . src/transaction-runner.test.ts`；日志 `management-retry-port-review-node24.txt`。首个未显式Node版本的命令被engine gate拒绝（shell Node26），没有执行测试；原失败保留于`management-retry-port-review.txt`，没有放松engine规则。

## 最终应用源码独立结论：ACCEPT（限定范围）

作者提交稳定源码后已完整审阅diff，并独立执行 `mise exec node@24.20.0 -- pnpm --filter @fan-support/application exec vitest run --config ../../vitest.config.ts --root . src/management-center.test.ts`：**33/33 PASS**，日志 `management-retry-application-independent.txt`。未发现本增量剩余明确P1/P2。此结论不是实际PG/冷启动/完整P6验收。

- 新helper只包围最终“loadClaim→publish→complete”的单事务；claim与media.prepare仍各一次，非空preparedMedia被原schema解析后复用，不重新做对象存储/图像处理。
- 最多3次总尝试；`instanceof PersistenceTransactionFailureError`、`code===TRANSACTION_ABORTED`、`recovery===RETRY_SAME_COMMAND`三项必须同时满足。每次失败promise结束后才按port retryAfterMs在事务外等待；固定上限没有新配置面。
- 新事务重新执行原loadClaim和schema/intentHash/operationId/leaseTokenDigest校验；PG adapter的fenced加载继续要求RUNNING、精确token、livelease和current delegation。重新加载拒绝时停止，不能继续发布或把旧lease强行标失败。
- 确定COMMIT abort，即使回调内publish和complete都已执行，仍整段从新loadClaim重跑；单元提交模型证明成功提交只有一次。未知COMMIT/不明异常不loop；原recordRolledBackPublicationFailure行为没有扩大，耗尽3次后只进行原有一次fenced失败记录。
- statement abort、两次COMMIT abort后第三次成功、三次耗尽、锁外等待800ms、四类重新加载失配、unknown/integrity/unexpected/plain-object异常、claim/media异常均有实际轻量反例；原target conflict与receipt一致性检查保留。

作者RED日志为 `management-publication-retry-red.txt`（作者报告7FAIL/26PASS）；作者另报告management+media36PASS及format/lint/typecheck/build完成，本review只独立认领上述33应用+59port实际测试和源码检查，不冒领作者执行。公共合同、迁移、配置未修改；本review未改作者文件。

最终hash：

- `packages/application/src/management-center.ts`：`ac078074b7941cc48d6fae913a90901118e3717ee242a36a35db3f2f94ee475e`
- `packages/application/src/management-center.test.ts`：`3432463d83a87d1a64b5b691ef593f6635f1440eabcade7057dd37112d365959`

**真实PG冷启动、唯一持久效果与完整P6-01五组验收仍PENDING**；不能从mock提交模型推断真实全链已通过。后续真实运行消费这两个hash后，root再登记实际结果。

## 后续媒体修复的共享helper增量

本报告原ac078074版本的局部ACCEPT保留为原时点。随后新的真实media SELECT40001促使root批准共享内部retry helper，center逻辑仅将同等门和loop移入`management-transaction-retry.ts`，当前center hash为`5d013bb31c73b38c475b57f831f5e123e43ad74779e86efae72b6525b5e80274`，helper为`eeb7dec0dd0073d555f893ea4a41d62d2a6fccffdc5f614c48d8683c5efd9c31`。本review已对新版本独立再审并实际跑center+media **54/54 PASS**（center原33测试未改）；详见`management-media-retry-independent-review.md`。当前输入应绑定这一增量hash，不能沿用原center hash声称最终源码未变。publication的3次/确定abort/unknownCOMMIT门无变化；fullGate继续PENDING。

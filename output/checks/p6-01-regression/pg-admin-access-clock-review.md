# P6-01 管理登录锁等待与数据库过期诊断

2026-09-23，owner `/root/regression_readiness`。只针对 `postgres-admin-access.mjs`，未运行完整 PG 链。

## 原失败与复现

- 原全链日志 `pg-full-precheck-1.txt`：database-clock expiry，checks=109，`claim waiting for lock rechecks database expiry` ASSERTION。原脚本未记录实际响应。
- 诊断副本 `pg-admin-access-clock-diagnostic.mjs` 完整保留原脚本 TTL、30ms 余量、锁等待与严格断言；仅改相对 import 并追加脱敏 code/kind、时间差日志。独立 `withEphemeralPostgres` 创建/迁移/销毁新库，不读写业务数据；父流程捕获失败后完成原 finally 清理。
- `pg-admin-access-clock-diagnostic-1.txt` 再次 FAIL：等待请求 27.666270 秒，host monotonic 实际 27.669161 秒，放锁前数据库 `expires_at - clock_timestamp()` **+0.041453 秒**；真实返回 LOGIN_CLAIMED，持久化 `claimed_at - expires_at` **-0.038179 秒**。
- 因此此次未满足“锁后数据库已经过期”的测试前提，成功 claim 仍在有效期内。精确机制是把一次 PG 时钟采样换算成另一时钟域的固定 host delay，并未再确认 PG 期限；本次证据不进一步声称是 VM 调时、漂移或具体主机根因。

## 产品只读复核

`admin-access-repository.ts` 先 `SELECT ... FOR UPDATE` 获锁，然后另一 SQL 的 materialized `clock_timestamp()` 判断 `created_at <= now AND expires_at > now` 并记同一 `claimed_at`。当前成功记录比数据库期限早 38.179ms，与实现相符。事务隔离 SERIALIZABLE，没有额外配置 statement/query timeout。未发现生产过期判断错误；未改 repository / migration / 合同。

原脚本 SHA-256 `2df52ee7879a54810e01602b7be15d82fc1f490176058235e60921bda6452bf6`；生产 repository SHA `98ba37cfede075ed0e4019ff8d7f91e2d3e256200caa1f3792bfe0683793d5a1`。

## 已批准的最小修复与真实 GREEN

root 在读到上述精确诊断后批准仅修改原脚本。claim 与同模式 revoke 锁后过期测试仍使用原 TTL、真实锁竞争证明、原 30ms 余量及严格拒绝响应；改为最多 60 秒 monotonic 有界的只读 PG clock 条件轮询，确认 `expires_at + 30ms <= clock_timestamp()` 后才放锁。host timer 只决定下次轮询，不作为过期证明。空 deadline / 非有限数字 / 超时直接 FAIL，不重新创建挑战、不写期限、不接受 LOGIN_CLAIMED、不重试被测事务。失败诊断仅保留固定 scenario、code/kind 与安全时间差数值；其中 databaseRemainingMilliseconds 包含原 30ms 余量。

- 首轮 lint 在 PG 启动前拒绝未显式 import 的 Node `performance`（`pg-admin-access-clock-lint.txt`），补 `node:perf_hooks` 后通过；保留该日志，无门槛调整。
- `pnpm exec prettier --write packages/persistence-postgres/scripts/postgres-admin-access.mjs` 与同路径 `pnpm exec eslint` 第二轮 PASS：`pg-admin-access-clock-format-2.txt` / `pg-admin-access-clock-lint-2.txt`。
- `node packages/persistence-postgres/scripts/postgres-admin-access.mjs`：另一个 owned Docker 新库实际 **PASS，原 115 checks 全部保留，exit 0**；`pg-admin-access-clock-green-1.txt`。helper 自有容器按原 finally 和 ownership labels 清理。未启动浏览器或全 PG 链。
- 最终脚本 SHA-256：`1c08aef69d8f2425c6410e56ad8a4aa9014c8c1e4c2ab42b9e92563a43d401ca`。生产 repository 的前述 hash 未变；无迁移/合同/锁文件改动。
- 非作者 `/root/regression_coverage_audit` 已收到该最终版本，独立结论待其写回；此报告不自我授予独立 ACCEPT。

完整 P6-01 最终门仍 PENDING；此次失败不能被下游 HTTP/browser PASS 代替。

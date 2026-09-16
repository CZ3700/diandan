# P4-06 expiry persistence delivery

状态：独占实现与实际验证完成；全仓库综合门禁、进度登记和提交由 root 统一处理。

## 最终证据

- `output/checks/p4-06-commerce-expiry/run-2026-09-16T02-31-05.164Z/`：PASS 6105 assertions，其中既有正常建品/价格/库存/TEST PSP 初始化 5763，新验证 342；18 个选定 source/dist/SQL/harness 输入前后 SHA 完全相同。
- `output/checks/p4-06-commerce-expiry/action-2026-09-16T02-31-05.164Z/`：PASS 5843 assertions（含初始化），10 个选定输入前后 SHA 完全相同；`observation.json` 和 `deadline-boundary.json` 记录真实修复结果。
- `expiry-recovery-regression.log`：7 个受影响测试文件、54 tests PASS；`expiry-recovery-typecheck.log`、`expiry-recovery-lint.log` 通过。
- `psp-expiry-red-diagnostic.log` → `psp-expiry-green.log`：真实 HTTPS/PG TEST PSP 原生 EXPIRED 从 HTTP 400 RED 到 HTTP 303 GREEN，认证查询与签名 webhook 一致、无新增 capture。

## 行为与锁序

`commerce-expiry-repository/data/inventory` 实现冻结的 CommerceExpiry port。每个 cart 使用独立 READ COMMITTED 事务，先锁 cart，再以 SKIP LOCKED 取得 order/attempt；之后锁 intent/session，按稳定库存维度顺序调用既有库存 domain/repository。事务开始时已到期的安全子集才可处理，写入还以真实 PG clock 重验。不删除历史，不清除私密密文。

ACTIVE cart/intents 到期转 EXPIRED。无 attempt 或明确 FAILED/CANCELED/EXPIRED 且 quote 到期时，order/intents 取消、cart/session 过期。CREATED/REQUIRES_ACTION/PROCESSING/UNKNOWN/SUCCEEDED 禁止取消；仅 UNKNOWN 的真正到期 reservation 可以过期。token/session 的 ACTIVE 到期行转 EXPIRED，并写通用审计。

实际 PostgreSQL 验证了提交前异常回滚、重复清理、两种 webhook 争锁顺序、CREATE/reconcile 并发、token/session/active cart/intent 到期。cleanup 先取得锁时，SERIALIZABLE apply 实际返回 40001；同 canonical event 重试后资金保留 PAID、履约 ON_HOLD、库存不二次扣减。webhook 先取得锁时清理返回 BUSY，重试读取已提交库存。CREATE 并发安全返回 409 CART_EXPIRED，无新 attempt/PSP 调用。未观察到 40P01。

## 实际发现并修复的支付恢复缺陷

`action-2026-09-16T02-20-34.659Z/` 保留真实 RED：UNKNOWN hold 到期清理后，旧 reconcile 仍恢复可支付 REQUIRES_ACTION；之后真实 capture 已存在，但 apply 返回 LATE_SUCCESS_REQUIRES_UNKNOWN_ATTEMPT，订单仍 PENDING。

窄修仅在 `payment-runtime-recovery.ts`：UNKNOWN 恢复 REQUIRES_ACTION/PROCESSING 前重验原 quote、intent、reservation；资源失效则仍记录可信 OBSERVED，保持 UNKNOWN。实际 UPDATE 再检查 clock 和完整原资源条件，只有真正 RETURNING 1 行才写状态历史。FAILED/CANCELED/EXPIRED 与 SUCCEEDED 证据不经过该资源门禁。既有 claim 已锁 operation 和 order/attempt，新增只在已持 order 后锁 intent/reservation，不反向取得 cart。

新增 unit RED 为 3 FAIL/6 PASS，随后 GREEN。真实 GREEN 保持 UNKNOWN/无 action；后续 capture 最终 SUCCEEDED/PAID/ON_HOLD，capture=1、库存扣减=0。另一真实边界用 Promise/SQL 调用暂停，在 readiness 成功后等待真实 quote 到期再执行 UPDATE，得到 RETURNING 0、UNKNOWN/无 action/无 capture；未改墙钟或期限字段。

## 独占变更文件

- 新增 `packages/persistence-postgres/src/commerce-expiry-{repository,data,inventory}.ts` 与 repository/inventory 两个测试文件。
- 新增 `packages/persistence-postgres/scripts/commerce-expiry-fixture.mjs`、`commerce-expiry-action-probe.mjs`。
- 窄改 `packages/persistence-postgres/src/payment-runtime-recovery.ts`、`payment-runtime-action.test.ts`。
- root 授权的 TEST PSP 三文件：`apps/api/scripts/payment-runtime-psp-{store,server}.mjs`、`payment-runtime-psp-http.test.mjs`。
- 合同、Application、中央 wiring、0029 migration 均由其他 owner 修改。

## 可重复命令

依赖编译完成后运行，集成会自建并清理独立实际 PostgreSQL、TLS S3 和独立 TEST PSP：

```sh
mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/commerce-expiry-fixture.mjs
mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/commerce-expiry-action-probe.mjs
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres exec vitest run --config ../../vitest.config.ts --root . src/payment-runtime- src/commerce-expiry-
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres typecheck
```

## 边界与检查

使用仓库拥有的 TEST PSP，不代表真实商户 PSP sandbox、真实扣款、staging 或生产发布。所有订单、capture、状态与库存均来自正常后台/API/验签 webhook/认证 reconcile；测试 SQL 仅观察事实，时序注入只在真实事务提交前/条件 UPDATE 前暂停。早期运行失败日志全部保留，未覆盖或删除。

独占实现 S.U.P.E.R 1–10 检查通过：职责分为扫描/聚合、审计/状态写入、库存桥接、验证器；依赖沿合同/domain/port/adapter 单向；边界 Zod+schemaVersion/JSON；无新增业务依赖或生产常量；PG adapter 可替换；定向 tests、类型、lint、format 和实际集成通过。全仓库最终 check 由 root 单独执行。

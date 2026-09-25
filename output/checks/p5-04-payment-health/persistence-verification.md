# P5-04 持久健康闭环验证

本地 TEST 范围；子任务 owner `/root/health_storage`。不代表实际 PSP、生产健康阈值、staging、灰度或整个 P5-04 DONE。普通付款事务隔离级别/连接池行为保持；新健康事务使用现有池中独占连接和 READ COMMITTED + account→state 行锁。

## 交付边界

- 0033 新增 policy/state/observation 三表；policy 以 account/environment/version 不可变保存，state 显式引用当前 policy，首版 initialize 不允许隐式切换版本。观测保留 policy_version；业务启停与 route publication 不由健康仓储修改。
- 原 account.health_status/version 和原有连续 append-only health events 继续为唯一健康真相，只有实际状态转移写旧账户。技术故障使用固定窗口，非技术结果不累计/不清除，OPEN 普通成功不恢复。
- 全局 observationId 的 canonical JSON/hash 去重、相同 ID 内容冲突拒绝；同账户跨实例行锁、同事务方法队列均有真实 PG 证据，防止两条并行 observation 丢计数。
- 只使用已保存并经 PG 当前 published route/account/environment/config/rule/scope/locale 校验的 GET_CAPABILITIES context；partial rollout >0 可安全探测，0/INTERNAL+LIVE 拒绝，创建资金准入仍由原与本轮灰度路径另行验证。
- due/expiry 采用 PG 时钟；claim 最多锁一个 account，再锁 state；generation、probeId、expiresAt、完整 context、account.version、policy.version 全部 fence。失败 probe 延期；旧/过期/被新故障及外部健康变化废除的 probe 不能恢复。
- 有效 probe 完成以 source=PROBE 复用 append-only observation，保存上下文、分类/allowlist code、generation/account version；成功恢复事件 request_id 精确关联 probe evidence，重放不会第二次落库。
- 健康 I/O 单独 budget：`paymentHealthTimeoutMs` 100–30000ms，默认 3000ms。获取连接、SQL、COMMIT 共用同一截止时间；超期销毁所获连接，迟到 pool 交付也立即销毁；BEGIN 后设置剩余 PG LOCAL lock/statement/transaction timeout。COMMIT 中断仍归 UNKNOWN，不宣称已回滚；普通财务操作不使用此 wrapper。

## 实际命令与结果

统一前缀 `mise exec node@24.20.0 --`。

| 命令 | 实际结果与证据 |
| --- | --- |
| `corepack pnpm --filter @fan-support/persistence-postgres build` | 最后行为 build exit0；`persistence-build-agent-4.log`。之后仅 lint 的 let→const/Node timer import 及独立复核明确的 SQLSTATE 25P04 allowlist 补充；root 最终统一构建待执行。 |
| `node packages/persistence-postgres/scripts/payment-health-postgres.mjs` | exit0，85 checks，含逐 SQL PREPARE、实际 PG+两个应用实例、partial published config、失败/恢复、版本历史、响应丢失、同事务并发和实际锁阻塞超时；`persistence-postgres-6.log`。 |
| `node packages/persistence-postgres/scripts/payment-health-ddl.mjs` | exit0，0032 之后 0033 空 up/down/up；`persistence-ddl-2.log`。有健康历史时 down 拒绝在上述85项中验证。 |
| `corepack pnpm exec vitest run --config ../../vitest.config.ts --root packages/persistence-postgres src/payment-health-client.test.ts src/postgres-persistence.test.ts` | exit0，26 tests；`persistence-affected-tests.log`。包含迟到获取、永不 settle query、总 budget、COMMIT UNKNOWN、释放仅一次。 |
| `corepack pnpm exec eslint packages/persistence-postgres/src/payment-health*.ts packages/persistence-postgres/src/postgres-persistence.ts packages/persistence-postgres/src/index.ts packages/persistence-postgres/scripts/payment-health*.mjs` | exit0，`persistence-lint-final.log`。 |
| `corepack pnpm exec prettier --write`（以上 owner 文件） | exit0，当前文件已格式化。全仓统一门由 root 执行，未冒称全包 tests 或全仓 check 已完成。 |

## 保留的失败与修复

1. `persistence-red-verified.log`：真实 PG 到0032后新manager undefined，实施前 RED。
2. `persistence-postgres-1.log` / `persistence-ddl-1.log`：新 SQL JSON `->` 与删除键操作的优先级错误，显式括号修复；后续完整迁移与空往返通过。
3. `persistence-partial-red.log`：真实 published rollout=5000 已证明，旧=10000 health context 规则拒绝；修为只读 >0，后续85项通过。
4. `persistence-postgres-3.log`：固定 Node sleep 后 PG lease 尚未到期。没有修改生产期限或伪造 DB 时间，测试改为有界轮询实际 PG due/expiry；尚未将本次具体失败归因于未取证的系统时钟原因。
5. `persistence-concurrent-red.log`：同事务 Promise.all 两观测计数为2而非3；仓储方法顺序队列修复，真实PG通过。
6. `persistence-postgres-5.log`：root 新0034尚未同步manifest时迁移入口失败；同步后通过，非健康逻辑失败。
7. `persistence-timeout-unit-red-verified.log` 4 RED / `persistence-timeout-postgres-red.log`：旧健康 I/O 在实际账户锁阻塞时无默认deadline而继续写入；wrapper与PG期限后26单测/85PG通过。首条 unit RED 命令相对config路径写错保留在 `persistence-timeout-unit-red.log`，不计行为RED。
8. `persistence-timeout-code-red.log` 明确25P04未分类的1RED/4PASS；实际PG触发证据 `persistence-timeout-code-postgres.log` 确认transaction_timeout=25P04，局部allowlist补充后5tests GREEN（`persistence-timeout-code-green.log`），未改全局errors；最后lint `persistence-lint-post-timeout-code.log` PASS。
9. TypeScript品牌类型、UPDATE误加参数及 Node globals/prefer-const lint 修正均保留对应 build/lint 日志。

## S.U.P.E.R

| # | 检查 | 结论 |
| --- | --- | --- |
| 1 | 文件职责单一 | PASS：client截止时间、data/事件、context资格、probe fencing、repository入口分别负责。 |
| 2 | 函数职责单一 | PASS：无 PSP/KMS 调用，事务只处理持久状态。 |
| 3 | 依赖单向 | PASS：adapter依赖 contracts/domain/port，不反向依赖应用/UI。 |
| 4 | 无新循环 | PASS：仓储内部仅独立helpers；root全仓图检查待统一。 |
| 5 | schema定义边界 | PASS：所有入口/返回使用冻结PaymentHealth schema/port。 |
| 6 | I/O可序列化 | PASS：timestamps/IDs/counters/枚举，原有交易runner继续阻止非JSON返回。 |
| 7 | 无正式环境硬编码 | PASS：业务策略外置版本化；3000ms是允许覆盖的基础设施安全默认；fixtures全为本地synthetic。 |
| 8 | 依赖显式 | PASS：只用已有Node/pg/contracts/domain/content/port，不增加包。 |
| 9 | 可替换 | PASS：应用消费port，新持久实现无需修改Domain/UI；旧账户/支付合同保持。 |
| 10 | 受影响验证 | PASS：26 tests、85真实PG、0033往返、lint；全仓最终组合检查由root补齐，不提前DONE。 |

## 文件指纹

以下为子任务交接时快照，不替代 root 完成0034与整合后的最终指纹。全部15文件见 `persistence-source-snapshot.json`。

| 文件 | SHA-256 |
| --- | --- |
| `database/migrations/0033_payment-provider-health.up.sql` | `d8b6f04119b7406f3a6383d66f79a9df125798d9633e7121131204d39cc30bab` |
| `database/migrations/0033_payment-provider-health.down.sql` | `dce0648e0a70cadc3d71fbad09523eaa362f900d3e9fbff91df53861014136ed` |
| `database/migrations/manifest.json` | `26b02679b691fb5c78ba1945d9abed036df92eb366ae04c173237c3db3622f9c` |

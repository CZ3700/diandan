# P4-04 Application 与公开支付边界独立复核

复核者 `/root/storefront_read`，2026-09-09。只读检查 root 的 Application、public/config contracts、恢复 lifecycle 及作者测试；没有修改这些源码、启动服务或重复测试。本人的 storefront UI 和 `payment-runtime-evidence.ts` 不在非作者结论范围。

**结论：当前 Application / public boundary 有界 ACCEPT，未发现必须先修的确定性阻断。实际 PostgreSQL / 双 TLS / 浏览器整链仍待集成，不能据此标记 P4-04 完成。**

## 核对事实

| 范围 | 实际代码与结论 |
| --- | --- |
| 重复 create | `packages/application/src/payment-runtime-create.ts:29` 先按 Cookie 授权读取永久 receipt，再比原命令 hash；已有 receipt 仅重新授权读 attempt。不会因配置已变而创建新 attempt。新建路径先确认当前 readiness / 配置 / 路由 / adapter capability，随后 `:166` 才提交持久 claim。 |
| PSP 身份与语言 | `payment-runtime-create.ts:108` 的 attempt UUID 同时固定 merchantReference/providerIdempotencyKey；金额取旧 quote，order 与 requestedLocale 取不可变 checkout，return/cancel URL 由配置 origin 和该 locale 构造。界面 locale / 国家不能重写冻结订单语言。`payment-runtime-execution.ts:43` 按持久 providerLocale 映射校验 create 返回，保持原身份。 |
| 外调用与未知结果 | `payment-runtime-execution.ts:35` 在持久 claim 后才调用 provider，KMS 也在事务外；create 响应损坏、异常或加密失败落 NETWORK_UNCERTAINTY。`payment-runtime-context.ts:37` 只重试真实 TRANSACTION_ABORTED 的数据库 callback，最多两次；UNKNOWN COMMIT 向上返回 UNKNOWN，不重跑外调用或宣称回滚。 |
| 恢复 | `payment-runtime-recovery.ts:24` 将 Cookie / attempt 授权、幂等 begin/complete 与 recovery claim 放同事务；重放只读。worker `:105` 只请求 DUE claim，CREATE 使用旧命令，RECONCILE 使用原 account / 金额 / PSP idem / audit，缺 externalReference 时保留合法缺省。返回事件再由完整 payment-port binding 与内部 reconcile schema 检查。 |
| 读与解密授权 | `payment-runtime-action.ts:106` 第一次读检查 Cookie / session / attempt；交互 action 解密后 `:127` 用原 version 再授权读取并比完整记录，任何变更拒绝明文返回。action type 与当前部署 origin 白名单仍验证。WAIT 不含敏感凭据，不需要外部 KMS。current / read 不调用 create/getPayment/reconcile；能力查询允许纯 getCapabilities。 |
| 最小公开 DTO | `packages/contracts/src/payment-runtime.ts:124` 的严格 attempt view 不含邮箱、原 PSP reference、provider idempotency、lease、密文或审计内部字段；UNKNOWN 不可重试，过期 action 与 EVIDENCE_PENDING 不可返回可执行动作。CURRENT 的 checkout/attempt 归属在 `:217` 精确绑定。服务端生成的实际 hosted action 仅在受权响应中出现。 |
| 配置与能力 | `payment-runtime-config.ts` 的七语言完整显式映射、HTTPS exact origin、唯一 account/environment registration 与有界时间参数保持；`payment-runtime-capabilities.ts` 使用已发布配置、健康/开关/商户状态和真实 adapter 能力，不从语言猜国家，不采用 provider 任意展示文字。 |
| 连续 worker | `apps/api/src/payment-runtime-lifecycle.ts:34` 单次有界顺序 sweep；失败结束当前批次但保留下次调度。stop 先停止新计时器，再 await inflight，最后 close；重复 stop 不重复关闭。 |
| API / BFF | 已单独只读核对严格 schema 后 action/session/attempt 绑定、exact action origin、固定路由、原 Origin/CSRF/idem、单 Cookie 与安全过期清除。派发后的 POST 非可信结果返回 UNKNOWN；GET 不派发恢复。页面 no-store/no-referrer/CSP 没有把回跳参数当授权。 |

## 证据与限度

- 已读 `application-expanded-final.log`：作者最新 2 files / 14 tests 通过；`provider-boundary-green.log` 的 3 tests 是其中相关边界的历史单独运行，不重复相加。`contracts-final.log` 为 75 files / 410 tests 通过。本复核没有重新运行这些命令。
- Application harness 的真实作用是验证调用顺序、事务外 KMS/provider、永久重放、首事务已提交但响应丢失、UNKNOWN、解密期间 version 变化以及 worker 无浏览器恢复。它使用内存仓储，不能证明真实 PG 的并发唯一、lease CAS、event/outbox 延迟约束或真实 KMS 密码学。
- `contract-compatibility.json` 记录 502 个旧 roots、87 个旧 paths 均无变更，当前 539 roots / 92 paths；本轮只读核该报告和新增 contract 源，没有重新生成/修改 artifact。
- PG adapter 必须兑现 `beginCreate` / `claimRecovery` 同事务的当前权限、receipt 唯一、冻结 claim 精确返回，以及 `settleCreate` / `recordReconcile` 的实际 fence。该实现仍由 directory 集成，本评审不把接口注释当实际 PG 证明。最终重点覆盖并发 create、settle COMMIT 丢响应、撤权/到期后迟到 action、重放原 event/audit 和真实 ledger。
- P4-04 的已认证财务成功仅为持久 EVIDENCE_PENDING；PAID/order/inventory 最终聚合属于 P4-05。真实 PSP 账户 / sandbox / 小额付款与正式七语批准不因 TEST 或静态通过而完成。

## S.U.P.E.R

1. 单责：入口、能力、create、执行、恢复、action 分离，未扩新结算领域框架。
2. 依赖方向：外部调用经 port；PG 负责事务事实，浏览器不提供价格/支付 authority。
3. 显式依赖：transactions、KMS、provider registrations、configuration 注入。
4. 合同：跨边界严格 versioned schema，provider 返回另做命令匹配。
5. 复用：沿既有 quote、路由决策、PSP port、canonical hash 与 idempotency。
6. 数据真相：恢复依赖持久 receipt/claim，定时器只驱动调用，不存业务真相。
7. 隐私：公开 DTO 最小；action 加密、读取后二次授权；异常只映射安全码。
8. 异常/并发：UNKNOWN 与确定 rollback 分开；晚结果交 PG fence 拒绝；不自动新建支付身份。
9. 收敛：当前职责清晰，无必须追加的重构或风格性变更。
10. 验证：上述 scoped 作者证据及非作者只读复核 ACCEPT；真实 PG/HTTP/浏览器和全仓最终门仍 PARTIAL。

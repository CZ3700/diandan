# P5-02 通知重发子线交接

2026-09-21，`/root/orders_notifications`。只完成通知子线与交叉复核；未提交、未推送、未真实发信。

## 实现与接线

- `createAdminOrderResendRepository(client, scope)` 实现冻结的 `AdminOrderResendRepository.request(AdminOrdersStoreRequest)`；同时验证 `orders.read` 与 `orders.notification.resend`、MFA/CSRF/session、订单版本和最新通知编号，按 `admin-orders:actor:action:key` 串行幂等键。
- `createAdminOrderResendNotificationRepository(client, scope)` 实现现有 `NotificationRepository`。原 `source/request` 在这个仓储中返回 `IGNORED`，只有明确授权的管理操作可建立新重发。
- `readAdminOrderNotification(client, orderId)` 返回冻结合同 `{latestNotificationId,eventType,status,canResend}`。主仓储还会将 canResend 与权限相交。
- Application 的 `createAdminOrderResendUseCases` 复用原发送流程，仅暴露 deliver/runPending。Worker 同时扫描自动通知与独立、仅存 ID 的人工重发 outbox。
- 0032 增加独立重发记录、outbox、attempt 和联系信息读取审计，不修改原 UNIQUE(order,event)、SENT 行、原 attempt 或既有财务状态。
- 每次新重发产生新的派发 ID、provider key、nonce 和安全查单链接；仅 UNKNOWN 的同一命令恢复允许使用已交换的链接。发送新链接不会主动注销已有查单 session；用户交换新链接时，沿用既有策略轮换旧 session。
- 尚未发送的旧状态会取消；未知在途重发在固定接收截止时间前继续阻挡新自动状态，截止后新自动状态可继续。旧历史不会删除或重置。

## 验证结果

所有命令使用 `mise exec node@24.20.0 --` 前缀。

| 检查 | 结果与证据 |
| --- | --- |
| 通知 PostgreSQL 定向单元 | 20/20：`pnpm --filter @fan-support/persistence-postgres exec vitest run --config ../../vitest.config.ts --root . src/admin-notification-resend.test.ts src/notification-repository.test.ts` |
| Worker 定向单元 | 12/12：`pnpm --filter @fan-support/worker exec vitest run --config ../../vitest.config.ts --root . src/notification-composition.test.ts src/reliable-events-composition.test.ts` |
| 三包 typecheck | persistence-postgres、application、worker 均通过 |
| Owned 文件 ESLint / Prettier | 通过；生产模块和夹具均已格式化 |
| 新人工重发最终真实 PG | `notification-resends/run-2026-09-21T11-08-01.216Z/results.json`：6085 checks，PASS，sourceUnchanged=true；已包含最终 identity→session 授权 helper |
| 原自动通知完整真实回归 | `../p4-06-notifications/persistence/run-2026-09-21T11-01-35.290Z/run-result.json`：6814 checks，PASS，sourceUnchanged=true |

新链路真实验证包括：已验签 TEST 支付、原自动通知 SENT、同键并发唯一逻辑任务、跨订单同键明确冲突、TLS 接受后丢响应、接收器进程重启、同一命令恢复且只增加一次接受、新链接交换、旧链接/session 行为、冷却限制、SENT 不可重置、旧状态取消、自动/人工跨链顺序、UNKNOWN 不得换新键、真实 60 秒截止后新自动状态继续、outbox 故障导致完整事务回滚、全新 Worker composition/pg-boss 从持久 outbox 读取并发送。

原自动回归额外覆盖：七种语言、COMMIT 结果丢失、过期 lease、模板漂移、receiver 有限去重窗口、Worker 消费、越南语生产构建查单页面的 390×844/1440×900、键盘、reduced motion 和 axe 0。

TDD 证据保留：第 6 轮在 UNKNOWN 旧派发仍可接受时新自动状态抢先发送用例失败；第 7 轮在跨订单同键并发明确冲突用例失败。修复后第 8、9 轮完整通过。权限基线与 Worker 双队列亦先观测 RED 再实现 GREEN。

## 交叉复核

复核 0031、订单仓储和通知间 cart→order→fulfillment/support-intent 顺序、审计/receipt/outbox 绑定与事务失败语义。发现授权 session→identity 与既有退出 identity→session 反向锁；真实 PG 最小复现 40P01，证据 `review-orders-auth-locks.{mjs,json}`。持久层同伴已修正为无锁 owner 读取→identity SHARE→绑定 owner 的 session SHARE，并加入实际 helper + 既有 logout 当前/全部会话的独立 PG 回归。

已检查 `persistence/auth-locks-2026-09-21T11-05-56.881Z.json`：6 checks PASS，两种撤销均 LOGGED_OUT，等待中的授权均 UNAUTHENTICATED。最终通知 6085 回归使用修正后的 helper。交叉复核结论 ACCEPT，未见其余已确认阻断问题。

## 明确运营边界

- 任意历史派发存在未确认的 UNKNOWN 时，当前保守策略会继续禁止新的人工重发，不能以新 idempotency key 绕过。60 秒用例验证的是较新自动状态在旧接受截止后继续，**不表示届时人工重发恢复**。人工 UNKNOWN 对账/解除机制尚不属于本阶段，不能重置 SENT、删除历史或复用已消费链接来解除。
- Worker `runPending(limit)` 对每个队列分别使用 limit，因此合计扫描上限为 2×limit；默认每队列 100。
- 以上是本地合成数据、真实本地 PostgreSQL/S3/TLS/pg-boss/TEST PSP 的证据；没有真实邮件、真实商户、实际礼物送达或生产发布声明。
- S.U.P.E.R 10 项按本子线已检查：职责与分层清楚、无新增循环依赖、沿用 schema-defined/serializable ports、无生产配置硬编码、无新增依赖，相关验证通过。整体 P5-02 最终门禁、文档状态、catalog/manifest 与提交由 root 统一处理。

0032 SHA-256：up `dea13c99e16e1cd4f46b3b968235c68fd8beb4e38550d92b0b1a4fcc0802923a`；down `1a0fad13b7d5263d04abe379099451c43d0f586b012c7f2be4ec87f7e8d03523`。本子线生产源码、SQL、测试与夹具现已冻结。

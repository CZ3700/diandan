# P5-02 独立复核

基线 `aa922bc`，分支 `codex/p5-02-order-operations`。以下为同一任务的分文件协作，不代表领取其他 Lane/Task。

## Application / API / 合同 / KMS

复核者 `/root/orders_admin`，作者 root。结论 ACCEPT。

- 检查 12 个固定操作、普通/私密 DTO 分离、目标与版本绑定、独立权限、浏览器不可提交权限字段、HMAC 幂等、KMS 目的域和解密前后两次数据库验证。
- 跨层限流 429 未列入 BFF 可转发状态的问题已先 RED 后修复；相应 BFF 测试通过。
- 旧 624 合同根、96 条 OpenAPI paths、60 份旧迁移保留，单独兼容报告见 `compatibility-final.json`。

## PostgreSQL 订单与迁移

复核者 `/root/orders_notifications`，作者 `/root/orders_persistence`。修复后结论 ACCEPT。

- 检查 cart→order→fulfillment/support-intent 锁序、历史快照、审核记录/读取授权、幂等收据与审计绑定、Manager 白名单和通知事务。
- 发现订单授权锁 session→identity 与原退出 identity→session 相反，真实 PostgreSQL 复现 `40P01`，见 `review-orders-auth-locks.json`。
- 修复为先无锁读取 owner，再 identity SHARE、绑定同 owner/session/digest 的 session SHARE；最后重验权限及实际数据库时间。
- `persistence/auth-locks-2026-09-21T11-05-56.881Z.json` 实际当前/全部退出两场景共 6 项通过，等待授权均 UNAUTHENTICATED；最终订单 5960 和通知 6085 真实链路使用修复后的 helper。

## 通知重发

复核者 `/root/orders_persistence`，作者 `/root/orders_notifications`。结论 ACCEPT。

- 独立重发记录/outbox/attempt 保留原 SENT 和 UNIQUE(order,event)，不改变原财务/履约状态。
- 真实 TLS 接收、丢响应、进程重启、同键恢复、新安全链接、跨订单同键冲突、worker/pg-boss、回滚和固定截止顺序均有证据。
- 审核要求补跑的原自动通知完整真实回归已通过 6814 检查。旧自动流程和新人工流程并存，没有真实邮件发送。
- 接受明确限制：历史未确认 UNKNOWN 持续阻止新的人工重发；截止后继续的是后续自动状态通知，人工解除/对账不在本任务范围。每轮两个队列分别扫描 limit，合计最多 2×limit。

## 管理中心 UI / BFF 与简化复核

复核者 root，作者 `/root/orders_admin`。结论 ACCEPT。最终浏览器 7113 检查（419 浏览器 assertions、32 PNG/axe）及原管理 7377 检查均通过。

- 同一入口保留艺人、礼物、海报；订单能力与内容能力独立获取，服务故障可以重试。
- 私密面板清除、过期、迟到响应、焦点恢复与显式内部备注提交分开处理；普通 DTO/截图不含正文。
- root 已查看最终候选的中文 390 详情、葡语 390 列表、英文 1440 详情，布局无横向溢出；浏览器覆盖全部七语言。
- 窄修审核 PENDING 文案、手机长语言筛选宽度、关闭私密面板后的焦点。未为减少行数改写已验证 API 或引入依赖。
- code-simplifier 复核：显式 BFF 映射、各边界 target 校验和 busy ref/state 各有职责；两个面板的焦点逻辑已共用 hook，无必要进一步重构。

这份代码复核不代替最终集成门，也不构成生产身份、真实商户、正式邮件、人工译审、实体手机或上线批准。

## 原回退夹具的空迁移前缀兼容

作者 `/root/orders_persistence`，独立复核 `/root/orders_notifications`，结论 ACCEPT；独立 28/28 检查通过，含真实 PostgreSQL。

- 只允许 0029–0032 已知 head；所有新增表和专属审计先一次性计数为零才开始回退。未知版本或任意保留历史直接拒绝。
- 每步使用原 runMigrations 的 confirmVersion、事务、checksum、锁与 down guard，精确核对回退列表和新 head，不吞错误；历史 SQL 无改动。
- 目录、发布运行时、管理目录三处仅使用进入测试前的实际版本/迁移数量核对恢复，原业务历史快照对比保留。
- 28 项保护测试已串入持久层 `test:postgres`；额外原回归的 20 个剩余脚本另有逐项退出记录。

## 五个旧交易回退验证

root 修复，`/root/orders_notifications` 独立复核 ACCEPT。五个原 proof 在实际空 0032 schema 逐一复现旧 0029 断言失败；共享 helper 的已知 head、所有新增历史预检、每步 confirmVersion/down guard 保持，最后恢复精确等于本次进入的 head。原记录存在、SQLSTATE 55000、ROLLBACK、before/after SHA、支付金额不可变检查未改变。完整 HTTP 购物车/编辑/结账/支付/入账五条随后均 exit 0，分别 6030/5924/7414/6562/6827 检查。

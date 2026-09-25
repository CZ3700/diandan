# P5-06：统一异常处理中心

> 执行方式：Superpowers subagent-driven-development；root 是唯一 Lane D executor，协作者仅实现本任务的独占文件。

**目标**：在现有管理中心提供支付事件查询与安全重放、失败队列恢复、UNKNOWN 支付核实、通知失败待办，所有恢复可审计、可恢复且不重复业务效果。

**架构**：Browser/BFF → application → schema/ports → PostgreSQL。只返回标准化安全元数据。支付核实和确定失败通知分别复用现有 finance RECONCILE 与订单通知重发事务；webhook/outbox 使用独立持久恢复操作、租约和原处理器，不删除队列历史，不改变原业务 effect/idempotency key。原始 webhook 正文不进入本功能响应。UNKNOWN 通知、过期或不支持的消费者保留待办并解释限制。

**技术栈**：TypeScript、Zod、Next.js、PostgreSQL、pg-boss、Vitest、Playwright；原生 PostgreSQL 18.6、TLS OIDC/S3/独立 TEST PSP 验收。不得将本地 TEST 结果标记为真实商户或线上验收。

## 文件责任

| 执行者 | 独占范围 |
| --- | --- |
| root | contracts、persistence-port、导出/生成物、根 scripts/package、文档、最终门禁与提交 |
| exception_storage | 0037 迁移、PostgreSQL admin-exceptions 文件、事务接线、实际数据库验收 |
| exception_runtime | application/API/worker 异常模块、既有运行入口接线、HTTP 夹具和协议验收 |
| exception_ui | admin 异常 UI/BFF、管理中心导航、浏览器验收 |

## 实施与验收

- [x] 先写并运行失败合同测试，冻结 CONTEXT/LIST/DETAIL 与四类严格绑定的 mutation；拒绝原文、任意 consumer、缺失确认、无版本及不匹配响应。
- [x] 持久层先写失败测试；0037 仅追加最小权限、永久操作回执、持久恢复操作与约束。锁后核对来源摘要，当前身份与权限复核，同键同正文恢复、异正文冲突；并发只创建一个有效恢复。
- [x] 应用层先验证越权/伪造/错误响应隔离；保留原账户支付核实、通知历史和原 webhook/outbox 效应。恢复操作 lease/generation 防止迟到进程结算覆盖新代次。
- [x] UI 保持一个“待处理”入口、四类筛选与分页；安全详情、固定原因、明确确认；actor-scoped 未决请求先存后发，网络丢响应和刷新均以原键原正文恢复，失权清空详情与禁用操作。
- [x] 实际 PostgreSQL 覆盖新迁移升级/回滚、永久回执/审计、权限撤销、并发/租约/重启、重复恢复、可信事件与原消费者绑定，保护旧 36 项迁移与历史业务记录。
- [x] 实际 HTTP/worker 覆盖四类异常、至少十次重复重放及退款/履约/通知效果计数、原支付账户对账、不可安全恢复的拒绝路径、响应丢失与持久恢复。
- [x] 实际浏览器覆盖七语言、390×844 与 1440×900、键盘、reduced motion、错误/只读/失权、响应丢失恢复，截图与 axe 证据落入本任务 output/checks。
- [x] 独立规格与代码复核；必要的小范围简化；运行受影响测试，再 format/lint/typecheck/build 与集成门禁。
- [x] S.U.P.E.R 十项检查、旧 schema/OpenAPI/SQL 兼容与预存 5993 个未跟踪文件摘要复核；将命令、结果、范围写入 phase/MASTER，本地提交，保留外部门禁。

命令入口使用 `mise exec node@24.20.0 -- corepack pnpm`；完整复跑命令见 `docs/runbooks/exception-operations.md`，实际证据与限定见 `output/checks/p5-06-exception-operations/final-verification.md`。不得并行启动 Next build 与浏览器 dev，避免类型生成冲突。现有全量命令 `check:dev` 必须保留。

## 本次不等于完整本地体验就绪

持久本地体验仍需按 `docs/runbooks/local-experience-readiness.md` 接通同一套前后台、媒体、数据库、worker、TEST 支付与重启保留数据。本任务完成后仍按实测结果报告，不提前建议购买服务器。

# P5-06：统一异常处理中心验收证据

基线 `f9c8a619f38a07c095607e4b3b73039b4317f2a0`；开发分支 `codex/p5-06-exception-operations`。只本地开发与提交，不涉及 push、部署或真实资金。

最终结果以 `final-verification.md` 和 `final-gates.json` 为准。在这两个文件形成之前，本目录的中间 PASS 只代表对应局部范围。

## 复跑入口

操作说明及命令见 `docs/runbooks/exception-operations.md`；领取和验收记录见 `docs/progress/phase-5-operations-payments.md`。原生 PostgreSQL 使用显式绝对 bin 路径，当前机器已验证 18.6。浏览器 dev 与 Next 生产构建必须顺序运行。

## 证据口径

- `storage/<timestamp>/result.json`：独立 PostgreSQL 约束、并发、租约和历史投影。历史来源为隔离合成种子，业务测试启用实际约束；不将这种种子称为真实 PSP 签名证据。
- `integration-<timestamp>/protocol.json`：正常业务入口生成异常来源，实际 PostgreSQL、签名 webhook、pg-boss、原处理器和持久 TEST PSP/邮件。核对同键回执及重复恢复前后的资金、履约、通知计数。
- `storage-cases.json`：实际 HTTP 来源上的 wrapper、未知投递结果和 OPEN/ALL 投影检查。伪造拒绝探针在独立回滚事务中临时关闭 immutable-delete guard；其他来源和授权约束保持启用。
- `browser-exceptions/`：真实 Admin→BFF→API 七语言双视口、错误与权限、恢复操作、截图和 axe。手机为浏览器模拟；七语文案保持 DRAFT，未声称人工批准。
- 提交后中断测试：真实 PG claim 和业务提交后故意省略 settle，等待真实租约过期，再由新 Worker 实例恢复；不是独立 Worker OS 进程 kill 测试。
- 独立审查分为 `spec-review.md`（UI 作者审查合同/应用/存储）和 `storage-independent-runtime-review.md`（存储作者审查应用/API/Worker/UI）；作者自检不当作非作者证据。精确输入摘要随报告保存。
- `verify-compatibility.mjs`：重算旧合同定义、OpenAPI、SQL/manifest 前缀，以及原 5993 个未跟踪文件摘要；当前候选全部源输入保存在 `candidate-source.json`。

## 原失败保留

保留测试先行的 RED、早期约束缺口、旧固定路径数量断言、格式/静态检查、错误 fixture 路径、队列 backlog 故障注入和浏览器导航竞争原件。`run-result.json` 缺失的未捕获拒绝轮次必须结合日志和 `cleanup.json` 阅读，不能视作 PASS。

本地 TEST 供应商不是商业 PSP sandbox，测试邮件不代表真实发送。完整持久本地体验另按 `docs/runbooks/local-experience-readiness.md` 验收，本目录不会替代该交付条件。

# P5-07 原直接依赖与 P5-06 状态独立复核

Reviewer：`/root/exception_storage`；2026-09-22。只读规范、ADR、任务原要求、已有验收和当前源码，未改任务状态、领取任务或进度计数。

## 最终结论

**READY 条件已成立**：本次最终组合与浏览器 PASS，53 文件独立复核快照未变，root 的完整 check:dev 与兼容/原文件保护记录已通过。因此 P5-06 原任务自身可 DONE，释放 Lane D 后，P5-07 可依 ADR-016 登记原任务的本地 runbook/fake 演练范围 READY。本人没有修改 phase、MASTER 或领取 P5-07；最终状态登记由 root 执行。

## 最终执行前的条件复核记录

**条件式 READY**：P5-07 原直接依赖仍为 P5-04/P5-05/P5-06，不能以局部切片替代。P5-04/P5-05 已有完整本地验收和非作者结论；P5-06 当前产品范围可满足原任务，待最终完整质量门、最终七语双端浏览器和冻结源码独立核对通过后，可把 P5-06 标 DONE，释放 Lane D，再按 ADR-016 将 P5-07 的本地 runbook/fake 演练范围置 READY。现在仍需等待这些最终结果，不能提前登记 DONE/READY。

P5-06 原 Task 与 SPEC Phase 5 第 6 项要求 webhook 查询/安全重放、DLQ、UNKNOWN 支付和通知失败待办；最低验证为不重复退款/履约/通知、敏感原文仅受控访问。没有要求本 Task 接入全新 PSP、真实资金或上线。因此不能仅因 P4-04/P5-03/P5-04/P5-05 各自仍有真实 PSP/商户/正式配置欠项，就为 P5-06 创造一个必须永久 IN_PROGRESS 的新外部门。P5-01/P5-02 的本地 DONE 也已经保留正式身份/邮件条件。

SPEC §13.3 的新 PSP 沙盒/真实小额/灰度与 Phase 4/7 的完整交易、生产门仍保持。§20.1 禁止以 demo 假数据代替真实依赖验收；本轮用实际 PG、TLS S3/OIDC、实际 pg-boss/Worker、独立持久 TEST PSP/邮件证明异常编排及原幂等，明确不声称商业 PSP sandbox 或生产验收。这是 P5-06 自身任务完成边界，不是替 P4-04 或后继签署真实供应商验收。

## P5-04 / P5-05 已验收输入

- 阅读 P5-04 `final-verification.md` 和 `final-independent-review.md`：健康/稳定灰度、原账户恢复、共享 conformance 完整本地 ACCEPT；其真实 PSP 条件仍在原 Task 保留。当前选择的 health/rollout/gateway/core/0033/0034 共 **45 文件 45/45** 与 P5-04 accepted 源及后续 P5-05 accepted 源逐 SHA 相同。
- 阅读 P5-05 `final-verification.md`、phase 最终记录和 `next-stage-readiness.md`：配置管理、独立审核/传播、双进程/七语双端完整本地 ACCEPT，正式商户能力/关键译审/配置继续保留。当前配置/0036相关 **47 文件 46/47** 与 accepted 源相同；唯一变化是 `admin-payment-configuration-postgres.mjs` 明确先 up 至 0036、验证 0036 down/up，再 up 最新版，避免新增 0037 后旧测试错误回退。旧 0036 SQL 未变，此脚本在当前 0037/canonical catalog 下实际原生 PG **151 checks PASS**：`storage-legacy-0036-green.log`。
- 精确比较与逐文件 SHA 在 `next-stage-source-compare.json`。上述文件选择不是全仓不变声明；共享 exports/bootstrap/Worker/合同生成件及新迁移必须由 P5-06 本轮集成和 root 最终质量/保护门承接。

## P5-06 完成时仍须具备的证据

1. 当前完整实现的 contract/unit/typecheck/build/format/lint 与兼容、秘密扫描、源/旧 SQL/原文件保护均通过；不是仅此次局部 53 个 PG checks。
2. 原生 PG 的永久 receipt/权限/并发/租约/重启/rollback 与对应真实 HTTP/Worker 四来源证明；原 handler 多次恢复不重复资金/履约/通知，UNKNOWN 固定原账户且只消费可信 reconcile，SENT/未知发送结果不绕过通知防重。
3. 同一管理中心的七语言 390×844/1440×900、键盘/reduced-motion/失败与只读交互、截图和隐私检查完整通过，所有当前夹具失败有如实原因与最终复验。
4. 非作者审查覆盖最终合同/应用/runtime/API、PG 与 UI；review source 指纹和 root 最终候选一致。

全部满足后 P5-07 只可做 Task 原定代码→沙盒→真实小额→灰度 runbook 与 fake adapter conformance/灰度演练，列清商户资格决策门；不实际新增多余渠道，不提前做生产 apply/真实资金。Phase6/7 不随此自动解锁。

完整持久本地体验仍由 `docs/runbooks/local-experience-readiness.md` 单独追踪；P5-06 DONE 或 P5-07 READY 不代表已经交付可持续使用的 storefront/admin/PSP/Worker 全链路环境。


## 最终条件核实记录

2026-09-22 最终 `integration-2026-09-22T08-16-42.172Z/run-result.json` 为 PASS / 7143 assertions，含异常协议 369、实际四来源共享存储 27、browser 809（含后端 hook）。browser report 为 11 cases、89 PNG/axe scans、708 UI assertions 全通过且 errors 为空，已实际覆盖分页、真实空列表、丢响应恢复、四动作及实时撤权/恢复。此前夹具失败均保留原因，并由最终全组合重跑承接。

独立应用/API/Worker/UI/BFF/runner **53/53** 源码未变，指纹 `96263ec948c42e943018a54b322ae789a3d41551c9608f0bf918755f2fdca6c3`；详见 `storage-independent-runtime-review.md` 与 source JSON。root `check-dev-status-copy-green.log` 完整通过，`compatibility-verification.json` PASS 保留 5993 原文件、72 旧 SQL、36 旧迁移及全部旧合同结构；P5-04/P5-05 输入比较仍为上述 45/45、46/47（唯一0036 runner兼容修已151原生checks通过）。非作者 storage spec-review 和本人非作者 runtime/UI 审查均无未解决阻断。

据原 Task、SPEC 和 ADR-016，P5-06 本地完成与 P5-07 本地 READY 的技术条件已满足；不新增 PSP/上线门，也不取消原 P4/P5 商户/真实供应商与 Phase7 发布门。真实资金、正式邮箱/身份、生产环境和持续可用体验仍由原后续任务/runbook 追踪。

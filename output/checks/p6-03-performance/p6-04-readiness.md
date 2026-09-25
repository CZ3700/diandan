# P6-04 条件性本地就绪核对

Reviewer：`/root/performance_matrix_audit`；2026-09-24。结论：**DIRECT_DEPENDENCY_LOCALLY_ACCEPTED_HANDOFF_CONDITIONAL**。

P6-04 的原直接依赖仍只有 **P5-06**。它的完整本地交付和非作者验收成立，当前相关实现可以作为后续有限本地检查的输入。**现在不激活、不置 READY、不领取 P6-04**：P6-03 仍在执行且本轮完整验收尚未闭合，Lane D 仍由 root 占用；本轮新增共享源也须由 P6-03 最终验证承接。本报告是条件性交接意见，不是安全检查结果，也没有新增一个 P6-03→P6-04 的业务依赖。

本次只读取规范、ADR、原始报告、源码和 Git 历史，计算文件 SHA-256 与旧合同逐值比较；没有运行安全扫描、单元测试、构建、浏览器、数据库或服务，没有修改 MASTER、phase 或业务代码。逐文件机器记录见 `p6-04-readiness-source.json`，读取时 HEAD 为 `b7df3400`（完整 SHA 在该文件中）。

## 原要求与授权边界

`docs/plan/task-breakdown.md` 的 P5-06 要求 webhook 查询/安全重放、DLQ、UNKNOWN 支付、通知失败待办，最低验证是重放不重复退款、履约或通知，以及受控敏感原文访问。该任务没有要求接入额外真实商户；当前实现只提供安全元数据，未提供原文读取入口，没有为了满足条目而新增泄露面。

P6-04 原范围是明确边界的越权、XSS、CSRF、SSRF、重放、token、secret、依赖及 PII 检查；High/Critical=0、修复回归和报告路径仍须由实际 P6-04 执行证明。P5-06 和 P6-01 的历史验收不能替代本项扫描或证明当前不存在安全缺陷。

ADR-016 允许走到 P6 波次后逐项消费已完整本地验收并经非作者复核的原直接依赖，但要求六项 Lane D 串行、先登记有限 ACTIVE 范围再 READY。当前 phase6 明确 P6-04 至 P6-06 仍 PENDING。无需重新申请同一排期授权，但也不能凭本报告越过当前执行和最终验收条件。

## P5-06 完整本地成果

已读取 `output/checks/p5-06-exception-operations/` 的 `final-verification.md`、`final-gates.json`、`spec-review.md`、`storage-independent-runtime-review.md` 及其源快照；作者 UI 自检与非作者审查区分清楚。

- 同一管理中心提供四类异常、筛选/分页、详情与明确阻断原因。命令检查当前 session/MFA/CSRF/grant、源版本和永久幂等，原操作和审计原子保存；不返回 webhook 原文、私密留言、邮箱、身份凭据或地址。
- WEBHOOK/DLQ 复用原来源、原 handler/consumer 和原业务去重；UNKNOWN 只对冻结原账户/attempt 执行已有 finance reconcile；通知只允许原已确定失败且符合条件的受控重发，未知发送状态不能盲目重试。
- 原真实 PostgreSQL 18.6 专项 **53 checks**、旧配置回归 **151 checks**、0037 往返及 **37 迁移/200 表**通过。约束注入和历史种子与普通 HTTP 生命周期证据分别披露。
- 最终组合 `integration-2026-09-22T08-16-42.172Z/run-result.json` 为 **PASS / 7143 assertions**，包括异常协议369、共享存储27。浏览器自身 **708 assertions / 11 case groups / 89 PNG / 89 axe**，七语言 × 390×844/1440×900，错误、分页、只读/无权限、键盘/reduced motion、两层丢响应后原键恢复和实时撤权/复权均通过；违规、incomplete、page error 为零。
- 十次同键及原 webhook/outbox handler 多次重放不增加 create/refund/履约/通知的非法副作用；原退款唯一、原账户 reconcile 观察唯一。恢复中断明确为提交后省略 settle、真实 PG lease 到期和新 Worker 实例恢复，**不是实际杀 OS 进程**。
- 原 `check:dev` 的 format/lint、64 typecheck /64 test task /36 build task 通过，合同517 tests、adapter/artifact、保护与当时秘密扫描通过；缓存数量和没有跑整条 `pnpm check` 的范围如实保留。原任务经两路非作者验收、S.U.P.E.R 1–10 通过后 DONE，未凭一个局部存储测试宣布完成。

## 当前源码与后续集成承接

本次选择原三份审查清单的并集，再加入原 candidate 中所有 exceptions 与0037文件，共 **69 个输入**；覆盖合同、应用、PG、API、Worker、Admin/BFF、四类文案/视图、原验收工具和迁移。这个选择性集合不是“全仓从未改动”的声明。

| 比较 | 实际结果 |
| --- | --- |
| 当前69输入 vs P5-06最终candidate | **67相同，2变化** |
| 当前69输入 vs P6-01最终源 | **69/69相同** |
| P5-06 candidate中的 database 文件 | **76/76字节相同**，包括迁移及其元数据/说明文件；不是76个SQL或迁移 |
| P5-06已接受提交的700个合同根 | **700逐值保持**；当前707个 |
| P5-06已接受提交的127个OpenAPI paths | **127逐值保持**；当前129个 |
| P5-06已接受提交的204个OpenAPI component schemas | **204逐值保持**；当前207个 |

两处已审阅差异：

1. `apps/admin/src/management-exceptions/exceptions.css` 把 `max-width:47.99rem` 改为既有48rem断点的范围表达式，是 P6-01 设计基础门的修正。
2. `apps/api/scripts/admin-exceptions-http.mjs` 将旧硬编码 Docker metadata 改为透传统一真实 TEST PostgreSQL runtime 返回的 metadata；原测试协议/业务断言不变。

这两处及其共享变化由 P6-01 **同执行源的完整 operations 五命令复跑**承接。`final-operations-9` 的异常命令为 **7146 checks**，浏览器仍为708断言/11组/89PNG/89axe且无错误；同键10次、原 webhook10次、outbox10次、四来源授权/审计/委托回执、UNKNOWN不重发及真实lease恢复均在此次标准运行中再次通过。完整运营组由 `/root/regression_readiness` 非作者验收。

P6-01最终来源 `642a55a818680d763f41ce5d87b5386092591ea5341c92ce4e88c8248bcb8b72` 的五组17命令/14要求跨运行完整覆盖随后已独立接受；保留 final-8 原整体FAIL，未用诊断覆盖标准门。共享发布/媒体重试、native TEST runtime、导出等变化由该完整验收及对应非作者审查承接，不只依赖69文件不变。

补充核对17个共享入口：API/Worker生产composition未偏离原成果；管理支付CSS、发布/媒体和PG测试入口匹配P6-01已接受源；Admin订单工作区焦点修正与contracts index匹配P6-02已接受源。P6-02 `run-4` 的完整七语28格/196页和当时质量/真实PG门已有非作者接受，可承接首页直接礼物浏览与后台焦点增量。后续语言菜单修复不改上述P5-06集合。

**本轮P6-03仍存在尚待最终接受的共享增量**：RUM配置/exports/合同登记、前台root挂载、依赖与测量工具等。独立RUM源码/轻量测试意见另见 `rum-independent-review.md`，不能把它当P6-03完整运行接受。后续安全范围应以P6-03最终冻结源码为准，把实际新增入口纳入任务范围；本报告没有提前执行该安全检查。

## 证据完整性与历史限制

本次重算P5-06审查引用8项及P6-01运营审查引用35项，共43个引用。**41项匹配历史SHA**，含所消费的原始运行/协议/存储/浏览器证据和P6-01引用；另外两项为P5-06最终元数据 `compatibility-verification.json` 与 `review-input-verification.json`，08:25审查快照引用早于它们08:30最终重写，故不能写43/43匹配。两者当前字节分别精确等于已接受提交 `e8185776`，最终 `final-gates.json` 嵌入/引用08:30值；此时间差已在机器记录保留并解释，没有修改历史引用或补造原SHA。

本次没有重新执行旧测试，也没有查看或修改用户持久实例。历史商业PSP、身份/MFA恢复、真实邮件、真机、人工译审、云/staging、远端CI与发布边界继续保留。P6-01原Docker时间约束和财务读集合间歇失败原因仍UNKNOWN，后续原生标准复跑成功不等于证明它们已修复；这些已披露限制不被本报告删除。

## 仅在以下条件完成后交接

1. P6-03登记的完整本地范围实测并经非作者接受，列清原外部门，释放Lane D；若后续仍改P5-06相关输入，需要重新核对差异和适用验收。
2. root确认该有限安全检查范围使用当前最终冻结源码、只针对自有本地TEST资源，登记证据与验证计划；保留所有原验收要求。
3. root在MASTER与phase6明确新增P6-04有限本地ACTIVE范围，并在Lane空闲后单独置READY/领取。

在这些条件之前，**P6-04保持PENDING、无owner；本报告不改变任务计数，不授权push、云apply、真实资金或发布，也不提前宣称High/Critical=0。**

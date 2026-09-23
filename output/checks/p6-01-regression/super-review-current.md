# P6-01 当前源码 S.U.P.E.R 收尾审查

2026-09-23；reviewer `/root/regression_readiness`。**第1–9项在下述源码范围内 PASS；第10项 FAIL / NOT_ACCEPTED。不能登记完整 S.U.P.E.R、P6-01 本地完工或后继激活。** 本轮仅阅读源码、差异、原始结果与已有非作者审查，并写本目录报告；未运行服务、浏览器、数据库、构建或测试，未修改根源码/文档，也未写 memory。

## 绑定范围与作者区分

消费当前 `owned-source-paths.json` 的84个审查路径：相对 `7ad8be93871c2aefa600ad4e299f85454f27c168`，40个MODIFIED、43个NEW，另1个application基础测试已恢复原字节，故实际83个修改/新增；不把84误称全部有diff。

逐字节及文件mode重算 `final-8/source.json` 中2740个执行输入，当前均与运行快照一致，重算指纹精确为 **`642a55a818680d763f41ce5d87b5386092591ea5341c92ce4e88c8248bcb8b72`**。完整source manifest含2822项；执行指纹按原规则排除docs、.agents及根说明文件。84路径中仅`docs/progress/phase-6-hardening.md`后来追加了真实final-8失败记录，不能用运行时文档hash冒称它从未变化；当前84路径SHA/mode单列于机器报告。

本人是fallback/SEO、native TEST核心及测试层迁移的作者，因此这些部分不自称独立批准：

- 采用coverage的`fallback-independent-review.md`：现存候选行逐值绑定、不可变manifest原证明、canonical语义、精度/重复/父关系/媒体/单边缺失反例及SQL叶级注入边界。当前14个仍适用的绑定全部匹配；旧application集成测试绑定由最新迁移review替代。
- 采用coverage的`unified-native-independent-review.md`及20文件hash集合：typed唯一native实现、18.x版本和严格归属清理、显式选择无降级、安全metadata、CI及统一环境布线；当前20/20绑定匹配。
- 采用coverage的`fallback-test-boundary-independent-review.md`及3文件hash：原测试body未缩水，已移至外层API，原application基础测试不变；当前3/3绑定匹配。
- 本人此前对其他作者的管理发布/媒体重试、Git环境隔离、publication唯一效果helper做过非作者源码与轻量复核，继续消费各自最新review；旧hash版本被后续明确替代的部分以统一native与media最终绑定为准。rollback prefix和PG clock测试修正也沿用coverage独立增量结论。

## S.U.P.E.R 十项

| # | 审查项 | 当前结论与依据 |
| --- | --- | --- |
| 1 | 每个模块单一职责 | PASS。固定计划、环境隔离、快照、执行、归档分离；journey分合同/流程/只读状态/启动器；恢复helper仅验证只读缺失证明，native helper仅管理自有TEST集群。 |
| 2 | 函数概念单一 | PASS。管理共享helper仅在port确认回滚时最多3次执行完整事务；reload/checkpoint/fence留在callback，外部inspector留在循环外。长CLI及浏览器函数是显式阶段编排，不混入新的业务判定。 |
| 3 | 单向依赖 | PASS。Application使用Domain/Port；SQL与运行时故障留在外层TEST适配。content私有fixture的集成测试已移出Application，未新增production导出；final-8原adapter边界门通过。 |
| 4 | 无新增循环 | PASS（源码与既有门）。新增环境、retry、recovery模块单向被消费；runner不反向依赖CLI，content不依赖API/PG。final-8质量组的类型、构建、适配器和出口门实际通过。 |
| 5 | 接口由schema/types定义 | PASS。公开API/内容/商业对象复用原versioned Zod；consumer先parse完整schema再检查locale。journey strict schema强制14唯一格及每格10步；TEST PG metadata为闭集类型。 |
| 6 | 业务I/O可序列化 | PASS。公开DTO、事件和报告为JSON；Pool/进程/AbortSignal/callback只是进程内装配依赖。私密内容只内存比对，截图mask，诊断只输出闭集code/计数/时间差。归档扩展名白名单不被误称PII扫描。 |
| 7 | 配置与环境隔离 | PASS。统一显式PG工具目录且冲突/无效/失败拒绝，不降级；源Git/准备/套件清除GIT与外来业务配置；新目录、随机凭据和loopback归属明确。预览构建常量沿用原TEST合同，不是生产域名/商户/品牌硬编码。 |
| 8 | 新依赖显式声明 | PASS。contracts、database迁移无修改/新增；lock与workspace字节不变；根package除scripts外与基线深度相等。复用既有依赖；运行文档声明Node/pnpm/Docker/Chrome/PG18/Linux显示前提。 |
| 9 | 部件可替换 | PASS。固定场景计划与执行器/证据收集分开；native替换位于testing入口；业务重试依赖port失败分类，无PG实现依赖。fallback复用原验证器，未新建放宽审批的平行规则。 |
| 10 | 修改后全部测试通过 | **FAIL / NOT_ACCEPTED。final-8整轮FAIL，coverage.complete=false。14已执行命令为13PASS/1FAIL，原17命令还3条NOT_RUN；operations未完整、journey未执行。** |

这些PASS是源码与已有对应证据的有界结论，不表示已证明不存在任何实现缺陷；新实际失败仍必须诊断，不因1–9项通过而忽略。

## code-simplifier 只读结论

依项目skill及code-simplifier规范审查新增模块和关键差异，**没有发现需要立即修改的确凿可读性/职责问题，不建议为了形式减少代码或扩大重构。** 当前有益的最小收敛已经体现为专职环境helper、管理port有限重试helper、typed native唯一实现加旧兼容alias，以及将集成fixture放回外层测试。

不能把fallback的present-row equalSet、canonical比较、最终完整validator合成一次宽松比较：它们保护不同证据边界。不能把所有交易错误泛化为共享自动重试，也不能将外部inspector并入重试closure。报告聚合的FAIL优先/完整覆盖条件、逐阶段安全输出、native归属清理都需要保持显式。此处没有以代码行数、文件长度或偏好作为问题依据。

## 文档完成状态核对

检查`MASTER.md`、`phase-6-hardening.md`、`task-breakdown.md`、`remaining-delivery.md`及`docs/testing/full-regression.md`，**未发现错误的P6-01完成声明**：MASTER为31 DONE /7 IN_PROGRESS /0 READY /11 PENDING，P6-01仍IN_PROGRESS且root占Lane D，P6-02至06仍PENDING，Phase7仍LOCKED。remaining-delivery的ACCEPTED指用户批准排期，非P6验收；历史阶段段落按时序保留，不能与最新状态混用。

phase最新段明确final-8质量/catalog/commerce局部PASS、运营财务读生命周期失败及后续未运行；runbook明确五组和14条齐全才complete，本地成功不等于远端CI/商户/云/人工。runbook统一PG环境说明也准确保留默认Docker及“历史时间约束失败尚未证实修复”。没有需要本review代改的错误完成声明。

## 当前完整门与风险

`final-8/report.json`、`steps.json`原失败保持：quality/catalog/commerce PASS；operations退款/拒付浏览器capture等待语义读集合清空失败；配置、异常重放和journey未运行。14要求聚合实际6PASS/3FAIL/5NOT_RUN。该聚合3FAIL不等于三个不同根因，不能据此改写已通过单项。一次相同5秒门的旁路诊断通过且未复现，不能覆盖原FAIL或宣称根因已修复。

最新记录仅支持源码1–9项有界接受；**第10项当前是FAIL，不是PASS，也不是未曾运行的PENDING**。P6-01总体未接受，P6-02不得据本报告激活。需后续完整同源五组17命令/14要求实际通过并完成独立终验；原远端CI、人工读屏/关键译审、物理手机、商户sandbox/真实小额、正式邮件、RUM、云staging/恢复/灰度等外部门照旧保留。

机器明细、全部84个当前hash、独立绑定校验、文档边界及原结果hash见`super-review-current.json`。

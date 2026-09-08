# P3-06 日常验证提速与性能样本有效性

2026-09-08，本地基线 `020379c`。本轮只改验证工具、根脚本入口和执行说明，P3-06 保持 IN_PROGRESS，22/49 DONE、Phase 4 LOCKED。结果与输入 SHA 见 [validation.json](validation.json)。

## 可重复入口与结果

- `mise exec node@24.20.0 -- corepack pnpm check:dev`：第二次完整运行 exit0，28.16 秒；格式/lint/工作区/领域边界及类型58/58、单元任务58/58、构建35/35通过，缓存分别57/56/33。它没有运行真实PG/S3、产品浏览器或正式验收；不能与约20分钟的全链检查作相同范围的速度比较。
- `mise exec node@24.20.0 -- node --test apps/api/scripts/storefront-acceptance-*.test.mjs scripts/check-development.test.mjs`：28通过、0失败。
- `mise exec node@24.20.0 -- node apps/api/scripts/storefront-acceptance-content-browser.mjs`：最终12项真实Chrome DOM场景、2次Lighthouse通过，正常页内容audit=1；预查正常但实际导航HTTP200不可用时audit=0，聚合必须拒绝。每次脚本生成独立目录，旧失败保留。
- 无筛选检查全部workspace及消费者；`--filter PACKAGE`或`PACKAGE...`只选择精确包/其依赖，不主动选择消费者。`--plan`只打印计划。执行说明见 `docs/plan/development-cadence.md`。

## 修正依据

旧聚合能接受没有成功内容证明的样本，首个回归测试有效RED；独立审查又发现空外层容器与缺字段证明能误过，经实际Chrome/Node RED后收紧。最终验证主内容标题、目录卡片/详情正文、URL和语言，以及可见的页面/目录错误状态；未知或矛盾证明失败。

实现使用固定安装的Lighthouse13.4.1 gatherer，在同次导航document中只读采集，再由独立内容audit判定；不添加导航/重试，不覆盖原performance权重/阈值/三样本策略。结构参照 [Lighthouse官方架构说明](https://github.com/GoogleChrome/lighthouse/blob/main/docs/architecture.md)，具体生命周期同时核对本地固定版本源码。失败LHR和汇总条目先保存，再停止验收。

第一次开发检查在新脚本裸`fetch`的lint处正确停止；遵循仓库模式改为`globalThis.fetch`，第二次整个入口通过。没有跳过失败步骤。根`check`字符串及CI与基线相同。

## 范围与保留

只证明采样工具能区分正常主内容与错误页，不证明全部子区域业务成功，也没有修复先前后端临时不可用的未知根因。本轮没有产品UI/SQL变更，没有重新生成七语言63次产品性能报告、真实PG/S3、手机、人工计时、读屏或正式译审证据。

既有完整检查、产品浏览器与性能记录仍以 `output/checks/p3-06-performance-final/` 的原源码范围为准。本轮原始日志/两份完整LHR保留在本地，位置与SHA列入validation；提交保留本摘要、validation和最终紧凑浏览器results，避免再次复制大型历史证据。S.U.P.E.R本工具切片十项通过，P3整体验收未通过。源码由storefront_read与storefront_directory分别独立复审ACCEPT。

下一业务入口已审计为P4-01；提前进入购买闭环的阶段顺序提案尚待用户回复，当前阶段门没有变更。购物车须先处理动态收礼资格、匿名无留言的加密意图表示及当前公开视图兼容性。

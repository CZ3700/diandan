# P3-06 性能续验本地检查点

2026-09-16，从本地 `7d1a539` 接续，分支 `codex/p3-06-performance-resume`。root 持有 Lane D；**P3-06 仍为 IN_PROGRESS**。正式计数 **27 DONE / 2 IN_PROGRESS / 20 PENDING = 49**，Phase 5 仍 LOCKED。未 push、未 merge，以下本地证据不代表生产发布或阶段完成。

## 本轮两项最小优化

1. **无购物车 Cookie 时跳过自动恢复。** 服务端仅传递 Cookie 是否存在的 boolean；false 不推断购物车为空，手动开抽屉和初始化仍走原请求与严格验证。已有 Cookie 继续恢复真实徽标，畸形/过期 Cookie 仍由原 BFF 验证。未修改购物车业务合同、认证或 CSRF 边界。该变化针对首访无 Cookie 的 404 触发完整验证模块下载；两轮各84页实际资源采集确认共有页面各减少152,421 gzip字节，性能验收仍未通过。
2. **中文/日文字体 CSS 范围互斥。** 从每个原分片的 unicode-range 中减去完整静态 UI 词库，仅 UI 字体声明这些字符。完整原声明 repertoire、每个非 UI 字符的原资源选择均保持；所有既有 WOFF2、UI CSS/manifest 和许可证不变。生成器校验词库 SHA、完整 codepoints、资源身份并生成稳定 package-local 引用。临时输出与新 UI 输入目录独立，Python hook 读取本轮 UI 产物，不依赖机器 `.pnpm` 路径。

## 已通过与保留的反证

| 范围                | 当前结果与证据                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 购物车 TDD          | [行为 RED](cart-hint/red.log)、[装配 RED](cart-hint/wiring-red.log) → [9 文件 / 100 tests PASS](cart-hint/green-final.log)；[摘要](cart-hint/result.json)。                                                                                                                                                                                                      |
| 字体 TDD            | [两个实际范围重叠 RED](font-overlap-probe/production-coverage-red.log) → [语义/原资源/字体加载 9 tests PASS](font-overlap-probe/production-coverage-green.log)；[临时输出 RED](font-fallback-css/temporary-output-red.log) → [生成器 8 tests PASS](font-fallback-css/generator-green-final.log)。最初缺模块的 `generator-red.log` 仅为搭建失败，不作为行为 RED。 |
| 字体/设计完整静态门 | 原 `check:design-foundations` 加入生成器测试，[51 tests PASS](design-foundations-final.log)，[4.631 秒、exit 0](design-foundations-final-result.json)。包括范围、字节、入口、许可证和消费者 CSS；不是浏览器性能结果。                                                                                                                                            |
| 全 Storefront 单测  | [87 文件 / 606 tests PASS](storefront-tests.log)，[命令 exit 0](storefront-tests-result.json)。                                                                                                                                                                                                                                                                  |
| 本地开发组合门      | [`check:dev` 第四轮](development-check-4-result.json) **44.691 秒、exit 0**；[日志](development-check-4.log)：typecheck 62/62（58 cached）、test 62/62（58 cached）、build 36/36（33 cached）。缓存如实保留；此命令未执行实际 PG/S3/browser/formal acceptance。                                                                                                  |
| 非作者源码评审      | [购物车 hint](cart-hint-independent-review.md)、[字体生成器与合同](font-independent-review.md)、[真实购物车浏览器 harness](harness-review.md) 在各自源码范围 ACCEPT；最终实测门仍由 root 汇总。                                                                                                                                                                  |

此前 `development-check[-2/-3]` 的失败日志、[baseline trace](baseline-trace-result.json) 与 [27 次 baseline repeat](baseline-repeat-result.json) 全部保留，不删除失败样本、不放宽预算。[保护清单](compatibility-and-protection.json) 与源码冻结清单用于后续统一复核。

## 字体浏览器证据必须分开解读

[冷缓存隔离诊断](font-overlap-probe/README.md) 在相同字体字节下，完整静态 UI 的原重叠请求为日文 29 / 中文 16，互斥后均为 1；加入原声明范围内的非 UI 样本后分别 37 / 23 → 9。此处是隔离字体请求对照，不是整站 Lighthouse 达标证明。

[Warm 原始严格报告](font-overlap-probe/warm/attempt-2026-09-16T07-25-54.302Z/results.json) **仍为 FAIL / exit 1**，不得改称全绿：原 Fontsource CSS 声明的 U+9FFF 在选中原 WOFF2 cmap 中不存在，原始/旧重叠/新候选均以相同系统字体回退；第三参照“完整原字体”与既有 UI subset 的部分中文 descent 浮点值也不完全相等（最大约 0.00000190735 CSS px）。原始严格失败未增加容差或删除。

[Candidate delta 独立判读](font-overlap-probe/equivalence-review.json) 为 **PASS**：仅比较本轮 CSS 分区改动与既有重叠 profile，日/中 × UI/混合 × 100/400/700/900 字重共 16 项，pixels、bounds、widths、metrics 与实际平台字体完全相同，462 份输入摘要前后不变。这只支持本次 CSS 改动没有引入该对照下的显示差异；不扩展为任意文本/字重/平台等价，不覆盖或升级旧近似像素证据。

## 本轮验收门结果

| 门禁                           | 状态与待填写项                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 实际 compiled Storefront UI    | **PASS**：[UI摘要](storefront-ui-result.json)，88场景/88PNG、22,705 callback断言、85 axe零violations，30 incomplete保留；实际七语言与双视口、键盘/错误/reduced motion。                                                                                     |
| 原性能预算                     | **FAIL / 未完整**：[部分对比](partial-performance-review.md)。attempt3在10/63、attempt4在41/63因真实内容错误中止；两轮各84资源页通过。仅13完整组三次可复算，其中3组过实验室门、10组未过，不补齐/拼接。JS和字体下降不等于LCP全改善。                         |
| 实际购物车 PG/API/TLS + 浏览器 | **PASS**：[购物车摘要](cart-browser-summary.json)，120.891秒exit0，真实PG/API/TLS/TEST KMS共5,924协议断言，20场景/40PNG/30axe；无Cookie自动GET=0、手动读404、返回徽标及HTML私密性通过。功能harness先访问过`/en/cart`，不冒充冷传输证据。                    |
| 共享 UI 原门                   | **自动脚本通过**：[共享UI报告](shared-ui/README.md)，干净独立checkout按P2-03→04→05原入口首轮exit0；13/16/8 locale场景、15/18/22 PNG、8/10/3 axe。55PNG与102文件SHA通过，指纹前后相同。P2-05真实手机门和原moderate/incomplete保留。                          |
| 完整仓库检查与最终复核         | **完整原命令通过**：[最终验证](final-verification.md)；单条 `pnpm check` 2144.195秒exit0，43原门连续通过。types/tests各62（61缓存）、build36（35缓存）、32出口。旧606合同/58SQL及2438原未跟踪保持。secret/audit通过；S.U.P.E.R第10项仍保留性能/人工未过门。 |

真人运营、读屏与关键译文批准、真实 PSP 商户验收、staging/生产/真机等未由本轮单测或隔离字体实验完成。本地回归通过仍不更新 P3-06 DONE 或解锁 Phase 5。

## 两轮不可用的调查状态

[无效采样与分层复验](content-diagnostic-summary.json)、[首页源审查](content-failure-review.md)、[可证伪读取假说](read-failure-hypotheses.md)。两个HTTP200安全错误页已由同导航audit和截图确认；原因未定位。原日志丢弃API记录；现已增加默认关闭的TEST-only分层观测，不放宽生产catch、合同、超时或性能预算。Raw HTML探针前三轮因copy/streaming loading标记及未生效替换而错误判定，均保留且不能作为产品失败证据；第四轮60次API/gateway/SSR正确谓词通过，只能证明后续读取健康。

## 新诊断 fixture 的实际结果（08:15–08:25 UTC）

默认关闭的 TEST 诊断已完成有效行为 RED → 14 tests PASS、独立审查 ACCEPT；root 接线后 `check:dev` 27.866 秒 exit 0（[结果](development-check-diagnostics-result.json)）。实施已保存本地提交 `0dabba96e88d421d4679f6891e9e237efc3ef24d`，未推送。

新实际 PG/TLS S3/worker/API fixture 的 32,461 协议断言通过，smoke callback 通过；随后 27 次 Lighthouse 均为有效内容，同期 browser phase 各读取层记录零失败，观测写入没有错误。9 组三次中仅英/中/日艺人页 3 组满足全部实验室门，整体 **COLLECTED_DIAGNOSTIC_BUDGET_FAILED / 198.813 秒 / exit 1**。诊断开关开启了额外 schema 校验与同步写文件，不能当作关闭诊断条件下的最终性能比较。完整 [27 次原始索引](diagnostic-trace/attempt-2026-09-16T08-21-29.460Z-32df9e34/results.json)、[运行结果](diagnostic-trace-result.json)、[分层记录归档摘要](read-diagnostics/actual-fixture-summary.json) 保留。

**旧偶发错误仍为未重现、未修复**。新 fixture 没有原先完整 UI 的发布/回退历史，27 个正常页面不能抵消旧 attempt-3/4 的真实错误，也不能拼入原 63 次门。未改业务重试、catch、超时、预算或失败分类。独立源码审查见 [final-source-review.md](final-source-review.md)，S.U.P.E.R 第 10 项仍待完整实测与原验收门。

最终综合结论与复验入口见 [final-verification.md](final-verification.md)。源码、关键结论和精简证据保存本地；大型原始trace、HTML、日志和重复截图继续保留于本机，Git选择范围见 [curated-evidence-plan.md](curated-evidence-plan.md)，最终暂存文件以staging-manifest.json为准。

最终暂存后的敏感信息扫描再次通过：[secrets-staged-result.json](secrets-staged-result.json)，32.165秒exit0。

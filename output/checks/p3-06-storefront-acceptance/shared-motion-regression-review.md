# P2-05 shared motion regression review

结论：接受本次桌面 Chrome 回归通过的证据；新增诊断未放宽性能预算。此前两次长任务失败仍成立，本次通过不能证明特定根因或永久修复。复核日期：2026-09-07。复核者：storefront_directory；浏览器执行者：root。复核者参与过数字阶段诊断实现，因此本文对该实现属于作者复核，对 root 执行结果属于独立证据核对。

## 失败与最终结果

| 运行      | 原始证据                                                                     | 实际结果                                                                                           |
| --------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| attempt 2 | `shared-motion-browser-2.log`                                                | `long task budget exceeded: 1`；该版本未记录任务时长与开始时间，不能补推数值。                     |
| attempt 3 | `shared-motion-browser-3.log`                                                | 360px 英文首场景失败；一个长任务 duration 56ms、startTime 1470ms；LCP 492ms、CLS 0，退出码 1。     |
| attempt 4 | `shared-motion-browser-4.log`、`../../playwright/p2-05/browser-results.json` | 浏览器验证通过，报告生成于 `2026-09-07T11:12:51.125Z`，结果为 `passed-with-physical-device-gate`。 |

上述失败日志仍存在，最终通过没有替换或抹去它们。root 报告 attempt 4 外层执行时间为 11:12:12.659 至 11:12:51.986；本文直接核对了日志和最终 JSON，没有另行执行浏览器。

## 诊断与采样边界

检查 `scripts/verify-ui-motion-browser.mjs` 的当前差异：只新增导航完成、settle 完成、字体审计起止、可信点击起止、采集起止的固定名称数值时间，并在性能失败时输出这些数值及既有指标。时间读取在每个场景执行，日志输出仅在失败时发生；不能描述为只有失败才执行的零开销诊断。

长任务 observer 仍在导航前安装并使用 buffered 数据；没有清空、过滤、排除长任务，没有更改预算、断言、原指标返回字段或场景顺序。`beginPerformanceWindow` 仍只进行可信点击及等待，并未重置采样窗口。导航/hydration、字体等待、图片加载和 decode、850ms settle、字体 DOM/CSSOM 审计、点击和采集均可能落在采样内。axe 和截图在性能断言之后，不能解释 attempt 3 首场景断言前的长任务。

失败发生时尚无新阶段数值，现有记录不足以把 56ms 归因于 hydration、字体审计、后台进程或任何特定函数。root 在最终重跑前清理了确认归属旧任务的 preview 进程，这只是运行条件变化，不能据此认定因果或已永久消除波动。

## 最终通过的准确范围

最终 JSON 的 8 个场景均为 errors 空、longTasks 空、CLS 0：360×800 en、390×844 vi、768×1024 th、1024×768 zh-CN、1440×900 ja、1920×1080 es，以及 320×800 en-XA/pt 压力场景。保留 22 张截图。三个 axe 扫描的 critical/serious **violations** 为 0；每个扫描仍有一个 moderate `heading-order` violation 和一个 `color-contrast` incomplete，不能宣称 axe 全部问题为 0。

移动/桌面 reduced-motion 记录中的 hero、艺人切换、加入反馈、成功反馈 animation/transition 均为 0，transform 为 none，位移与滚动差为 0，状态反馈仍可见。运行使用生产构建、Chrome 152.0.7977.82，触控仅为桌面模拟；`physicalDeviceEvidence` 为 false，真实手机录像和帧率门仍待完成。此处 LCP、Event Timing 和 rAF 是本地代理指标，不能替代真实用户 INP 或本轮前台 63 次 Lighthouse 验收。

本次复核只读源码、读取现有日志/JSON并新增本文；未运行 build、Next、PostgreSQL 或新的浏览器测试。源码继续冻结。

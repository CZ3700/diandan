# 礼物共享读取：实际性能差异分析

四组交叉后的结论：候选确实消除了重复公开内容读取，但本轮 **不能声称首屏性能改善，也不能声称没有性能回归**。首轮中文和日文模拟 LCP 退化，中文两次与日文一次还有约 1 秒的真实图片加载后呈现延迟；第二轮候选未重现这三个实际间隔，但中文模拟 LCP 再次比同期原代码更慢。当前证据把差异定位到图片已加载后的绘制及 Lighthouse 模拟关键路径，不能确定根因，也不能称为噪声。36 个样本及全部失败预算保持，性能门 OPEN，仅支持读取一致性/功能检查点。

## 证据范围

- 共用真实 PG/TLS S3 seed：`output/checks/p3-06-storefront-acceptance/run-2026-09-16T17-15-30-987Z/`。
- 原代码：`browser-attempt-2/gift-read-comparison/`；候选：`browser-attempt-3/gift-read-comparison/`。
- 各有 14 个七语言双视口常规导航、9 份原始 Lighthouse JSON/HTML。候选另有 4 个故障/无市场边界导航。
- 两组均启用同一 TEST 原生读取观察，非正式性能验收。baseline 采集时间为 17:25:01–17:25:54Z，candidate 为 17:30:05–17:30:56Z；不是同时运行、不是同一个浏览器进程。
- 18 份 `configSettings` 完全相同：Lighthouse 13.4.1、Chrome 152、mobile、simulate、RTT 150ms、throughput 1638.4Kbps、CPU slowdown 4。所有同导航内容校验成功。
- 本分析只读 JSON、源码及原生日志，不重新运行浏览器、PG、构建或 CPU 测试，不改阈值/Chrome/测量配置。

## 首轮三次中位数

单位毫秒；“实际 LCP”取原始报告 `audits.metrics.details.items[0].observedLargestContentfulPaint`，不能与 Lighthouse 模拟 `largest-contentful-paint.numericValue` 混为一谈。

| 语言 | 代码 | 模拟 LCP | 实际 LCP | 首响应 | 主线程工作量 | 图片加载后呈现延迟 | scoped 原生读取 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| en | baseline | 2629.2 | 349 | 314 | 275.8 | 26.1 | 307 |
| en | candidate | 2631.7 | 329 | 265 | 279.5 | 49.0 | 259 |
| zh-CN | baseline | 2677.3 | 567 | 490 | 489.7 | 53.7 | 477 |
| zh-CN | candidate | 5573.3 | 1456 | 401 | 449.3 | 1050.9 | 390 |
| ja | baseline | 2885.9 | 642 | 558 | 571.3 | 54.9 | 543 |
| ja | candidate | 3913.3 | 276 | 235 | 291.6 | 29.0 | 230 |

这里 scoped/首响应的下降仅描述上述 9 个 Lighthouse 样本，不能推广到所有导航：14 次无网络限速的 UI 样本中，scoped 读取中位数反而从 **308ms 上升到 468.5ms**（baseline 范围 256–509，candidate 251–615）。例如 en/390 为 509→615ms、zh-CN/1440 为 264→439ms、th/1440 为 256→555ms。主机状态、请求调度或执行时序是否影响结果，首轮不能区分。

## 全部 18 个原始样本

每个编号对应上述目录的 `<locale>-gift-mobile-<编号>.json`。该表不筛除慢样本。

| 代码 | 语言/编号 | 模拟 LCP | 实际 LCP | 首响应 | 主线程工作量 | 模拟 TBT | scoped 读取 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | en/1 | 2772.8 | 379 | 332 | 287.4 | 5.5 | 325 |
| baseline | en/2 | 2618.4 | 349 | 314 | 251.7 | 4.0 | 307 |
| baseline | en/3 | 2629.2 | 337 | 298 | 275.8 | 7.0 | 291 |
| baseline | zh-CN/1 | 2731.5 | 755 | 671 | 565.1 | 19.0 | 655 |
| baseline | zh-CN/2 | 2675.8 | 567 | 490 | 485.2 | 25.0 | 477 |
| baseline | zh-CN/3 | 2677.3 | 554 | 480 | 489.7 | 25.5 | 466 |
| baseline | ja/1 | 2885.9 | 642 | 558 | 571.3 | 19.5 | 543 |
| baseline | ja/2 | 3326.2 | 767 | 687 | 609.4 | 37.0 | 669 |
| baseline | ja/3 | 2691.6 | 578 | 504 | 532.4 | 31.5 | 489 |
| candidate | en/1 | 2776.6 | 329 | 265 | 311.2 | 8.0 | 259 |
| candidate | en/2 | 2619.3 | 291 | 246 | 227.3 | 3.5 | 239 |
| candidate | en/3 | 2631.7 | 374 | 310 | 279.5 | 6.5 | 299 |
| candidate | zh-CN/1 | 4364.2 | 471 | 401 | 449.3 | 45.0 | 390 |
| candidate | zh-CN/2 | 5573.3 | 1472 | 407 | 488.4 | 0.0 | 396 |
| candidate | zh-CN/3 | 5576.4 | 1456 | 384 | 433.7 | 0.0 | 374 |
| candidate | ja/1 | 4366.9 | 1548 | 479 | 494.3 | 62.0 | 467 |
| candidate | ja/2 | 3913.3 | 276 | 235 | 291.6 | 5.0 | 230 |
| candidate | ja/3 | 3067.3 | 267 | 232 | 284.6 | 3.5 | 226 |

## 差异定位

### 1. 实际读取数量满足优化目标，但不等于延迟已经稳定改善

baseline 14 次普通导航 + 9 次 Lighthouse 均为 `GIFT_CONTENT=1` 与 `STOREFRONT_GIFT=1`，共 46 个正常内容请求。candidate 相同 23 次正常导航均为 `GIFT_CONTENT=0` 与 `STOREFRONT_GIFT=1`，共 23 个正常请求。全部 HTTP 200、原生 CREATE/HEADERS/COMPLETE 完整；候选四个额外边界共 5 个请求，不能混入正常样本。

减少的是该导航的这两类公开读取请求数，不能推导“所有数据库工作减半”。两组 UI 读取时长和 Lighthouse 读取时长的方向不同，尚不能给出稳定服务端延迟收益。

### 2. 三个候选样本出现实际呈现间隔

从 `lcp-breakdown-insight` 与 `network-requests` 得到：

| candidate 样本 | LCP 图片加载结束 | 最后 stylesheet 完成 | 最后字体完成 | 实际 FCP=LCP | 图片加载后呈现延迟 |
| --- | ---: | ---: | ---: | ---: | ---: |
| zh-CN/2 | 421.3 | 431.6 | 522.6 | 1472 | 1050.9 |
| zh-CN/3 | 398.4 | 407.2 | 492.8 | 1456 | 1058.0 |
| ja/1 | 497.5 | 501.5 | 596.3 | 1548 | 1050.3 |

这不是同样长度的数据库等待或图片网络下载：图片、stylesheet、字体都已在绘制前数百毫秒完成。三个样本的 DOMContentLoaded/Load 也分别在 991/992、888/888、1002/1003ms，早于首次绘制。

三个样本原 `main-thread-tasks` 列出的最大任务分别为 30.987、28.643、29.356ms，无大于 50ms 的实际顶层任务。主线程总工作量也没有同比增长 1 秒。该 audit 仅列大于 5ms 的顶层任务（本地 pinned `lighthouse/core/audits/main-thread-tasks.js`），因此只能排除一个连续长主线程任务解释，不能声称 CPU 完全空闲或已经证实 compositor/background 机制。

### 3. 模拟退化并非全部对应真实 1 秒间隔

candidate zh-CN/1 的实际 LCP 为 471ms，比 baseline 三次中位 567ms 更短，但模拟 LCP 为 4364.2ms。candidate ja/2 实际 276ms、模拟 3913.3ms，也没有实际绘制间隔。因此存在模拟关键路径对时序变化的放大，不能只用上述三个实际间隔解释全部模拟退化。

`render-blocking-insight.metricSavings.FCP` 在 zh-CN baseline 为 700/550/700ms，在 candidate 为 2650/4150/4150ms；ja 从 1150/2050/700 到 2800/2400/1200ms。此项是模型估计的反事实收益，不是实测 CSS 下载耗时，也不能据此认定 CSS 本身被改坏。两组相关 stylesheet 实际请求只持续约 4–30ms；CJK 最大 stylesheet 在模拟表中的请求估计约 609–762ms，两组均存在，并未出现实际 4 秒下载。

### 4. 没有新增客户端资源体量证据

按每种语言比较其 baseline/candidate 共 6 份报告，所有 Script、Stylesheet、Font、Image 的 URL 路径与 `resourceSize` 集合完全相同：

- 各语言均 8 个 script，解压大小合计 519,533 字节。
- 各语言均 4 个 stylesheet；共有 43,606、23,703、9,006 字节三份。语言样式 en 4,215、zh-CN 97,006、ja 100,106 字节，均未变化。
- 字体数量 en 2、zh-CN 9、ja 11；对应路径和字节集合均未变化。
- LCP 图片路径与字节相同，仍是 gift-main-image，且各次都通过 initial document discovery、high priority、eager 检查。
- document 解压大小也分别恒定为 en 91,896、zh-CN 91,720、ja 96,786 字节；压缩传输差异仅 0–2 字节。

因此没有证据支持“新代码增加 JS/CSS/font/image 下载体量”这一解释。资源路径/大小一致并不自动证明 SSR 流式调度、hydration 时间与渲染路径没有变化。

## 当前判断与交叉验证

首轮是单向 A→B、共享 seed、不同 Next 构建/浏览器进程，candidate 额外进行了四个错误路径探测，且宿主 benchmarkIndex 在 2652–4493 之间变化。不能据此把所有差异归因于改动，也不能用这些混杂因素把失败样本排除。

root 随后串行完成同设置 A→B 交叉复验（attempt 4 baseline、attempt 5 candidate），完整评价见后文；全部四组三次样本和预算结论保留，不用后来的较快结果替代首轮失败。

当前 runner 保存 LHR/HTML 与 native 日志，未保存这些导航独立的原始 trace/DevTools log（包括后续合计 36 次）。因此尚不能逐节点重放 Lantern 或确定三个约 1 秒呈现间隔的 compositor/visibility 原因；此缺口不能以猜测补足。

## 交叉复验：A2 原代码

第二轮原代码 A2 位于 `browser-attempt-4/gift-read-comparison/`，17:36:54–17:37:42Z 收集完 9 次 Lighthouse，状态仍为 `COLLECTED_DIAGNOSTIC_BUDGET_FAILED`。此轮在第一次 candidate 的原完整 UI 发布/回退检查之后：显示内容已回退，但 published proof/发布版本已有新历史，**不能称两轮使用完全同一个数据库 snapshot**。同样不将这一差异用作排除任何样本的理由。

| A2 语言 | 模拟 LCP 中位 | 实际 LCP 中位 | 首响应中位 | scoped 读取中位 |
| --- | ---: | ---: | ---: | ---: |
| en | 2615.9 | 283 | 246 | 241 |
| zh-CN | 3315.1 | 402 | 343 | 335 |
| ja | 2709.1 | 376 | 311 | 301 |

A2 出现原代码 zh-CN/2 模拟 LCP 4968.5ms / 实际 438ms、ja/2 模拟 3918.2ms / 实际 376ms，说明模拟高值并非只在第一次 candidate 出现；这仍不足以否定 candidate 的真实呈现延迟，也不能据此给出无回归结论。

| A2 样本 | 模拟 LCP | 实际 LCP | 首响应 | 主线程工作量 | 模拟 TBT | scoped 读取 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| en/1 | 2761.9 | 300 | 246 | 227.2 | 1.5 | 241 |
| en/2 | 2615.9 | 283 | 242 | 231.0 | 3.0 | 236 |
| en/3 | 2106.9 | 282 | 256 | 233.3 | 2.5 | 250 |
| zh-CN/1 | 2710.5 | 279 | 244 | 271.9 | 0.0 | 239 |
| zh-CN/2 | 4968.5 | 438 | 377 | 327.3 | 0.0 | 367 |
| zh-CN/3 | 3315.1 | 402 | 343 | 375.7 | 16.5 | 335 |
| ja/1 | 2629.7 | 383 | 315 | 328.4 | 6.0 | 307 |
| ja/2 | 3918.2 | 376 | 311 | 312.1 | 14.0 | 301 |
| ja/3 | 2709.1 | 292 | 260 | 277.6 | 0.0 | 254 |

## 交叉复验：B2 候选与全部 36 个样本的评价

B2 位于 `browser-attempt-5/gift-read-comparison/`，17:39:22–17:40:09Z；状态为 `COLLECTED_DIAGNOSTIC_BUDGET_FAILED`。同样在原完整 UI 发布/回退之后。root 已确认恢复候选源字节，不把回退后的 proof 历史视作初始 snapshot。

| B2 语言 | 模拟 LCP 中位 | 实际 LCP 中位 | 首响应中位 | scoped 读取中位 |
| --- | ---: | ---: | ---: | ---: |
| en | 2625.9 | 326 | 285 | 277 |
| zh-CN | 4358.9 | 291 | 237 | 231 |
| ja | 2711.0 | 270 | 236 | 231 |

| B2 样本 | 模拟 LCP | 实际 LCP | 首响应 | 主线程工作量 | 模拟 TBT | scoped 读取 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| en/1 | 2776.6 | 351 | 291 | 254.1 | 5.5 | 285 |
| en/2 | 2625.9 | 326 | 285 | 263.6 | 6.0 | 277 |
| en/3 | 2623.9 | 305 | 262 | 261.2 | 5.0 | 253 |
| zh-CN/1 | 2626.1 | 359 | 287 | 319.4 | 5.0 | 277 |
| zh-CN/2 | 4508.3 | 267 | 213 | 269.1 | 4.0 | 207 |
| zh-CN/3 | 4358.9 | 291 | 237 | 271.6 | 3.0 | 231 |
| ja/1 | 3159.8 | 270 | 236 | 282.7 | 2.0 | 231 |
| ja/2 | 2260.0 | 275 | 243 | 276.0 | 2.0 | 237 |
| ja/3 | 2711.0 | 255 | 222 | 294.9 | 0.0 | 217 |

四组完整结论如下：

1. **行为证据稳定。** 每轮 baseline 23 次正常导航为 46 个两类内容请求，每轮 candidate 相同 23 次为 23 个，正常请求均 200，候选 4 个额外边界分别保留。36 个 Lighthouse 样本全部同导航内容有效，实际 `configSettings` 完全一致；按 locale 比较 12 份报告的 Script/Stylesheet/Font/Image 路径与解压字节集合也全部一致。
2. **延迟方向不完全稳定。** 14 次 UI scoped 读取中位按 A1/B1/A2/B2 为 308/468.5/305/217.5ms。Lighthouse 第二轮 zh/ja scoped 中位下降，但 en 为 A2 241→B2 277ms；不能报告所有场景都更快。
3. **B1 实际呈现异常未解释。** B2 的 actual LCP en 305–351、zh 267–359、ja 255–275ms，图片加载后呈现延迟为 25–61ms，未再出现约 1 秒间隔。后次未重现不是修复证明，更不能删除 B1 的三个慢样本。
4. **中文模拟劣化两轮都存在。** A1→B1 为 2677.3→5573.3ms；A2→B2 为 3315.1→4358.9ms。虽然原代码也有单次 4968.5ms，仍不足以将候选两轮较慢中位归为噪声。日文 A1→B1 2885.9→3913.3ms、A2→B2 2709.1→2711.0ms，第二轮未重演第一轮的中位退化，但没有证明原异常不存在。
5. **正式性能门仍未通过。** 四轮各三个语言组的 LCP 中位全部高于 2500ms；12 组没有任何一组因此满足完整性能预算。不能把其中个别小于 2500ms 的样本单独当成通过，更不能把 B2 替换 B1。当前只接受读取一致性与功能检查点，性能门保持 OPEN。

## 下一项有界证据步骤

建议下一次只收集中文礼物页的一对原代码/候选组，各固定 3 次，共 6 次导航；保持现有 pinned Lighthouse、原 slow-4G/CPU 模拟设置、内容校验、诊断计数、Chrome 默认特性与原预算。预先规定次数，出现失败也保存原结果，不通过不断重跑寻找快样本。若要研究首轮真实绘制间隔，必须在同一导航发生时取证，不能靠之后另一次普通截图重建。

在每个 Lighthouse `RunnerResult` 保留现有 LHR/HTML之外，保存该次 `artifacts.Trace` 与 `artifacts.DevtoolsLog`（pinned 类型位于本地 `lighthouse/types/artifacts.d.ts`），连同源指纹、完整配置、对应 Next generation/原生 sequence 窗口及数据库发布版本。原始 trace/DevTools log 只留受控 TEST 虚构公开内容场景，避免触碰支付、查单或私密消息路径。

随后离线完成两条核对：

- 用同版本 Lantern 模型重放，确认能复现该 LHR 的 FCP/LCP 数值，再找出 optimistic/pessimistic 关键路径中最后的 stylesheet/font/script/CPU 节点及依赖边；区分下载、执行、文档流式到达与模型排序的贡献，不用 `render-blocking-insight` 的反事实收益代替该证明。
- 对 observed FCP/LCP，定位图片 request finish、PaintImage、raster/activate/presentation、主线程任务、页面 visibility 与丢帧事件。如果再次出现约 1 秒间隔，判断延迟确切位于何环节；如果未出现，如实记录未重现，不宣称已修复。

不禁用 Chrome feature、不改变屏幕/限速/阈值、不增加预热或优选运行，不在同一性能采样期间运行构建和 CPU 检查。下一次有界实验也属于诊断；不能用它替代最终原七语言正式矩阵、RUM、真机及人工验收。

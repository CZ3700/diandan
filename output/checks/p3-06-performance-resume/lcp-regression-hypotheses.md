# CNgift / JAhome LCP 回退：已有证据与待验证假说

只读分析，2026-09-16。结论：模拟 LCP 回退真实存在，但不能据此断言实际绘制变慢或字体优化造成回退。**paint 截点前完成的字体集合变化**与模拟值分档高度一致，是目前最具体、可用 trace 验证的假说。未运行 Chrome、构建、测试或新测量，未修改产品源；原失败和无效样本均保留。本报告不改变预算或正式验收结论。

输入：

- baseline：`baseline-repeat/attempt-2026-09-16T07-04-10.806Z-db2a7fd0/{zh-CN-gift,ja-home}-mobile-{1,2,3}.json`，相对本报告目录。
- candidate：`output/checks/p3-06-storefront-acceptance/run-2026-09-16T06-56-33-163Z/browser-attempt-4/performance/` 下同名 6 个 LHR，路径相对仓库。
- 两组使用相同 Lighthouse 13.4.1 / Chrome / 节流设置；这 12 份内容验证有效。attempt4 整体仍在 41/63 因另一份无效内容中止，不能称完整通过。

## 实测时序与模拟结果

单位 ms，保留 3 位。observed 来自 `audits.metrics` 的精确 timestamp 差值，而非整数显示值。TTFB/图片发现延迟来自 `lcp-breakdown-insight`，不是模拟 TTFB。

|页面 / 版本 / 次数|模拟 LCP|模拟 FCP|observed LCP|observed FCP|TTFB|图片发现延迟|
|---|---:|---:|---:|---:|---:|---:|
|CN gift baseline 1|2613.405|1506.270|227.790|227.790|191.051|3.288|
|CN gift baseline 2|2706.902|1504.601|218.611|218.611|184.902|3.389|
|CN gift baseline 3|4507.992|3457.992|219.362|219.362|185.262|3.493|
|CN gift candidate 1|4964.349|4214.349|439.503|439.503|358.847|5.855|
|CN gift candidate 2|4358.877|3458.877|257.431|257.431|224.087|3.655|
|CN gift candidate 3|4959.707|4209.707|254.728|254.728|216.985|3.489|
|JA home baseline 1|2556.551|1507.034|612.889|35.992|5.008|573.624|
|JA home baseline 2|3387.459|1508.306|640.350|53.745|6.744|607.312|
|JA home baseline 3|2780.490|1356.660|620.627|34.779|5.194|586.320|
|JA home candidate 1|2686.921|1505.281|547.403|41.697|4.064|513.337|
|JA home candidate 2|3383.465|1505.643|542.475|26.394|3.637|507.730|
|JA home candidate 3|3382.202|1504.802|517.553|39.670|4.273|485.973|

CN baseline 第 2→3 次 observed LCP 仅差 0.751ms，模拟 FCP 却差 1953.391ms；异常分档在旧版本已存在。candidate 第 1 次确实有实际 TTFB 增长，图片渲染延迟也达 68.998ms（其余约 25–30ms），需要独立解释。第 2/3 次 observed LCP 仅比相应 baseline 晚 38.820/35.366ms。JA 三次 observed LCP 全部更早，不能把模拟中位数增加等同于实际首屏回退。

## 资源与 LCP 元素没有显示的新回退

- CN 六次都是 380×380 的 `Rose Palace · zh-CN` 礼物主图；JA 六次都是 412×515 的 `Mira Vale independent mobile · ja` hero。各页 selector、尺寸相同。全部通过 high priority、初始文档可发现、非 lazy 三项 discovery 检查。
- 图片下载：CN baseline 2.961–3.171ms、candidate 4.764–5.803ms；JA baseline 2.026–2.374ms、candidate 1.707–1.828ms，不能直接解释秒级模拟差。
- `network-dependency-tree-insight`：CN 六次只列主文档，最长链 574/550/548 → 990/589/650ms；JA 列文档、CSS、字体，最长链 903/928/911 → 726/734/777ms。这个 insight 的树不是 Lantern LCP 模拟图，不应据此断言字体有无进入模拟。
- 字体实际 transfer：CN 每次 12 个 / 724747B → 9 个 / 556871B；JA 每次 22 个 / 542931B → 4 个 / 174170B。主要 locale CSS 也略小：CN 34085→33363B，JA 33806→33412B。`font-display-insight` 六组均无条目。
- TBT：CN 24.5/19/20 → 0/0/0ms；JA 33.5/37.5/35.5 → 2/2/1ms。现有 LHR 不支持新增 JS 阻塞是主因。

## 假说 1：paint 截点改变模拟图的字体候选集合（优先验证）

本地锁定依赖 `@paulirish/trace_engine@0.0.65` 的 `models/trace/lantern/metrics/FirstContentfulPaint.js#getFirstPaintBasedGraph`，以 observed paint 时间排除在其后结束的非主文档 network 节点；`LargestContentfulPaint.js` 同样以 observed LCP 构图，再取模拟节点结束时间。FCP 还会检查资源优先级，LCP 排除低优先级图片等。**以下只是按 LHR 的 networkEndTime 与精确 paint 截点比较的候选集合，不等同于已经重建的最终依赖图。**

|页面 / 版本|第 1 次 paint 前字体|第 2 次|第 3 次|对应模拟 FCP / LCP 档位|
|---|---|---|---|---|
|CN baseline|0|0|5：Latin、UI、117、112、116|FCP 1506 / 1505 / 3458|
|CN candidate|7：上面 5 个加 115、113|5：同 baseline 第 3 次|7：同 candidate 第 1 次|FCP 4214 / 3459 / 4210|
|JA baseline|0|2：Latin、UI|1：Latin|LCP 2557 / 3387 / 2780|
|JA candidate|1：Latin|2：Latin、UI|2：Latin、UI|LCP 2687 / 3383 / 3382|

边界实例：CN baseline 1 的 UI 于 227.812ms 完成，LCP 227.790ms；baseline 3 的 UI 于 218.501ms 完成，LCP 219.362ms。JA candidate 1 的 UI 于 548.006ms 完成，LCP 547.403ms；candidate 2 的 UI 于 540.012ms 完成，LCP 542.475ms。相同二进制的完成时间只跨越很短的 observed 截点，模拟值却可进入另一档。

后续验证应保留准确 trace / DevTools log / Lantern 输入，对 CN baseline 2↔3、candidate 2↔3，以及 JA candidate 1↔2 比较 optimistic/pessimistic 图中的字体、其祖先依赖、模拟终点节点与 transfer 权重。如果这些字体没有进入最终图，或非字体终点单独解释差值，本假说应被否定或缩小。baseline 已有原始 trace；正式 attempt4 仅保存 LHR/HTML，不能凭本报告冒充完成候选图重放。不得删除离群样本、改节流、阈值或只择优重跑。

## 假说 2：文档/SSR 等待造成局部实际变慢（独立验证）

CN candidate 第 1 次的高 TTFB、完整文档长链与 render delay 同时增加，需同一导航的服务器读事务/SSR 和流式响应时间定位；仅凭 LHR 不能区分 API 等待、主机调度或其他原因。JA hero 发现延迟仍约 486–513ms，且 FCP 已先出现；这符合内容较晚到达/被发现的可能性，但比 baseline 的 574–607ms 改善，是已有机会点而非本轮回退证据。两者都不能用来解释目前另一导航的无效内容错误，后者原因仍待 TEST diagnostics。

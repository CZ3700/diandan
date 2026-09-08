# 最终 63 次 Lighthouse 的剩余性能诊断

本报告只读现有 JSON、已有 Lantern 重算结果和对应源码；没有重跑浏览器、构建、网络或新实验。产品提交 `7db722b4f5480ffb78eb19f5e2eec7675e50b1bd`，995 个构建输入 SHA `df759a88a8dd62d8f08a08eccf87f2e29781e867ffffe955e4f554b7cadce62e`。本机 TEST 编译版，Chrome 152.0.7977.82、Lighthouse 13.4.1 原移动端模拟节流保持不变，不是 RUM、真机或生产 CDN。

## 结论及新增的内容状态缺口

原结论仍为 `COLLECTED_BUDGET_FAILED`：21 个三次中位数组中评分 18 组达标，硬 LCP `<2500 ms` 仅 3 组达标，CLS 21 组达标且中位数均为 0。全部 63 样本保留，不挑最好、不排除异常样本、不替换中位数。数值和资源字节独立复核见 [final-performance-review.json](./final-performance-review.json)。

逐样本读取 LCP 元素后发现 **62 个内容图片 LCP、1 个临时不可用页面 LCP**。`ja-artist-mobile-2.json` 的 `lcp-breakdown-insight` 明确记录 `div.storefront > main#main-content > section.storefront-state > h1`，文本为“このページは一時的に表示できません。”；raw 内 `final-screenshot` 已人工查看，确实显示该错误、重试按钮和“所有艺人”链接，非加载状态。该次模拟 LCP 2558.7594 ms，实测 LCP 33.872 ms，采集开始于 `2026-09-08T03:09:27.337Z`。所有浏览器网络条目 HTTP 200、无 Lighthouse runtimeError，并不等于业务内容成功。

代码证据：`packages/i18n/src/storefront/ja.ts` 的 `contentError` 与该文本相同；`apps/storefront/src/storefront/artist-page-factory.tsx` 会在内容读取失败时渲染它。`apps/storefront/src/server/public-catalog.ts` 将多种上游失败、响应身份/schema 不匹配或捕获异常统一为 `CONTENT_UNAVAILABLE`，现有 raw 不能区分这些原因。`next-runtime-7.log` 仅 416 字节启动/停止记录；外层 `baseline-runtime.log` 该段仅采样进度，没有相关 API 状态、SQLSTATE 或错误时延，因此**不能归因数据库、权限过期、网络超时或机器波动**。fixture 静态清单不证明 03:09:27 的动态数据库状态。

验收器的具体缺口：`apps/api/scripts/storefront-acceptance-performance.mjs` 的前置资源页等待目标 selector，但后续每次独立 Lighthouse 导航仅检查版本、runtimeError 和数值；前一个页面成功不能证明后一次导航内容成功。需要下次在不改变 Lighthouse 配置的前提下保留每个被测导航的业务内容状态；本次保留异常并如实标记。其余 62 个图片 LCP 只证明该元素存在，也不能据此声称全页面业务字段逐项都正确。独立 review JSON 已新增这些范围，不改变原聚合。

## 21 组按页面归类

下表均为三次中位数，单位 ms。模拟 LCP 是实际预算判定值；observed 和四个阶段来自同一次未施加真实网络节流的 trace 观察。**阶段分解不能拿来相加解释模拟 LCP**；各列单独取中位数，也不要求这些列相加等于 observed 中位数。

| locale / 页面 | 模拟 LCP | observed LCP | observed TTFB | 图片发现延迟 | 图片下载 | 元素渲染延迟 | 硬 LCP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| en / home | 2833.3 | 393.4 | 4.9 | 369.4 | 2.0 | 16.5 | 未达标 |
| en / artist | 2458.9 | 99.8 | 70.4 | 3.4 | 3.5 | 24.5 | 达标 |
| en / gift | 2613.6 | 287.1 | 252.7 | 3.8 | 4.4 | 26.6 | 未达标 |
| zh-CN / home | 2688.9 | 493.9 | 3.9 | 468.6 | 1.7 | 20.1 | 未达标 |
| zh-CN / artist | 2460.9 | 107.4 | 67.7 | 3.5 | 4.2 | 31.1 | 达标 |
| zh-CN / gift | 4207.1 | 247.2 | 214.5 | 3.5 | 3.6 | 41.2 | 未达标 |
| th / home | 2777.3 | 494.8 | 3.8 | 460.7 | 1.8 | 30.0 | 未达标 |
| th / artist | 2610.1 | 123.9 | 68.1 | 3.5 | 4.3 | 46.0 | 未达标 |
| th / gift | 2763.0 | 276.8 | 198.1 | 3.4 | 4.2 | 66.7 | 未达标 |
| vi / home | 2682.9 | 477.5 | 3.4 | 456.0 | 1.8 | 15.6 | 未达标 |
| vi / artist | 2608.8 | 102.5 | 65.0 | 3.4 | 3.5 | 32.0 | 未达标 |
| vi / gift | 2760.3 | 238.4 | 198.6 | 3.4 | 3.6 | 32.2 | 未达标 |
| ja / home | 3306.4 | 523.7 | 3.7 | 491.6 | 2.2 | 24.3 | 未达标 |
| ja / artist | 3607.1 | 100.7 | 72.0 | 混合内容¹ | 混合内容¹ | 29.2 | 未达标 |
| ja / gift | 3756.7 | 264.0 | 227.9 | 3.3 | 2.7 | 25.8 | 未达标 |
| es / home | 2835.1 | 418.5 | 4.2 | 389.2 | 1.9 | 20.9 | 未达标 |
| es / artist | 2460.4 | 91.9 | 67.1 | 3.4 | 4.2 | 15.6 | 达标 |
| es / gift | 2610.0 | 239.3 | 208.8 | 3.3 | 3.5 | 24.9 | 未达标 |
| pt / home | 2834.9 | 466.7 | 3.7 | 437.5 | 1.8 | 22.4 | 未达标 |
| pt / artist | 2610.2 | 108.4 | 70.0 | 3.5 | 3.8 | 32.7 | 未达标 |
| pt / gift | 2610.7 | 256.0 | 219.2 | 3.3 | 2.9 | 30.5 | 未达标 |

¹ 日语艺人组包含上述不可用 H1 样本；该样本不存在图片发现/下载阶段，因此不以 0 补齐或当作三次正常图片计时。原模拟 LCP 三值为 3760.3 / 2558.8 / 3607.1 ms，中位数照旧 3607.1 ms。

- **所有首页**：实际 TTFB 中位数仅 3.4–4.9 ms，但图片发现阶段中位数 369.4–491.6 ms；下载只 1.7–2.2 ms。源码已有目录独立 Suspense，首页仍必须等待真实首页组合 proof 才渲染图片。直接观察支持“早返回 shell 后，内容图片较晚进入可请求状态”；不能把它写成缓存图片下载慢，也尚不能由 raw 精确划分 API proof、SSR 发出与浏览器解析的各自耗时。
- **正常艺人详情样本**：图片通常在首字节后约 3–4 ms 即发起；语言组主要差距不在 observed 图片下载。en、zh-CN、es 组硬 LCP 中位数通过，但 zh-CN 单次仍有 3907.9 ms，不能声称每次都通过。
- **礼物详情**：各语言 observed TTFB 中位数 198.1–252.7 ms，图片发现约 3–4 ms，下载约 3–4 ms。模拟 LCP 仍是 2610–4207 ms，因此不能用 localhost 的快速图片下载宣称慢 4G 预算已满足。

全部 62 个图片 LCP 的 `lcp-discovery-insight` 均显示 `priorityHinted/requestDiscoverable/eagerlyLoaded = true`。全部 63 个 `font-display-insight.score = 1`；不能把补 high priority、eager 或 optional 字体当作尚未实现的优化。63 次 TBT 最大值仅 5 ms，不能仅凭它排除网络/脚本依赖图，也没有显著长 CPU 阻塞占据几秒的直接证据。

## 重点组的直接资源证据

### 中文礼物：4207 ms 不是 4 秒实际图片下载

三次模拟 LCP 为 4207.071 / 4809.9602 / 2624.2817 ms，三次内容 LCP 均是礼物图片。第 1 次 observed 247.203 ms = TTFB 214.498 + 发现 3.312 + 下载 3.593 + 渲染 25.800。

实际 750w 优化 AVIF 图片 body 47884 B、transfer 48415 B；网络约 217.727→221.216 ms，High。三次均下载同样 11 个字体资源、合计 637026 transfer B；其中 UI 字体 body 84152 B，仍有原始后备分片，以及 Latin 资源。中文 profile CSS `23z_5kqs9oyt-.css` 为 33919 transfer B / 98984 decoded B。第 1 次有 8 个字体请求在 observed LCP 之前发起，但“发起较早”不是 Lantern 因果关系。

三次相同字体数量/字节却出现不同模拟 LCP，现有 final raw 没保存完整 Trace/DevtoolsLog 或 Lantern nodeTimings，无法确认最后关键节点到底是字体、脚本、CPU 任务或它们的排队关系。`network-dependency-tree-insight` 在该礼物页仅列文档根，不提供这条关键链。`render-blocking-insight` 的预计节省约 2520 ms 是该 insight 的估算；该份 `metricSavings.LCP = 0`，不能当成“删除 CSS 就能节约 2.5 秒 LCP”。

### 日语：大资源图与一个真实不可用样本必须分开

日语首页 / 艺人 / 礼物的模拟中位数分别为 3306.4 / 3607.1 / 3756.7 ms。首页三次均图片 LCP，其实际图片发现中位数 491.6 ms；艺人组不能混淆不可用 H1 与图片样本。

日语礼物三次模拟 LCP 为 2558.6 / 3756.7 / 3758.1 ms，observed 244.9 / 264.0 / 272.9 ms（这里按数值排序）；三次都为图片 LCP。每次 21 个字体资源、505438 transfer B，CSS 共 47761 transfer B。最终日语 UI font body 为 96956 B，原完整字体后备仍参与；第 2 次的 750w 图片也是 body 47884 B、transfer 48415 B，约 242.840→246.899 ms。日语 profile CSS `237i6p23touk4.css` 为 33663 transfer B / 101065 decoded B。

这说明最终仍存在较大的字体/CSS请求集合，但不是字体主因的充分证明。其 `network-dependency-tree-insight` 同样只列文档根；正常图片样本的 render-blocking insight 也没有给出对应 LCP 可节省量。不能把之前 125 KB 日文字体的旧 critical path 直接复制为现在 96.956 KB 字体的因果结论。

### 英文首页与礼物：共同 JS 链仍须用最终 trace 证实

英文首页中位数 2833.3 ms、礼物 2613.6 ms；两者各次仅 2 个字体资源、61360 transfer B，CSS 共 15355 transfer B。首页 observed 图片发现阶段中位数 369.4 ms，礼物则是 TTFB 中位数 252.7 ms。首页第 2 次 hero body 16733 B，High 请求约 366.252→368.127 ms；英文礼物图片 body 47884 B。直接数据不支持把英文余下超标统称为“大 CJK 字体”或“图片没压缩”。

## 前两轮 Lantern 证据的适用边界

已有两轮保留了 Trace/DevtoolsLog 并由同版本 Lighthouse 精确重算，全部 `differenceMs = 0`，本报告未再重算：

- [baseline Lantern](./baseline-trace/attempt-2026-09-08T01-50-00.639Z-64843ee6/lantern-node-analysis.json)：英文礼物第 1 次模拟 LCP 3245.4255 ms，最后 CPU 任务 66 ms，等待 transfer 73777 B 的 `2p07cckado7sy.js` 到 3179.4255 ms；图片早于该链完成。日语第 1 次最终节点是原 `noto-sans-jp-85` 字体，到 5422.9389 ms。
- [第一候选 Lantern](./candidate-trace/attempt-2026-09-08T02-27-50.271Z-5a587533/lantern-node-analysis.json)：英文第 1 次为 2917.6725 ms，最后 CPU 54 ms 依赖同脚本结束 2863.6725 ms；日语第 1 次 3908.5161 ms，最终节点是当时 body 125004 B 的 UI font。当前该字体已为 96956 B，且抽屉与其他客户端装载已有后续改动。

这些精确旧图支持下一次优先验证网络依赖与请求调度，而不是猜测某个长任务。但旧源码的终点不是最终源码终点。最终 raw 只能观察请求字节与时序，无法无损重建模拟乐观/悲观网络和 CPU 图；HTTP/1.1 localhost 观察与模拟慢 4G 不是同一时延。不得改变协议、节流算法或阈值来取得更好分数。

## 最多两个下一次可证伪的候选

1. **首页内容可用时间**：围绕现有首页组合读取和 SSR 输出做一轮有界计时，验证是否能在保持原子发布 proof、版权与失败关闭规则不变的情况下减少重复读取/计算，使有效 hero 更早进入 HTML/预加载流。当前目录已经独立 Suspense，不能再把“移出目录等待”当作新优化。可证伪标准：同配置新 trace 中原 369–492 ms 的发现阶段若不随后端路径耗时下降，或关键图仍由后续 JS/字体决定，则该候选不能解释硬 LCP 超标。
2. **最终关键资源链的竞争**：有限选 zh-CN gift、ja gift/artist 及 en gift 对照，保留三次完整 Trace/DevtoolsLog/Lantern 输入，先核实正常业务内容，再判断终点是否仍由原始后备字体请求或共同 JS 等待。若最终图确认非首屏内容引发后备字体竞争，才测试推迟该非关键渲染且保留全部原文字形/完整后备、可访问性与布局；若终点是共同 JS，则只定位该实际模块的必要性，不能先删字体。可证伪标准：在同一预算与样本规则下，候选资源不在终点依赖链，或减少它不使模拟终点提前，就拒绝该假设。严禁按夹具文案挑字符、去掉原后备字形或把旧 trace 推断作为最终证明。

业务不可用样本需要先补可观测诊断与采样完整性，属于结果可信度前提，不计为第三项性能优化，也不允许用“重跑替换”抹去本次失败。

## SHOULD 与硬门分开

84 资源页有 70 页高于首屏 JS gzip `<150000 B` 的 SHOULD 建议，范围 148428–152024 B；这是建议未满足，不是把硬 LCP 放宽到相同的级别。234 个实际图片观测均满足其角色字节建议，也不能据此宣布 LCP 通过。上述结果是本地实验室检查；没有生产 RUM、真实手机或最终批准素材性能证据。

## 证据入口

- 原 63 LHR 与 21 aggregates：[最终 performance 目录](../p3-06-storefront-acceptance/run-2026-09-08T01-40-26-728Z/browser-attempt-7/performance/)。重点文件 `zh-CN-gift-mobile-1.json`、`ja-artist-mobile-2.json`、`ja-gift-mobile-2.json`、`en-home-mobile-2.json`、`en-gift-mobile-1.json`。
- [逐 63 份只读提取](./remaining-performance-evidence.json)：元素分类、observed 分解、网络资源与 insight 字段；全导航 font transfer 不是自动等于首屏或 LCP critical bytes。
- [追加内容范围的独立复核](./final-performance-review.json)：原 median/预算不变，新增 62 图片 / 1 不可用的逐样本证据。
- [Next 日志](../p3-06-storefront-acceptance/run-2026-09-08T01-40-26-728Z/next-runtime-7.log)、[外层日志](./baseline-runtime.log)：未包含该次上游失败原因。所有旧失败报告继续保留。

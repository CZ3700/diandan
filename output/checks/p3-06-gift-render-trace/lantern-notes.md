# P3-06 pinned Lantern 与 observed paint 离线分析入口

范围：只分析 root 控制的 TEST 礼物导航。不得以模拟结果替代实际绘制，不把样本之外的历史 trace 事件套用于本轮，也不以缺事件证明没有工作。性能门仍 OPEN。

## 已核对的本地官方实现

当前锁定 `lighthouse@13.4.1`，其 Lantern 实现来自 `@paulirish/trace_engine@0.0.65`。以下都是本地已安装的依赖源码，不自行重写指标算法：

- `lighthouse/core/audits/metrics/first-contentful-paint.js` 与 `largest-contentful-paint.js`：`numericValue` 直接采用各自 computed metric 的 `timing`。
- `lighthouse/core/computed/metrics/first-contentful-paint.js`、`largest-contentful-paint.js`：navigation + simulate 调用对应 Lantern computed artifact。
- `lighthouse/core/computed/metrics/lantern-metric.js`：默认图来自 `DevtoolsLog` + `ProcessedTrace`；只有 `INTERNAL_LANTERN_USE_TRACE` 被设置时切为 TraceEngine 图。本检查点不设置该键。采集 config 记录 `internalLanternUseTracePresent: false`，离线也拒绝该键存在，避免图源混算。
- `lighthouse/core/computed/page-dependency-graph.js`：默认模式将 `NetworkRecords` 映射为 Lantern network request，与主线程 trace 事件构图。
- `lighthouse/core/computed/load-simulator.js`：使用原 DevtoolsLog 网络分析和原配置创建模拟器，不另设延迟/吞吐/CPU 参数。
- `trace_engine/models/trace/lantern/metrics/{Metric,FirstContentfulPaint,LargestContentfulPaint}.js`：FCP/LCP optimistic 与 pessimistic 的权重均 0.5，无 intercept；LCP 最后至少为 FCP，并在取 terminal estimate 时排除 Low/VeryLow image。图构造仍可能保留它们，所以摘要保存所有节点，只限制 LCP terminal 候选。
- `lighthouse/core/lib/tracehouse/trace-processor.js`：官方 `ProcessedTrace/ProcessedNavigation` 定位主 frame、time origin、有效 FCP/LCP。`lighthouse/core/audits/metrics.js` 对 observed summary 取整；离线核验同样先 `Math.round`，不拿整数 summary 与微秒事件要求逐小数相等。
- `trace_engine/models/trace/handlers/LargestImagePaintHandler.js`：LCP `nodeId` 与同 renderer PID 的 `LargestImagePaint::Candidate.args.data.DOMNodeId` 对应；从该事件取得 image URL。相同 nodeId 在别的 renderer 不代表相同元素。

## 输入/输出约定

采集 callback 在 `<browser-attempt>/gift-render-trace/` 每次固定保存 `zh-CN-gift-mobile-1..3`：

- `.json`：原 LHR；`-trace.json`：原 `artifacts.Trace`；`-devtools.json`：原 `artifacts.DevtoolsLog`。
- `-artifacts.json`：完整原 artifacts，保留 `settings/URL/GatherContext/SourceMaps/HostDPR` 等。
- `-config.json`：采集设置和 `internalLanternUseTracePresent`；此外采集器保留 HTML、原生序列窗口、发布 proof 与状态报告。

离线入口：

```sh
mise exec node@24.20.0 -- node apps/api/scripts/storefront-gift-trace-analysis.mjs \
  --input <gift-render-trace-directory> \
  --output <new-analysis-directory>
```

输出目录必须不存在，避免覆盖旧失败。按序离线分析三次；单次失败写到 `results.json` 并继续保留其他既定样本结果，最后任一失败令 exit 非零。分析只读取本地文件，不启动服务、浏览器、网络或构建。

官方 computed 输入为 `Trace/DevtoolsLog/GatherContext/lhr.configSettings/URL/SourceMaps/HostDPR/simulator:null`，使用每次独立的 computed cache。standalone trace/devtools 必须与完整 artifacts 深比较一致；安装的 Lighthouse 版本必须与原报告同为 13.4.1。FCP/LCP 两项复算与原 `numericValue` 差的绝对值必须 ≤0.000001ms，否则不输出“权威关键路径”结论。该容差仅容纳浮点计算误差，不是放宽性能预算。

## 模拟图摘要的含义

每个 FCP/LCP optimistic/pessimistic 模型保存全部 node timings、原观测时间、节点类型、资源文件/URL摘要、CPU 子事件分类和全部显式依赖边。保存指标终点节点，以及沿“完成最晚的显式依赖”回溯的链，平局在节点字段中完整保留。

这些链不是浏览器真实关键路径，也不是模拟器所有资源竞争原因。节点等待其显式依赖完成后的间隔标为 `UNRESOLVED_SCHEDULER_OR_CONTENTION`，不擅自归因某 stylesheet 或某条 CPU 任务。若需要区分 socket/CPU 调度竞争，应进一步检查 pinned simulator 的调度记录与该图，不能直接把最新完成依赖称作根因。

## 实际绘制摘要的含义

从官方选中的 LCP/主 renderer 和导航 time origin 建立独立时间线。只有同 renderer 且 nodeId 或 image URL 匹配的 `PaintImage` 才进入候选列表；`nodeMatches: true` 是与目标节点的强关联，URL-only 项显式标为可能是另一个复用该图片的节点，不能等量作为目标节点证据。保留 `LargestImagePaint` 的进程/node 证据及匹配网络记录。候选窗口包含 LCP 后 250ms，分析 LCP 绘制前链时必须另取 `startMs <= selectedLcp.startMs` 的强关联事件，不能直接取数组末尾的后续 repaint。

Raster、ActivateLayerTree、Presentation、DroppedFrame 与 visibility 等事件只分为同 renderer 邻近或其他进程邻近，保留可用 layer/frame/sequence 字段，统一标注尚未与该图片建立因果关系。不能用“最近一个 Raster/Activate”证明目标图片已经 raster/提交，缺少事件不能证明整个期间一直 visible 或 compositor 空闲。`compositorCause` 初始保持 `UNKNOWN`，由具体关联证据决定是否能进一步分析。

## 完成的验证与输入绑定

2026-09-17 root 确认固定六次采集完成后才运行离线重放。源码此后冻结，没有启动服务、Chrome 或构建。

- 原采集根：`../p3-06-storefront-acceptance/run-2026-09-17T04-12-40-212Z/`。
- baseline：`browser-attempt-1/gift-render-trace`，旧礼物两读取入口；candidate：`browser-attempt-2/gift-render-trace`，复用 scoped gift 读取。
- 两组各三个固定 zh-CN 礼物导航；完整结果为 [baseline-analysis/results.json](baseline-analysis/results.json) 和 [candidate-analysis/results.json](candidate-analysis/results.json)，每样本还有独立 `-analysis.json`。
- **6 次 × FCP/LCP = 12 项与原 LHR 的数值差严格为 0**，不是仅在容差内。两组状态均 `ALL_REPLAYS_MATCHED`。这验证算法与输入复现，不表示预算通过；输出始终保留 `performanceAcceptance: false`。
- 每次 LHR、Trace、DevtoolsLog、完整 artifacts、config 共 5 文件逐字节长度/SHA256 绑定到采集 `results.json` 描述，共 30 文件。另严格核对三处 requested URL、两处实际 settings，standalone Trace/DevtoolsLog 与完整 artifacts 内容一致。安装/报告 Lighthouse 都是 13.4.1；采集与离线 `INTERNAL_LANTERN_USE_TRACE` 均不存在。
- 内容、发布 proof 与两份 production entrypoint SHA 的比较由 root 在采集证据层审计；离线数值匹配不代替这些检查，也不把 SHA 描述当成独立真实性签名。

### TDD 与静态验证记录

以下轻量命令在实际执行后补记。RED 是当时预期失败的工具结果，不是现在重新破坏代码制造失败；当时未用 `run-check.py` 保存原始日志，不虚构日志文件或时间戳。

|阶段|准确命令|实际退出码与结果|
|---|---|---|
|初始 RED|`mise exec node@24.20.0 -- node --test apps/api/scripts/storefront-gift-trace-analysis.test.mjs`|1；4 项失败：重放差异拒绝、图依赖/等待/隐私、LCP terminal、观测事件关联|
|初始 GREEN|同上|0；4/4 通过，约 0.043s|
|绑定测试 RED|同上|1；5 项中 4 通过、URL/settings/SHA 篡改绑定项失败；新增守卫前已实际看到失败|
|最终 GREEN|同上|0；5/5 通过，约 0.036s|
|格式|`mise exec node@24.20.0 -- corepack pnpm exec prettier --write apps/api/scripts/storefront-gift-trace-analysis.mjs apps/api/scripts/storefront-gift-trace-analysis.test.mjs`|0|
|静态检查|`mise exec node@24.20.0 -- corepack pnpm exec eslint apps/api/scripts/storefront-gift-trace-analysis.mjs apps/api/scripts/storefront-gift-trace-analysis.test.mjs --max-warnings=0`|0|

真实重放的准确命令和退出结果另有原始记录，未覆盖失败目录：

```sh
python3 output/checks/p3-06-gift-render-trace/run-check.py baseline-lantern-replay \
  mise exec node@24.20.0 -- node apps/api/scripts/storefront-gift-trace-analysis.mjs \
  --input output/checks/p3-06-storefront-acceptance/run-2026-09-17T04-12-40-212Z/browser-attempt-1/gift-render-trace \
  --output output/checks/p3-06-gift-render-trace/baseline-analysis

python3 output/checks/p3-06-gift-render-trace/run-check.py candidate-lantern-replay \
  mise exec node@24.20.0 -- node apps/api/scripts/storefront-gift-trace-analysis.mjs \
  --input output/checks/p3-06-storefront-acceptance/run-2026-09-17T04-12-40-212Z/browser-attempt-2/gift-render-trace \
  --output output/checks/p3-06-gift-render-trace/candidate-analysis
```

[baseline-lantern-replay-result.json](baseline-lantern-replay-result.json)：exit 0，0.532s，04:21:18.499707Z 至 04:21:19.031793Z；[candidate-lantern-replay-result.json](candidate-lantern-replay-result.json)：exit 0，0.372s，04:21:25.559091Z 至 04:21:25.930712Z。各自 `.log` 同目录保留。

## 六个样本：模拟与实际分别记录

下表 A1–A3 是本次 baseline 三导航，B1–B3 是本次 candidate 三导航；不是前一检查点的四个组名。单位毫秒，展示值四舍五入三位，JSON 保存原精度。

|样本|模拟 FCP|模拟 LCP|实际 FCP|实际 LCP|实际主图请求耗时|主图完成→LCP|图片缓存状态|
|---|---:|---:|---:|---:|---:|---:|---|
|A1|1515.517|5431.034|403.458|584.152|246.661|1.733|MISS|
|A2|2411.597|3311.596|282.854|282.854|6.746|27.483|HIT|
|A3|1510.818|2626.227|348.497|348.497|7.922|53.776|HIT|
|B1|3165.831|5421.108|383.076|534.137|207.799|4.352|STALE|
|B2|1509.260|2109.260|245.258|245.258|7.657|26.016|HIT|
|B3|1508.959|2620.439|256.582|256.582|4.523|30.908|HIT|

**本次没有复现前次约 1 秒的图片完成后呈现间隔；这不等于前次问题已解释或修复。** 本次 A1/B1 主图完成后分别 1.733/4.352ms 即记录官方选中的 LCP。其余四次也在 26.016–53.776ms 内。前次 36 个有效样本和失败预算仍全部有效，本次六个诊断导航不能替换或挑选它们，更不能关闭性能门。

### 实际 PaintImage 链与边界

同 renderer 且同 LCP node 的首次绘制、所选 LCP 顺序如下：

|样本|主图网络完成|LCP 之前强关联 PaintImage|官方 LCP|
|---|---:|---:|---:|
|A1|582.419|582.934|584.152|
|A2|255.371|276.819|282.854|
|A3|294.721|341.711|348.497|
|B1|529.785|532.384|534.137|
|B2|219.242|239.418|245.258|
|B3|225.674|249.388|256.582|

每次都有同 URL、其他 node 的 PaintImage，不能混入这条强关联链。A2/A3/B2/B3 还有 LCP 之后的同节点 repaint，均未拿来计算上述间隔。窗口内 A1/B1 分别有 50/47 个其他进程的 DroppedFrame；其余四次为 0。这些事件尚未关联到主图 layer/frame 提交；与本次立即绘制证据一起看，不能据此声称再次出现前次约 1 秒阻塞。目标图的 compositor 原因仍 `UNKNOWN`，也不把邻近 raster/activate 当作已证实的目标图完成时刻。

## 模拟高值的具体依赖差异

Pinned `FirstContentfulPaint.getFirstPaintBasedGraph` 按实际 paint cutoff 选择网络节点；根 document 保留，节点的保留还需满足官方其他条件。**实际绘制时机的变化能改变模拟图纳入哪些字体/脚本，模拟终点不总是实际 LCP 图片。** 以下来自与原 LHR 完全匹配的模型；本次各样本同指标的 optimistic/pessimistic timeInMs 相同，完整两图都保存。

|样本|LCP 图节点数|其中字体数|模拟 LCP terminal 与最后显式依赖|
|---|---:|---:|---|
|A1|26|9|document → `1t9s50a05f_y-.css` → SC108 / SC119 字体|
|A2|20|3|document → 同 CSS → SC112 / SC117 字体|
|A3|17|0|document → `2p07cckado7sy.js` → CPU RunTask|
|B1|26|9|document → 同 CSS → SC108 / SC119 字体|
|B2|15|0|document → 图片 与 `2c4nlk_2vrv0p.js` 并行终点|
|B3|17|0|document → `2p07cckado7sy.js` → CPU RunTask|

- A1/B1 的 LCP cutoff 为 584.152/534.137ms，九个字体在官方图时钟中最晚 428.897/404.736ms 已完成，因而都能入 LCP 图。两图都是 Document1、CPU3、CSS4、Script8、Image1、Font9。模拟终点是 SC108 与 SC119，并非图片。
- A1 CSS 模拟完成于 2115.517ms；SC108 模拟 4073.276→5431.034，SC119 模拟 3623.276→5431.034ms。字体开始相对 CSS 完成仍有约 1957.759/1507.759ms 的调度/竞争间隔。B1 对应间隔约 1955.277/1505.277ms，机制相近；**不能把这些间隔全算成 CSS 下载或实际 CPU 阻塞**。
- A2 实际 FCP/LCP 同为 282.854ms。Latin/SC112/SC117 的图时钟完成时刻为 282.498/282.677/282.572ms，三字体入图；其余字体不入。B2 cutoff 245.258ms 时所有字体都在其后完成，字体不入图。A3/B3 也没有字体入 LCP 图，terminal CPU 分别由相同 JS 之后模拟 60/57ms 工作构成。
- FCP 也受 cutoff 影响：A1 的首字体完成 412.854ms 晚于 FCP 403.458ms，7 节点图无字体；B1 的 Latin/SC112/SC117/UI 字体完成约 379–380ms，早于 FCP 383.076ms，11 节点图纳入四字体，UI 字体成为 3165.831ms 的模拟 FCP terminal。
- cutoff 必须使用官方图所用的 NetworkRecords 时钟。LHR network audit 的相对时间有约零点几毫秒差异；例如 A2 UI 字体 audit 值看似 282.830ms，但图值约 283.043ms 已晚于 cutoff，不能混用时钟称模型选错了字体。

四个 CSS 与字体资产内容未因候选读取改动增加。其中 CJK CSS 原资源 97,006B、网络 transfer 33,363B；九字体均由它产生显式依赖。这证明该资源在部分样本的模型路径中占有分量，但另一些样本以 JS/CPU 或图片/脚本为终点，**不支持单一“CSS 就是根因”的解释**。模型的 render-blocking 反事实收益也不是实际下载或渲染等待的实测时长。

Root 另核验当前 SC UI 字库 manifest 是 416 字、108,856B，与当前 catalog SHA 一致；不是旧 149 字符清单过期。原始 HTML 的非 UI 汉字还来自 native 语言名、运行时品牌标语、Intl 币种名称和 TEST 图片 alt。不能为这个 fixture 挑字删字或删除回退字形来制造性能提升。

## 图片缓存证据及下一步界限

只从已保存 DevtoolsLog 的目标图片响应读取安全白名单字段：六次均为同一 `/_next/image` 图片宽度 750、质量 75，输入是工作器处理后的 1200px WebP，响应实际是 **AVIF 47,884B**。A1 响应 `x-nextjs-cache: MISS`，B1 是 **STALE，不能写成 MISS**，另四次 HIT；全部 `fromDiskCache: false`。A1/B1 `receiveHeadersStart` 约 246.039/207.113ms，HIT 四次约 3.853–7.301ms。

全部响应 `Cache-Control: public, max-age=60, must-revalidate`。当前 TEST 上游图片 gateway 在 `storefront-media-fixtures.mjs` 使用 `public, max-age=60`，生产 `image-config.ts` 的 Next minimumCacheTTL 也是 60；生产真实对象/CDN 的头还需独立核实。这组数据证明 **MISS/STALE 与较长图片响应相关**，尚不能拆出读取上游、变换尺寸、AVIF 编码、缓存锁/重验证等各自耗时。浏览器 trace 本身没有 Next 服务端 codec span，因此不将 246/207ms 全归因 AVIF 编码。

本轮仅接受诊断工具与精确复现/定位，不提出已证明有效的 production 改动。若继续追图片响应，应做固定主图/同构建/同真实内容的有界成对实验，保留 MISS、STALE、HIT 状态，并补服务端上游获取与变换/编码分段计时；再考虑是否测试 immutable 图片缓存策略或格式选择。改变 TTL 不能消除首次 MISS；预热、延长 TEST 缓存或关闭 Chrome feature 都不能作为性能验收办法。字体或图片策略的后续候选仍须保留全部七语言/动态内容字形覆盖、图片质量与实际/模拟预算检查，不能靠本次六个样本关闭门禁。

前次证据继续保留在 [原 36 样本分析](../p3-06-gift-read-reuse/performance-analysis.md)。**读取一致性与功能检查点可独立成立；正式性能收益未被证明，P3-06 性能门 OPEN。**

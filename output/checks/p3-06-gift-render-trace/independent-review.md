# P3-06 礼物页绘制追踪：独立审查

## 范围与当前结论

- 审查者：`/root/gift_read_review`；2026-09-17；父任务 P3-06 / Lane D。
- 本轮仅检查源码、既有证据和后续追踪方法，不运行测试、构建、服务、PostgreSQL 或 Chrome，不编辑生产与工具源码。
- 生产静态结论针对已提交 `0fd6fd0` 的共享读取实现及同一版本未变的礼物展示代码。root 在固定六次比较中临时切换旧版/当前版，因此不能将任一时刻的工作区内容当作最终待交付源码。最终审查须以恢复后的 fingerprint 为准。
- 初步未发现足以支持生产修复的根因。未发现礼物主图等待应用动画、字体 ready 或客户端挂载完成的显示门；这不能证明浏览器 decode、合成、呈现或流式 DOM 顺序没有等待。
- 36 份历史 LHR 的预算失败保持有效。本轮同导航 trace 只能补足诊断，不能替代正式七语言性能与人工验收。

## 源码核对

### SSR、内容读取与 metadata

`gift-content-read.ts` 以 React 请求内 `cache` 和五个 primitive 键复用选中礼物的完整证明。有效市场只读 scoped；仅 `MARKET_UNAVAILABLE` 顺序读取 unscoped 介绍；无市场直接读取介绍。未增加跨请求缓存、TTL、重试或吞错逻辑。`gift-detail-page-reads.ts` 在启动内容读取后立即启动艺人目录，正文只等待当前礼物完整证明，艺人目录继续作为 promise 传入。

`gift-page-factory.tsx` 的礼物正文等待 copy、礼物证明、cart restore hint；context 另行启动且只有受限错误降级。礼物详情没有包在目录页所用的外层 Loading Suspense 中，context/recipient/SEO 使用独立 Suspense。`CartProvider` 直接返回 children，没有 mounted 状态控制整个页面显示。

`gift-seo.tsx` 的标题、图片、正文与 Product 使用相同选中结果；独立 SEO entity 仍需证明版本一致。因此删除冗余内容读取不代表 metadata、正文与独立 boundary 会在相同毫秒、相同 chunk 到达。资源 URL/字节一致也不能排除 HTML 流、解析器、脚本和 stylesheet 依赖顺序变化。

本地 pinned Next 文档 `apps/storefront/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md:1240` 说明默认可流式发送 metadata，HTML-limited bot 可阻塞正文；当前配置未覆盖 `htmlLimitedBots`。应以本次实际 UA、document trace 和 DOM 内容证明行为，不能把文档默认当作本导航的证明。root 已检查 pinned React 的 boundary 调度；框架存在 rAF/定时器不等于礼物主图实际处于该隐藏 boundary，更不等于发现约一秒的应用延时。

### 主图与 CSS

- `gift-detail.tsx:71` 的主图初始渲染 `PublishedImage priority`。
- `published-image.tsx:59` 对该图设置 `loading="eager"`、`fetchPriority="high"`；宽高、srcSet、sizes、焦点来自发布媒体，不等待 hydration 后再选择资源。
- `packages/ui/src/media-frame.tsx:167` 默认 `decoding="async"`。`data-media-state="ready"` 只表示当前不是已知错误，不能作为图像已解码/已显示的浏览器证据。
- `Media` 初始不是 error；effect 只核对已完成的坏图，正常图不会因 effect 未执行而隐藏。
- `gift-detail.css` 为方形主图、`object-fit:contain` 和响应式 grid；UI media 基类为普通 grid/img。未发现主图或其祖先的 opacity、visibility、content-visibility、动画 reveal 门。
- `storefront.css:530` 的 enter 动画选择 `.storefront-hero-copy`，不匹配礼物主图；礼物目录 hover 样式也不是详情主图初次绘制门。reduced motion 不改变这一事实。

`decoding="async"` 仍是需要由 trace 区分的阶段，不建议无证据改成同步解码。也不能将 `PublishedHeroImage` 的首页/艺人显式响应式预加载与礼物主图混为一谈；实际 preload/discovery 要读同次文档与网络记录。

### 字体与 stylesheet

中文 profile 使用 UI `font-display:optional`，补充 unicode 分片使用 `swap`，源码未等待 `document.fonts.ready`。locale layout 引入字体、storefront、directory、detail CSS；全局还有 UI primitives/interaction/motion 等样式。没有“字体下载完成才允许展示主图”的应用代码。

这只能否定显式 JS 字体等待假设，不能排除 stylesheet 的解析/应用依赖、字体导致的布局变化或 Lantern 模型中的间接依赖。网络 `loadingFinished`、CSS 已应用、图片 decode、栅格化完成和像素实际呈现是不同事实。暂不建议开启全局 `experimental.inlineCss`：既有资源体量和跨页缓存代价必须评估，单项 audit 的反事实收益不是足够依据。

## 历史 36 样本的证据边界

依据 `output/checks/p3-06-gift-read-reuse/performance-analysis.md`：A1/B1/A2/B2 的每语言三次，共 36 份 LHR，Lighthouse 13.4.1 / Chrome 152 / mobile simulate / RTT 150 / throughput 1638.4 / CPU 4 的参数一致；12 组 LCP 中位数都超过 2500ms。

1. 两次比较中文模拟 LCP 均更慢：2677→5573ms、3315→4359ms。旧版也有模拟高值，不能由此否定当前实现回归，也不能宣称共享读取已提速。
2. B1 的中文两次、日语一次存在资源结束后约一秒的实际 FCP/LCP 等待；B2 没有复现。未复现不等于已修复，也不能直接归为噪声。
3. B1 ZH-1、JA-2 以及部分旧版样本实际绘制很快而模拟值高，证明必须分开解释 observed 和 simulated。
4. 同 locale 的主图、字体、CSS、script URL/字节未变，排除了新增资源体量这一特定解释；没有排除发现顺序、document stream、解析、模型依赖、浏览器调度等解释。
5. 历史 36 次未保存同次原始 Trace/DevTools log，无法事后恢复对应的精确 Lantern 图或呈现因果链。
6. `p3-06-read-stability/render-delay-review.md` 的 08:21 独立 trace 曾见 59 次 DroppedFrame 与较晚 presentation，但不是这 36 次的 trace。不能迁移它的帧丢弃原因或结果来解释本轮导航；即使出现相同形状，原因仍需独立证明。

## 同导航诊断的接受条件

| 待检验假设 | 必要证据 | 允许作出的结论与限制 |
| --- | --- | --- |
| SSR 或 scoped 内容等待是瓶颈 | 本次 native read 窗口、文档响应/数据事件、同发布版本正文证明，统一相对导航起点 | 可区分响应前等待与资源后等待；文档首字节早不代表主图节点已到达 |
| metadata / React boundary 晚揭示主图 | 同次 stream/boundary 标识、对应主图节点所在 DOM、脚本调用/rAF 与可见性证据 | 只有证明该主图在该 boundary 才能归因；框架存在 `$RC`/`$RV` 定时行为不足够 |
| CSS 导致模拟高值 | pinned Lantern FCP/LCP 与 LHR 精确复算一致，optimistic/pessimistic 图、边、节点 timing | 解释模拟关键依赖；`render-blocking` 反事实收益不是 CSS 实际下载耗时 |
| CSS/字体导致实际延迟 | 本次 stylesheet/字体网络、解析/样式/布局事件与 LCP 节点链 | 能区分下载、应用和布局；缺少样式事件时保留 UNKNOWN |
| 图片 decode/raster 晚 | navigation/frame/nodeId/URL 一致的 ResourceFinish、Decode/PaintImage，关联 layer/frame/sequence 的后续阶段 | PaintImage 是较强的图片特定证据；全局最近 Raster/Activate 只能称邻近事件 |
| 合成/呈现或帧调度等待 | 对应 renderer 与 frame/sequence 的 commit/activate/draw/presentation、DroppedFrame 和可用的 visibility/occlusion 信息 | 有明确 frame 关联才可说该图片呈现等待；没有 dropped 原因则不能指定原因 |
| 主线程工作使绘制延迟 | 主 renderer 的完整相关线程区间与任务（含短任务）、present timing | audit 没有 >50ms 任务不等于 CPU 空闲；缺事件不等于没活动 |

每次须锁定 LHR 所属 navigation、主 frame、最终有效 LCP、nodeId 与主图 URL，保留原始 Trace/DevTools/LHR bytes、校验 SHA、pinned runtime/config、源码 fingerprint、fixture 发布证明和原生读取窗口。跨进程/线程的事件不能只凭接近时间串成因果链；时间单位和 trace 时间原点必须明确。

模拟侧先使用同版本官方 ComputedFcp/ComputedLcp 复算并与 LHR 核对，再输出 optimistic/pessimistic 的依赖图和终点。沿“最晚完成依赖”得到的路径应标注为解释视图，不能冒充包含连接竞争、带宽竞争、CPU 调度的完整仿真因果图。

测量继续保留原 pinned 参数，不为增加事件修改 trace categories、Chrome 特性、额外预热或选优重试。默认 trace 缺少所需事件时应标明不可判定。六次固定比较全部留档，包括预算失败和无法复算情况，不用平均掩盖样本差异，不作为新正式验收。

## 初步独立结论

当前支持继续采集与离线分析，尚不支持修改生产 CSS、字体、图片 decode、SSR 顺序或浏览器配置。后续待审内容为新增 runner/verifier/analyzer 的最终 diff、六次样本的原始记录与分析结果，以及恢复后的源码 fingerprint。本报告此版不是新工具测试通过或性能门通过声明。

## TEST runner/verifier 独立复核

已只读检查新增四文件，未发现必须阻止本轮固定采集的问题。

- `storefront-gift-trace-comparison.mjs` 仅接受显式 baseline/candidate schemaVersion 1 模式；入口要求 TEST read diagnostics，复用现有 ephemeral PG/S3 fixture 与既有 acceptance runner。
- `storefront-gift-trace-verification.mjs` 固定三次中文礼物 Lighthouse 导航，无额外浏览器导航或页面预热。Chrome flags、Lighthouse categories/mobile/simulate 与先前比较一致，未添加渲染实验参数或 trace categories。
- 每次先保存 LHR、原始 Trace/DevTools/all artifacts、document HTML、Lighthouse HTML、config、native log 与文件 SHA，再执行内容/读数验证。单次 runner 异常、内容错误或缺少 trace/network 不补采；继续保留剩余固定样本后整组 FAIL。
- 组前唯一一次 API proof 与 `acceptancePages` 都使用 `fixtures.gifts[0]`、`fixtures.markets[0]`、`zh-CN`；响应保留后再做合同与 id/handle/market/currency/locale 校验。这里读取的是既有 TEST 公开 API，没有新增 endpoint 或业务写入。
- 收到预算失败时标 `COLLECTED_DIAGNOSTIC_BUDGET_FAILED`；仅完成采集不会更改预算或标正式性能通过。
- code-simplifier 只读检查：runner 管启动，verifier 管采集/留档/验证，测试注入 Lighthouse 与日志读口；当前分解能表达边界，没有为减少行数提出时序改写。

证据边界继续保留：`validateAttempt` 对参数只硬校验 Lighthouse 13.4.1、mobile、simulate；本轮最终证据仍需核对 Chrome、RTT/throughput/CPU、UA、`INTERNAL_LANTERN_USE_TRACE` 缺席及原参数。组前 API proof 是该时点证明；既有内容 gatherer 证明同导航 URL/locale/非空可见标题及无错误，不能单独声称每次 DOM 的所有内容已绑定同发布版本。后续可从保留 HTML、实际 fixture 无变更区间、native read 与文档内容核对，不需改变采集条件。

已读取工具作者的结果文件：`trace-tools-red-result.json` exit 1；`trace-tools-green-final-result.json` exit 0；限定 eslint exit 0；prettier --write exit 0。审查者未执行这些命令，未追加 CPU 测试。结果文件只声明命令退出状态，实际测试数量以配套原始输出为准。

此次只读审查的 SHA-256：

| 文件（`apps/api/scripts/`） | SHA-256 |
| --- | --- |
| storefront-gift-trace-comparison.mjs | `498577dd2a00bfaa28705f805e787ffd7ee344c1dce154379796979a17d48002` |
| storefront-gift-trace-comparison.test.mjs | `e6ae523766d4f1911a756a7a267a57afab91aab1dec463acb5c13dac414bc56b` |
| storefront-gift-trace-verification.mjs | `43e5c303054d75b48e547bc6e6314493dd7aa897ad707138a7266fea7d25894b` |
| storefront-gift-trace-verification.test.mjs | `5dcdddc120f7f46b6a210060da12ced348464def7e2cd2641834336ab7c4c973` |

## 离线 analyzer 草稿复核

只读检查 `storefront-gift-trace-analysis.mjs` 与其四个纯测试，并对照本地 pinned Lighthouse/trace-engine 源码。未运行测试或重放，待冻结后复查 fingerprint。

- 官方 `FirstContentfulPaint` / `LargestContentfulPaint.request` 先精确核对 LHR（误差容限 0.000001ms）才导出模拟图；拒绝改变 `INTERNAL_LANTERN_USE_TRACE` 数据源，独立文件必须与完整 artifacts 相等。
- 官方 `ProcessedNavigation` 选择 LCP，observed FCP/LCP 四舍五入后必须吻合 LHR metrics；top-level tasks 使用官方主线程时间轴，避免只看 long-task audit。
- 已核对单位：Lantern NetworkNode 与 CPUNode start/end 为微秒，NetworkRequest 的 rendererStart/networkEnd 为毫秒，现有转换与同一 time origin 匹配。
- LCP 终点排除 Low/VeryLow Image 与 pinned `LargestContentfulPaint` 算法相同；输出保留所有图边、模拟节点和可选并列 dependency，明确 latest-finished 路径不等于资源竞争的因果归因。
- 图像后的 renderer/global raster、frame、visibility 事件被标为未关联，`compositorCause` 保持 UNKNOWN；不存在无证据把帧丢弃原因归为页面代码的推断。

已反馈两个需要保留的边界：URL-only PaintImage 匹配可能对应同 renderer 内复用该图片的其他节点，应与精确 nodeId 匹配区分；analyzer 草稿没有直接核对 LHR requestedUrl / config.url / artifacts.URL 或 capture 清单 SHA，最终证据层须补核这些绑定。固定文件命名与数值复算一致本身不替代输入身份校验。工具作者可增强离线校验，不能因此修改已冻结采集设置。

## 六次实际采集与离线输出独立复核

输入：`output/checks/p3-06-storefront-acceptance/run-2026-09-17T04-12-40-212Z/browser-attempt-{1,2}/gift-render-trace`。组 1 为 baseline，组 2 为 candidate。采集结束后仅进行本地文件读取、SHA/JSON 核对；未启动浏览器、服务或 Lighthouse 重放。

### 输入与源码完整性

- 独立重新读取并计算 `capture-verification.json` 所列 54 文件的长度与 SHA-256，全部匹配；六次 runner 均返回且无 capture failure。
- 六次完整 LHR `configSettings` 深相等；mobile simulate、RTT 150ms、throughput 1638.4Kbps、CPU 4、412×823/DPR 1.75 一致；同导航内容 6/6 有效，无 Lighthouse runtimeError，均未启用 `INTERNAL_LANTERN_USE_TRACE`。
- requestedUrl 与本次 config/group URL 一致；组前 publication 完整 body 深相等。每组的三份 HTML 逐字一致；跨组唯一差异在 RSC payload 的 `b` 字符串值，其余 HTML 一致。这个文件比较不证明网络 chunk 到达时序一致。
- 原生读数保持 baseline 每次 1 unscoped + 1 scoped，candidate 每次 0 + 1，全部状态 200。这是已确认的读取减少，不能自动换算为稳定 LCP 提升。
- 当前两个临时切换入口 SHA 已恢复为 comparison-plan 中 candidate SHA：`gift-detail-page-reads.ts` 为 `3f65e77d…6cc9fe`，`gift-seo.tsx` 为 `0604cd4a…f89272`；`git diff --name-only -- apps/storefront` 为空。

### 实际绘制与模拟结果

下表来自已保存分析 JSON；PaintImage 只选本次 LCP 之前、精确 nodeId 匹配的事件，排除同 URL 的另一图片节点与 LCP 后的重绘。单位 ms。

| 样本 | 模拟 LCP | 图片网络完成 | 精确节点 PaintImage | 实际 LCP | 网络完成→LCP |
| --- | ---: | ---: | ---: | ---: | ---: |
| A1 | 5431.034 | 582.419 | 582.934 | 584.152 | 1.733 |
| A2 | 3311.5965 | 255.371 | 276.819 | 282.854 | 27.483 |
| A3 | 2626.2270 | 294.721 | 341.711 | 348.497 | 53.776 |
| B1 | 5421.108 | 529.785 | 532.384 | 534.137 | 4.352 |
| B2 | 2109.260 | 219.242 | 239.418 | 245.258 | 26.016 |
| B3 | 2620.4388 | 225.674 | 249.388 | 256.582 | 30.908 |

这里的 A/B 是本轮两组三次，不能与历史 A1/B1/A2/B2 四组名称混用。两组模拟 LCP 中位数为 3311.5965→2620.4388ms，两组都 `COLLECTED_DIAGNOSTIC_BUDGET_FAILED`；单次 B2 低于阈值不改变候选组失败。实际 LCP 此轮较短，没有复现历史约一秒的资源后等待；旧 36 样本保持原结论，不能据本次未复现宣布修复。

分析器的绑定增强已复核：新增 `verifyCaptureBinding` 核对 URL、audited/gathered settings、每个输入的原始长度/SHA；PaintImage 分开标记精确 node 与 URL-only。六份分析输出各核对 5 个输入，30 个输入 SHA 均与 capture 清单一致；官方复算的 FCP/LCP 共 12 个差值全部为 0。两次实际重放 exit 0 由 measure 执行，审查者未重复运行。

本次模拟 LCP 终点存在多种形状，optimistic/pessimistic 均可查原节点和边：A1/B1 为中文 font108/font119；A2 为 font112/font117；A3/B3 为 `2p07cckado7sy.js` 后的 CPU 节点；B2 为主图与 `2c4nlk_2vrv0p.js` 并列网络终点。这个结果证明模型链条的具体组成，尚不证明 CSS、字体或脚本任何一项是实际呈现的单一根因，也不授权调整模型设置或直接删除字体。

本轮首样本 observed 窗口内有 A1 50 / B1 47 个未关联 DroppedFrame，后四次为 0；前两次主图网络完成至 LCP 仅 1.733/4.352ms。DroppedFrame 数量本身不能作为约一秒主图呈现阻塞的证据，也不能套用历史 08:21 trace 的原因。`compositorCause` 保持 UNKNOWN。

### 当前评审状态

采集完整性与已列离线解释未发现阻断项；此前两条 analyzer 证据绑定建议已处理。当前 analyzer SHA 为 `e937f7ad1fa28bb8b20492c7f2647c9d745294b0f1ef58e58fa0138ee3f2efe9`，测试 SHA 为 `21899958b2405e166f1a0130c98c8c199689487d8540377d62ca6ba75743a9de`，后续如修改需刷新。

此时尚未看到完整检查点全仓门结果，因此不提前给出整个检查点 ACCEPT / S.U.P.E.R 全通过。P3-06 性能、人工验收和先前未解释的实际等待仍 OPEN；生产源码本轮没有新增修改。

## 最终工具范围评审（开发门完成后）

本节更新上一节的待审状态，不覆盖先前测量失败与范围限制。已只读复核 README、`lantern-notes.md`、`analysis-summary.json`、`final-source.json`、`protection-final.json`、相关命令结果与原始日志，以及三份进度文档 diff。

- `all-diagnostic-tests-result.json` exit 0；原始 `.log` 明确 28 tests / 28 pass / 0 fail / 0 skipped。包含既有原生观察器、读取窗口、采集器与离线分析测试。
- `check-dev-result.json` exit 0，32.134 秒；原始日志为类型 62/62、测试 62/62、构建 36/36，缓存分别 61/61/35；workspace/domain 检查通过。该命令明确没有运行 PG/S3/browser/formal acceptance，不能扩大解释。
- adapter boundary 与实际 build artifacts 检查各 exit 0；另一个独立真实 fixture 的原始日志明确 32,461 协议断言 PASS，最终 fixture 进程 exit 0，761.5 秒包括等待分析时间，不作为纯运行性能。
- `final-source.json` 原 2,212 输入 + 六个新增诊断文件 = 2,218，汇总 SHA `9a2415ffc3dfa6787b7aaae3df31d0028a0f6012874a48a5d3261fba7efd348f`。审查者重算六个工具文件 SHA 全部相等，生产 diff 为空；未再修改已审源码。
- `protection-final.json` 是 root 实际检查结果：4,117 个开工前未跟踪文件均存在且逐 SHA 不变、未被 stage；原生产输入无差异；已清理 fixture 的旧 PID/端口均无残留。审查者核对结果与来源，没有重跑大批文件保护扫描或操作进程。
- `analysis-summary.json` 六份引用分析文件的长度/SHA、equivalence 与所选 observed FCP/LCP 均和原分析一致。摘要只挑选 FCP/LCP 两个 timing 字段，不应与包含 load/traceEnd 等字段的完整 timing 对象直接比较结构。
- 新增图片缓存结论已独立从六份 DevTools JSON 复核：MISS/HIT/HIT 与 STALE/HIT/HIT，AVIF、max-age=60、fromDiskCache=false；receiveHeadersStart 为 246.039/6.291/7.301 与 207.113/7.291/3.853ms。文档正确限制为响应延迟相关性，没有把延迟全部归因编码、TTL 或源读取。
- 三份进度文档保持 27 DONE / 2 IN_PROGRESS / 20 PENDING、P3-06 IN_PROGRESS 与 Phase5 LOCKED；旧 36 + 新 6 诊断样本保留，物理设备、人工、商户与正式性能门不升级。下一步是有界分段测量与最小候选，不是已有生产修复承诺。

### S.U.P.E.R 十项：限定六个诊断工具/测试文件

| # | 检查 | 结论与依据 |
| --- | --- | --- |
| 1 | 模块单责 | PASS：启动与 fixture 生命周期、采集留证、离线解释三个职责分别在三个模块；对应测试各自验证边界。 |
| 2 | 函数概念单一 | PASS：模式解析、Chrome 参数、留档、单次验证、固定采集循环、输入绑定、图摘要、observed 摘要分别命名；未用简写改动原时序。 |
| 3 | 依赖与数据方向 | PASS：TEST runner 调现有 fixture/采集；离线工具只读本地证据、调用 pinned 官方 computed；未新增业务内层对工具的反向依赖。 |
| 4 | 无循环依赖 | PASS：只读导入检查与全仓 workspace validation 的 no dependency cycles 结果一致。 |
| 5 | 接口合同 | PASS：公开 API 仍用现有 `storefrontGiftResponseSchema`；TEST 模式/结果 JSON 有 schemaVersion 和运行时断言；离线 URL/settings/SHA 绑定并拒绝无效输入。未新增跨业务模块合同。 |
| 6 | 可序列化 I/O | PASS：留存原 Lighthouse artifacts 与显式 JSON 摘要；Lantern 节点/Map 转为普通对象、数组、数值和 ID，不持久化函数/循环图对象。 |
| 7 | 环境与配置 | PASS（TEST 范围）：沿用已有固定 Chrome 路径、pinned 测量条件和虚构 TEST host，要求显式 diagnostics；API/浏览器端口来自 owned fixture。没有新增生产域名、支付、凭据或业务配置硬编码。 |
| 8 | 依赖声明 | PASS：复用仓库已安装并锁定的 Lighthouse/合同/fixture 与 Node 内置模块，没有新增包或未声明业务依赖；离线核对安装版本与报告同为 13.4.1。 |
| 9 | 可替换边界 | PASS：采集循环注入 Lighthouse 与日志读取；离线分析函数接收原始数据，和 fixture 生命周期分离；可分别替换，不修改生产模块。 |
| 10 | 所选验证通过 | PASS（本工具检查点）：28/28 定向测试、check:dev、adapter/artifact、真实协议和固定六次有效采集、精确离线重放均有实际证据。此项不把预算失败转为通过，也不表示完整 pnpm check / 七语言性能 / 人工 / PSP 已通过。 |

code-simplifier 结论：近期六文件未发现需要为可读性再改时序的地方，不建议额外重构。最终独立代码与诊断证据审查结论为 **ACCEPT_FOR_DIAGNOSTIC_TOOL_SCOPE**，无未解决的阻断代码发现。

收尾门补验：已读取本轮 `secrets-staged-result.json` 与日志，`security:secrets` 于 04:37:50.607–04:38:27.506 UTC 执行，36.899 秒、exit 0；使用本轮实际扫描证据，不借用旧检查点结果。已检查实际 staged 路径，包含六工具、三进度文档及本检查点摘要证据，没有 raw Trace/DevTools/artifacts、日志、临时 Python 或旧未跟踪证据；只读执行 `git diff --cached --check` 为 exit 0。

最终汇总 `final-verification.json` 的 scope、计数、六导航/54文件/12复算、两组预算失败、28工具 tests、32,461协议、check:dev 缓存口径、秘密扫描与历史异常未解决标志，与本报告一致。其当时状态 `PENDING_FINAL_INDEPENDENT_REVIEW` 可由 root 在收录本结论后更新。

最终结论：**本次六文件诊断工具检查点独立审查 ACCEPT，S.U.P.E.R 十项在上述明确范围内 PASS，未发现未解决的阻断项。** 正式性能、人工/物理设备/商户验收与历史绘制异常仍 OPEN；不扩大为 P3-06 DONE 或上线许可。审查者仅编辑本报告，未执行测试、构建、重放、服务或浏览器。

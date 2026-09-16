# 首屏延迟只读复核

2026-09-16，P3-06，分析输入：`output/checks/p3-06-performance-resume/diagnostic-trace/attempt-2026-09-16T08-21-29.460Z-32df9e34`。本轮额外核对当前 SSR、图片组件、CSS 和采集器源码；没有生产修改、Chrome、构建或新 fixture。该诊断 fixture 开启 TEST schema 校验/同步 I/O，不能当成与旧 baseline 严格同条件的性能比较。

结论：**中文礼物第 2/3 次约 1 秒空档发生在已经绘制/栅格化之后、浏览器帧呈现之前；英文首页/礼物页则有明确的共享 JS 模拟关键路径，以及不同的真实 SSR/图片等待。** 目前没有证据支持用礼物 CSS、字体 preload 或删除图片内容来修掉中文空档。

## 1. 中文礼物：首图已画好，呈现未及时发生

原 trace 精确事实另存 `render-delay-trace-facts.json`，带 3 份 trace SHA-256、renderer/main-thread ID 和事件时间。

|事件，相对 navigationStart，ms|CN gift 1|CN gift 2|CN gift 3|
|---|---:|---:|---:|
|LCP 主图下载结束|553.600|503.500|469.800|
|第一次 LCP 节点 `PaintImage`|613.492|552.677|509.170|
|第一次对应 compositor commit|614.711|553.823|510.225|
|该首轮 raster 后 `ActivateLayerTree`|622.840|562.233|517.334|
|首个 `AnimationFrame::Presentation` / observed LCP|625.914|1552.632|1511.677|
|LCP 前 renderer `DroppedFrame` 数|0|59|59|
|LCP 前最长主线程 `RunTask`|37.529|37.255|33.329|

第 2 次主图 `nodeId=8` 在 552.677ms 已 `PaintImage`，尺寸 380×380、位置 (16,161)，不是空容器或别的图片。第 3 次同一主图在 509.170ms 已绘制。两次首轮 raster 分别约 562/517ms 完成；随后约 60Hz 的 `BeginFrame` 继续出现，但有 59 个 `DroppedFrame`，主图再于 1551.017/1509.871ms 绘制，1552.632/1511.677ms 才呈现并记为 FCP/LCP。不能把首次 `PaintImage` 冒称用户已经看到页面。

可排除或缩小的解释：

- **不是 1 秒主线程长任务。** 从 700ms 到 LCP 没有单个超过 2ms 的 main-thread RunTask；两次 LCP 前全部 main-thread RunTask 总时长仅 126.625/117.734ms。首次布局约 23/21ms，不是 1 秒。
- **不是等待最后一个字体到 1.5 秒。** 两次全部 `RemoteFontLoaded` 最晚 613.970/570.932ms；早于呈现约 939/941ms。字体处于 `optional`，未重复分析已确认的 unicode 范围修复。
- **不是主图仍等待 SSR 或初次样式。** 正文首块 492.657/457.721ms 已提交，主图下载、布局、绘制、raster 均先完成。约 1041/1044ms 到来的后续 HTML 执行 React `$RC/$RV`，但早期主图已存在；第 2 次 `$RV` 于 1042.459ms 请求的 rAF 直到 1550.253ms 才执行，故这个回调本身也在等待主帧。
- **源码未设置首图渐现门。** `PublishedImage`/`MediaFrame` 直接 SSR `<img>`，仅错误时换 fallback；无 `await document.fonts.ready`、opacity/transform/clip-path/presence/inert 门。`primitives.css` 的媒体只有正常块布局/尺寸/contain，`gift-detail.css` 不对主图做动画；`storefront-enter` 仅匹配首页标题/按钮。已有真实 PaintImage 更直接证明主图已进入绘制。

不能证明的部分：保存的 trace 没有足够的 renderer visibility/occlusion 或 compositor 阻塞原因事件，不能认定是 background throttling、截图回压、Chrome 缺陷或某个生产 CSS 规则。截图事件同样在 486→1555ms /447→1514ms 出现空档，说明已保存画面也缺乏中间呈现；**这不证明截图采集导致空档**。采集器使用独占 headless Chrome，LH 循环串行；`fonts.ready` 只在另一个已关闭的资源统计浏览器阶段使用，不是 Lighthouse 页面控制逻辑。当前最小下一步是保留相同预算，在需要复现时补帧呈现/visibility 原因观测；不通过改变节流、隐藏失败或加 CSS hack 来“修复”指标。

## 2. 英文六份：官方模拟重放定位到共享 JS

调用已有 `verify-lantern-cutoff.mjs` 对 en home/gift 各 3 份串行重放，耗时 0.480 秒，结果另存 `en-lantern-replay.json`。全部 FCP/LCP 与 observed 时间严格匹配原 LHR，误差 0。

|样本|observed LCP ms|模拟 LCP ms|性能分|模拟两图最终节点|
|---|---:|---:|---:|---|
|en home 1|790.437|2852.036|0.96|共享脚本依赖后的 RunTask|
|en home 2|439.275|2538.546|0.97|同上|
|en home 3|451.125|2840.719|0.96|同上|
|en gift 1|1023.477|2867.291|0.95|同上|
|en gift 2|704.147|2720.390|0.96|同上|
|en gift 3|589.774|2686.993|0.96|同上|

六次关键 RunTask 均依赖 `2p07cckado7sy.js`（实际 transfer 73777B；含 Next hydrateRoot 与 React DOM runtime）。home 终点任务模拟耗时 53–66ms、gift 118–140ms；前面的脚本下载模拟结束更晚，约 2261–3011ms。不是把秒级问题归结为实际 JS 执行了几秒。`2c4nlk_2vrv0p.js` 另有 47667B，部分终点也直接依赖它。

图片和字体会占用模拟网络，但**这六份字体没有成为最终节点**：home 主图仅约 17264B、模拟约 1507ms 已结束；gift 主图约 48415B、模拟约 2413–2568ms 结束；最后仍为共享 JS 与它关联的任务。home pessimistic 图比 optimistic 晚 450ms，并纳入早期发现的 low-priority 列表图；不能把这种图差直接解释为 450ms 的可保证优化收益，也不能删正常目录图片来迎合预算。

## 3. 真实 SSR/发现链和 preload

英文 home 第 2 次：初始流块在 7.278ms 到达，4 份 CSS 最晚约 12.7ms 完成；内容流块到 421.764/422.515ms 才到达，hero 422.871ms 发起，424.909ms 下载结束，439.275ms 呈现。第三次同样约 424ms 才发现主图。源码 `createStorefrontPage` 等待已验证 homepage + copy，再渲染 `PublishedHeroImage`；其 desktop/mobile 响应式 image preload 和 high priority 已存在。**这里没有可通过重复加同一 image preload 消掉的 400ms：更早发布该 hint 需要更早拿到可信发布媒体信息。** 首次图片下载另有 171ms，而后两次约 2ms，不能把首轮时间一律视为下载带宽。

英文 gift 第 2 次：TTFB 626.722ms、首正文块 634.712ms、图片请求 635.411ms，CSS 最晚约 648.9ms 完成；主图 652.048ms 下载结束、704.147ms 呈现。第三次 TTFB 531.808ms，图片发现仅在其后 7.079ms。`readGiftDetailPage` 已并行启动 gift/scoped proof，艺人/政策流式后续不挡首图；保留存在性/当前报价证明是正确边界。应先定位当前可信读取/SSR 等待，而不是把政策证明移到浏览器或取消服务端权威。

**未发现显式字体 preload。** 生产代码没有 `as="font"`；CN 原始文档 Link 头只列 preconnect 和四个 stylesheet preload；9 个字体 request 的 initiator 都是 locale CSS URL、优先级 VeryHigh，trace 的 BeginRemoteFontLoad 发生在样式/布局期间。正常第二/三次 en home/gift 的主图下载已结束之后，才发起第一个字体请求。只有两页首次较慢的图片下载与字体存在真实时间重叠。模拟中两类资源有并行区间，说明改成更早字体 preload 可能改变竞争，但现有证据**不支持宣称“删除现有 font preload 能改善”或“加 preload 一定更快”**。

## 4. 能支持的最小改进方向与限制

1. **优先当前读取稳定性修复，并定位必要的 SSR 读取时延。** 英文首页内容流块、礼物 TTFB 是可定位的真实等待；已有 image high priority/preload 基本正确。不得以放松发布证明、报价校验或返回陈旧内容换取更早首图。
2. **性能后续优先审计初始共享 JS 的模块归属与必要客户端边界。** 六份官方图都指向同一 runtime；当前 header、image、cart provider、artist directory 为客户端入口。可对产品自有部分做单一、可回退的服务端/交互拆分候选，但本次没有模块级体积归因或改后采样，不能声称某个拆分已证明能消掉 React/Next runtime，亦不建议盲改框架 chunk。
3. **CN 约 1 秒空档先保留为呈现链路未定因。** 既有 trace 已排除主图下载未完、1 秒主线程执行和等待字体 1 秒；没有可据此批准的生产动画/样式补丁。若需进一步验证，应记录同一导航的 compositor/visibility/截图握手状态，保持原测量设置并保留异常样本。

这轮没有得出可直接提交的 UI 修复；没有降低预算或把原始帧异常改判无效。新 27 次正常读取也不能证明旧偶发读取错误已修复，TEST diagnostics 的额外开销不从观测值中擅自扣除。

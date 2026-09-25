# P3-06 首次绘制等待：页面、CSS 与流式 SSR 只读审计

- 日期：2026-09-17；执行者：`gift_read_impl`；当前基线 `a560ac7`。
- 本报告只读取已存证的文件和本机 pinned Next/React 源码，没有运行构建、测试、浏览器或服务，没有修改生产代码。
- 原始慢/快样本：`output/checks/p3-06-storefront-acceptance/run-2026-09-17T08-41-18-090Z/browser-attempt-1/gift-render-trace/zh-CN-gift-mobile-{2,3}-{artifacts,trace,devtools}.json`。时间均相对各自已绑定主导航 `timeOriginUs`，不是模拟 Lantern 时间。

## 结论与最小假设

页面源码和同导航 HTML/CSS 可以排除主图或整个页面被应用层 `opacity`、`visibility`、`hidden`、加载淡入、等待 hydration ready 或包裹主内容的 Suspense 主动隐藏。没有证据支持修改这些代码。

尚待证伪的单一假设是：慢样本第一次主线程绘制记录之后，浏览器首帧提交/绘制调度或呈现仍受某个状态阻挡；600ms 的 `PaintImage` 不是已经显示在屏幕上的证明。资源相关的浏览器提交阻挡（含字体）尚不能排除，但不能仅凭 `font-display:optional` 或网络完成时间指定它为原因。

最小验证是同配置、固定数量的 compositor/scheduler 扩展追踪，检查600ms附近的 main-frame、commit、submit、presentation 与阻挡原因。若该帧已成功呈现新文档内容而仅 paint 指标晚到，则本假设的“呈现受阻”分支被否定，应调查指标/观测时序。若追踪能把阻挡和后续释放关联到具体字体/资源，才有理由讨论对应修复。不得关闭 Chrome 特性或修改页面来制造通过。

## 内容完全相同的快样本是重要反例

旧入口三次 `MainDocumentContent` 全部逐字相同：UTF-8 91,720B，SHA256 `d96dc2bde72d25a1e3f3efa78fa2122cfe6e8390776c204e0b000e7912637958`。四份样式内容的 SHA 也逐文件一致：

| CSS | UTF-8 内容 SHA256 |
| --- | --- |
| `40bq4a1qmkc-o.css` | `c6d7335b7e5573dfd3e4fe2ae16f982061f0f5b509e88a3615604b17d9ffafd3` |
| `1t9s50a05f_y-.css` | `8bb695570a3328e67cbadb1f887182661bc02730a364ceb30fbf20d93fe22f49` |
| `2dh8jd8nafbry.css` | `5f896216a4491260c123d2ba3acdd77ad03ebf99aa2fa75824b223aec05e811a` |
| `0mfs1xz8q_x--.css` | `043d2b7321dfd95856e328a5cce42527d2bc5a12429e24139e887ce863d0dfe9` |

| 同导航事件 | 慢 before2 ms | 快 before3 ms |
| --- | ---: | ---: |
| 文档第一块 `Network.dataReceived`，67,975B | 514.629 | 265.059 |
| 图像 `Network.loadingFinished` | 528.146 | 274.438 |
| 最后一个 CSS `Network.loadingFinished` | 544.98 | 279.25 |
| 八个请求脚本最后一个网络完成 | 554.33 | 287.98 |
| 首次 React `$RV` callback | 560.803 | 286.517 |
| 主图 node8 首次 `PaintImage` | 600.411 | 308.613 |
| 九个字体中最后一个网络完成 | 655.77 | 343.99 |
| 文档第二块，23,745B | 1235.182 | 791.171 |
| 尾块 React `$RV` callback | 1237.037 | 792.363 |
| 尾块 `_reactRetry` 请求的 rAF 执行 | 1593.830 | 803.362 |
| 实际 FP/FCP/LCP | 1597.291 | 316.253 |

`Network.loadingFinished` 是网络阶段证据，不代表字体解码、样式应用或 compositor 阻挡已经解除。快 before3 在相同文档第二块到达前约475ms、部分字体完成前就已有首次绘制，因此“必须等待所有流式数据/艺人数据/字体网络结束才显示正文”不是页面固有条件。

## SSR 与显示控制

- 实际 HTML 中 `.storefront`、`.gift-detail`、`.gift-main-image`、`img` 直接位于普通主 DOM。主图是 `data-media-state="ready"`、`decoding="async"`、`loading="eager"`、`fetchPriority="high"`，尺寸1200×1200；它不是任何 `hidden id="S:*"` 的后代。
- 待完成边界 B:0 为 SEO，B:1 为艺人选择，B:2/B:3 为市场与政策。主图和正文不在这些边界内；完整HTML没有 `$RR(`、`media="not all"`、`blocking="render"`、`startViewTransition`、`vt-name` 或 `vt-enter`。
- `gift-page-factory.tsx` 保留详情页没有外层 Loading Suspense的结构；`gift-detail.tsx` 直接输出主图，异步区域仅在各自局部边界。`app/layout.tsx` 没有首屏等待样式或初始化隐藏脚本；订单入口脚本受订单header限定，样本不包含它。
- `published-image.tsx` 将 published media 转为普通图片 props；`packages/ui/src/media.tsx` 初始失败状态为null，不依赖 effect/onLoad 才进入ready；`media-frame.tsx` 直接输出 `<img>`。effect仅处理已完成但加载失败的图片。
- `packages/ui/styles/primitives.css` 的 `.fs-media__image` 是尺寸、display与object-fit规则；`gift-detail.css` 使用 `object-fit:contain`，没有主图显示过渡。`storefront.css` 的进入动画仅匹配 `.storefront-hero-copy`，不匹配礼物详情。实际四份CSS也未发现匹配该页面祖先的隐藏/淡入规则。
- Filmstrip第一张非白帧不等于主图像素完整呈现；`PaintImage`、LCP事件和截图是不同层级的证据。此报告没有将这些时刻互相替代。

## CSS 与字体

中文font layout导入字体CSS与storefront/gift CSS。pinned `next/dist/server/app-render/render-css-resource.js` 为这些资源生成普通 `rel="stylesheet"` 与 React `precedence`；实际四个link在head中，样式记录均 `disabled:false`、`loadingFailed:false`。

实际字体CSS含102个 `font-display:optional` 声明，没有block/swap/auto声明。四个样式和八个脚本的网络完成时间都早于首次主图 `PaintImage`。字体引起的布局更新可见于646.982/661.993ms，但既有追踪不足以证明之后是否仍存在浏览器内部资源阻挡。不能把约一秒间隔解释为仍在下载CSS/字体，也不能据此直接移除字体或改其覆盖范围。

## pinned React 流式运行时

本机 `next/dist/compiled/react-dom/cjs/react-dom-server.browser.production.js:2471` 生成首壳 `requestAnimationFrame` 记录 `$RT`；`:2619` 的 `$RC/$RV` 用rAF或 `$RT+300-now` 定时器批量替换局部边界；`:2626` 的 `$RR` 会等待新增stylesheet。实际HTML包含普通 `$RC/$RV`，不包含 `$RR` 或 view-transition升级运行时。

慢样本初次 `$RV` 已在560.803ms执行0.221ms，早于主图600.411ms绘制。尾块 `$RC` 在1236.585ms装入Timer，1237.028ms即触发，`$RV` 1237.037ms开始，仅0.122ms；这次没有实际等待300ms。其 `_reactRetry` 在1237.147ms请求rAF，直到1593.830ms才回调。该差值证明回调等待浏览器帧的现象，不证明React定时器或页面主动阻挡了首帧。

pinned `next/dist/client/app-index.js:302` 对正常SSR调用 `hydrateRoot`；不是默认清空正文后进行createRoot。React client源码确实有 `suspendResource`/`waitForCommitToBeReady`，但功能存在不等于本次已触发。`react-dom-client.production.js:17323` 先复用已有stylesheet，真正未就绪的资源才计数。当前证据没有运行时调用关联，不能把其图片/stylesheet计时器指定为本次原因。

## 验证边界

只做原始JSON读取、哈希比较、同导航事件筛选与源码核对。没有增加样本、预热、改动旧证据或修改生产文件。本报告排除了具体页面主动隐藏/主图流式等待假设，但没有定位浏览器内部首次呈现阻挡原因，P3-06性能门仍开放。

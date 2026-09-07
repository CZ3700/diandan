# P3-06 LCP 只读诊断

## 范围与结论

- 审计者：`/root/storefront_read`；仅读取现有报告、源码和本机安装的 Next 16.3.4 / Fontsource 文件。本轮没有启动服务、浏览器、HTTP 请求、构建或测试，没有修改产品源码。
- 报告目录：`run-2026-09-07T17-13-43-828Z/browser-attempt-1/performance/`（相对此目录）。该轮 `source-input-provenance.json` 记录源清单 SHA-256 `fe46825ee20b329c3291f632a556388381e4f80a9fa6ec76e92ff19e9da6d000`；这里不重新计算或扩称全部验收。
- **确定的静态关键路径：首页仍在输出 hero 前等待下屏艺人目录。** `page-factory.tsx:42` 的 `Promise.all(copy, homepage, directory)` 将目录读取与已验证的首页内容绑在一起。建议先验证将目录等待移到其自己的 Suspense，保留两读并行。
- **不是缺少图片 preload。** 当前响应式双端 preload、eager、high priority 已存在，LHR 的实际图片请求也标记 `isLinkPreload: true`。再次添加同样标签不能提早尚未输出的标签。
- **SEO/字体/CSS 不能混为同一原因。** SEO JSON-LD 与 footer 已独立 Suspense；默认 Chrome 流式 metadata 不要求正文等待完整 SEO。中文字体是额外的网络成本；LHR 没有提供每个后端读取的 span，不能从这些报告断言 directory 或 SEO 各自占用了多少毫秒。
- 这是修复候选与测量计划，不是 LCP 门已通过的证明。保留本轮完整 63 份采样，不改变 Lighthouse 模拟参数、分数阈值或真实发布证明。

## 原始报告事实

以下均来自对应 `*.json`，不是报告 HTML 截图推算。所检查报告的 `runWarnings` 为空。数值单位为 ms，显示值做了小数舍入。

| 报告 | Performance | 模拟 LCP | observed LCP | 模拟 FCP | observed FCP | TBT |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| en-home-mobile-1 | 0.89 | 3622.05 | 885 | 1661 | 46 | 2 |
| en-home-mobile-2 | 0.89 | 3764.03 | 810 | 1511 | 29 | 2.5 |
| en-home-mobile-3 | 0.91 | 3466.73 | 1093 | 1058 | 28 | 4.5 |
| en-artist-mobile-1 | 0.88 | 3776.27 | 482 | 1661 | 482 | 2 |
| en-gift-mobile-1 | 0.87 | 3937.70 | 829 | 1673 | 829 | 5 |
| zh-CN-home-mobile-1 | 0.81 | 5110.44 | 785 | 1507 | 29 | 3 |

模拟配置包含 RTT 150、throughput 1638.4 Kbps、CPU slowdown 4，内部 request latency 562.5、download throughput 1474.56 Kbps。`lcp-breakdown-insight` 的子阶段是观测轨迹上的时长，不能把它们直接当成模拟 LCP 的分解或把 estimated savings 逐项相加。

英文首页第 1 次的 `network-requests`：

- 主文档请求约 0.307，首字节约 4.478，最后字节 878.942；传输 20,025 B、解压后 144,444 B，HTTP/1.1。早首字节不等于 hero 已经出现在第一块 HTML。
- 四个 CSS 在约 7–8 开始发现、12–13 完成，合计传输 15,300 B。实际 FCP 46。
- hero 图片约 734.798 被发现，734.953 发请求，880.135 完成；AVIF 传输 17,265 B，priority High，`isLinkPreload: true`。
- LCP breakdown 为 TTFB 4.478、资源加载前等待 730.588、加载 145.337、渲染等待 4.220。后续第 2 次 optimizer 请求只约 2 ms，图片发现前等待仍约 772 ms。
- LCP 节点是 `section.storefront-hero > div.storefront-hero-image > picture > img`，移动端约 412 × 515，顶部 65。discovery insight 的高优先级、初始文档可发现、非懒加载检查均通过。这里“初始文档”仍可能是晚到的流式片段，不等同于最早字节。

所以本机的实际约 730 ms 等待不能归因于 12 ms 已完成的 CSS；模拟网络中的 CSS 延迟则仍有成本。英文第 1 次 render-blocking insight 估计 900 ms（另一次 740 ms），这是模拟机会值，不是对 SSR 目录耗时的测量。

## 当前读取和输出顺序

1. `apps/storefront/src/storefront/page-factory.tsx`：获取 searchParams、准备 anchor/query，启动首页与目录读；但父组件必须等两者和 copy 全部完成才能创建 `HomeContent`。外层 Suspense 先输出的是 `route-states.tsx` 的加载文案，不含主视觉图片。
2. `home-content.tsx`：收到完整安全首页结果后才选择 hero 并渲染 `PublishedHeroImage`；初始 `ArtistDirectory` 位于后续艺人 section。目录数据不是 hero 内容、媒体、授权或当前发布证明的输入。
3. `published-image.tsx`：同一 `getImageProps` 来源计算 mobile/desktop 的真实候选和 preload，保留源宽上限、media 条件、`sizes=100vw`、eager/high、加载失败替代。两个 preload 随组件渲染才输出，不能越过父组件的 await。
4. `storefront-page-reads.ts`：React `cache` 包装相同 primitive key 的 homepage/directory 读，供页面和 SEO 在同次渲染复用；底层 `public-catalog.ts` 仍是 `fetch(..., cache: 'no-store')`、严格 envelope/locale 校验、8 秒失败边界。不是跨请求缓存，也没有本次理由改变它。
5. `browse-seo.tsx`：metadata 仍读取目录、首页和 SEO ENTITY，保留失败 noindex、版本/locale 对齐；正文中的 `BrowsePageSeo` 已放在独立 Suspense。`StorefrontPageShell` 的政策 footer 也独立 Suspense。由源码不能把 SEO 当作 hero 的直接 JSX await 屏障；它们仍可能竞争同一 API/PG 资源，需要独立服务端计时才能归因。
6. `artist-page-factory.tsx:49` 还有一个相邻但不在本次首页最小修改范围的 `context={await readCommerceContext()}`：艺人内容已经验证后，下屏 GiftDirectory 的 context 仍挡着整体输出。后续若调整应只拆下屏子组件，必须保留 `notFound()` 在任意正文 flush 之前，不能把真实 404 变成已提交的 200。

本轮只利用 LHR 文档时序与静态依赖图；没有重新抓取原始 HTTP 片段。目录中的 Lighthouse `*.html` 是报告，不是带服务器 flush 时间戳的首页响应，不能拿它冒称精确片段证据。

## 最小实现提议（等待 root GO）

建议首先只改首页组合：

1. 仍同时启动 homepage 与初始目录 promise；父组件仅等待 copy 与 homepage。
2. 将已经启动的目录 promise 的 await 移入下屏 async server child，置于该目录自己的 Suspense。`HomeContent` 保持同步，只接受目录渲染槽（或等价小 helper），主视觉的完整发布/媒体证明仍在输出前完成。
3. Suspense 使用语义明确的目录加载状态。保留目录 section/标题/跳转锚点，避免导致 anchor 消失或加载后的布局跳动。最终目录仍为服务端 HTML，不能改成浏览器加载后才获取目录。
4. 保留初始 anchor、market/currency 与其他 query、无效 anchor 的错误、目录失败重试、七语 copy、当前完整 metadata/noindex 判定。首页失败不能输出旧 hero 或猜测媒体地址。

拟独占文件：

- `apps/storefront/src/storefront/page-factory.tsx`
- `apps/storefront/src/storefront/home-content.tsx`
- `apps/storefront/src/storefront/page-factory.test.tsx`
- 如有必要新增 `apps/storefront/src/storefront/homepage-directory.tsx`，只负责已启动 promise 的目录 server rendering。
- 必要时仅补 `browse-seo.test.ts` 回归；不改其产品逻辑。

不涉及 shared copy/contracts/header/footer/styles，不新增 API，不更改缓存 TTL 或凭证边界。root 在完整 63 样本保留且停止 Next 后明确 GO，再进行 RED→GREEN。

对应失败测试应证明真实行为：

- 真实 `renderToPipeableStream`，已确认 homepage 成功但目录 deferred 时，最早输出中已有 hero 与匹配的响应式 preload；原实现应无法满足。
- resolve 目录后最终服务端响应包含真实卡片，保留 anchor 与 query；失败 resolve 后显示目录错误，不能静默空成功。
- 无效 anchor 不退回第一页；locale 与 context 不变；原读取并发、footer 不阻塞和 detail 404 测试保留。
- 独立 deferred SEO 不阻断 hero，完成后 metadata 保留目录失败 noindex；不要通过移除安全依赖让测试变绿。

后续允许采样时，先记录同一输入下 homepage/directory/SEO 各自完成时间与 hero preload 所在 HTTP 片段，再用相同 Lighthouse 设置复测。该调整只能移除多余的 `max(homepage, directory)` 等待；如果 homepage 自身较慢，不保证有同等幅度收益，更不能先承诺 LCP < 2.5 秒。

## 中文/日文字体与 CSS

`zh-CN-home-mobile-1`：四个 CSS 合计 47,276 B，Noto SC CSS 自身 33,233 B；14 个 font 请求合计 799,513 B。hero 仍是图片，750 ms 开始、754 ms 完成，LCP 785 ms。字体请求均 VeryHigh：

- latin、119、118、117、116 分片在约 22–26 ms 开始；114 在约 48 ms 开始。
- 其余 8 个分片约 769–774 ms 开始，和已输出的正文相邻。
- 对照日文首页第 1 次，21 个字体约 424,801 B，CJK font CSS 33,023 B；英文为 2 字体 61,360 B。

`packages/design-tokens/styles/fonts/simplified-chinese.css` 当前只有官方 `@fontsource-variable/noto-sans-sc/wght.css` import。安装包 5.3.0 的该文件已经使用 `font-display: swap`、100–900 variable wght 与 unicode-range；101 个声明对应约 4,516,508 B 的字体资产。**浏览器没有因为这一个 import 下载全部 4.52 MB，而是按页面字符下载了部分较大的切片。** 包内 CSS 入口只有 index/wght，并没有一个可直接替换、同时覆盖全部动态中文但显著更小的独立核心中文入口。

`route-states.tsx` 首个 fallback 已显示中文“加载中…”与“正在加载艺人…”。这些字符至少命中 116/117/118/119 分片，与首批请求一致；省略号同时出现在部分 unicode-range。这个静态对应解释了字体为何在 hero 尚未输出时已经需要加载，但没有逐字体使用栈，不能断言每一项仅来自 fallback。模拟网络上数百 KB VeryHigh 字体与后续图片存在竞争是合理推断，不是本机已测得的具体延迟量。

最稳妥的顺序：

1. 先做上述等待关系修正，让安全图片尽早参与调度；保留 Noto、现有字形覆盖和 swap。不要 preload 所有字体，不要简单禁用/替换 CJK 字体，也不要把 CSS 的 weight range 写窄后宣称二进制文件变小。
2. 记录修正后每片开始时间与模拟 LCP。现有 unicode-range 已在工作，单纯把完整 CSS 拆成多个同步 import 不会必然减少所需字体字节。
3. 如果仍有字体门问题，可另行研究从固定版本 Noto 可重复生成“固定界面文案优先子集 + 保留其余完整动态字符覆盖”的字体分片。必须保留许可、全七语/动态字形/字体审核映射，验证范围的完整覆盖与重叠优先级，不能从本次 TEST 内容反推删除生产可能出现的字符。这不是本次首页三文件小改可直接附带完成的工作，也没有本轮性能通过证据。

公共 locale layout 同时 import `storefront.css`、`gift-directory.css`、`gift-detail.css`，因此首页会接收部分详情样式。全局 CSS 还包含 UI 组件样式；可以后续检查实际路由依赖是否需要全部 CSS。不要把 Coverage 标记的 focus/hover/错误态样式当成死代码删除。当前 CSS 实际本机约 12–17 ms 完成，不能把模拟 900 ms savings 当成这里已经证实的 SSR 根因。

## 本机官方文档依据与限制

读取的是已安装 Next 16.3.4 的本地文档，没有网络查询或依赖版本变更：

- `apps/storefront/node_modules/next/dist/docs/01-app/02-guides/streaming.md`：独立异步子组件的 Suspense 才能独立 flush；父级 await 仍阻塞后代；早 TTFB 与长内容下载需要区分。片段替换不必等待整个页面 hydration。
- `.../03-api-reference/03-file-conventions/loading.md`：正文 flush 后无法再改变 HTTP status，支持保留详情 existence-before-stream 约束。
- `.../03-api-reference/04-functions/generate-metadata.md:1240`：普通浏览器可先发送 UI，HTML-limited bots 才等待 metadata；本项目没有 htmlLimitedBots 全匹配覆盖。相同文件 resource hints 章节说明 preload 可以提前发起请求，但必须先被服务器输出。
- `.../03-api-reference/02-components/image.md:265`：preload/eager/fetchPriority 的作用。当前真实 preload 已被浏览器使用，不缺该开关。
- `.../03-api-reference/05-config/01-next-config-js/cssChunking.md`：默认已经尝试合并 CSS；`graph` 属 experimental Turbopack 选项，在字节与请求数间权衡。不是无证据改成 strict/关 chunking/内联全部 CSS 的依据。

该诊断允许提出一项小范围组合修复，不能作为 P3-06 性能通过、生产 CDN/RUM 达标或实际人工作业验收的替代。

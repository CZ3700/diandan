# P3-06 首屏读取与 JavaScript 只读审计

2026-09-16；审计者 `/root/first_paint_audit`；基线 `75751e11a79a82d0ae9a0d667c5e2eabe50e50c3`。本报告属于 root 的 P3-06 续验，不领取另一任务。仅读取源码、已有 trace/LHR、当前 `.next` 产物；没有修改生产代码、运行构建、启动 PostgreSQL 或 Chrome、重新采集性能矩阵。

## 下一步建议：礼物详情与 SEO 共用一次完整的 scoped 读取

**优先验证并实施正常市场礼物页的冗余发布读取消除。** 这是当前源码和合同可以直接支持的候选；不是已经完成的优化，也不能预先声称 LCP 达标。

目前 `apps/storefront/src/storefront/gift-detail-page-reads.ts:17–36` 无条件启动 `giftRead(locale, handle)`，有合法 market/currency 时还启动 `commerceRead(...)`，随后等待两者。`gift-page-factory.tsx:192` 在 scoped 成功时实际显示的是 scoped 返回的内容，独立 unscoped 成功结果没有用于正文。

这里不是“两次不同领域证明都必不可少”：

- `packages/contracts/src/storefront-commerce.ts:167–175` 的 `StorefrontGift` SUCCESS 直接扩展 `PublishedGiftCommerce` SUCCESS，已经携带完整内容、publication、classification，并补充真实 market/currency/recipient/offers。
- `packages/persistence-postgres/src/storefront-commerce-repository.ts:128–164` 在 scoped 事务内首先调用 `loadPublishedContentContext`，完成发布证明与分类投影，再检验市场和当前报价/库存/受赠艺人。保留这条路径即可保留现有服务端权威；不能改成相信前台价格或已缓存的旧礼物。
- `apps/storefront/src/server/public-commerce.ts:147–220` 分别请求 `/api/v1/storefront-gifts/:handle` 与 `/api/v1/gift-content/:handle`。两者是不同 HTTP 路径与事务，React 的缓存不能自动合并它们。
- `gift-page-reads.ts:15–49` 已对每个读取分别使用 React `cache`。因此不能把正文和 metadata 的调用夸大为四次必然 HTTP 请求；本建议消除的是 **两种读取之间的重复证明**，而不是修复已经存在的同函数请求内去重。
- `gift-seo.tsx:57–104` 目前先等 unscoped 内容/SEO entity，再查 scoped。只修改正文不会消掉 metadata 所触发的 unscoped 请求；两处必须使用同一请求内读取决策。

已有实际样本命中这条分支：`output/checks/p3-06-performance-resume/diagnostic-trace/attempt-2026-09-16T08-21-29.460Z-32df9e34/en-gift-mobile-{2,3}.json` 的请求路径均为 `/en/gifts/studio-gift-001?market=GLOBAL&currency=USD`。两次服务端响应审计为 626/531ms；原 trace 中相应精确 TTFB 为 626.722/531.808ms，LCP 图片随后很快被发现。其模拟 LCP 为 2720.390/2686.993ms。**这支持优先减少真实 SSR 重复工作，不证明其中多少毫秒由重复读取造成。** 两个请求目前并行，故收益不能简单相加；还需验证 PostgreSQL/Node 竞争与实际端到端差异。

建议维持一个共享的服务端读取决策，按已验证选择分支执行：

|选择/结果|读取及行为|
|:--|:--|
|合法市场，scoped SUCCESS|只使用 scoped 中的完整内容、发布证明和报价；正文、metadata、Product JSON-LD 一致使用这个 publication|
|合法市场，scoped MARKET_UNAVAILABLE|随后读取 unscoped，只显示真实礼物介绍与现有换市场提示；不构造报价，SEO 继续 noindex|
|合法市场，scoped NOT_FOUND|保持首响应前 404，不用第二次读取把它恢复成成功|
|合法市场，scoped 其他失败或意外拒绝|保持现有安全错误/失败关闭；不能用 unscoped 成功绕过当前报价失败|
|没有市场|保持 unscoped 内容读取；不得根据语言猜市场或价格|
|无效查询/handle|保持原校验、恢复链接与 404 语义；不得为优化扩大可接受输入|

不需要改变公开 API/合同、数据库、支付、生产缓存策略或 HTTP 超时。共享缓存键必须来自规范化的 primitive 参数（locale、handle、market、currency、idol），并维持请求内生命周期；不要引入跨请求内容缓存。variant 的选择有效性、noindex 与查询保留仍由原输入解析负责。

### 验证计划与风险

1. 先写失败测试：同一正常 scoped 页的正文和 metadata 只需要一次 scoped 读取、零 unscoped 读取；给未使用的 unscoped 返回永久 pending，已验证 scoped 仍可输出首屏。scoped pending 必须继续阻止任何内容/价格首屏。
2. 保持并扩展七语言 SSR 流式测试：404、scoped unavailable、无效市场、无市场、daily 原文语言、暂停艺人、错误译文、旧/当前 publication 不匹配、variant 错误。当前 `gift-page-scheduling.test.tsx` 有明确“两种 proof 都必须 pending”的实现假设，不能简单删掉该测试；应改成“当前单次完整 scoped 证明必须 pending”的业务断言，同时保留 unscoped 分支完整测试。
3. metadata 与正文都消费同一 publication；SEO entity 对版本/翻译不匹配必须继续 noindex、禁用对应 hreflang/Product，不能拿另一版标题和当前价格拼装。
4. MARKET_UNAVAILABLE 的介绍读取将从并行变为顺序，这个错误分支可能稍慢；需实测错误体验。正常路径预期省掉一次独立内容请求，不预报 LCP 收益。
5. 做受影响单元/SSR/SEO、全仓质量门，再由 root 独占真实 fixture 验证请求数、七语 390×844/1440×900、发布/回滚与同导航内容。性能比较沿用相同设置和预算，保留每个失败样本；先有限定向样本判断候选价值，再决定正式 63 次验收。

## JavaScript 归属：不建议把大 runtime 当成可直接删除的产品代码

读取当前 `.next/server/app/(public)/(latin)/en/page/build-manifest.json` 与 `page_client-reference-manifest.js`，并在 Node VM 中仅捕获 Turbopack 注册数组（不调用任何模块 factory）核对模块归属。以下 gzip 是本机对文件字节压缩的大小，不是 Lighthouse 的网络 transferSize；不能混用口径：

|当前产物|原始字节|本机 gzip 字节|归属|
|:--|--:|--:|:--|
|`2p07cckado7sy.js`|234156|73054|React DOM/hydrateRoot，原 trace 的最终模拟关键任务依赖|
|`2c4nlk_2vrv0p.js`|178998|46972|Next router、RSC、导航/缓存等运行时|
|`1eb2a8tunus1g.js`|15995|5549|React 基础与框架辅助|
|`turbopack-264kn-mbs3jz9.js`|9688|3837|Turbopack runtime|
|`3rrddfj_zf4lv.js`|14378|3661|共享 route/layout 客户端模块|
|`0khagzihg94ls.js`|16177|5684|ArtistDirectory/ArtistSearch/ArtistTrack 与 Button/Field|
|`3dxyo5tonng-p.js`|38007|12709|PublishedImage、header/cart 轻入口及 Next image helper|

home 的 client-reference manifest 确认入口为 `published-image.tsx`、`artist-directory.tsx`、`cart-provider.tsx`、`site-header.tsx`。目录校验、购物车完整 schema 校验和抽屉已有动态导入；不能重复声称把它们拆出就能再次省去上轮的 152421 gzip 字节。

`3dxyo5tonng-p.js` 中确实包含 `next/image` 的 `getImgProps`（factory 4859 字符）和 `Image`（3556 字符）等模块，虽然产品只调用 `getImageProps`；但动态追加艺人卡片、礼物艺人选择器、购物车图片也都使用 `PublishedImage`。只把首页 hero 移到服务器并不会让这个 dependency 消失。不要绕用 Next 私有路径或硬编码优化 URL 来追求几个 KB，也不要承诺能删除 React/Next 的共享 runtime。这个方向的实施范围和风险大于上述重复读取候选。

次级候选是把 `gift-recipient.tsx` 中关闭抽屉时不需要的搜索/目录逻辑移到点击后加载的 panel；现有 `LazyDrawer` 只延迟抽屉实现，调用方搜索/目录模块仍在静态依赖中。它需要保持按钮即时反馈、错误重试、focus/cancel/IME/键盘和已选艺人权威，且没有改后模块/运行时证据，本报告不提供虚构节省值，不建议与首个候选同时实施。

## 保留的未知项

复核 `output/checks/p3-06-read-stability/render-delay-review.md` 与其 `render-delay-trace-facts.json`：中文礼物第 2/3 次均在图像已 PaintImage/栅格化之后约 1 秒才呈现，有 59 个 dropped frames。现有源码/trace 不支持字体 preload、图片 CSS 或动画补丁能修复该空档。没有重判这两个样本、降低阈值或将当前报告当成新的性能通过证据。

旧默认关闭 TEST Next observer 仅覆盖 homepage/idol。其全绿记录不提供上述两个 gift 路径的独立耗时归因；本报告也没有把 UI 全量 API 计数当成单导航请求数。

### 输入校验摘要

- `en-gift-mobile-2.json` SHA-256 `17daad3ae80080ea23562a91e3a4bdf307c4e153d990e83bd13350329bfc31ad`
- `en-gift-mobile-3.json` SHA-256 `058f7a6e7704e6b6e848494e059bb283109b591706e9e28d2796ef5fa243bf58`
- 当前 `2p07cckado7sy.js` SHA-256 `2a22dc37ba2a7bec1956a7d402601129dae9908cd12de6447cb3f0f07cc17de2`
- 当前 `2c4nlk_2vrv0p.js` SHA-256 `3b1d23c8cd320e6e298efd099225e893a8977a14d433d0c5afbf090f4921abf4`
- 当前 `3dxyo5tonng-p.js` SHA-256 `615743df5230886d0d04e94ab6a63b51dd0f9971cfb11945fd1dc1e77c6b8b2e`

本报告是静态/已有证据分析；没有新性能测量、测试通过或 Phase 退出结论。

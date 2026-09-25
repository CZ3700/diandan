# P3-06 图片响应链只读审计

日期：2026-09-17。基线：`92ae73c`。范围：本地安装的 Next **16.3.4** 官方实现、本项目图片配置与媒体链、前一轮六份已保存 trace/Devtools 证据。没有启动服务、浏览器、构建、测试或编码微实验，没有修改 node_modules、生产代码、旧证据。本文提出的测量步骤均是交给 root 执行的方案，不能当成已经验证的结果。

## 已能确认的结论

1. `MISS` 的前台响应确实要经过上游整包读取、内容校验、必要的图片优化、缓存写入。各段贡献尚未知。
2. 当前磁盘图片缓存的 `STALE` 会先交付旧 buffer，然后后台 revalidate；它与 MISS 不是同一路径。前一轮 B1 的约 207ms 不能直接写成再次 AVIF 编码耗时。
3. 没有上游 HTTP ETag 不代表无法复用旧编码。Next 对完整上游 buffer 计算稳定 hash；匹配旧 `upstreamEtag` 且旧产物不是 bypass/优化失败结果时，直接复用旧优化 buffer。
4. 新 Next 进程第一次访问图片缓存时，前台还可能等待模块加载和磁盘 LRU 初始化；后者会读取已有所有图片缓存 entry 的完整 buffer。这个成本尚未测量，是需要区分的假设。
5. 最小无 patch 方案是将真实 Next HTTP 的 MISS/HIT/自然过期观察，与独立 child 调用 pinned 官方函数的解释性微实验分开保存。二者不能做简单 TTFB 相减而宣称得到 codec 成本。

## 本项目的两次图片处理

- Worker 先校正/剥离原图元数据并生成角色 master，再输出 AVIF/WebP/JPEG 各四个尺寸：320、640、960 和该角色 master 宽度，共 12 个衍生图。见 `packages/contracts/src/media-processing.ts:23`、`:116`，`packages/media-image/src/image-pipeline.ts:184`、`:262`。
- Worker 编码参数：AVIF quality60 / effort2 / 4:4:4，WebP quality82 / effort4，JPEG quality85 / 4:4:4。公开派生对象路径包含 master checksum 和产物 checksum，见 `packages/content/src/media-processing.ts:31`。不能通过猜测文件名构造未发布的其他衍生 URL。
- 内容读取按已批准的发布 proof 挑选可用产物，并倾向最大宽度、同尺寸 WebP，见 `packages/persistence-postgres/src/published-content-repository.ts:173`。日常发布读取也有独立同类选择，不把前台当第二媒体真相源。
- `PublishedImage` 调用 `getImageProps`，以该公开源图再生成 Next `/_next/image` 的 width 候选，并限制候选不超过已验证源宽度，见 `apps/storefront/src/storefront/published-image.tsx:11`。主图已有 eager/high；不是当前证据支持的懒加载遗漏。
- 图片配置只接受固定 HTTPS 公开 origin 的 `/processed/v1/*/*.{avif,webp,jpg}`，禁止源上传/中间 PNG/任意 query，redirect0、q75、AVIF 优先再 WebP、minimumCacheTTL60，见 `apps/storefront/src/server/image-config.ts:49`。这维持既有发布/SSRF边界，优化不可绕开。
- TEST gateway 每次源请求检查 PostgreSQL 公开媒体资格，再从真实 TLS S3-compatible 取整包，校验 SHA 和长度；响应 `public, max-age=60`，**没有 ETag**。见 `apps/api/scripts/storefront-media-fixtures.mjs:118`、`:139`、`:153`。S3 的内部 ETag 不会自动透传到这个网关。
- 上传 adapter 的 PutObject 带 checksum、ContentLength、ContentType 与 `IfNoneMatch: "*"`，当前没有在此处写 CacheControl，见 `packages/media-s3/src/adapter.ts:767`。生产公开源/CDN的缓存头仍需生产配置证据，不能用 TEST gateway 头代替。

## Pinned Next 的精确路径

本节路径共同前缀是 `apps/storefront/node_modules/next/dist/`。所有结论来自这些本地官方实现，不是根据最新版在线文档推断旧版本行为。

### 1. 入口、cache key 与前台返回

`server/next-server.js:165–239`：请求首次进入图片分支时 require image-optimizer，构造 `ImageOptimizerCache`，执行参数验证并算 cache key，再调用 `imageResponseCache.get`。cache key 包含 cacheVersion4、源 href、width、quality、协商 mime；见 `server/image-optimizer.js:676`。Accept 改变格式时会形成不同缓存项，不能把 AVIF 和 WebP 当同一 warm key。

`server/response-cache/index.js:194–221`：先读 incremental cache。存在 entry、不是 on-demand、`isStale !== -1` 时，立即 `resolve(previousIncrementalCacheEntry)`；HIT 返回，STALE 继续后台 revalidate。当前 `ImageOptimizerCache.get` 的磁盘分支 `isStale: now > expireAt` 只产生 boolean，因此这里的 -1 阻塞过期特殊分支不适用当前图片缓存。

`lib/batcher.js:33–69` 的 DetachedPromise 可先被该 resolve 完成，后续 callback 的 return 不能再次替换值；batcher 仍等后台处理结束才删除 pending 项。因此临近同 key 请求可能继续共享已解析的旧 entry，直到后台完成。缓存标签由旧 entry 的 `isMiss/isStale` 产生，并非每请求后台工作完成后的标签。

`server/response-cache/index.js:278–301`：MISS 没有提前 resolve，要等 responseGenerator、转 entry、incrementalCache.set 完成。`isRevalidating: true` 由该函数向生成器传递，MISS 也会经过它；它不是“客户端正阻塞等待 stale”的证据，且 Next image route 生成器只解构 `previousCacheEntry`。

### 2. 磁盘缓存首次初始化可能位于前台

`server/image-optimizer.js:681–692`：没有 custom handler、磁盘缓存未关闭且 isrFlushToDisk 时，构造器立即启动 LRU 初始化。`get:734–748` 先读取目标缓存文件，再 await 该 LRU，最后返回 entry。

`server/lib/disk-lru-cache.external.js:30–53`：进程内 `_diskLRUPromise` 单例。未配置最大大小时读取磁盘剩余空间并取其一半；随后调用 initCacheEntries。

`server/image-optimizer.js:178–193`：枚举 cache dir，逐 key 调用 readFromCacheDir，读取完整 buffer，按 expireAt 排序。`:280–304` 是单 entry 的 readdir/readFile。新进程首次请求可能包含旧缓存全集初始化，后续请求仅等待已完成 promise。

**证据边界**：源码能证明该等待存在；还没有证明它贡献了旧 B1 207ms 的多少。不能只看到第一次慢就宣称磁盘 LRU 是根因。官方独立 codec 微实验也不会自动覆盖这个成本。若需要进一步隔离，可由 root 使用专属缓存副本/独立进程测官方构造+get；避免对真实测量缓存调用 resetDiskLRU 或改变其状态。

### 3. 上游完整读取与 ETag

`server/next-server.js:750–792` 的 imageOptimizer 先 `fetchExternalImage`，拿到完整上游数据后才调用纯优化函数。

`server/image-optimizer.js:921–1018` 的 fetchExternalImage：执行 fetch（7秒超时、manual redirect）、按上限读完整 body、拼成 Buffer、读 content-type/cache-control/ETag，再计算/提取 etag。它没有将旧 ETag 作为 `If-None-Match` 发给上游；旧 hash 的比较发生在 body 全部读完以后。直接给 TEST 网关增加 ETag 不会让这个官方分支自动变为条件 GET/304。

`:255–266` 的 extractEtag：有上游 ETag 时进行 base64url 编码；没有时调用 getImageEtag，对全部 buffer 计算 SHA256 base64url。TEST 源 bytes 不变即可生成相同 upstreamEtag。

`:862–870` 的 getPreviouslyCachedImageOrNull 需要同时满足：旧 entry.kind 是 IMAGE、旧 upstreamEtag 不等于旧 optimized etag、当前 upstream.etag 等于旧 upstreamEtag。前一项差异用来排除 SVG/动画/bypass 或之前优化失败的直接源图结果。

`:1132–1141` 满足上述守卫时返回旧 optimized buffer/etag/upstreamEtag，避免新的 resize/encode；它仍已付出本轮上游抓取与内容检测成本。这个 return 使用旧 cacheControl.revalidate（非零时），不能仅因上游换了 Cache-Control 就假定已有缓存立刻采用新 TTL。

客户端的 `If-None-Match` 是另一层：`:1204–1239` 调用 `server/send-payload.js:35` 的 sendEtagResponse，可结束为304。这发生在图片 cache lookup 之后，不能证明没查cache/没安排后台抓源；而304分支在设置 X-Nextjs-Cache 之前返回，可能没有该缓存标签。测量必须分别记录状态码和etag行为。

### 4. 冷优化、惰性 Sharp 初始化与输出

`server/image-optimizer.js:1078–1186`：选择 maxAge（minimumTTL 与上游 s-maxage/max-age 的较大值）、检测图片类型、动画/bypass 判断、协商输出格式、尝试复用，否则 optimizeImage。优化失败可能回退源图并返回 error，实验必须拒绝把这种回退当作目标格式优化成功。

`:196–237` 的 getSharp 在第一次调用时 lazy require('sharp')，设置允许的 libvips loader、operation cache、并发；同进程之后复用 `_sharp`。若微实验在计时前为了 metadata 或质量检查先 import sharp，就会把这段 cold 模块/原生初始化移出时窗。

`:872–912` 的 optimizeImage：sharp(source) → timeout → rotate → resize(width, withoutEnlargement) → 输出编码 → toBuffer。Next q75 对 AVIF 实际映射为 **quality47、effort3**，WebP 使用 quality75；“相同请求 q75”不是编码器相同质量数值。该调用包含解码/旋转/缩放/编码/Sharp首次加载及可能的本地队列等待，不能只命名为“AVIF encoder纯耗时”。

`:268–278`、`:795–814` 写缓存会删除该 key 目录、创建并写 buffer；MISS 响应要等这个 await。STALE 正常路径的写入在已返回旧 entry 之后。HTTP首响应尚包含 Next 入口/调度、文件I/O、网络等其他成本。

## 原六样本提供和没有提供的证据

原始目录：`output/checks/p3-06-storefront-acceptance/run-2026-09-17T04-12-40-212Z/browser-attempt-{1,2}/gift-render-trace/`；离线证明及各数字见 `output/checks/p3-06-gift-render-trace/lantern-notes.md`。

|原样本|图片缓存标签|图片请求实际总时长|receiveHeadersStart|资源|
|---|---|---:|---:|---|
|baseline 第1次|MISS|246.661ms|246.039ms|AVIF 47,884B|
|candidate 第1次|STALE|207.799ms|207.113ms|同图、同尺寸、同资源大小|
|其余4次|HIT|4.523–7.922ms|3.853–7.301ms|同图、同尺寸、同资源大小|

没有同导航 Next服务端分段、磁盘初始化计时、Sharp进入/完成证据，因此以下都是**假设**：cold优化成本主导MISS；进程首次模块/LRU初始化影响STALE；源网关PG/S3或事件循环竞争参与延迟。STALE源码已表明正常前台不等待重新编码，不能把MISS与STALE相似TTFB强行归为同一codec。

前轮全部12个Lighthouse模拟FCP/LCP可由原Trace/Devtools精确重放，并已证明实际绘制cutoff影响字体/脚本入图。图片路径改进即使成功，也不等于单独消除所有模拟高值；原36样本的一秒呈现异常依旧未解决。

## 建议 root 执行的最小无 patch 证据

### A. 真实 Next HTTP 行为（不是浏览器性能验收）

固定同构建、同源bytes/校验和、同width750/q75、同Accept、同请求方式；复用一个Next进程按既定序列观察MISS、HIT、自然过期STALE、后台更新完成后的HIT。不要人工改旧缓存expiry，不修改TTL或使用预热结果替代cold。等待时间从实际cache expireAt计算；“61秒”只是当前TTL下的近似调度，报告记录真实expired状态。

逐次保留：cache key摘要、是否本进程首个图片请求、目标缓存文件expiry/maxAge/源与优化etag、缓存entry数量/总字节、HTTP状态/TTFB/body完成/内容类型/长度/安全缓存头、served buffer SHA。区分request开始、response完成、后台上游结束/缓存改写。下一次HIT不能仅靠睡眠猜测后台已完成，应读回expiry或由受控source事件证明。

同时记录源gateway请求的已有固定目标计数，必要时 TEST-only 分段 PG资格、S3 headers、完整body、hash与response.finish。必须有界、默认关闭、不记录原URL/query/私密headers/凭据。它测的是本地TEST链，不能代替生产S3/CDN延迟。

### B. 独立 child 调用 pinned 官方函数（解释性微实验）

无需修改node_modules或注入production Next进程。单独保存结果，避免与root浏览器采样并发：

1. 计时首次 require/import pinned image-optimizer 模块，记录Next/Node/Sharp版本、源码hash与实际resolved images/experimental设置；不得在计时前预载Sharp。
2. 用真实fixture的已发布源调用官方 fetchExternalImage，整体计时明确包含headers/body/hash；验证源SHA/长度/尺寸/类型与公开proof一致。不要将原URL/credentials写入摘要。
3. 用官方 validateParams 与实际配置得到width/q/mime；调用 imageOptimizer(upstream, params, config, {isDev:false, previousCacheEntry:null})。记录完整调用耗时与输出SHA/尺寸/bytes/类型、没有error回退。尺寸或质量解码校验放在首次计时之后/另一个child，避免预载native模块。
4. 构造真实前值 IMAGE entry，使用上次返回的etag/upstreamEtag/buffer；源输入保持官方fetch结果。检查 getPreviouslyCachedImageOrNull 确实返回前value，计时第二次 imageOptimizer，assert其返回buffer与前值严格相同、SHA相同。这样证明走复用守卫；只比较字节相同不足以证明没有重编码。
5. 固定重复次数与顺序，保留首cold及全部重复，不择优。前后source hash必须一致。直接 optimizeImage 可另测，但不能把其先运行后 imageOptimizer 称作第一次cold。不要把独立函数时长从另一导航HTTP TTFB相减来生成未观测分段。

这个方案足以判定官方转换路径在相同实际图上是否昂贵、前值复用是否生效；不能还原原B1的207ms分段。如果STALE慢仍存在，下一最小分段应落在入口模块加载/cache get/LRU，而非继续调整codec。

### C. 可用 hook 与暂不需要的侵入

源码导出的 `fetchExternalImage`、`imageOptimizer`、`optimizeImage`、`getPreviouslyCachedImageOrNull`、`ImageOptimizerCache` 足够完成B。class prototype可以被TEST启动模块包裹以测cache get/set，但这会提前加载模块、改变cold初始化位置，必须另外记录，且本轮无须先引入。

虽然 `server/lib/trace/constants.js:120` 存在 `NextNodeServer.imageOptimizer` span名称，当前实际 `next-server.js:750` 方法没有使用该span，也未发现fetch/resize/encode/cache的专用细分trace。不能仅打开现有OTel就承诺得到各段。直接覆盖模块导出的函数还可能遇到只读getter，内部闭包调用也不会必然走替换后的export；不建议为此patch模块。

## 有证据后才测试的优化候选

|候选|成为下一实验的必要证据|收益边界与代价|
|---|---|---|
|输出WebP优先/格式策略|B中AVIF官方转换明显更慢；固定同源、同q75对照得到尺寸、字节与解码质量证据|可能改善首次转换，可能增大传输；不能假设修复STALE，也不能只测一张图后全站采用|
|immutable派生图缓存策略|真实HTTP与来源策略证明反复自然过期成本可避免，且权限撤回/发布回退/CDN策略有明确约束|可以减少源重验，不能消除首次MISS；长TTL涉及失效与公开资格，不先改TESTTTL美化验收|
|消费已发布响应式派生图|确认二次有损转换/请求时编码是值得消除的主要成本|需公开合同提供获批准的多尺寸/格式URL和回退；不能猜checksum URL，改动范围明显大于配置级候选|
|共享/持久图片缓存或初始化优化|真实分段证明cache read/LRU在首次请求主导|涉及运行架构与部署；当前没有生产证据，不改Next缓存实现或随意关磁盘缓存|

所有候选均未在本子任务实施或验证。图片策略改动还需七语言/双视口、实际内容、像素质量、完整失败预算及原浏览器性能门复验。**当前只交付只读证据与实验方案，P3-06性能门OPEN。**

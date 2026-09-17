# P3-06 图片响应实验：独立只读审查

## 范围与初步结论

2026-09-17，`/root/gift_read_review`，父任务 P3-06 / Lane D；本地基线 `92ae73c`。仅核对生产与 pinned Next 源码、既有六导航证据、实验与回归要求；不运行测试、构建、Chrome、服务或图片处理，不修改生产/工具源码。

可以继续进行固定输入的 HTTP 缓存状态实验，以及独立子进程调用同版官方 `fetchExternalImage` / `imageOptimizer` 的解释性微实验。尚无依据选择编码、格式、TTL、字体或共享 JS 的生产补丁。最重要的区分是：HTTP 的 MISS/STALE/HIT、进程是否首次初始化、上游是否读取、图像是否真正重编码，是四个不同维度。

历史 42 份有效诊断报告及失败预算保持；本次微实验不替代 Lighthouse，也不解释尚未复现的历史一秒绘制等待。

## 当前链路与不能省略的事实

### 本仓库配置与媒体来源

- `apps/storefront/src/server/image-config.ts` 只接受精确配置的 HTTPS origin 与 `/processed/v1/*/*.{avif,webp,jpg}`；不接受源图、PNG master、私密 query 或任意 host。redirect 为 0，SVG 禁止，private IP 仅显式 development/test 开放。
- 当前 `qualities:[75]`、formats 为 AVIF 优先/WebP 次选、minimumCacheTTL 60；尺寸集合固定。`PublishedImage` 使用 `getImageProps` 生成 srcSet 并按已验证源宽度截断，不放大源图；主图 eager/high，按实际 sizes 选择资源。
- 礼物 GIFT_PRIMARY master 为 1200×1200。worker 先做方向校正、既定 COVER/CONTAIN 构图与 PNG master，再生成有 hash 身份的响应式产物。WebP profile 为 quality 82 / effort 4；AVIF 为 quality 60 / effort 2 / 4:4:4；JPEG 为 quality 85 / 4:4:4。不能把这些 profile 与 Next 二次转换的 profile 当作等价。
- 已发布内容仓储和 daily publication 在符合媒体证明的候选中优先大尺寸、同尺寸优先 WebP。浏览器取到的 1200px WebP 是已发布衍生图，不是未经校验原上传。不能在组件里猜一个 AVIF/其他宽度 URL 绕过真实产物与 publication receipt。
- TEST gateway 对每个公开请求先核对 PostgreSQL 的 READY/授权/metadata publication，再执行 S3 GetObject、读完整 bytes、校验 checksum 和 byte size。响应 `public,max-age=60`，没有 ETag header；这一 TEST 路径不等于生产 CDN 的延迟或缓存行为。

### pinned Next 的实际行为

依据本地 `apps/storefront/node_modules/next/dist/server/image-optimizer.js`、`next-server.js`、`response-cache/index.js`：

1. 图像 cache key 包含 cache version、完整源 href、输出宽度、URL quality 和协商 MIME；href 的 host/port 变化也改变 key。不能跨不同 fixture origin 把请求当成同一缓存键。
2. `next-server` 先取 image response cache；需要生成时才先 `fetchExternalImage`，再 `imageOptimizer`。external fetch 包含完整响应体读取，不只是响应头；无上游 ETag 时以 bytes 导出稳定 ETag。
3. 当前磁盘 image cache 的 `isStale` 是布尔过期。正常 STALE 先 resolve 旧缓存，再后台 revalidate；不要将 STALE 标签等同一次阻塞重编码，也不要把后台完成前的第二次请求误标为新 HIT。
4. 再验证拿到相同 upstream ETag、旧值确为优化成功的图片时，`getPreviouslyCachedImageOrNull` 直接复用旧 buffer，避免再次编码；这在 TEST 无 ETag header 时仍可通过 bytes hash 生效。
5. `optimizeImage` 内首次 `getSharp` 可加载/初始化 sharp，并按环境调整 concurrency；随后 rotate、resize 与编码在最终 `toBuffer()` 中执行。不能给同步 `.resize()` / `.avif()` 链式调用计时后称其为真实缩放/编码耗时。
6. **URL q75 在本 pinned AVIF 路径映射为 `round(75×50/80)=47`，effort 3**；WebP 则使用 quality 75。相同 q 参数不保证不同 codec 画质相同。
7. `imageOptimizer` 优化失败可返回原上游图，并携带 error；HTTP 200、较快响应或有图片 bytes 都不证明 AVIF 转换成功。实验须核对 error、实际 MIME/尺寸/输出身份。
8. effective TTL 为配置 minimumCacheTTL 与上游 max-age/s-maxage 的较大值；动态优化响应带 `Vary:Accept` 和 must-revalidate。提高 minimumCacheTTL 不能消除首次 MISS，还会改变 stale 频率，不能将这种测量状态变化冒充编码优化。

## 固定实验应保留的证据

### 输入、运行条件与实际 HTTP

预先记录固定次数、顺序和停止规则。沿用同一个真实 fixture、同一构建、同一源 WebP 字节、源 URL、目标 750×750/q75/AVIF 与同样 Accept；不在对照间发布/回退或换媒体，不插入额外页面预热。应保留：

- source asset/master/variant 与 publication 的可核查引用、源 SHA/byte size/格式/尺寸、目标完整 key 的摘要；实际 `PublishedMediaView` 与 HTML 当前选中图片一致。
- Node、Next、sharp/libvips 版本及有效图像配置、进程 ID/启动时刻、构建与源码指纹。明确是新进程还是同进程、新缓存还是旧缓存，不能仅以 `MISS` 宣称进程完全冷启动。
- 每次请求的状态、开始/响应头/正文完成时间、实际 Accept 协商结果、Vary、Cache-Control、ETag、x-nextjs-cache、响应 MIME/bytes/SHA/解码尺寸。只记录 TEST 公开目标与白名单字段，不收集 Cookie 或任意响应内容到日志。
- cache entry 的 key、创建/到期信息、旧输出与 upstream ETag 身份；观测源站请求数量与起止时间。如只能观测 gateway 的整体读取，就称其整体时间，不拆成未测的数据库/S3/网络分量。
- 自然到期前后的 `MISS → HIT → STALE → 后台完成后 HIT` 状态及完整失败。STALE 必须检查先发送的 buffer 是否旧缓存，另记录再验证是否发生/完成及新缓存状态；不要仅从单个 HTTP header 推断后台任务已完成。

可为冷缓存对照使用独占 TEST cache 副本或精确目标键的受控隔离，但要声明它是人为冷状态，不能覆盖用户/生产缓存，也不能在正式性能样本之间秘密清缓存或预热。自然到期实验保持原 60 秒策略；若只为理解另做手动过期注入，须单列，不能与自然到期同名。

### 官方函数微实验的接受边界

可以在独立子进程使用同版官方方法，分别观测完整 upstream fetch 与 `imageOptimizer` 的总耗时；不 patch node_modules，不替换真实 HTTP 采集结果。需要保持和实际服务一致的 NODE_ENV、配置、源 bytes、Accept/params、输出格式/宽度/q 与并发配置。

- 每个样本说明是否第一次调用 `getSharp`；模块加载、首次初始化和已初始化后的转换分别报告，不能通过先调用一次丢弃样本来美化“首次”成本。
- 对无 previous cache 的完整转换，确认 `error` 不存在、实际 AVIF/750×750、源与目标身份正确；允许合理记录 determinism，不能只看耗时。
- 对相同上游内容的 previousCacheEntry 复用，旧 entry 应来自一次实际成功转换并保持其真实 upstreamEtag/etag，而非凭空伪造成功值。结果 bytes/SHA 必须和旧输出一致。
- 对上游改变/优化失败等分支，如非当前性能问题所需，不无界扩大实验；必要验证应保留真实错误语义与 fallback 标签。
- `imageOptimizer` 总耗时包含 content detection、复用判断、sharp 初始化及 decode/resize/encode，不能直接称为“AVIF 编码耗时”。HTTP TTFB 减去另一个独立 fetch 耗时也不能得到精确 codec 成本：不同请求可能存在排队、连接复用、磁盘、模块初始化和并行后台工作。
- 如进一步单独 decode/resize/encode，需说明该分解已改变 lazy pipeline、输入表示和内存/调度，是额外微实验；不能将其阶段简单相加冒充原请求的精确执行链。

上轮 A1 MISS 246ms、B1 STALE 207ms 与 HIT 约4–7ms仅为已观测关联。现有源码甚至允许 STALE 完全不等待重新编码，因此先判定究竟在哪个边界等待，比提前选择 codec 更重要。

## 优化候选的质量与缓存约束

| 候选方向 | 必须先证明 | 不能采用的通过方式 |
| --- | --- | --- |
| 延长不可变图片 TTL / CDN 策略 | hash URL 与不可变 bytes 一致、生产响应头/缓存层真实行为、发布替换与回退引用新旧正确资产及≤60s可见；首次 MISS 成本另报 | 只把 TEST TTL 拉长、只采 HIT 或隐藏 STALE/MISS |
| 改 AVIF/WebP 顺序或编码参数 | 同目标尺寸、同源、实际支持协商；典型照片/礼物材质/透明边缘/文字线条/暗部渐变的视觉与体积对照；实际请求耗时、传输和浏览器解码综合验证 | 降 q、改小 width/DPR、压糊图片后只报 LCP；把同 q 当同画质 |
| 直接复用已发布衍生产物 | 已生成且有真实媒体/metadata/publication proof；尺寸足够且不放大，完整 srcSet/格式回退/内容权限与来源仍成立 | 根据 hash 猜不存在的 URL，使用源上传或任意远端图，跳过 worker/校验 |
| 异步生成目标变体 | 已有 durable worker 与产物合同、幂等身份/预算、发布/旧资产保留语义；转换成本从请求链移到何处仍透明 | 在前台偷偷生成无证明资产、丢失失败与重试或伪造双端图片 |
| 减少共享 JS/组件初始化 | bundle/入口真实使用与同导航执行证据，既有组件交互和 SSR 边界保留 | 删除功能、locale/fallback/alt、隐藏正文/以延迟可见内容刷 FCP/LCP |

此轮图片调查不修改字体字集、字体 fallback、locale messages 或 TEST 文案。若未来模型关键路径提示字体，需按独立候选核对全部七语言及运行时文案，不能只保留当前 fixture 所用字符。

## 最小合适的实际回归范围

1. **只有取证工具，没有生产变化**：工具先失败再通过；真实固定图片 HTTP 状态/来源/输出/自然过期链与官方函数微实验；参数与原始记录全部保留；受影响工具检查、check:dev、独立审查、S.U.P.E.R、秘密扫描。不因微实验新增工具重复整套七语言 UI，也不能给业务性能记为通过。
2. **仅缓存/服务端图像配置发生生产变化**：直接受影响配置/媒体来源与错误边界测试；实际 MISS、HIT、自然 STALE/再验证、并发同键去重（如改到此处）、格式协商与实际输出检查；保持禁止源图/重定向/错误 origin 等既有边界。因为配置全局作用于已发布图片，不能只验一个中文礼物。
3. **任何用户可见图片/共享组件候选**：遵守本阶段登记，至少七语言 × 390×844 与 1440×900 真实浏览器，并覆盖首页海报、艺人混合比例照片、礼物主图/目录、原文 alt/lang、破图稳定布局、COVER/CONTAIN、键盘与 reduced motion；涉及详情/购物车共享图片需补对应实际路径。保留候选前后可比 screenshot、实际选图尺寸/格式与图片清晰度，不能只看页面不报错。
4. **性能结论**：候选需预定有限的原参数成对导航，缓存条件分组明示，LHR+Trace/DevTools+内容校验、全部成功和失败留档。正式门须回到既定全七语言与预算，微实验 ms、暖 HIT 或单次最好分数都不能替代。未触及支付/订单业务则不扩大到 PSP；商户/人工门继续保留。

## 当前评审状态

**允许继续有界取证，不认可任何尚未验证的生产优化。** root 独占实际 fixture/编译/Chrome/测量；审查者未执行资源消耗实验。待 root 给出固定计划、实际 HTTP/微实验结果和最小候选后再做针对性独立复核；本报告不宣称本次实验已经执行或 S.U.P.E.R/性能门已经通过。

## 本轮收敛候选：隔离礼物目录入口

root 后续将本轮唯一生产候选收敛为礼物目录入口隔离。图片部分仅保留上述源码审计，**没有实施或声称完成图片分段实验**，不混入 format、quality、TTL、srcSet、字体或共享框架运行时修改。

已只读检查 `shared-script-audit.md`、当前 `gift-page-factory.tsx`、GiftDirectorySection→GiftDirectory→GiftFilters→GiftFiltersClient 依赖链，以及既有调度/SEO/筛选测试入口。当前全部 gift-family 路由通过共用工厂静态引用目录组件；详情虽不渲染筛选，但审计保存的真实下载 JS 中确有筛选实现。这支持一个明确可测假设：让目录专属 server 入口承担该引用，详情首访应不再下载目录筛选实现。它不保证共享 React/Next chunk 消失，也不保证 LCP 达标。

### 最小行为与路由边界

- 七语言 `/gifts` 仍输出原目录、相同 `dynamic="force-dynamic"`、异步 params/searchParams 与 metadata。新入口不能漏掉某 locale、改变 query 解析、分页/分类/价格排序、市场/币种/选中艺人上下文或 URL 恢复行为。
- 目录原有 context/copy/cart restoration 等待方式与 artist 查询/展示保持；无市场、非法 query、市场不可用、目录错误、空目录、越界页均走原恢复路径。筛选 client 的加载失败/取消、IME、返回页恢复、移动抽屉与键盘能力应仍由现成测试/实际场景覆盖。
- shared shell 的 header/main 应仍在恰好一个相同 locale key 的 CartProvider 中；首次无 Cookie 与返回访客的 cart restoration 保持，cart CSS 不因入口拆分漏载。header active、skip target、footer/policy links 及 query 保留不变。
- 原 `gifts` 与 `region` 外层 Loading Suspense 保持；详情不应新增外层 Loading 或先发壳再判断 404。非法 handle / 真 NOT_FOUND 应保持原 HTTP 与 notFound 语义。
- 原详情共享 scoped 读取、五 primitive cache key、仅 MARKET_UNAVAILABLE 顺序回退、其余错误不旁路、artist/context 独立 Suspense、选中 recipient/variant 与无效价格保护不得调整。目录拆分不应顺带重写详情调度。
- 详情/目录/政策/region 的 title、canonical、hreflang、robots、OG、JSON-LD 仍走原 SEO 逻辑，发布/translation proof 与 fallback/noindex 规则不变。若 common Kind/type/export 修改影响 policy/region，也需对应入口与错误/metadata 的小范围回归，不能因名称叫“目录拆分”而忽略共用工厂调用者。
- 新依赖方向应是目录 route/专属 factory → 可复用 shell/metadata；shared/detail 不应通过 barrel 或运行时回调默认值重新导入目录。纯类型引用需确实可擦除；是否真正减包最终以编译后真实下载内容为准。

### 固定 before/after 测量的具体约束

1. root 预定同 fixture、原参数中文详情各三次，全部六次保留。**本轮 before 基线 `92ae73c` 已经使用共享内容读取，因此两组都应 0 unscoped + 1 scoped。** 上轮工具的 `baseline` 模式原来硬断言 1+1，不能直接沿用旧含义，不能为使工具通过而回退共享读取。
2. 源码 diff 只包含目录入口及必要路由/测试适配；两组 published content、输入主图、图片参数、字体与消息资源不变。保留构建/生产输入 SHA 与实际下载每个 script 的 URL、原字节/SHA、真实 transfer/resourceSize；重新打包的文件名变化不是删除了模块的证明。
3. 需从当次实际下载 `Scripts[].content` 或等效原始响应证明 GiftFiltersClient 的可识别实现确实从详情初始集合移除，同时目录依然加载并使用它。不能仅按旧 chunk 文件名消失、source import 少一行、旧 factory 大小或 source map 引用推断节省。
4. 总 script 数量/原始字节、本机固定压缩口径与实际网络 transfer 分开列，避免把 gzip level/头部/HTTP 缓存差异计为代码收益。若提 CPU/LCP 改善，另核相同官方 trace/LHR；模块减少本身只支持包内容精简结论。
5. 完整 88 UI 场景与 Lighthouse 的执行顺序须明确。优先两组都先做各三次 Lighthouse，然后跑候选 88 UI，避免只在候选 LH 前进行大量 UI 导航预热图片。若顺序不能对称，则逐次标明 MISS/STALE/HIT 与相关差异，不能将不一致缓存状态归因目录拆分；不主动预热或改 TTL。
6. 同导航实际内容有效、主图/locale/市场正确、无 runtimeError，LHR/Trace/DevTools/native reads 全部先留档再验证。性能任一预算失败保持原状；旧 42 个诊断样本与历史异常不被本轮六个样本替换。

### 此候选的回归与当前结论

候选至少先写入口隔离的失败证据，并运行受影响调度、共享读取、SEO、目录/筛选、CartProvider/恢复测试；实际候选执行 root 计划的完整 88 场景七语言双端、现成错误/键盘/reduced-motion/发布回退检查，以及固定 before/after 六次原参数 Lighthouse 和实际 script 身份比较。图片策略未动，不增加 codec/TTL 对照，也不将旧图片源码审计描述为已执行优化。

**方案评审可继续，最终代码与性能结果待审。** 尚未审核最终 diff，不提前给出实现 ACCEPT 或新的 S.U.P.E.R 全通过；本段只限定行为边界与取证口径。审查者仅修改本报告，没有运行任何测试、构建、服务或浏览器。

root 已固定并提交只读复核的 `plan.md` 与本地一次性 `run-comparison.mjs`：before/after 均调用既有 collector 的 `mode:"candidate"` 保留 0+1 读取断言，另写 `entry-isolation-stage.json` 标明 baseline/candidate 与两组均 scoped-shared；候选 `ui` 阶段才调用既有完整 browser matrix。计划明确全部 3+3 Lighthouse 先于完整 UI，图片/字体设置不改，全部失败保留，主要假设为真实下载脚本内容减少。上述两项读数/预热风险已在计划中处理；采样中自然缓存状态仍需逐次报告，不据此作 LCP 因果归因。一次性 wrapper 未修改原 collector 或预算。

## 脚本分析器与新增测试草稿只读审查

已只读检查一次性 `analyze-entry-scripts.mjs`，未执行。其正确区分了 parsed scripts、实际 Script 网络请求、按 SHA 去重的外部 body、原始 UTF-8 字节、固定 gzip level6 与实际 transfer/resource 字节；捕获 body 长度、network decoded size、原始文件 SHA 与单次 URL/settings 绑定均有断言。标记来自未修改的 GiftFiltersClient 四个属性名，结论只称 markers 消除，没有把旧 factory 字节数当作节省量，也说明 root 提供的 source manifest 不能单独证明编译器确实使用了对应文件。

已反馈待收敛的三处小守卫，最终源码/结果需再核：

1. 草稿消除判定只看 external script，候选也应核全部 parsed Scripts 的 marker，避免代码转入 inline 仍称整体消除。
2. 对 NetworkRecords 的 requestId 加唯一性检查，使“请求只计一次”有明确断言；同 URL 的不同真实请求仍各计一次 transfer，不能按 URL 去重后隐藏重复下载。
3. stage 标记与两组共享读取语义，以及六次 configSettings 相等，需由分析器或最终证据层明确验证；单次内部 binding 不等于跨组设置一致。

另已只读检查作者的 `gift-page-entry-isolation.test.ts` 与 `gift-directory-page-entry.test.tsx` 草稿：前者覆盖 21 个非目录 route 排除目录筛选与七个目录 route 保留依赖；后者真实渲染七语言目录并核 metadata、query/购物车参数分离、选中艺人、外层 Suspense、copy/context/cart hint 等待及 context 拒绝。未见必须阻止实施的问题。

AST 测试只遍历相对静态 import/export，正确忽略 type-only/CSS；其不覆盖 dynamic import、package alias 或最终 bundler 行为，故只作为静态依赖回归。真正是否从详情初始下载中消除筛选代码仍由 root 的实际 body/network 证据判定。测试草稿未由审查者执行，不宣称当前已 GREEN。

## 冻结实现独立代码复核

已检查最终九个生产文件与三个测试文件；未发现阻断代码问题。与基线比较，生产行为变化限于 server 模块依赖注入：

- 新九行 `gift-directory-page-factory.tsx` 是 server-only，唯一负责向共用工厂传入现有 `GiftDirectorySection`。
- 共用工厂将该组件改为 type-only import，`PageDefinition` 判别 tuple 要求 `kind="gifts"` 时提供组件；非目录调用签名仍为原两参数。目录 JSX 使用注入值，原 copy/context/cart hint 的读取与等待、artist 选择、error/404、详情独立 Suspense、SEO、header/main/footer 与 CartProvider 原地保持。
- 七个 `/gifts/page.tsx` 改用新入口；每个 locale 字面量、force-dynamic、原 `createGiftStorefrontMetadata(locale,"gifts")` 保留。详情/policy/region 路由未修改。
- 组件函数引用只存在于 server 模块工厂组合，未作为 client prop 或业务 JSON 传递，未新增不可序列化数据边界。
- 原调度测试仅将目录场景的调用改成新目录工厂；没有删除或弱化既有详情、policy、region、CartProvider 断言。两份新测试和实际网络检查承担不同层的证据，不能互相冒充。

已读取 root 的实际原始测试日志：`red.log` 为 21 failed / 26 passed（47）；`green.log` 为六文件 142 passed（142）、2.60 秒。审查者未执行测试。此时全仓 check:dev、候选三次导航、完整88场景及脚本内容分析仍由 root 后续提供，不提前宣称这些已通过。

冻结时已核的核心 SHA-256：

| 文件（`apps/storefront/src/storefront/`） | SHA-256 |
| --- | --- |
| gift-page-factory.tsx | `a8c7a0688c04c8744cf980ec109de32b55fc85f2a41c6b5eec13a4e7856a8e16` |
| gift-directory-page-factory.tsx | `db9080b8a7d03c31058d32d9764a4fe4af3ad1e9948be8f68db82d81c6a1db90` |
| gift-page-entry-isolation.test.ts | `ab28133e733042d9361391ee0713cc10afbab7b49fb30c7afd374b36c63a13d5` |
| gift-directory-page-entry.test.tsx | `ca06b912e5cd99d6cf313b0a9122bce9a5bacc8ccc78208ad93e0ba278b6f32e` |
| gift-page-scheduling.test.tsx | `9ada2abcd0ccc73c293038a63db88a8f0876d3c249ec78f79b192672b96cf49a` |

### code-simplifier 与 S.U.P.E.R 初判

code-simplifier 只读收敛结论：不建议追加修改。九行 wrapper 使目录依赖所有权清楚；判别 tuple 保持“目录必须提供组件”的编译约束。改成可选参数、默认导入或大规模搬动分支，反而可能放松约束、重新建立目录 runtime 依赖或改变 await/错误时序。现有改动已足够小，不为少几行引入风险。

| # | 检查 | 当前结论 |
| --- | --- | --- |
| 1 | 模块单责 | PASS：目录入口只组合目录专属依赖；共用 shell 继续原职责。 |
| 2 | 函数单一概念 | PASS：新函数只构造原目录 Page，没有新增读取/筛选/副作用。 |
| 3 | 依赖方向 | PASS：目录 route→目录入口→shared factory；shared 仅类型引用目录组件，不产生 runtime 反引。 |
| 4 | 无新增循环 | PASS（静态）：新增模块没有反向 runtime import，现有模块方向不改。 |
| 5 | 明确接口 | PASS：SupportedLocale、PageDefinition 判别 tuple 与现有组件 props 类型限定组合；业务 Zod/JSON 合同不变。 |
| 6 | 可序列化数据边界 | PASS：没有改变业务输入/输出或将 server 组件函数传至 client；React server 工厂组合仍留在 server。 |
| 7 | 环境配置 | PASS：没有新增域名、资产、市场、币种、凭据或运行配置；七 locale 路由字面量是既有固定路由结构。 |
| 8 | 依赖声明 | PASS：没有新增生产依赖；静态测试使用既有 TypeScript 工具。 |
| 9 | 替换边界 | PASS：目录实现通过原 props 类型注入，可独立替换；详情不需知道目录运行时实现。 |
| 10 | 验证 | 定向 142 tests PASS；完整开发门、真实UI、实际脚本减少、收尾扫描仍待当轮结果。不能提前计全部完成。 |

一次性脚本分析器此前三条建议也已静态确认处理：检查所有 parsed Scripts（含 inline），requestId 非空唯一，stage/两组0+1读取/全部六次 settings 相等。分析器未由审查者执行；实际兼容性与结果仍以 root 留档为准。

**代码审查可进入实际验证，无阻断发现。** 本段不等于已证明减包、LCP 收益或完整检查点 ACCEPT；性能/人工/商户门保持 OPEN。

## 六次实际下载与开发门复核

现已只读核对当轮 `check-dev-status.json` 和 `check-dev.log`：exit 0、34.624 秒；typecheck 与 test 各 62/62（各 61 cached），build 36/36（35 cached）。先前一次性 output 分析器缺少 URL/Buffer 显式 import 的 lint 失败由 root 保留，当前冻结候选通过；本审查没有重新运行任何测试或构建。

独立轻量读取并校验 `run-2026-09-17T08-41-18-090Z/browser-attempt-1`、`browser-attempt-2` 的 54 个原始文件长度/SHA 全部一致；六次 LHR configSettings 相等、无 runtimeError、同导航内容有效、实际读取均为 0 GIFT_CONTENT + 1 STOREFRONT_GIFT。两组组前完整公开 API response SHA 相同由 `capture-summary.json` 留档；其范围是组前响应相同，不冒充每次导航不可变版本证明。

对 `script-comparison` 另核六份明细的全部 96 个 parsed Scripts（含 inline）：每份原始 artifacts 中的 content SHA 与提取结果逐项相同，19 份去重 body 的实际字节/SHA/UTF-16 长度及四 marker 计数吻合。48 个真实网络 Script 请求均为 200、finished、未失败，逐次各八个唯一 requestId；resource 字节与 body 相符，transfer/resource 逐请求求和与总数一致。before 三次均有包含四 marker 的同一旧 body，after 三次的全部 parsed scripts 均无任何 marker；不是仅按 chunk 名字或排除 inline 得出的结果。

| 单次导航的脚本口径（三次均相同） | before | after | 减少 |
| --- | ---: | ---: | ---: |
| Script 请求数 | 8 | 8 | 0 |
| 实际外部 UTF-8 body / decoded resource 字节 | 519,533 | 513,708 | 5,825 |
| 实际逐请求 transfer 字节 | 159,320 | 157,941 | 1,379 |
| 本机 gzip level 6 字节（独立诊断口径） | 155,368 | 153,989 | 1,379 |

这些证据支持目录筛选特征实现从详情首访脚本集合消除及以上实际体积减少；不提供该实现执行次数、单独工厂压缩边界或 LCP 因果。源码清单仅有已审九生产/三测试差异，未同时改变 GiftFiltersClient、图片、字体或配置；manifest 与编译输入的关联仍依赖 root 的冻结/构建过程，不由 manifest 本身单独证明。

两组官方 trace 分析的 12 个 FCP/LCP 复算记录均与各自 LHR 精确相等（difference 0、容差 1e-6ms），六份详细分析与汇总一致。审查者只核对结果和原始输入 SHA，没有重放官方计算。当前中文六次诊断的模拟 LCP 中位数为 before 5,441.416ms、after 4,817.547ms；两组 performance score 与 LCP 预算均失败，CLS 为 0。保留全部三次，不能用 candidate 第三次 2,111.332ms 替代组结果或正式全语言门。

### 历史绘制等待已再次复现，仍未定位或修复

before 第 2 次的图片请求完成时间为 528.146ms，官方 observed LCP 为 1,597.291ms，间隔 **1,069.145ms**，因此不能沿用上一检查点“本轮未复现”的表述。同导航、同 renderer、同 LCP node 8 的 PaintImage 发生在 600.411ms 与 1,594.351ms，而 firstPaint/FCP/LCP 均为 1,597.291ms；这也说明早期 PaintImage 不能单独证明已向用户呈现。另一个复用相同 URL 的 node 36 不计为目标主图证据。相邻 compositor/raster 事件没有目标图像关联，不作具体原因判断。

候选三个 image-finish-to-LCP 间隔为 10.658 / 37.893 / 30.480ms，只说明三个样本没有该异常，不能证明目录拆分修复了异常。before 图片状态为 MISS/HIT/HIT，after 为 STALE/HIT/HIT；首样本缓存状态、时间顺序及未控制的渲染波动限制 LCP 因果解释。本轮没有实施图片转换或缓存优化。历史与当轮累计 **48 份诊断报告**，仍不是正式 63 份矩阵。

**实际减包证据与完整开发门通过；S.U.P.E.R 第 10 项尚待当轮完整 88 UI 场景及最终收尾保护/扫描结果。** 本段继续保持检查点整体待验收，P3-06 性能/人工/商户门 OPEN。

## 完整 UI 与收尾的最终独立复核

已只读检查 `final-verification.json`、`source-binding.json`、`README.md`、`boundary-results.json`、`protection.json`、fixture 原日志及 attempt3 的原始 `browser-results.json`。浏览器结果文件的实际 SHA 与 final-verification 所录 `9159b1f65d42d73accd0a5305adc74cfb9045916fe3195a8dff62a4a619493a7` 相同。

- 88/88 cases 通过：七语言 × 两个宽度的六类页面共84例，另四例分别覆盖艺人搜索/锚点/键盘/语言恢复、礼物分页/筛选/原生返回、移动筛选焦点/reduced motion/取消、不可用/网络/图片/缺失路由。84份 metadata 覆盖同七语言六类页面，目录与详情 SEO 未被新入口绕过。
- 88份 PNG 实际存在且格式正确；86份 reflow 记录均无 root/body 超过所测 viewport 宽度。85次 axe 的 violations 合计0、incomplete 合计30；incomplete 不计为通过人工无障碍验收。pageErrors 为空。
- 独立打开查看中文390宽详情、英文1440宽目录截图：详情主图与正文、规格/价格、目录筛选表单、四列卡片及分页均保持可见，未见本次依赖隔离造成的布局缺失或遮挡。此抽查只支持所见截图，不能冒充88图逐张人工审阅、译审、实机或VoiceOver。root另查看的泰语手机目录/葡语桌面详情在最终文件保留SHA；四张所录截图SHA已独立重核。
- 实际发布/回滚可见性均 PASS，分别10,084ms / 10,310ms；原记录覆盖七语言公开API、Chrome文档、Next sitemap。sitemap为56 root shards、七语言、1,050 URLs。该证据限定本地TEST路径，`externalCdnEvidence:false`、`manuallyRunPurgeWorker:false`；不冒充真实外部CDN验收。
- fixture 原日志确有32,461协议断言PASS以及三次browser callback；adapter/artifact边界结果均exit0。清理记录为owned session34858 exit0、62919/62920无监听。审查者没有再次启动或操作进程，清理结论来自root当轮实际留档。
- protection记录原4,210个未跟踪文件和2,229个候选输入均无SHA变化。独立重核本轮12个差异文件当前SHA及before/after清单聚合SHA匹配。`source-binding.json` 相对更早reference的既有差异不是本轮新增范围；本轮候选相对baseline确为九生产/三测试文件。

### 最终范围结论与 S.U.P.E.R 限制

**ACCEPT：礼物目录入口隔离的代码、本地功能回归与实际详情脚本减少证据。无阻断审查发现，不建议追加代码简化。** 上表S.U.P.E.R第1–9项保持PASS；第10项在本次选定实现和开发验证范围为PASS，依据为142定向测试、完整check:dev、实际协议、88 UI、同导航脚本/trace校验与边界检查。

这不是P3-06整阶段完成：正式性能预算仍失败，历史约一秒绘制等待已复现但未定位/修复；七语言关键译审、运营计时、30组axe人工判断、VoiceOver/实机、外部CDN，以及P4-04商户/PSP/staging门仍未由此检查点完成。S.U.P.E.R的局部验证结论不覆盖这些OPEN门。

**最终提交收尾的秘密扫描仍待root提供当轮结果。** 因此当前接受实现及已核证据范围，不将整体收尾标成全部通过；不表示已推送、合并、部署或生产发布。审查者本轮只修改本报告，未执行测试、构建、服务、浏览器或官方trace重放。

最终补证：已只读核对当轮 `secrets-status.json` 与 `secrets.log`，全工作区及新增暂存检查点文件的秘密扫描 exit0、40.534秒，**本次本地提交门PASS，目录入口隔离检查点独立复核ACCEPT并冻结**；上述性能/人工/商户OPEN边界不变，不表示已推送、部署或生产发布。

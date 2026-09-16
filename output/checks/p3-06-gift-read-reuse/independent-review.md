# P3-06 礼物正文与 SEO 共享读取独立审查

审查者：Codex `/root/gift_read_review`；2026-09-17（Asia/Bangkok）；基线 `587b3a2`。这是 root 持有的 P3-06 内部只读协作，不领取另一 Task/Lane。本文初稿审查候选设计与原源码，最终差分结论待实现后补充。未运行 build、PostgreSQL 或 Chrome，未修改产品源码。

## 设计结论

同意正常市场礼物详情移除独立 unscoped 内容请求。没有找到它拥有而 scoped 缺失的发布权威。`StorefrontGift` 的成功合同直接扩展 `PublishedGiftCommerce`，包含完整发布身份、内容与分类，额外添加 market/currency/recipient/offers；不是只包含价格的第二份摘要。

核对链路：

- `packages/contracts/src/storefront-commerce.ts:168` 扩展公开完整礼物合同，并验证规格、库存策略、受赠艺人和可售状态一致性。
- `packages/persistence-postgres/src/storefront-commerce-repository.ts:128` 的 `loadGift` 在同一 SERIALIZABLE snapshot 中先调用 `loadPublishedContentContext`，严格/日常发布模式分别保留完整 proof，分类与出版身份绑定，之后验证市场、受赠艺人及当前价格库存。
- `packages/persistence-postgres/src/published-content-repository.ts:70` 验证当前 head/publication、manifest bytes/hash、receipt/headVersion、媒体证明和共享锁；proof v3 走真实 daily publication reader。复用读取不删除这些检查。
- `packages/application/src/storefront-commerce.ts:106` 再验证 command、当前对象/请求语言、当前 SQL price 与 canonical price-book evidence，投影报价，再以公开 schema 校验。
- `apps/storefront/src/server/public-commerce.ts:147` 验证 HTTP status、schema、handle、locale、market/currency 与 recipient，8 秒超时、no-store 和安全失败不变。

现有正文 `gift-detail-page-reads.ts:17` 总是启动 unscoped，正常 scoped 成功后正文实际使用 scoped；SEO `gift-seo.tsx:58` 则先等 unscoped，随后再 await scoped。两种 endpoint 不能由 React 自动合并，已有各自 `cache` 也不意味着必然四次 HTTP。目标是移除一次不同路径的冗余完整发布读取。

## 必须保留的行为

| 分支 | 读取与输出 |
|:--|:--|
| 合法 market/currency、scoped SUCCESS | 正文、title/description/OG、JSON-LD 使用同一个 scoped publication/content；零 unscoped 请求。 |
| 合法市场、scoped MARKET_UNAVAILABLE | 之后才读取 unscoped 介绍；市场错误仍明确，无虚构 offer，SEO noindex/no hreflang/no Product。 |
| 合法市场、scoped NOT_FOUND | 保持首响应前 404，不用另一次读取恢复成功。 |
| 合法市场、CONTENT_UNAVAILABLE/INVALID_QUERY 或意外 reject | 保持原安全失败/拒绝，不用 unscoped 绕过价格或内容失败。 |
| 无市场 | 只读 unscoped，原文/翻译照原规则显示；不猜市场、币种或报价。 |
| 非法 query | 保持原 unscoped 对象存在检查、错误界面与恢复链接；不调用 scoped。非法 handle 在调用前 404。 |
| variant/recipient | 已选规格不存在不能偷换最低价规格；受赠艺人暂停/缺失/不适用与库存/预售行为仍来自 scoped。 |
| fallback/daily | 严格英文事故 fallback 与 daily 实际 sourceLocale 保留各自 provenance/lang；非对应语言不伪造可索引翻译。 |

原实现可能在两个独立读取恰跨发布时得到不同版本或一成一败。新行为使用一次完整、同事务 scoped 证明决定正文；这不是宣称两个旧请求在所有竞态中本来等价。它消除这对独立快照的混版窗口，但 SEO entity 仍是独立读取，继续需要严格匹配。

`provenSeoLocales` 必须保留 publication id、revisionId、manifestHash、publishedAt、translationRevision、requested/resolved locale 和 fallback 检查。任何一项不匹配应 noindex，并清空 alternates/Product；不能只比 revisionId，也不能拿旧 unscoped 标题拼当前 scoped 价格。无市场的合格内容 Product 可无 offers，维持原行为。

## 需要的测试与实际证据

1. 正常 scoped 成功与未使用 unscoped 永久 pending/抛错的组合，正文和 SEO 不应等待或调用 unscoped；scoped 自身 pending 必须继续阻止任何礼物正文/价格首屏。
2. 无市场 unscoped pending、404、失败/意外拒绝，以及 MARKET_UNAVAILABLE 的顺序介绍读取、介绍 404/失败/拒绝。
3. 七语言正文与 metadata 使用同一内容；对 SEO entity 的四个 publication 字段及 translation revision 分别做不匹配回归；daily 原文和严格 fallback 保持 noindex。
4. 已有七语言流式测试、延迟 context/artists、暂停艺人、库存/variant/查询恢复、购物车恢复继续通过。旧“两次 proof 都 pending”断言应改为当前选择的完整权威读取 pending，不删除首响应安全门。
5. 实际 Next 上同时存在 `generateMetadata`、正文和内联 JSON-LD 时按 owned 原生观察计数；普通函数单测中的 React cache 不具备真实 RSC 请求上下文，不能仅靠 mock 计数声称实际合并。相同语义但 query 属性顺序不同、variant 改变和不同 locale/market/currency/idol 的缓存边界不串线；不能引入全局 Map 或持久缓存。
6. root 独占真实 fixture，在同样设置下保留有限前后样本、同导航内容验证和所有原始失败；一个端点少一次请求不等于保证 LCP 达标。MARKET_UNAVAILABLE 介绍变为顺序读取，该异常分支可能更慢，应在浏览器保留错误与恢复体验证据。

本地安装的 Next 文档 `01-app/02-guides/caching-without-cache-components.md:262` 明确 React cache 用于单次 render pass 的读取去重；`01-app/03-api-reference/04-functions/generate-metadata.md:112` 说明 metadata/页面/Server Components 的请求 memoization。此设计继续使用现有 React 请求内机制，不能改为 `use cache`/`unstable_cache` 等跨请求缓存。

## 当前审查边界

本初稿没有新测试通过、实际请求数、性能收益或 Phase 退出结论。P3-06 性能、人工/读屏/真机、PSP、Phase 5 和上线门均保持。

## 候选草稿复核（实际源码尚为基线）

root 指定的 `candidate-source-draft/` 中三个生产文件及 `gift-content-read.test.ts.txt` 已逐行只读审查；现有正文/SEO 测试差分此前亦已读。静态结论：未发现阻断性问题，最终实际源码与执行结果仍待核对。

- 新 `gift-content-read.ts` 只负责按已经解析的选择执行完整内容读取。React cache 的 locale/handle/market/currency/idolId 五个固定 primitive 参数不会因正文与 metadata 构造了不同 selection 对象而错过同请求缓存；variant 不改变 API 读取，仅在调用者决定报价/SEO。无市场和非法选择共享相同 unscoped key，但外层仍各自保存 selection、展示不同状态。
- scoped NOT_FOUND/CONTENT_UNAVAILABLE/INVALID_QUERY 原样返回，无 catch/fallback 重试；只有 MARKET_UNAVAILABLE 才 await unscoped。缓存中不储存私密上下文，也没有全局可持久 Map、跨请求 TTL、配置更改或新网络 timeout。
- 正文在发起共享内容读取后立即发起 artists，继续只 await 内容权威；artists 的安全 catch 不动。context 仍由原 page factory 单独流式解析。
- SEO 从 `result` 选择标题/描述/图片/publication/locale proof；scoped 成功时 result 就是同一 scoped 值，Product 使用同一对象及其报价。MARKET_UNAVAILABLE 结果只能提供介绍，`scoped?.outcome` 失败使索引与 Product 关闭。原 `provenSeoLocales`、variant、recipient fallback 和最终 indexable 合并未弱化。
- 新 cache 参数测试明确 mock 只采集参数而不模拟真实 RSC 生命周期；实际去重仍由 root 的编译后 Next 原生请求计数证明。单测中 JSON.stringify 把 undefined 表示为 null 不会影响该测试比较的已定义隔离维度，但它不是生产缓存实现。

已读取并应用 `/Users/mario/.codex/skills/code-simplifier/SKILL.md` 检查最近修改。三个生产文件职责单一，单层条件/短分支可读，无必要新增抽象、合并模块或压缩代码；不建议为减少行数重排 await/artist 并发或 SEO 分支。只需原计划格式化，不产生额外行为改动。

这一轮没有执行 Vitest、typecheck、build、PG 或浏览器，避免干扰 root 的 Lighthouse 基线测量；以上不冒充执行通过结论。

## 最终实际源码差分审查

结论：**ACCEPT（代码范围）**，未发现需要修复的功能、错误传播、SEO、缓存隔离或可读性问题。已复核实际 `apps/storefront/src/storefront/` 下三个生产文件（含新增 helper）和三个测试文件，与草稿设计一致。没有修改被审源码，也没有另跑测试或构建。

测试补充已落实：七语言首屏不等待未使用的 unscoped；原 404/reject/pending 分别继续覆盖 scoped 与无市场 unscoped；MARKET_UNAVAILABLE 顺序回退的 pending/404/CONTENT_UNAVAILABLE/reject；daily sourceLocale 在有/无市场两种情况下保持真实 lang，有市场价格继续显示；metadata 保留原文但不伪装翻译；publication 四字段、translation、recipient fallback 和未知 variant 继续禁用错误索引。旧双证明调度断言改成当前完整证明，不是放开未验证首屏。

已读取 `gift-reads-red-result.json` / `gift-reads-red.log`（23 failed / 53 passed）及 `gift-reads-green-attempt-1.log`（3 文件、88 passed、2.83 秒），根代理另提供 typecheck 成功；对应 typecheck 原始日志只有 `tsc -p tsconfig.build.json`，无错误输出。本审查没有伪称独立重复执行。

审查时第一轮 `check-dev-result.json` 为 exit 1，`check-dev.log` 明确 format 在新 helper 测试文件失败，后续检查未执行；须由 root 保留原失败并完成格式化后复验。实际 Next 去重、七语言双视口、发布回退和性能比较仍以 root 后续新证据为准。

### S.U.P.E.R（本次前台代码）

| 项 | 判定 | 依据 |
|:--|:--|:--|
| 1 单文件职责 | PASS | helper 只决定权威读取，页面读调度与 SEO 呈现保持分离。 |
| 2 单函数职责 | PASS | 外层选择 primitive key，内层执行分支读取；没有混入报价规则或缓存失效。 |
| 3 单向数据流 | PASS | 页面/SEO → server-only helper → 既有公开 API reader。 |
| 4 无循环依赖 | PASS | helper 仅导入既有 reader 与 parser 类型；reader 不反向导入 helper。 |
| 5 合同边界 | PASS | 沿用 StorefrontGiftReadCommand、既有 API schema 与 parser 输出，无新跨包合同。 |
| 6 可序列化 I/O | PASS | 请求键全为验证后的 primitive；异步返回既有可序列化公开响应，无 provider 对象或私密上下文。 |
| 7 配置无硬编码 | PASS | 新生产代码没有新增域名、路径、locale/市场特判、价格或密钥。 |
| 8 依赖声明 | PASS | 沿用已有 React/server-only/contracts，无新依赖。 |
| 9 可替换性 | PASS | 内部共享 helper 与现有 reader 边界清楚，API/PG/领域未动。 |
| 10 验证 | PASS（本次功能/开发范围） | 88 定向、最终 check:dev、真实七语言双端功能/SEO/请求计数已核对；首轮格式失败保留。正式性能、人工与 Phase 退出门仍 OPEN，见后续证据补验。 |

### 审查输入 SHA-256

下表是本次只读确认时的六文件字节，便于后续 root 比对最终候选；格式化若改变测试字节，应记录新值。

| 文件 | SHA-256 |
|:--|:--|
| `gift-content-read.ts` | `daba229db6fdc0f011733bca662dab817eb7d9b4585617f850eb053fdb657515` |
| `gift-detail-page-reads.ts` | `3f65e77df84f71c82af6210b13d55d89db3967af4d21dc53aa9fa3416f6cc9fe` |
| `gift-seo.tsx` | `0604cd4aa64c407633fdff6a7182377a3ab4ba2f3d4d8ebed2a46aec74f89272` |
| `gift-content-read.test.ts` | `2ed4e20a338f499a44aedac320ce1a3469a84b32a5612d49d36f5b0c9d8093f8` |
| `gift-page-scheduling.test.tsx` | `d7bda124ab664f37720e251106f0e03ef9e3efe97076c90cad777f8b04bb3399` |
| `gift-seo.test.tsx` | `862b1f7518b47bbe51fe623aad3a11243ed36618161ef2911027c14c5798eccb` |

## 实际功能与开发验证补验

已独立读取 root 生成的原始结果文件及日志，**维持代码 ACCEPT，S.U.P.E.R 第 10 项在本次功能/开发验证范围更新为 PASS**。这不是 P3-06 退出或性能验收通过。

- `check-dev-final-result.json`：原命令 `pnpm check:dev` exit 0，57.564 秒；日志确认 workspace/boundaries/format/lint/typecheck/test/build 连续通过。typecheck/test 各 62 成功（各 60 cached），build 36 成功（34 cached）。第一轮 format 失败文件与日志仍保留，不改写为第一次即通过，也不称此次为完整 `pnpm check`。
- 原实际 fixture `run-2026-09-16T17-15-30-987Z/browser-attempt-3/browser-results.json`：88 cases 全通过、88 PNG、85 axe 零 violations，30 incomplete rules 保留；84 metadata 页，0 pageErrors。证据明确没有新增 physical device 或 VoiceOver。
- 同次 `publication-visibility.json`：真实 TEST 发布到七语言 API/Chrome/Next sitemap 可见，PUBLISH 12,322 ms、ROLLBACK 11,655 ms，均在 60,000 ms 内；无外部 CDN 证据。
- 同次 `gift-read-comparison/results.json`：七语言 × 390/1440 共 14 个正常详情导航全部 HTTP 200、目标内容可见、URL/locale 正确、无错误 UI；每个导航均为 1 次 STOREFRONT_GIFT、0 次 GIFT_CONTENT，证明实际编译 Next 正文/metadata/JSON-LD 没有再触发独立 unscoped 读取。
- 4 个真实边缘分支也已核对：scoped missing 为 HTML 404 且只有一次 scoped 404；scoped 注入 unavailable 为安全错误 HTML，只有一次 scoped 503，未恢复为介绍；无市场只有一次 unscoped；未配置市场先 scoped 409 COMPLETE，随后才 GIFT_CONTENT CREATE/200，介绍可见且无报价。
- 六个实际源码/测试文件逐 SHA 均与 `candidate-source.json` 一致，完整候选 manifest 声明 2,212 输入、aggregate SHA `ae070dff1fc4ea83caff72f08f0e0a2b85beae365fb3391a04c1ef85c49e7590`。本独立复验只重算六文件，未冒称重算全部 2,212；详见 `independent-source-verification.json`。新 helper 测试仅格式变化后的 SHA 为 `2ed4e20a338f499a44aedac320ce1a3469a84b32a5612d49d36f5b0c9d8093f8`，其余五文件与上表相同。

比较结果的明确状态仍为 `COLLECTED_DIAGNOSTIC_BUDGET_FAILED`；Next 原生观测已启用，`formalPerformanceAcceptance=false`。不以 UI callback 的 PASS 覆盖 Lighthouse 预算失败，不将少一次请求换算为保证 LCP 达标。root 追加 A2/B2 顺序比较仍保留各次原始样本；本补验不提前宣布其未完成测量结果。性能、人工运营/关键译审/读屏/真机、实际 PSP、Phase 5 和上线门继续 OPEN/LOCKED。

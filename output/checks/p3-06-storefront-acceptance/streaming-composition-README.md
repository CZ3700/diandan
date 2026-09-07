# 首页与艺人页下屏读取独立流式输出

作者 `/root/storefront_read`，同 P3-06 executor 下的 root 委派。root 在完整 63 份性能采样结束并暂停 Next 后授权实现。本轮不启动服务、浏览器或构建。

## 改动

首页仍同时开始 homepage 与 directory 读取，但只等待 copy 和经过严格验证的 homepage 才输出 hero。已启动的目录 promise 在 `HomepageDirectory` 中等待，由下屏独立 Suspense 输出原 `ArtistDirectory`。

艺人页仍先验证 slug 与当前 IDOL 存在性，`NOT_FOUND` 仍在任何 shell 返回之前执行。成功艺人的下屏 `ArtistGiftDirectory` 才读取 commerce context，随后复用原 `GiftDirectorySection`；主视觉不等该请求。可信 artist.id 仍覆盖入站 query 的 idol 值。

共 5 个产品源文件和 2 个测试文件，清单及独立 SHA 在 `streaming-composition-source.json`。不涉及合同、API、copy、footer/header、CSS、媒体证明、缓存 TTL 或礼物详情页工厂。`code-simplifier` 复核保留两个简单 server child，没有引入通用数据加载框架。

## 验证

使用 Node 24.20.0，通过 `mise exec node@24.20.0 -- corepack pnpm ...` 执行。

| 项目 | 结果 | 日志 |
| --- | --- | --- |
| 首页有效 RED，7 locale + 两个目录错误 | 9 FAIL / 13 PASS；已确认 homepage 成功仍无 hero，直到目录 resolve | `homepage-directory-streaming-red.log` |
| 首页首次 GREEN | 22 PASS | `homepage-directory-streaming-green.log` |
| 艺人有效 RED，七语慢 commerce context | 7 FAIL / 23 PASS；存在已确认却未输出 hero | `artist-directory-streaming-red.log` |
| 艺人首次 GREEN | 30 PASS | `artist-directory-streaming-green.log` |
| 最终六文件回归 | 55 PASS | `streaming-composition-final-tests.log` |
| 7 个 owned files ESLint | exit 0 | `streaming-composition-final-lint.log` |
| 7 个 owned files Prettier check | exit 0 | `streaming-composition-final-format.log` |
| 全 storefront typecheck | root 修正其同期文件后执行 PASS；本作者只读日志核对，不重复运行 | `performance-source-typecheck.log` |

最终回归命令为 `pnpm --filter @fan-support/storefront test src/storefront/page-factory.test.tsx src/storefront/page-factory-dependencies.test.ts src/storefront/browse-seo.test.ts src/storefront/published-image.test.tsx src/storefront/artist-directory.test.tsx src/storefront/gift-directory.test.tsx`。

测试使用真实 `renderToPipeableStream` 与完整 schema 验证的单位夹具：证明未确认内容不输出 hero；确认后在慢目录、慢 context、慢 SEO 下可以输出 hero/preload；最终服务端卡片、anchor、七语 locale、market/currency/sort/idol 保留；目录/商务失败不成为空成功；未找到艺人的原 404 测试保留；目录失败仍令 metadata noindex。

首个首页夹具漏 `aliases` 的错误单独保留 `homepage-directory-streaming-fixture-error.log`，它不是有效 RED 根因。第一次 typecheck 同时发现本测试 fixture 的 nested union narrowing 与 root 同期 `gift-detail-page-reads.ts:18` 的 string/Slug 类型错误；自己的类型问题已修正，后续两次只余 root 文件错误，未改越界文件。口述中曾误报前一轮回归 47 项，实际 `homepage-directory-streaming-regression.log` 为 41 项；最终以 55 项日志为准。

Root 随后将其 helper 的 handle 类型收紧为现有 command 的 branded handle，执行全 storefront typecheck 通过；这里已读取 `performance-source-typecheck.log` 确认。之前失败日志保持原样，7 个 owned files 快照不变。独立 `git diff --check` 限定这 7 个文件 exit 0。

## 独立复审与边界

目录 agent 非作者只读复审 5 个产品源文件与测试，结论 ACCEPT：首页两读保持并行；仅真实 homepage 阻塞 hero；艺人先 existence 后 shell；commerce 只在成功 artist 子树读取；最终目录/context/anchor 保留。其复审没有代跑我的测试，作者执行与非作者源码审阅分开。

待真实观测：一行目录 fallback 未预留完整卡片高度，desktop 可视区若包含下屏内容可能产生 CLS，需要新的真实浏览器/相同 Lighthouse 参数验证。尚未宣称实际 LCP、CLS 或 P3-06 门通过。旧全部 63 份性能结果和失败保留；这次 React SSR 单测不是生产 CDN/RUM 证据。

# 交接：L2-17 礼物展示与筛选体验七项已完成并上 stg；L3-12 尚未开工

> 日期：2026-10-01
> 执行：Claude（Windows 端）
> 分支：`v2/r1-production`，本文件提交后与 origin 同步。stg 在 e84d347e（`webMode: PREBUILT`），迁移头仍是 0057。
> 冷启动顺序：AGENTS.md → SPEC §0.3–0.6 → [上线计划](../plan/2026-09-28-flexible-storefront-launch.md) → [当前进度](../progress/launch-progress.md) → [新功能方案](../plan/2026-09-30-brokers-ledger-private-notes.md)（第 2.3 节、第 5 节、第 9 节“账目（L3-12）”）→ [ADR-022](../decisions/022-brokers-ledger-private-notes.md) → 本文件
> 上一份交接：[2026-09-30-l3-11-brokers-and-artist-assignment.md](2026-09-30-l3-11-brokers-and-artist-assignment.md)（其中 L3-12 的开工清单仍然有效）

## 背景

用户要求按上一份交接继续（下一步是 L3-12），同时追加了七项商城礼物展示的修改。七项里第 6 项是缺陷，用户又正在看商城，所以先做这七项，合并为条目 L2-17。L2-17 做完即到阶段边界，**L3-12 没有开工**，留给新会话。

## 已完成

| 条目 | 提交 | 验证 |
|:--|:--|:--|
| 进度登记（开工前） | c49e89a5 | — |
| L2-17 全部代码、七语言文案、SPEC 6.1.0 §0.6、上线计划、完整栈浏览器脚本改写 | e84d347e | 见下 |
| journey 脚本：详情页政策组改为只核对页脚 | 9896c879 | CI 结果见“在途” |
| 依赖安全升级：`@nestjs` 三个包 12.0.2、fastify 5.12.4（GHSA-9c5c-9qcx-q35q） | 26b9fb3c | 本机审计无已知漏洞；类型检查、构建 38、受影响包测试通过；**stg 尚未部署** |
| 进度表、本交接 | 本次提交 | — |

L2-17 的七项与做法（用户原话在上线计划“2026-09-30 晚 用户追加”）：

1. **摘要截断**：所有礼物卡片摘要电脑 2 行、手机 1 行。
2. **筛选不刷新**：类型、排序、翻页都是就地更新，不重新加载文档、不回到顶部，地址同步变化。
3. **只留类型 + 价格排序**：工具栏是一行类型标签和“价格 ↑ ↓”两个图标；类别、可售状态、金额区间的面板与手机抽屉撤下。
4. **去掉标题**：首页礼物区、礼物目录页、艺人页礼物区都不显示标题、小标题和副文案。
5. **电脑 4 列**：平板 3 列、手机 2 列；“大图展示”预设不变。
6. **价格或摘要有时看不到**：三个原因都修了（见“关键决策”）。
7. **礼物详情页**：去掉“礼物详情”“工作室准备与转交”两个板块。

验证（数字在进度表 L2-17 行）：

- 单测：商城 934、i18n 64、ui 100；门禁 format、lint、typecheck、build 38、设计令牌与四项 UI 检查通过；测试串行加逐包降并发复跑全过。
- 本机真实浏览器：假 API 夹具 + 开发模式、正式构建各 185 项；七语双端 268 项（无横向溢出、axe 无严重违规）。
- stg 真实域名（只读）：177 项 + 七语双端 268 项全过；刷新 40 次全部同时有价格和摘要（部署前同样 40 次：礼物目录页 10 次全部没有摘要，首页 30 次里 21 次首屏没有价格）。

## 关键决策及理由

- **先做七项、后做 L3-12**：第 6 项是用户能看到的缺陷；L3-12 估计一个半到两个会话，混在同一会话里会在半途交接。
- **就地更新用 Next 客户端路由，链接保持真实**：工具栏和翻页都是普通 `<a href>`，带 `data-gift-nav` 标记；`GiftNavigationFrame`（客户端组件，包在礼物区外层）拦截点击后 `router.push(href, { scroll: false })`。好处是地址可复制、可分享、后退可恢复，搜索引擎照常抓取，服务端渲染的组件不依赖路由。
  - 跟随时去掉链接里的 `#gifts`，否则 Next 会滚回礼物区顶部。
  - 用 `useTransition` 包住导航：新结果就绪前旧列表留在原位（只变淡），不出现空白或占位；选中的标签通过上下文立即高亮。
  - 翻页完成后才把礼物区顶部滚回视野；类型和排序不滚动。
- **三处“看不到价格或摘要”的原因**：
  1. 旧表单把没选的条件以空值写进地址（`category=`），带价格的读取把它判为非法参数，退回无价格列表。翻页链接不带空值，所以“点下一页就好了”。现在空的 `kind`、`category` 按“未选择”处理（`gift-query.ts`），旧地址也能正常显示价格。
  2. 礼物目录页带价格的卡片不显示摘要，先到的无价格卡片显示摘要。现在所有列表用同一种卡片。
  3. 首次加载价格比列表晚到。现在先到的卡片带价格行占位，价格到达后原位填入，卡片不位移；地址带排序、金额或可售状态时，价格到达前显示骨架，避免先显示另一种顺序的列表。
- **详情页显示说明全文**：日常管理中心的说明最长 600 字符，卡片摘要（`shortDescription`）只是它的前 160 个字符。原来全文在“礼物详情”板块里，板块去掉后若只留摘要，超出 160 字符的部分就无处可看。所以在名称下显示全文并保留换行（`gift-detail-summary.ts`）。这一点用户没有提，是实现时发现的。
- **整个筛选面板撤下，而不只是类别**：用户说“只保留类型筛选”。可售状态和金额区间随之撤下，对应的输入校验、懒加载模块和测试一并删除。这些参数接口和地址仍然支持；地址带入时列表上方显示“已应用”和“清除筛选”，避免看不见的条件缩小结果。
- **标题改为不可见而不是删除**：页面大纲和读屏需要一个标题，`/gifts` 需要 `h1`。标题文字是“礼物”或当前类型名，用 `storefront-sr-only` 隐藏。
- **只有能给出价格时才显示排序**：多市场未选择时列表没有价格，也就没有排序控件。
- **价格占位用独立类名** `gift-directory-card__pending`：`gift-directory-card__price` 只表示真实价格，脚本不会把占位当成已定价。
- **没有脚本的浏览器**：部署前就只看到整页的加载状态（流式渲染需要脚本），这次没有改变，也没有为它另做回退。
- **文案**：新增一个键 `giftSortPrice`，删掉 13 个不再使用的键，七语言同步；审校记录仍是 DRAFT，哈希已刷新。

需要用户知情的两点（已写进进度表 L2-17 行的“缺口”）：

- 旧内容编辑器里的结构化长描述、转交说明、预计时间和安全提示不再在详情页显示。stg 现有礼物没有这些内容；政策链接仍在页脚，结账页仍逐条展示政策并取得同意。如果以后要恢复“预计转交时间”，可以在购买区加一行。
- “先写失败测试”没有严格做到：测试与实现同批完成，第 6 项以部署前在 stg 的复现（`output/checks/l2-17/stg-before.mjs`）作为失败基线。

## 在途

- 没有改到一半的代码。
- **CI（草稿 PR #16）**：
  - run 36741772819（080ce206，含 L2-17）：Security、commerce 通过；journey 停在七语矩阵，原因是脚本还在详情页里找政策链接组，9896c879 已改。
  - 9896c879 的这一轮（run 36748809693）里 Security 失败：当天新公布的 GHSA-9c5c-9qcx-q35q（`@nestjs/platform-fastify` 低于 12.0.2，高危）。已升级并在本机审计通过。
  - 本文件所在的推送会取消上一轮并触发新的一轮，**journey 与 Security 是否通过要在新会话里核对**。
  - catalog、operations、quality 仍停在各自既有的第一处失败。
- **CI 还没有执行到的改写脚本**：catalog 组的后三步（`storefront-acceptance-matrix`、`gift-storefront-browser`、`management-center-browser`）排在既有失败的 `catalog-fallback-seo` 之后。这些脚本只做了语法检查和 lint；逻辑与本机验收脚本相同，但没有在完整栈上跑过。`accessibility-flows`、`storefront-drawer-lazy-browser`、`storefront-acceptance-lazy-validation` 不在回归计划里，同样没有跑。
- **stg 没有带上依赖升级**：stg 在 e84d347e，`@nestjs` 仍是 12.0.1。下次部署（例如 L3-12）会一并带上；API 与 worker 是随 `local:build-web` 重新构建的，部署后照常抽查公开路由和后台登录即可。
- stg 上没有新增测试数据。回滚点：`~/backups/stg-pre-e84d347e-20260930`（回滚版本 cfcdfde1）。
- 远端协作者 Mario 的 b30e1cb3（首页群像海报动效）随这次部署一起上了 stg；他的专项复核还没做，进度表 stg 行里已注明。

## 下一步

1. **核对最新一轮 CI 的 journey 与 Security**（`gh run list --branch v2/r1-production --limit 1`）。journey 再失败就下载 `regression-journey` 附件，看 `artifacts/playwright/p5-08-local-experience/*/report.json` 的 `failure.sourceLine`，对照 `apps/api/scripts/local-experience-browser.mjs`。
2. **L3-12 艺人收礼账目与导出**：开工清单在上一份交接的“下一步”第 1 条，内容不变（先写失败测试 → 迁移 0058 → 合同、应用层、仓储、接口 → 后台“艺人账目” → 验收、部署 stg 后执行 `sync-roles`）。开工前在进度表把状态改为 IN_PROGRESS 并写明验证计划。
3. **CI 回归，先修 `catalog-fallback-seo`**（HOMEPAGE 故障回退）：它修好后 catalog 组才会执行到 L2-17 改写的三个脚本。上次的诊断结论在进度表“CI 回归”行：嫌疑是首页聚合读取 `storefront-homepage-repository.ts` 的 `loadPublishedContentContext` 在译文缺失时不回退。Mario 在 b30e1cb3 里改过 `regression-seo-recovery.mjs`，动手前先看他的改动。
4. **T-12**、**L3-13**：不变。

## 环境注意

- **本机商城验收夹具**在 `output/checks/l2-17/harness/`（不入库）：
  - `fixture-server.mjs <接口端口> <媒体端口>`：26 件礼物的假公开接口和 HTTPS 媒体；`POST /__mode` 可切换单/多市场、延迟和配色。
  - `run-next.sh`（开发模式）、`run-prod.sh build|start` 加 `tls-proxy.mjs`（正式构建，地址 `https://shop.example.invalid:4643`）、`stop.sh <端口…>`。
  - 证书 `cert.pem` 有效到 2026-10-30。旧夹具 `f1-03/harness/cert.pem` 已在 09-29 过期：过期后 Next 图片优化全部返回 500，手机宽度下浏览器会反复请求失败的图片，看起来像死循环；换证书后消失，正式构建上用拦截模拟图片失败也不会重复请求。
- **验收脚本**（都在 `output/checks/l2-17/`）：
  - `local-verify.mjs <标签>`：功能验收。对真实环境只读运行时加 `L217_FIXTURE=none L217_ORIGIN=… L217_VIRTUAL_PAGE=12 L217_GIFT=/zh-CN/gifts/<句柄> L217_POLICIES=1`。
  - `locales.mjs <标签>`：七语双端布局与 axe。
  - `stg-before.mjs` / `stg-after.mjs`：刷新基线。
  - 传以 `/` 开头的环境变量或参数要加 `MSYS_NO_PATHCONV=1`，否则 Git Bash 会把它改写成 Windows 路径。
- **文案键增删后刷新审校哈希**：先 `pnpm --filter @fan-support/i18n build`，再 `node output/checks/l2-17/storefront-copy-hashes.mjs --hash`，再构建一次。和 Mario 同时改文案时 `*.review.ts` 必然冲突：任取一边，合并后重算即可。
- **heredoc 里内嵌 node 脚本改源码会丢反斜杠**：`\\b` 被写成退格符，正则失效且肉眼看不出。含正则的修改用编辑工具直接改；大段替换先把替换文本存成文件，再按锚点拼接。
- **开发服务器运行时 `tsc` 会报 `.next/types` 冲突**：`next dev` 会改 `apps/storefront/next-env.d.ts`。停掉开发服务器并 `git checkout` 还原后再做类型检查，提交前确认它没有被带上。
- **单测里渲染礼物分区要模拟路由**：分区里有 `GiftNavigationFrame`，需要 `vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))`；已有 `notFound` 模拟的文件要把 `useRouter` 加进去，用到真实 `notFound` 的文件用 `importOriginal`。
- **流式渲染测试**：整棵树只有一个 Suspense 边界时 React 不会先输出回退内容，测试里要像真实页面一样在外面包一层元素。
- **浏览器脚本里的就地导航**：`waitForNavigation` 和 `goBack({ waitUntil })` 对同文档导航会立刻返回。改为等地址变化，再等 `[data-gift-navigation]:not([data-gift-pending])`，再等网络空闲；后退之后等工具栏的 `aria-current` 到位。
- **`check:dev` 并行下的 5 秒超时**：做法不变。本轮超时的是 admin 3 个、storefront 2 个、persistence 5 个，串行加 `--maxWorkers=4` 逐包复跑全过。
- **stg 部署**：本次构建 205 秒。当前商城配色是用户设置的樱花粉。

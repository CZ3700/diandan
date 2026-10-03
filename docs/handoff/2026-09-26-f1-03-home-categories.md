# 交接：F1-3 首页改版、四分类、价格直显第二阶段完成 → 下一条 F1-4 送达证明照片

> 日期：2026-09-26
> 项目：`C:\Users\admin\Desktop\下单\下单`
> 分支：`v2/r1-production`（已推送 origin，工作区干净）
> 新会话冷启动顺序：
> 1. 本文件；
> 2. `docs/handoff/2026-09-26-core-features-first.md`：核心功能的范围与顺序，用户已批准，不必再确认；
> 3. `docs/progress/v2-progress.md` 的"R2 站点核心功能"一节；
> 4. 开工 F1-4 前读：
>    - V2 方案 §4 第 6 项；
>    - `docs/plan/2026-09-26-slim-and-ux-appendix.md` 变更清单第 6 行；
>    - 规范 §5.8、§9.5、§15；
>    - F1-1 设计 `docs/plan/f1-01-virtual-gift-fulfillment.md`（履约状态机与送达动作）。

## 背景

用户 2026-09-26 批准站点核心功能按 F1→F2→F3 推进，沙盒与外部配置放到最后。F1-1（虚拟礼物自动履约）和 F1-2（订单公开短号）已在之前的会话完成。

本会话完成 F1-3，设计文档是 `docs/plan/f1-03-home-categories.md`。内容：
- 两个公开目录接口增加礼物类型筛选；
- 首页改为满屏偶像海报，下接四分类磁贴；
- 价格直显第二阶段：唯一市场时 `/gifts`、首页和艺人页目录直接带价，链接与规范 URL 不带隐含作用域，页眉和页脚隐藏"选择地区"入口。

## 已完成

| 提交 | 内容 | 验证 |
|:--|:--|:--|
| `86f12dd` | **F1-3a**：`GET /api/v1/gift-browse` 与 `GET /api/v1/gifts` 支持 `kind` 筛选，每个礼物带出 `giftKind`。取值为日常发布文档优先，其次修订资料，早期 v1 修订为 NULL。两个表都按唯一键联表，筛选在分页之前，无迁移。应用层与路由逐条复核。OpenAPI 已重新生成 | 合同 535、catalog 18、application 645、api 348。本机真实 PG：新脚本 `postgres-gift-kind-directory.mjs` 40 项（已并入 `test:postgres` 与 `test:postgres:gift-browse`）；既有 gift-browse 803、strict 69、catalog-directory 315 |
| `af5bb73` | **F1-3b**：首页满屏海报与四分类磁贴。两个目录的 `kind` 进入 URL 状态，有类型筛选和已应用摘要，`/gifts?kind=` 的眉题显示类型名。一个卡片组件同时服务两个目录，并显示分类标签。七语言文案仍是 DRAFT，审校哈希已更新 | storefront 807（当时）、i18n 63；本机浏览器验证见下 |
| `ceb768b` | **F1-3c**：唯一市场带价，流式结构调整；隐含作用域不进链接与 canonical；地区入口改为按上下文决定的插槽。ADR-017 增补、减摩擦记录、进度表已同步更新 | storefront 823。本机浏览器：三种上下文模式与延迟流式计时 |

**本机浏览器验证**（`output/checks/f1-03/`，不入库）：
- 方法：本机没有 S3，自建了假 API 夹具。Next dev 前台指向它，用 Playwright 加本机 Chrome 检查。
- 尺寸：390×844 与 1440×900。
- 语言：en、zh-CN、th、vi、es、pt 有截图和 DOM 检查；ja 只测了流式计时。
- 结论：
  - 唯一市场 / 多市场 / 上下文故障三种模式都符合预期；
  - 上下文延迟 3 秒时，内容卡片 0.2–0.8 秒出现，价格约 3.6 秒原位替换；
  - 所有链接都不带隐含市场；
  - 地区入口只在唯一市场时隐藏（抽屉与页脚都核对过）；
  - 磁贴键盘焦点环可见；减少动态效果时首屏动画关闭；
  - 无横向溢出，无控制台错误。

**门禁**：
- 三次 `check:dev` 的前五段（workspace、边界、format、lint、typecheck 69/69）都通过。
- test 段都只有既有的负载超时，串行复跑通过；build 38/38。
- 持久化包有 3 个测试在 32 个 worker 并发冷启动时稳定超时：`translation-workspace-repository`、`admin-preview-media-repository`、`translation-transfer-repository`，都是各自文件的第一个测试。用 `--maxWorkers=12` 跑时 765 全过。这 3 个测试与本次改动无关。

**未覆盖（需要 CI）**：API 级协议脚本与浏览器级验收。

## 关键决策及理由

1. **`giftKind` 放在 `PublishedGiftView` 上，作为可选、可空字段，没有另包一层。**
   - ADR-019 把分类定为与 `category` 同级的展示分类，日常发布文档里两者本来就并列。
   - 内容目录的条目就是视图本身。另包一层会改动内容目录的所有消费方、夹具和真实 PG 脚本（约 30 个文件）。
   - 只有目录读取会附上这个字段，礼物详情等其他读取路径不带。字段可选，所以其他路径不受影响。
   - 内部快照的做法：内容目录加与条目等长的 `giftKinds` 数组；带价目录的条目加 `giftKind`。两者都是可选的，只有生产者（仓储）总会填写。
2. **分类在 SQL 里按修订取，不做迁移。**
   - 用 `LEFT JOIN daily_publication_revisions ON gift_revision_id = revision.id` 和 `LEFT JOIN gift_revision_profiles ON gift_revision_id = revision.id`，两个都是唯一键，所以不会使行数翻倍。取值规则与 `order-line-gift-kind.ts` 相同。
   - 公共片段在 `packages/persistence-postgres/src/published-gift-kind.ts`。
   - v3 记录自带发布文档，仓储会核对 SQL 取到的分类与文档一致；v1/v2 记录只能信任资料行。
   - 新参数一律追加在参数表末尾，避免挪动既有参数的位置。
3. **v1 早期修订没有分类，筛选时不出现，只在"全部"里出现。** 这是真实数据状态，不做猜测性回填。
4. **四个磁贴总是显示，不依赖任何读取，随页壳输出。**
   - 某类暂时没有礼物时，点进去是既有的空结果状态。
   - 分类计数需要额外的聚合读取，留到有真实数据后再定。
   - 类型名沿用礼物详情已有的 `giftKind*` 文案，由 `gift-kind-copy.ts` 统一。
   - OTHER 类不做磁贴，也不在筛选里出现（除非 URL 已选中它），只在"全部"里出现。
5. **满屏海报几乎只改了 CSS，DOM 保持不变，所以 CI 选择器（`.storefront-hero #hero-title`、`.storefront-hero-image img`、`.storefront-hero-caption a`）都还有效。**
   - 桌面：同一格叠放，渐变遮罩用 `::after` 加 `color-mix(var(--color-bg))`。
   - 手机：图框 `aspect-ratio: var(--hero-mobile-aspect)`。`storefront-browser.mjs` 要求图框比例等于构图比例，图片失败时尺寸不变；原来固定 40svh 的高度其实不满足这个断言。
   - 未改规范 §5.1 的"桌面透明覆盖式页头"。它属于全站页头改动，不在本项范围，记为后续。
6. **价格直显第二阶段的流式结构：目录区在自己的 Suspense 里等待上下文，回退就是纯内容目录。**
   - 纯内容目录先 await（与现状相同），作为同一个元素对象，既当回退，也当"非唯一市场"时的结果。这样页壳和内容都不等商业上下文，满足 ADR-017 增补。
   - 代价：唯一市场时每次渲染多一次读取。首页本来就提前发起内容目录读取。
   - 考虑过的替代：回退用骨架屏，再在边界内先读上下文。它会让目录内容等商业上下文，违反交接中的硬约束，所以没有采用。
7. **核心组件只负责判定作用域和读取价格，渲染交给调用页的回调。**
   - 核心组件是 `sole-market-directory.tsx` 的 `SoleMarketGiftDirectory`。`/gifts` 传完整目录与筛选；首页用默认的紧凑渲染，即 `GiftBrowse` 显示带价卡片。
   - 第一版直接在核心组件里引用 `GiftDirectory`，结果首页的模块图引入了完整筛选的客户端组件，被 `page-factory-dependencies.test.ts` 拦下，于是改为回调。
8. **隐含作用域不写进 URL。**
   - `gift-query.ts` 的链接构造函数增加 `scope: "EXPLICIT" | "IMPLICIT"` 参数，筛选和校验一路透传。
   - 艺人页改为把作用域作为 `implicitScope` 传给目录区，URL 值保持原样。第一阶段是把市场写进 values。
   - URL 里显式写了市场和币种，哪怕与隐含作用域相同，也仍是显式选择。
   - `createSeoIdentity` 增加第 5 个参数 `implicitScope`：
     - 市场/币种与它相同时，canonical 去掉它们；
     - 无作用域的 `/gifts` 在唯一市场时变成可索引的带价目录；
     - 礼物详情的 variant 在隐含作用域下也保留。
   - SEO 加载器只在需要时读取上下文：`gift`/`gifts` 总会读；艺人页只在 URL 带市场时读。
9. **地区入口是服务端决定的插槽。**
   - `region-entry.tsx` 的 `RegionChoiceEntry` 放在 Suspense 里，回退为空，所以单一市场站点不会先闪出链接。
   - `SiteHeader` 的 `regionEntry` 和 `SiteFooter` 的 `region` 都可选，不传时保持原样，现有页眉测试不用改。
   - `/region` 页保留。

## 在途

没有改到一半的代码。待外部条件或待确认的事项：

- **CI 首跑的首要风险**：
  - `apps/api/scripts/local-experience-browser.mjs:433` 与 `apps/api/scripts/accessibility-flows.mjs:170` 在礼物详情页等待 `[data-market-choices]` 里的市场按钮。
  - 本地体验夹具（`local-experience-bootstrap.mjs:144`）只有一个 GLOBAL/USD 市场。从价格直显第一阶段（`973bbfa`）起，唯一市场的礼物详情已经直接显示价格和加购，不再出现地区选择。所以这两处断言在 CI 上会失败。
  - F1-3 又让首页和 `/gifts` 在同一夹具下带价，但 `accessibility-flows.mjs` 首页分类筛选的选择器（`#gifts [data-gift-browse-category]`、`[data-gift-browse]`）仍然成立。
  - 本机跑不了这些脚本，没有盲改。CI 首跑时按实际失败修改。
- **CI 验证**：本分支仍然没有 PR。F1-1、F1-2、F1-3 的 API 和浏览器级用例都只能在 CI 跑。计划在 F1 全部完成（F1-4 之后）开草稿 PR 一起跑，**开 PR 前要向用户确认**。
- 既有问题未动：
  - `pnpm deploy` 缺 `@opentelemetry/core` 对等依赖；
  - CI 有四组回归既有失败；
  - 并行负载下有慢测试超时（admin `center.test.tsx`；storefront 的 rum/specimen/order-controller；持久化包的 3 个冷启动测试）。
- R0 遗留、待用户拍板的事项：main 分支、`output/` 历史文件、归档目录、远端 `codex/*` 分支。

## 下一步（按优先级）

1. **F1-4 送达证明照片（可以直接开工）。** 先写 `docs/plan/f1-04-delivery-proof.md`，要点：
   - 需求来自附录第 6 行：运营标记送达时上传 1–3 张照片；新增 `fulfillment_proof` 关联表；照片只在查单会话内展示，不进任何公开页面；后台提示运营裁掉第三方人脸和地址信息。
   - 迁移 0040（当前头是 0039）。F1-1、F1-2 都有回滚前缀守卫：`notification-rollback-prefix.mjs` 与其测试要加入 `"0040"`，未知头探针改为 `"0041"`。
   - 媒体管线复用：`packages/media-image/src/image-pipeline.ts`（EXIF 剥离、重编码）、`packages/media-s3`、`packages/media-port`。
     - 先弄清公开媒体与"私有、只在会话内可见"媒体的边界。
     - 公开媒体 URL 合同 `publicMediaUrlSchema` 要求公开主机名，送达照片不能走公开派生路径，需要带会话授权的读取方式（例如经查单 API 代理，或签名 URL）。这是本项最大的设计点。
   - 后台送达动作：`packages/contracts/src/admin-orders.ts:118`（`DELIVER`），后台 UI 在 `apps/admin/src/management-orders/`。
   - 查单页照片位：`apps/storefront/src/storefront/order-detail.tsx`，F1-1/§4-5 的时间线旁。
   - 虚拟礼物行（F1-1）没有实体送达，不应要求照片。
   - 本机没有 S3，只能靠单元测试加真实 PG（表、约束、回滚）。S3 相关部分交 CI。
2. F1 全部完成后，开草稿 PR 跑 CI（先问用户）。处理上面的 CI 首要风险，再进入 F2 榜单与公会赛（按 ADR-018 拆子里程碑）。
3. 后续小项，不阻塞：
   - 规范 §5.1 的桌面透明覆盖式页头；
   - 磁贴显示分类计数；
   - 唯一市场时礼物详情的 JSON-LD 带 offer。

## 环境注意

- **本机浏览器验收夹具**：在 `output/checks/f1-03/harness/`，被 git 忽略，可以复用于 F1-4 的查单页。
  - `fixture-server.mjs <apiPort> <mediaPort>`：
    - 实现首页、偶像目录与详情、内容目录、带价目录、商业上下文等读取接口，响应都经合同 schema 校验；
    - 媒体用 HTTPS 提供，sharp 生成占位图；
    - `POST /__mode {"context":"SOLE|MULTI|FAIL","contextDelayMs":N}` 切换模式。
  - `run-next.sh` 启动 Next dev（端口 4600），相关设置：
    - `FAN_SUPPORT_DEPLOYMENT_ENV=development`；
    - 媒体主机必须是公开主机名。用 `media.example.invalid`，配合 `apps/api/scripts/storefront-test-dns.mjs` 这个 DNS 垫片（`NODE_OPTIONS=--import=...`）解析到本机；
    - 证书用 openssl 自签（CA:TRUE，SAN 为 `media.example.invalid`），经 `NODE_EXTRA_CA_CERTS` 让 Next 信任它，不关闭 TLS 校验。
  - `shoot.mjs`、`element.mjs`、`probe.mjs`、`timing.mjs`、`a11y.mjs` 分别采集截图、DOM 事实、抽屉入口、流式计时和焦点。都用 `@playwright/test` 的 `chromium.launch({ channel: "chrome" })`。
- **Git Bash 会把 `/en` 这类参数转换成 Windows 路径**，给脚本传 URL 路径时要加 `MSYS_NO_PATHCONV=1`。
- **Next dev 会改动 `apps/storefront/next-env.d.ts`**，提交前用 `git checkout HEAD -- apps/storefront/next-env.d.ts` 还原。跑门禁前要停掉 dev 服务器，避免与 `next build` 抢 `.next`。
- **prettier 不要用大范围通配**，Windows 会报命令行过长。只格式化改动过的文件：`(git diff --name-only; git ls-files --others --exclude-standard) | grep ... | xargs corepack pnpm exec prettier --write`。
- **Bash 工具 heredoc 超过约 8KB 整条命令都不会执行**（报 unexpected EOF）。长补丁写成 Python 脚本文件放在 scratchpad 再执行。
- **Python 补丁脚本要先算好新内容，再用 `with open(p, "w")` 写入。** 本会话一个写成元组的赋值导致文件先被截断后写入失败，设计文档一度被清空，已用 `git checkout HEAD --` 恢复。
- **前台文案审校哈希是整份文案对象 `JSON.stringify` 的 SHA-256。** 先构建 i18n，再从 `dist/storefront/<locale>.js` 计算。脚本在本会话 scratchpad 的 `update-review-hashes.mjs`，要复用可以抄进 `output/`。
- **合同改动后跑 `corepack pnpm contracts:generate`**：它会先构建 contracts，再重写 `packages/contracts/generated/*.json`，这两个文件受版本控制，要一起提交。下游包测试依赖 contracts 的 dist。
- 上一份交接（`2026-09-26-f1-02-public-order-number.md`）的环境注意仍然有效。

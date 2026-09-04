# Phase 2 — 设计系统与交互样板

> 状态：ACTIVE
> 任务：6  
> 解锁条件：Phase 0 退出门禁通过；最初与 Phase 1 同时激活，当前 Phase 1 已关闭

## 目标

用真实响应式界面证明“电影感偶像画册 × 精品零售 × 可信支付”的视觉和交互语言，然后再扩展页面。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P2-01 | DONE | Codex `/root` | P0-04 | Git `f578208`、PR #10/run `33821542072`；本地、clean clone、浏览器、Quality/Security 与独立终验全绿 |
| P2-02 | DONE | Codex `/root` | P2-01 | Git `9f33dad` + evidence `d40a79b`、PR #11/run `33835758064`；本地、clean clone、浏览器、Quality/Security 与独立终验全绿 |
| P2-03 | DONE | Codex `/root` | P2-02 | 实现 `0f86e6c` + evidence `ef6e16a` + CI 稳定化 `f6e19c9`；[PR #12](https://github.com/CZ3700/diandan/pull/12)/run `33874955057`、本地、浏览器、fresh clone 与两路独立终审全绿 |
| P2-04 | READY | — | P2-02 | 依赖已满足且 Lane B 已由 P2-03 释放，可由下一 executor 领取 |
| P2-05 | PENDING | — | P2-03、P2-04 | 三段标志性动效 |
| P2-06 | PENDING | — | P2-04、P2-05 | 人工品牌样板批准 |

## 必须证明

- 390×844 与 1440×900 人工视觉批准，六个标准视口无破版。
- 所有交互有键盘和 reduced-motion 等价状态。
- axe critical/serious 为 0；真实移动设备无明显卡顿。
- 正式品牌/摄影未确认时，只使用有权使用的内部素材和默认 tokens。
- Latin/Vietnamese/SC/JP/Thai 字体按 locale 分包；CJK/Thai/Vietnamese/长西葡语与 pseudo-locale 在 320/390/1440、200% zoom 下无裁切，语言切换保持 route/cart/market/currency。

## Phase 退出证据

Phase 0 已于 2026-09-03 通过退出门禁，Phase 1 已于 2026-09-04 关闭，Phase 2 现为唯一 `ACTIVE` Phase。P2-01、P2-02 与 P2-03 均已通过本地、浏览器、fresh clean-clone、独立终验与真实 PR Quality/Security；P2-03 已释放 Lane B，P2-04 现为唯一 `READY` 任务。Phase 2 的 P2-04/P2-05/P2-06 及完整退出门禁尚未取得，Phase 3 继续锁定。

## P2-01 执行卡

**本次执行登记**：

- Owner：Codex `/root`
- 开始：`2026-09-04T05:57:07+08:00`（`2026-09-03T21:57:07Z`）
- 输入：P0-04 已验证的 Next.js Storefront/Admin 运行骨架，以及 P1-01 冻结的 `SupportedLocale` 唯一合同。
- 精确输出：`packages/design-tokens` 中可序列化的设计令牌与 CSS 变量合同；按 locale/script 选择且由浏览器按需加载的 Latin/Latin Extended/Vietnamese/SC/JP/Thai 自托管字体；深色默认主题、流体排版、响应式网格/容器；仅允许覆盖 `--idol-accent` 的对比安全解析；Storefront 内部、noindex 的多脚本基础样板与可重复 token/font/layout 检查。
- 视觉命题：电影感深色画册底色，以温暖金色作为克制强调，让多脚本文字和人物媒体未来都能成为主角。
- 内容计划：内部样板依次证明品牌色与语义色、显示/正文排版、多脚本断行、响应式网格、偶像 accent 安全回退；不伪装成已完成的粉丝业务首页。
- 交互命题：P2-01 只验证主题与响应式状态切换的即时反馈、可见键盘焦点和 reduced-motion 基线；主海报/偶像切换/加购动效留给 P2-05。
- 明确不做：P2-02 的 Button/Link/Media/Price 等原语，P2-03 overlay/语言与地区控件，P2-04 组合组件，P2-05 标志性动效，P2-06 人工品牌冻结；不新增公开 `/:locale` 业务页面、正式品牌/Logo/肖像素材、市场/币种/支付逻辑、API、数据库或迁移。
- TDD 与验证计划：先以失败测试锁定 token schema/CSS 同源、无散落品牌值、字体 profile 与 `SupportedLocale` 完整映射、越南语附标与 CJK/Thai/长西葡/pseudo 断行样例、accent 对比回退和网格断点；再运行受影响测试、token/font 静态检查、format/lint/typecheck/build、整仓 0-cache check、secret/audit。真实浏览器覆盖 360×800、390×844、768×1024、1024×768、1440×900、1920×1080，并在 320px/200% zoom、键盘、reduced-motion、console 与横向溢出上复核；证据写入 `output/playwright/p2-01/`，最后执行 clean-clone 和独立评审。
- 风险映射：`R-07`（性能/reduced motion）、`R-12`（字体只采用明确开源授权，不使用参考站或未授权品牌素材）、`R-17`（locale 只从 contracts 导入且不得推导 market/currency；字体 fallback/断行必须跨脚本稳定）。
- 并发/所有权：P2-01 是唯一 Lane B executor；Codex `/root` 独占全局 design tokens、字体、Storefront 内部样板及相关根 manifest/lockfile。子代理只做只读审计、上游资料研究或不修改这些边界的独立复核。

**Review 请求（2026-09-04T08:15:00+08:00）**：

- **实现候选**：`@fan-support/design-tokens` 以 schemaVersion 1 的冻结 plain object 同源输出颜色、排版、间距、容器、网格、motion 与 CSS variables；Storefront/Admin 只消费共享基础样式。唯一运行时品牌覆盖为 `--idol-accent`，解析器按正文/大文本/非文本三类 WCAG 对比阈值 fail closed 回退。
- **字体与授权**：Fontsource `5.3.0` 精确锁版并自托管 Manrope、Noto Sans、Noto Sans Thai、Noto Sans SC、Noto Sans JP；`SUPPORTED_LOCALES` 通过穷尽映射选择 Latin/Vietnamese/Thai/SC/JP profile，网络字体请求为 0，OFL 与第三方 notice 纳入源码及 Docker copy 静态门禁。
- **内部样板**：`/_internal/design-foundations/{locale}` 只在 dev/test/preview 可用，staging/production 404，带 `noindex,nofollow`；覆盖七个正式 locale 与内部 `en-XA`，不新增公开业务路由、不引入正式品牌/肖像或 P2-02 原语。
- **TDD/静态门禁**：design-token 17 tests、Storefront 52 tests、design-foundation static gate 21 tests、adapter-boundary 27 tests 全绿；测试覆盖 token/CSS 同源、无散落品牌值、locale 完整映射、分包、字形/附标/断行、对比回退、响应式网格、环境关闭与供应链边界。
- **本地完整门禁**：Node `24.20.0` / pnpm `11.25.0` 下 `TURBO_FORCE=true pnpm check` exit 0：workspace/contract/PG18/pg-boss/S3-compatible/format/lint/adapter/artifact 全绿，typecheck `50/50`、test `50/50`、build `34/34` 且 0 cached；secret scan 通过。官方 registry high audit 最近一次因 registry timeout 未形成新结论，提交前重试。
- **浏览器证据**：`output/playwright/p2-01/` 记录生产构建在 preview gate 下的 6 个标准视口、七 locale + `en-XA`、320 px stress、键盘 focus、reduced-motion、Storefront/Admin root 及 preview/staging/production 环境关闭；HTTP/font/lang/noindex/overflow/clipping/replacement glyph/console/page/request assertions 均通过。隔离 Google Chrome 152 的原生 200% page zoom 由 DPR `2→4`、CSS viewport `1710×842→855×421`、outer window 不变且无 CDP Emulation API 证明，西班牙语长标题无横向裁切。
- **独立复核**：架构/代码复核 Blocker 0；视觉、断行、根页面与真实 zoom 人工抽查接受。完整的 all-script × all-condition 无障碍矩阵、axe 与真实设备性能属于 P2-06/P6-02 后续门禁，本任务不提前宣称完成。
- **环境限制**：尝试实际构建含字体 notice 的 OCI image 时，Docker VM 因 `ENOSPC` 终止；未清理或覆盖用户的约 59 GB 既有镜像。该步骤不是 P2-01 最低门禁，Dockerfile copy 路径已由 21 项静态门禁验证；真实 image build 留作有可用 Docker 空间时复验。
- **非阻断维护项**：设计静态检查有意锁定当前 `SUPPORTED_LOCALES.map` + exhaustive switch AST 形状，后续若重构映射写法应同步放宽 parser 并保持缺 locale 必失败；本次不为减少行数引入高风险重构。

### DONE 证据（2026-09-04）

- **Tokens / 主题 / 布局**：`@fan-support/design-tokens` 以冻结、可序列化、`schemaVersion: 1` 的同源对象/CSS variables 定义颜色、语义色、流体排版、间距、容器、响应式网格、焦点与 motion；Storefront/Admin 共用深色基础主题。运行时只允许覆盖 `--idol-accent`，并分别按正文、大文本、非文本阈值检查对比度，不安全或非法值回退为 `#6888bd`。
- **字体与 locale 边界**：精确锁定 Fontsource `5.3.0`，自托管 Manrope、Noto Sans、Noto Sans Thai、Noto Sans SC、Noto Sans JP 并提交 OFL/第三方 notice；五个 route-group/font CSS 入口按 Latin/Vietnamese/Thai/SC/JP profile 拆包。完整映射只从 canonical `SUPPORTED_LOCALES` 派生，穷尽 switch + `never` guard 令新增 locale 必须显式处理，不从 locale 推导 market/currency/payment。
- **内部样板与关闭策略**：生产构建中的 `/_internal/design-foundations/{locale}` 只在 dev/test/preview 开放，且带 `noindex,nofollow`；preview 200，staging/production 404 且 `/healthz` 仍为 200。样板覆盖七个正式 locale 与内部 `en-XA`，没有新增公开 `/:locale` 业务页面、P2-02 原语、正式品牌/肖像、API、数据库或支付逻辑。
- **TDD / 对抗门禁**：design-token 17 tests、Storefront 52 tests、design-foundation static gate 21 tests、adapter-boundary 27 tests 全绿；覆盖 token/CSS 同源、非法 token/schema、散落品牌值、字体 profile 完整性与唯一性、字形/越南语附标/多脚本断行、accent 对比回退、视口网格、环境 fail-closed、错误依赖位置和 npm alias 绕过。
- **浏览器验证**：`output/playwright/p2-01/` 的 15 张 PNG 与 README SHA-256 全部匹配。Playwright Chromium 152 对生产构建完成 360×800、390×844、768×1024、1024×768、1440×900、1920×1080 六标准视口、七 locale + `en-XA`、320 px stress、键盘 focus、reduced-motion、Storefront/Admin root 与环境关闭检查；HTTP/font/lang/noindex/overflow/clipping/replacement glyph/外链资源/console/page/request assertions 均通过。
- **真实 200% page zoom**：安装版 Google Chrome 152 使用隔离 profile 的 HostZoomMap 默认 zoom，未调用 CDP device metrics/page scale；DPR `2→4`、CSS viewport `1710×842→855×421`、outer window 保持 `1710×929`、`visualViewport.scale=1`，西班牙语长标题自然换行，`clientWidth=scrollWidth=bodyScrollWidth=855`、detected clipping 0。证据 PNG 为 `3420×1684` physical pixels，用户日常 Chrome profile 未被修改。
- **本地完整门禁**：Node `24.20.0` / pnpm `11.25.0` 下 `TURBO_FORCE=true pnpm check` exit 0；workspace 4 apps/30 packages/34 units 无环、contract fresh、真实 PostgreSQL 9 migrations/108 tables、可靠事件/pg-boss/S3-compatible、Prettier/ESLint、adapter/artifact 全绿，typecheck `50/50`、test `50/50`、build `34/34` 且 0 cached。`pnpm security:secrets` 退出 0。
- **Clean clone**：冻结实现提交 `f578208fc05822426bc3d83e362f35ebe29460ee` 在 `/tmp/p201-acceptance-jHSRWV/repo` 完成 offline frozen install（35 workspaces、401 reused、0 downloaded）、0-cache 完整 `pnpm check`（约 175 秒）、secret scan、15/15 图片哈希/JSON 检查与 `git diff --check`；最终工作树为空。
- **真实 CI**：[PR #10](https://github.com/CZ3700/diandan/pull/10) 的 [run 33821542072](https://github.com/CZ3700/diandan/actions/runs/33821542072) 对同一实现 SHA 执行 Quality 成功；Security 前两次由 npm 官方 advisory POST 外部超时而无漏洞结论，第三次只重跑失败项后 audit 与 secret scan 成功，最终 Quality/Security 均绿色，未放宽 fail-closed 门禁。
- **独立终验**：架构/代码与 fresh-clone 验收均 `ACCEPT`，实现 blocker 0；独立复跑 design/domain/adapter、完整 check、secret、浏览器 JSON/15 张截图哈希并人工检查多脚本与 zoom。首轮指出的 README 旧哈希/缺 zoom 证据已修复，旧伪缩放截图未进入提交。
- **边界与残余**：正式品牌、Logo、摄影与最终字体批准属于 P2-06；all-script × all-condition、axe、读屏和真实设备性能属于后续 Phase 2/P6-02，不提前宣称完成。实际 OCI build 因 Docker VM `ENOSPC` 未完成，未删除用户约 59 GB 的既有镜像；Docker notice copy 已由 21 项静态门禁验证，待空间可用时补真实 image 回读。静态 parser 对当前 AST 形状较严格是非阻断维护债，未来调整必须保留 canonical locale 缺项必失败。

### P2-01 S.U.P.E.R 检查

| # | 结果 | 证据 |
|:--|:--|:--|
| 1 | PASS | tokens、font profiles、accent policy、Storefront resolver、内部 specimen 与静态 gate 职责分离 |
| 2 | PASS | token 数据、CSS 序列化、字体映射、copy factory 与 accent 解析均为小型纯函数/冻结数据组合 |
| 3 | PASS | Browser/Route → Storefront helper → contracts/design-tokens 单向；design-tokens 不依赖 Next、Nest、ORM 或供应商 SDK |
| 4 | PASS | workspace 检查为 4 apps/30 packages/34 units、0 dependency cycles；字体包只允许出现在 design-tokens 外层资源包 |
| 5 | PASS | 共享 token root 有 `schemaVersion: 1`；locale 唯一合同复用 contracts，静态/运行时输入均严格验证 |
| 6 | PASS | 跨包 token/font profile 为可序列化 plain data；CSS 入口只承载资源声明，不暴露浏览器/框架对象 |
| 7 | PASS | origin/deployment environment 注入并 fail closed；无生产域名、secret、真实品牌素材或 locale→market/currency/payment 特判 |
| 8 | PASS | Fontsource/OFL 依赖精确 `5.3.0`、workspace 依赖显式声明，frozen offline install 与 CI audit 通过 |
| 9 | PASS | 字体 profile、accent 输入、部署环境和 token 消费边界可替换；新增 locale 会由 exhaustive/static gates 阻断遗漏 |
| 10 | PASS | focused、本地 0-cache、真实 PG/S3、六视口/320/zoom/keyboard/reduce、clean clone、secret/audit、独立终验与 PR Quality/Security 全部通过 |

## P2-02 执行卡

**本次执行登记**：

- Owner：Codex `/root`
- 开始：`2026-09-04T09:57:36+08:00`（`2026-09-04T01:57:36Z`）
- 输入：P2-01 已冻结的共享 design tokens、locale 字体/主题/网格与内部 preview gate；P1-01 的 canonical `SupportedLocale`、金额与展示语言合同。
- 精确输出：在 `packages/ui` 实现 Button、Link、Icon、Media、Price、Status、Field、Quantity 八类框架内基础原语及其类型化 API、样式和测试；Storefront 增加仅供 dev/test/preview、noindex 的原语验收 fixture，用真实交互证明各状态而不伪装为业务页面。
- 视觉命题：把电影感深色画册的克制材质落实到可复用控件；排版、边界、触控尺度与单一 accent 建立高级感，状态语义保持清晰可信。
- 内容计划：内部 fixture 按动作、导航/图标、媒体、金额/状态、表单/数量分区，使用英语、CJK、泰语、越南语、最长西/葡语和 `en-XA` 压力文案；每区只证明原语行为，不加入 Hero、商品卡、购物车行或订单时间线。
- 交互命题：hover/focus/active 只用克制的颜色、透明度与轻微 transform；loading 保持尺寸并提供可访问状态；reduced motion 取消位移和旋转但保留非动态反馈。
- 明确不做：P2-03 的 Dialog/Drawer/Toast/Menu/Language/Region/focus-trap，P2-04 的 Hero/IdolPortrait/GiftTile/IdolContext/CartLine/OrderTimeline 与正式组件展示页，P2-05 标志性动效，公开 `/:locale` 页面、正式品牌/Logo/肖像、业务 API、数据库、市场、币种或支付逻辑。
- TDD 与验证计划：先写失败测试锁定原语语义、类型/状态组合、金额最小单位与 locale 格式化、媒体 alt/fallback、Field 关联/错误、Quantity 边界、无关键翻译文本固定高度/ellipsis、token-only 样式、RTL/pseudo 结构；逐个见红后最小实现并复跑。随后运行受影响 test/typecheck/build、静态边界检查、format/lint、整仓 0-cache check 与 secret scan。
- 浏览器计划：production build 在 preview gate 下覆盖 390×844 与 1440×900，并抽查六基准视口、320 CSS px、键盘 Tab/Enter/Space/箭头、hover/focus/disabled/loading、RTL 结构、reduced-motion、axe critical/serious、无横向溢出/裁切、console/page/request 错误；证据写入 `output/playwright/p2-02/`。
- 风险映射：`R-07` 以合成友好微交互、reduced-motion 与稳定 loading 尺寸控制；`R-17` 以 canonical locale 导入、`Intl` 格式化、多脚本/伪语言/RTL 验收和 locale 与 market/currency 零推导控制。
- 并发/所有权：P2-02 是唯一 Lane B executor；Codex `/root` 对 `packages/ui`、Storefront 原语 fixture、相关样式/测试及必要 manifest/lockfile 负最终责任。其下受控子代理只在 `/root` 分派的互不重叠文件内实现并回报 RED/GREEN 证据，不形成第二 Lane executor；最终集成、复核与状态变更仍由 `/root` 完成。

**Review 请求（2026-09-04T11:40:00+08:00）**：

- **八类原语**：`@fan-support/ui` 已实现 Button、Link、Icon、Media、Price、Status、Field、Quantity；服务端入口只导出无客户端状态的六类原语，`./client` 以 `use client` 隔离 Media/Quantity，`./primitives.css` 显式承载 token-only 样式。React/CVA 例外被限制在 UI 包，adapter 边界对 npm alias、跨包扩散与 declaration 泄漏继续 fail closed。
- **语义与精度**：Button loading 保留文字布局 footprint 并使用绝对定位 spinner；Link 补齐新窗口安全 rel；Icon 强制 decorative/informative 二选一；Price 直接消费 branded integer minor units，以 BigInt 保持 `Number.MAX_SAFE_INTEGER` 末位精度并只按显式 locale/currency 展示；Field 关联 label/hint/error；Quantity 以安全整数和 BigInt step lattice 限制边界、键盘与直接输入。
- **媒体与浏览器边界**：Media 强制有效尺寸及 informative alt/decorative 选择，错误 fallback 保持 aspect ratio，并以 `src/srcSet/sizes` 组成资源身份避免换源后残留错误。根入口在 `react-server` conditions 下可加载，客户端状态未泄漏到 RSC 图。
- **内部 fixture**：Storefront 在既有 `/_internal/design-foundations/{locale}/primitives` 下覆盖七个正式 locale 与 `en-XA`，沿用 noindex 与 dev/test/preview gate；staging/production 返回 404。样板只证明原语，不新增公开业务路由、组合组件、正式品牌/肖像、市场/币种/支付推导、API、数据库、migration 或 OpenAPI 变更。
- **TDD 与静态门禁**：UI `10 files / 50 tests`、Storefront `11 / 56`、Admin `6 / 22`、UI primitives `42/42`、design foundations `21/21`、adapter boundaries `29/29`、browser helper `19/19` 全绿；UI typecheck/build、focused Prettier/ESLint 与 `git diff --check` 通过。
- **浏览器候选证据**：`output/playwright/p2-02/` 的本地候选由 production standalone build 生成，记录 13 个确定性场景、6 次 axe（critical/serious 0）、3 个环境 gate 与 15 张截图；覆盖六基准视口、320 px `en-XA`/长葡语、键盘、hover/focus/disabled/loading、Field/Quantity、Media fallback、RTL 与 390/1440 reduced-motion，未发现横向溢出、裁切、replacement glyph、外链资源或 console/page/request 错误。
- **真实 200% zoom**：安装版 Google Chrome `152.0.7977.82` 使用隔离临时 profile 的 HostZoomMap；outer window 保持 `1710×929`，CSS viewport `1710×842→855×421`、DPR `2→4`、`visualViewport.scale=1`、detected `200%`。截图只用 CDP `Page.captureScreenshot` 读取真实合成表面，不调用 Emulation/device metrics/page scale；两张 PNG 均为完整 `3420×1684`，右上 `PT` marker 经显隐像素差验证，临时 profile 已删除，15/15 SHA-256 匹配。
- **评审修复**：首轮浏览器独立复核指出 request firewall 时序、axe artifact 路径、候选替换完整性、loading footprint、reduced-motion 覆盖与真实 zoom 截图裁切；均以失败测试复现后修复。最终两路只读复核确认真实 Media 解码失败链、跨平台证据路径校验、13/6/3/15 矩阵、零 console 豁免与完整 200% zoom 截图，结论均为 `ACCEPT`、blocker 0。
- **完成门禁**：实现提交 `9f33dad482798a58e108d0c8c0495a878cf375c7` 后从 clean worktree 重生浏览器证据并以 `d40a79bd3fb93a884ffd8613c58f84902ae6ca41` 固化；fresh clean-clone 完整验收与 [PR #11](https://github.com/CZ3700/diandan/pull/11) [run 33835758064](https://github.com/CZ3700/diandan/actions/runs/33835758064) Quality/Security 均成功。任务不宣称 AWS apply、staging、production、正式品牌批准或真实设备性能。

### DONE 证据（2026-09-04）

- **原语与入口边界**：`@fan-support/ui` 精确提供 Button、Link、Icon、Media、Price、Status、Field、Quantity；root 仅导出六个 server-compatible 原语，`./client` 只导出 Media/Quantity，`./primitives.css` 为显式样式入口。实际 Storefront consumer 在 `react-server` conditions 下导入成功，客户端状态未泄漏到 RSC 图。
- **语义、金额与交互**：Price 以 branded integer minor units + BigInt 在 `Number.MAX_SAFE_INTEGER` 边界仍保留最小单位精度；Button loading 保持布局 footprint；Link、Icon、Media、Field、Quantity 分别锁定安全 rel、装饰/信息语义、资源身份/fallback、label/hint/error 和安全整数 step lattice。键盘、focus-visible、hover、disabled、loading、RTL、direct input 与 reduced-motion 均有测试和浏览器证据。
- **样式与内部 fixture**：Storefront/Admin 共享 token-only primitives CSS 与 Tailwind/PostCSS 管线；交互目标最小 48 px，非文本边界对比不低于 3:1，不固定或省略关键翻译文本。`/_internal/design-foundations/{locale}/primitives` 覆盖七个公开 locale 与内部 `en-XA`，带 `noindex,nofollow`，preview 为 200，staging/production 为 404 且 `/healthz` 仍为 200。
- **TDD / 对抗门禁**：UI `10 files / 50 tests`、Storefront `11 / 56`、Admin `6 / 22`、UI primitives static `42/42`、design foundations `21/21`、adapter boundaries `29/29`、browser runner helpers `19/19` 全绿；覆盖 RSC/client 图、精确 exports、依赖 allowlist、CSS/token/RTL/reduced-motion、候选证据原子替换、manifest/hashes 与 POSIX/Windows/NUL/traversal 路径攻击。
- **浏览器证据**：`output/playwright/p2-02/` 基于 clean 实现 SHA `9f33dad482798a58e108d0c8c0495a878cf375c7` 生成，`git.dirty=false`。生产 standalone build 完成 13 个场景、6 份 axe artifact（critical/serious 0）、3 个环境 gate 与 15 张 PNG；覆盖六标准视口、320 px `en-XA`/最长葡语、390/1440 键盘/hover/reduced-motion、RTL、Field/Quantity 与真实 Media error fallback，场景错误、console/page/request/http/external-resource 错误均为 0，15/15 SHA-256 匹配。
- **真实 Media 与 200% zoom**：测试从用户可见按钮点击开始，React 把 `src` 切到合法 data URL 但无效 PNG，浏览器原生 decode error 触发 fallback；`triggerClicked/sourceChanged/browserDecodeFailed=true`，前后 frame 尺寸稳定且无 console 豁免。Google Chrome `152.0.7977.82` 使用隔离 HostZoomMap profile，outer `1710×929` 不变、CSS viewport `1710×842→855×421`、DPR `2→4`、detected `200%`；无 Emulation/device metrics/page scale，两张 CDP compositor PNG 均为完整 `3420×1684`，右侧 `PT` marker 可验证，profile 已删除。
- **本地与 clean clone**：Node `24.20.0` / pnpm `11.25.0` 下先在实现工作树执行强制 0-cache `pnpm check`；随后 evidence SHA `d40a79bd3fb93a884ffd8613c58f84902ae6ca41` 在 `/tmp/p2-02-clean-clone.WN5vUK` detached checkout，offline frozen install 复用 `423/423`、下载 0，`TURBO_FORCE=true pnpm check` 退出 0：真实 PostgreSQL 9 migrations/108 tables、可靠事件、S3-compatible、Prettier/ESLint、typecheck `51/51`、test `51/51`、build `34/34`、adapter/artifact 均全绿且 0 cached；secret scan、runner `19/19`、证据 JSON、15/15 hashes 与 `git diff --check` 通过，最终工作树为空。
- **真实 CI**：[PR #11](https://github.com/CZ3700/diandan/pull/11) 基于 `codex/p2-01-design-foundations`；evidence head `d40a79bd3fb93a884ffd8613c58f84902ae6ca41` 的 [run 33835758064](https://github.com/CZ3700/diandan/actions/runs/33835758064) Quality 成功。Security 首次仅因 npm advisory POST 三次外部超时失败，没有漏洞结论；保持 `--audit-level=high` 原样重跑后 audit 与 secret scan 成功，该 evidence 快照最终 Quality/Security 均绿色且当时 PR merge state 为 CLEAN。后续 progress-only 提交不改产品实现或冻结证据，仍须由 PR 当前 HEAD 的必需检查复验。
- **独立终验与边界**：产品/架构、浏览器 runner 与代码收敛复核均 `ACCEPT`、blocker 0；最终复核特别确认 Media 不是 synthetic event、Windows 路径不绕过 validator、缩放截图不裁切。本任务没有 migration、OpenAPI、公开业务路由、overlay/composite、支付或生产基础设施改动；正式品牌/摄影、真实移动设备性能、AWS apply、staging/production 和 Phase 2 人工批准仍属于后续门禁。

### P2-02 S.U.P.E.R 检查

| # | 结果 | 证据 |
|:--|:--|:--|
| 1 | PASS | 八类原语、server/client 入口、样式、fixture copy、静态 gate 与浏览器 runner 各自职责单一 |
| 2 | PASS | 金额格式化、Icon 语义、Media identity、Quantity lattice、路径校验与证据组装拆为小型纯函数/局部状态机 |
| 3 | PASS | Browser/Route → UI primitive → React/contracts/design-tokens 单向；UI 不回依赖 Storefront/Admin、数据库或 provider adapter |
| 4 | PASS | workspace 为 4 apps/30 packages/34 units、0 dependency cycles；server graph 动态/静态 reachability 与 emitted declarations 均有门禁 |
| 5 | PASS | 对外 props/type exports 明确，金额/locale 复用 canonical contracts；本任务无新增跨模块 API/event/queue schema |
| 6 | PASS | primitive props 与跨包输入为可序列化值；客户端事件/DOM ref 不进入 root server-compatible 入口或业务合同 |
| 7 | PASS | fixture origin、端口与环境由 runner 临时注入；无生产域名、路径、secret、正式品牌值或 locale→market/currency/payment 特判 |
| 8 | PASS | React/CVA/Tailwind/PostCSS/axe/Playwright 均显式锁入 manifest/lockfile，UI 依赖 allowlist、offline frozen install 与 CI high audit 通过 |
| 9 | PASS | server/client/CSS 子路径、typed props 与资源 identity 允许替换单个原语或渲染层，不要求修改 commerce/domain/provider 层 |
| 10 | PASS | focused、本地 0-cache、真实 PG/S3、浏览器/axe/zoom、clean clone、secret/high audit、独立终验与 PR Quality/Security 全部通过 |

## P2-03 执行卡

**本次执行登记**：

- Owner：Codex `/root`
- 开始：`2026-09-04T17:40:07+08:00`（`2026-09-04T09:40:07Z`）
- 输入：P2-02 已冻结的八类 UI 原语、server/client/CSS 入口、preview-only 多语言 fixture 与浏览器证据；P1-01 唯一拥有的 `SupportedLocale`、native names 和 locale/market/currency 分离合同。
- 精确输出：在 `packages/ui` 实现可替换、类型化的 Dialog/Drawer、Menu 与 Toast/live-region 原语；实现互不耦合的 Language 与 Region 控件；在 Storefront 外层实现仅改变展示 locale 的 URL 与 `site_locale` cookie 适配，并以内部 dev/test/preview fixture 验证焦点、滚动、宣告及上下文保持。
- 视觉命题：延续电影感深色画册，以安静的遮罩、清晰的层级和单一金色焦点建立“临时工作面”，避免玻璃拟态堆叠或通用 SaaS 弹窗感。
- 内容计划：内部 fixture 分为 modal/drawer、menu、toast、language、region 五个单一职责工作区；使用英语、CJK、泰语、越南语、最长西/葡语与 `en-XA` 压力文案，只证明交互原语，不伪装成导航、购物车或结账业务页。
- 交互命题：overlay 以 `opacity + transform` 在 280–360 ms 内建立层级并在 reduced motion 下移除位移；Menu 以即时方向键/字母导航解释选择范围；Toast 只对有意义的状态变化宣告一次，关闭与超时不抢焦点。
- 明确不做：P2-04 的 Hero/IdolPortrait/GiftTile/IdolContext/CartLine/OrderTimeline，P2-05 标志性业务动效，真实购物车抽屉，公开 `/:locale` 页面或导航，动态内容/API/数据库/迁移，真实市场/国家/币种/支付能力推导，正式品牌/Logo/肖像或生产 cookie/domain 配置。
- 合同与架构计划：UI 层只接收可序列化的受控状态、候选项和回调；Language 只消费 canonical locale/native name，Region 只展示调用方明确传入的 region/market/currency 标签，两者绝不互推。URL 替换与 cookie 写入由 Storefront adapter 负责，UI 不导入 Next.js、config、数据库或 provider 对象；任何新增 headless 依赖必须锁版并受 adapter-boundary allowlist 约束。
- TDD 计划：先写失败测试锁定 Dialog/Drawer 的语义、focus trap/return、ESC、outside dismissal 与背景滚动；Menu 的 roving focus、方向键/Home/End/typeahead/ESC；Toast 的 live region、去重、超时/手动关闭与不抢焦点；Language/Region 的独立状态、URL/query/hash 保持、非法 locale 拒绝和 cookie 最小属性。逐项确认 RED 后只做最小实现，再收敛重复逻辑。
- 浏览器与质量计划：production standalone build 在 preview gate 下覆盖 390×844、1440×900、六基准视口、320 CSS px、真实 200% zoom、键盘、touch/pointer、RTL 结构、reduced-motion、axe critical/serious、焦点留存、body scroll lock、读屏宣告、route/query/hash 与模拟 cart/market/currency/amount/payment-attempt 不变；证据写入 `output/playwright/p2-03/`。最后运行受影响 tests、format/lint/typecheck/build、全仓 0-cache check、secret/high audit、fresh clean-clone、独立复核与真实 PR Quality/Security。
- 风险映射：`R-07` 以合成友好 presence、确定性生命周期、reduced-motion 和真实浏览器交互控制；`R-17` 以 canonical locale、整路径替换测试、cookie schema、Language/Region 物理与数据分离，以及切换前后交易上下文深相等控制。
- 并发/所有权：P2-03 是唯一 Lane B executor；Codex `/root` 对 `packages/ui` overlay/control API、Storefront locale adapter/内部 fixture、相关样式/测试及必要 manifest/lockfile 负最终责任。子代理只做只读研究、测试矩阵设计或最终独立复核，不形成第二 Lane executor。

**完成验收快照（2026-09-04）**：

- **实现与边界**：实现提交 `92d8215` 提供 source-owned、Base UI `1.7.0` 锁版的 Dialog/Drawer/Menu/Toast/live-region、Language/Region 控件、Storefront locale URL/cookie adapter 与八语言内部 fixture；`068ecf8` 修复 touchmove 外部拖动导致菜单关闭并继续滚动页面的问题；`0f86e6c` 将菜单共享锁、同一 token、`documentElement` marker、listener identity/顺序/cleanup、outside touch cancellation 绑定到同一 AST 生命周期，并以专项结构变异防止 dead-code、阴影绑定和异步 predicate 假绿；`f6e19c9` 将交互入口的首次重型导入移到 Vitest 收集阶段，避免冷 CI 资源竞争计入单个测试的 5 秒时限。未把交互值重新暴露到 server-compatible root/client 旧入口，也未引入业务 API、数据库或 provider 依赖。
- **交互与 locale 证据**：Dialog/Drawer 的 forward/backward focus trap、ESC/outside close、focus return 和 scroll release；Menu 的 Arrow/Home/End/typeahead、disabled、ESC、touch scroll lock、popup 内滚动与普通 outside tap；Toast 的 live announcement、去重、hover pause/release、timeout/manual close 与不抢焦点均由真实浏览器断言。Language 只替换 canonical locale path 与 host-only `site_locale` cookie，region/market/currency、query/hash、amount/cart/payment-attempt 深相等保持；Region 只回传调用方显式值。
- **浏览器证据**：clean source HEAD `0f86e6c16e9f44bd3c9096e2d8d02a9a3e7aa1b8` 生成 `output/playwright/p2-03/` 并由 `ef6e16a0870b5e230b796f9905649398bfce0859` 固化；13/13 场景和 15/15 SHA-256 图片通过，覆盖 360×800、390×844、768×1024、1024×768、1440×900、1920×1080、320 CSS px、CJK/Thai/Vietnamese/最长西葡语/`en-XA`、RTL、touch 与 reduced motion。原生 Google Chrome `152.0.7977.82` 的隔离 profile 证明 200% zoom：CSS viewport `1710×842 → 855×421`、DPR `2 → 4`，profile 已清理；touch 菜单页面滚动保持 `64 → 64`，关闭后 root/body overflow 与 marker 均释放。
- **axe 人工判读**：8/8 原始 artifact 的 critical/serious **violations** 为 0；唯一 exclusion 精确为 `[data-base-ui-focus-guard]`，理由与 Base UI 上游 [#4845](https://github.com/mui/base-ui/issues/4845) 对齐，并另由 focus containment/return 断言覆盖。原始结果没有被隐藏：Menu 留有 1 个 moderate `region` violation（portal menu 不属于 landmark）及 1 个 `aria-controls` critical incomplete，但 artifact 中 trigger 的目标 ID 与实际 `role=menu` popup ID 精确存在；Dialog/Drawer/Toast 的 `aria-hidden-focus` 和 Dialog overlap contrast 均为 axe 无法自动判定的 incomplete，结合 DOM、键盘、焦点与生命周期证据由两路独立终审接受，不把 incomplete 误写成自动通过。
- **本地与 fresh clone**：Node `24.20.0` / pnpm `11.25.0` 下当前工作树 `TURBO_FORCE=true pnpm check` 退出 0；在 CI 稳定化后额外获得 UI package `57/57`、连续 `10/10` 重复运行，全仓 0-cache typecheck `51/51`、test `51/51`、build `34/34` 通过。此前 evidence HEAD `ef6e16a0870b5e230b796f9905649398bfce0859` 在 `/tmp/p203-fresh-clone.GE4FyJ/repo` detached checkout，offline frozen install 复用 `432/432`、下载 0，0-cache 全仓 check 再次退出 0：真实 PostgreSQL 9 migrations/108 tables、可靠事件并发、TLS S3-compatible、Prettier/ESLint、adapter/artifact 均通过。`pnpm security:secrets`、专项 checker/runner `51/51`、证据 JSON 与 15/15 hashes、`git diff --check` 均通过；显式使用官方 registry 的 `pnpm audit --audit-level=high` 返回 `No known vulnerabilities found`。
- **独立终审**：实现/对抗终审与代码收敛终审均 `ACCEPT`、P1/P2 blocker 0；审查期间发现的 dead-code token 拼接、touch cancel 乱序、不可达 listener/cleanup、非共享 Set/token/root/size 解绑、callback 短路逆序、async predicate、`Symbol`/`document` 阴影以及无关 Set 误报均先形成 RED fixture，再修至 GREEN。刻意严格的 AST 形态会让未来等价重构需要同步更新门禁，这是已接受的维护成本。
- **真实 CI 与范围**：[PR #12](https://github.com/CZ3700/diandan/pull/12) 基于 `codex/p2-02-ui-primitives`；review head `42649cbaefbfcceb9b5656af84f603116471e368` 的 [run 33873226040](https://github.com/CZ3700/diandan/actions/runs/33873226040) 执行 Quality `5m38s` 与 Security `30s`，两项均成功。后续仅改两份进度文档的 head `849d7efc6c208f6a2621e4d3376d505f112e999e` 在 [run 33873981827](https://github.com/CZ3700/diandan/actions/runs/33873981827) 暴露首测动态导入 `5038ms` 超过 Vitest `5000ms` 默认时限；断言未失败且后续六例均通过，独立复核确认是冷 transform 与全仓并发共同触发的阈值型 flake。根因修复 head `f6e19c948e124436ec423e3607c889f7254b1c24` 的 [run 33874955057](https://github.com/CZ3700/diandan/actions/runs/33874955057) 在同样冷 CI 下 Quality `5m49s` 与 Security `21s` 均成功，未放宽 timeout 或降低并发。P2-03 因而保持 `DONE` 并释放 Lane B。preview/staging/production 只是本地 production-build 配置闭合验证：preview fixture 200、staging/production fixture 404、三者 healthz 200；不宣称真实云 staging/production、AWS apply、正式品牌批准或真实设备性能。

### P2-03 S.U.P.E.R 检查

| # | 结果 | 证据 |
|:--|:--|:--|
| 1 | PASS | overlay、menu、toast、selection controls、locale adapter、内部 fixture、静态 gate 与浏览器 runner 各自职责单一 |
| 2 | PASS | overlay focus、menu lock、toast lifecycle、locale URL/cookie、measurement/evidence 校验均拆为局部函数；终审收敛后无 P1/P2 复杂度问题 |
| 3 | PASS | Browser/Storefront adapter → UI → React/contracts/design-tokens 单向；UI 不反向依赖 Next.js、数据库或 provider |
| 4 | PASS | 全仓 workspace 4 apps/30 packages/34 units 且无 dependency cycle；server/client 导出图和 adapter boundary 门禁全绿 |
| 5 | PASS | 对外 props/type exports 明确；locale 复用 canonical `SupportedLocale`，region/market/currency 由调用方显式传入；本任务无 API/event/queue schema |
| 6 | PASS | 跨包 props/options/cookie projection 可序列化；回调、DOM event/ref 仅停留在 client UI/Storefront adapter 内部 |
| 7 | PASS | fixture origin/port/environment 临时注入；cookie host-only；无生产域名、secret、正式品牌值或 locale→market/currency/payment 特判 |
| 8 | PASS | Base UI/axe/Playwright/React 等均显式锁入 manifest/lockfile，offline frozen install、allowlist 与官方 high audit 通过 |
| 9 | PASS | source-owned typed UI 与 Storefront adapter 边界允许替换 headless/render/route adapter，不触及 commerce/domain/provider 层 |
| 10 | PASS | focused、本地 0-cache、真实 PG/S3、13 场景/8 axe/15 图片/原生 zoom、fresh clone、secret/audit、两路独立终审与 PR #12 根因修复 head `f6e19c9` Quality/Security 全部通过 |

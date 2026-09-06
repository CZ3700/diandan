# Phase 2 — 设计系统与交互样板

> 状态：CLOSED
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
| P2-04 | DONE | Codex `/root` | P2-02 | 六个组合组件、内部八语言展示页、16 场景/10 axe/18 截图、全仓门禁与独立终审通过 |
| P2-05 | DONE | Codex `/root` | P2-03、P2-04 | 桌面证据 + iPhone 普通/系统 reduce 录屏、帧采样、可信触摸、全仓检查及独立终审通过 |
| P2-06 | DONE | Codex `/root` | P2-04、P2-05 | 24 场景/86 PNG/完整 check；2026-09-05 用户批准 V2 开发视觉基线并授权进入 Phase 3，正式资产仍待上线前独立批准 |

## 必须证明

- 390×844 与 1440×900 人工视觉批准，六个标准视口无破版。
- 所有交互有键盘和 reduced-motion 等价状态。
- axe critical/serious 为 0；真实移动设备无明显卡顿。
- 正式品牌/摄影未确认时，只使用有权使用的内部素材和默认 tokens。
- Latin/Vietnamese/SC/JP/Thai 字体按 locale 分包；CJK/Thai/Vietnamese/长西葡语与 pseudo-locale 在 320/390/1440、200% zoom 下无裁切，语言切换保持 route/cart/market/currency。

## Phase 退出证据

2026-09-05 用户明确确认“视觉风格我认为差不多了”，要求“根据这个风格作为基础开展下面的阶段”，动效特效随后打磨。此为 V2 开发视觉基线的人工接受，结合 P2-01 至 P2-05 已有验证和 P2-06 的 24 场景/86 PNG/完整 check，P2-06 改为 DONE，Phase 2 CLOSED，Phase 3 ACTIVE。批准范围与正式资产门禁调整见 ADR-008/009；不把本次确认记作七语言母语审校、正式品牌/摄影许可或新版本真机性能证据。以下执行记录保留历史状态。

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

## P2-04 执行卡

**本次执行登记**：

- Owner：Codex `/root`
- 开始：`2026-09-04T21:16:55+08:00`（`2026-09-04T13:16:55Z`）
- 输入：P2-01 已冻结的 token/字体/网格/媒体策略，P2-02 已验证的 Button/Link/Icon/Media/Price/Status/Quantity 原语与 server/client/CSS 边界，以及 P1 已冻结的 locale、金额、内容投影和订单状态合同。
- 精确输出：在 `packages/ui` 实现可替换、类型化、默认 server-compatible 的 Hero、IdolPortrait、GiftTile、IdolContext、CartLine 和 OrderTimeline 组合组件；在 Storefront 既有 dev/test/preview-only、noindex 树下建立七公开 locale + `en-XA` 的组件展示页，完整呈现 loading/empty/error/图片失败/可用与不可用状态。
- 视觉命题：人物摄影和礼物媒体先行的编辑式画册，用大比例裁切、安静留白、精确字阶与单一金色焦点建立精品感；只在礼物、人物和购物车行这些真实交互对象上使用容器，不做通用卡片墙。
- 内容计划：展示页以 Hero 建立人物存在感，以 IdolPortrait/GiftTile/IdolContext 证明选择与归属，以 CartLine/OrderTimeline 证明交易上下文与履约可扫读性；文案覆盖 CJK、Thai、Vietnamese、最长 Spanish/Portuguese 与 pseudo-locale，只使用虚构、可再分发的内部素材。
- 交互命题：焦点和 hover 只使用已冻结的微交互来表达可操作性，Quantity 和操作按钮保持键盘/触摸等价；组合组件不自带业务状态机或连续动画，主海报、偶像切换和加购/成功动效保留给 P2-05。
- 明确不做：不新增公开 `/:locale` 业务页面、真实购物车/订单业务状态、API/数据库/migration、内容发布、正式品牌/Logo/肖像、P2-05 标志性动效、P2-06 人工品牌冻结，也不将部署、云资源或运维验收作为当前产品代码门禁。
- 合同与架构计划：组合组件只接收可序列化展示值和显式回调，复用 canonical `SupportedLocale`、branded minor amount 与现有原语；不读 Next.js、数据库、provider 或全局市场状态，不从 locale 推导 market/currency/payment。组件状态使用显式判别联合或穷尽映射，新增入口不污染已冻结的 server-compatible root 与 client 入口。
- TDD 计划：先写失败测试锁定六个组件的可访问语义、精确导出、媒体比例/fallback、偶像归属、金额与数量、时间线当前/完成状态、loading/empty/error 和多脚本断行；每组确认 RED 后做最小实现，再收敛重复。
- 浏览器与质量计划：扩展现有确定性 production-build runner，覆盖 360×800、390×844、768×1024、1024×768、1440×900、1920×1080、320 CSS px、原生 200% zoom、键盘、touch/hover、RTL 结构、reduced-motion、axe critical/serious、横向溢出/裁切、图片失败与六组件全状态；证据写入 `output/playwright/p2-04/`。随后运行受影响 tests、format/lint/typecheck/build、全仓 0-cache check、secret/high audit、fresh clean-clone、独立复核与真实 PR Quality/Security。
- 风险映射：`R-07` 以稳定布局、合成友好微交互与 reduced-motion 控制；`R-08` 以结构化组件、固定媒体比例、信息性 alt 与图片错误降级控制；`R-17` 以 canonical locale、`Intl` 金额/文本和多脚本/pseudo 验收控制。
- 并发/所有权：P2-04 是唯一 Lane B executor；Codex `/root` 对 `packages/ui` 组合 API/样式/测试、Storefront 内部展示页、静态/browser gate 及必要 manifest 负最终责任。子代理只做只读模式研究、测试矩阵或最终独立复核，不形成第二 Lane executor。

**Review 请求（2026-09-04T23:30:58+08:00）**：

- **组合组件与边界**：`@fan-support/ui/composites` 精确导出 Hero、IdolPortrait、GiftTile、IdolContext、CartLine、OrderTimeline 六个 server-compatible 组件；唯一交互组合 `InteractiveCartLine` 留在 `./composites-client`。共享 Media frame 被拆为无状态服务端渲染层与最小 runtime-error 客户端叶子，没有把 `use client`、Next、数据库或 provider 反向带入组合入口。
- **交易与隐私语义**：CartLine 同时保留 80px 礼物图和 40px 偶像头像，数量变化以 branded integer minor amount 重算小计；键盘与触摸均证明增量、删除和恢复。公开 DOM 只包含 `data-private-message=present/none`，不含留言正文、完整显示名或内部 intent 标识。
- **响应式与状态稳定**：Hero 的 loading/ready 使用同一 4:5/16:9 媒体比例并共享窄屏长文案预留；真实切换在全部 16 场景比较根尺寸、文档坐标、下游锚点与整页高度，误差阈值 1 CSS px。独立复核额外抽样 320/390/436/600/767/768/968/1000/1023/1024/1440px，差值全部为 0；767px 葡语与 1023px `en-XA` 已成为永久前一像素门禁。
- **图片失败与媒体**：五个带媒体组件均由浏览器真实 `error`/decode 事件进入本地化 fallback；Hero ready→failure 保持根尺寸和下游位置、fallback 不覆盖正文，响应式 art direction、focal point、无边框方角与媒体比例均有运行时断言。三个虚构内部素材及生成 brief/使用边界记录在 `apps/storefront/public/ui-composites/README.md`，不代表正式品牌或肖像批准。
- **多语言与可访问性**：七个公开 locale 加内部 `en-XA` 的 noindex preview 页面覆盖 CJK、Thai、Vietnamese、最长西/葡语与完整伪本地化；16/16 浏览器场景、18/18 截图、10 次 axe（critical/serious 0）、键盘、touch、hover、RTL、390/1440 reduced motion、安装版 Chrome 原生 200% zoom 均通过。preview 路由为 200，staging/production 模式为 404，均仅是本地生产构建关闭策略证明。
- **TDD 与静态门禁**：UI `14 files / 80 tests`、Storefront `15 / 102`、browser runner `11/11`、composite checker `10/10` 全绿；checker 对精确出口、RSC 图、依赖/CSS 边界、八个 locale route、物理方向/裁切规则与持久证据做 fail-closed 校验。2026-09-05 在全局字体加载策略收敛后重新生成浏览器证据，`p2-04-render-inputs-v1` 当前内容指纹为 `0509535d326e069ae0f127a862fb7edae423365f82d77b6905bbf8f9df7fd605`，提交前/后 Git 状态不会误判新鲜度。
- **完整本地门禁**：Node `24.20.0` 下 `pnpm check` exit 0；workspace 4 apps/30 packages/34 units 无环、合同/设计/primitive/interaction/composite/domain/adapter/runtime/observability 全绿，真实 PostgreSQL reliable-event 与 TLS S3-compatible 集成通过，Prettier/ESLint、typecheck `51/51`、test `51/51`、build `34/34`、adapter/artifact 全绿。`pnpm security:secrets` exit 0；切换至 npm 官方 registry 的 `pnpm audit --audit-level high` 返回 `No known vulnerabilities found`；React server 条件下精确六导出可加载。
- **独立终审**：首轮终审先后拦截 CartLine 小计/双媒体尺寸、伪本地化漏项、图片失败与证据假绿、Hero 状态位移及断点采样空档；均补 RED/浏览器复现与 fail-closed 门禁后，最终结论 `ACCEPT`，当前无 P1/P2。
- **范围与剩余风险**：本任务完成的是可复用产品组件代码和本地生产构建证据；没有新增公开业务页面、真实购物车/订单/API/数据库、部署、AWS/Akamai apply、staging/production、正式品牌/肖像批准或真实移动设备性能结论。三段标志性动效、真实设备录屏/性能与 motion 人工批准进入 P2-05/P2-06。

### DONE 证据（2026-09-04）

- **源码产物**：六个类型化组合组件、交互 CartLine 客户端入口、token-only 组合样式、八 locale 内部展示页、完整状态/图片失败/隐私 fixture 与三张虚构内部图片均由仓库源码拥有；未引入业务 SaaS、运行时远程素材或新增第三方依赖。
- **可重复证据**：`output/playwright/p2-04/` 保存 `browser-results.json`、README、18 张带 SHA-256 的 PNG 与 10 份 axe 原始结果；`mise exec node@24.20.0 -- corepack pnpm verify:ui-composites:browser` 和 `check:ui-composites` 均 exit 0，当前内容指纹与持久证据一致。
- **关键回归门**：16 个场景覆盖六基准视口、320px `en-XA`/葡语、767/1023 前一像素、390/1440 RTL/reduced-motion、键盘/触摸/hover/全状态/真实 decode failure/原生 200% zoom；Hero loading→ready 与 ready→failure 在根、锚点和文档高度上均无位移。
- **质量与安全**：UI 80/80、Storefront 102/102、runner 11/11、checker 10/10、完整 `pnpm check`、secret scan、npm 官方源 high audit、精确 React server 导出与 `git diff --check` 全绿；独立实现终审 `ACCEPT`，无剩余 P1/P2。
- **结论边界**：P2-04 标记 `DONE` 并只解锁 P2-05；本地证据不冒充 cloud/staging/production、真实设备性能、正式品牌审批或发布证据。

### P2-04 S.U.P.E.R 检查

| # | 结果 | 证据 |
|:--|:--|:--|
| 1 | PASS | 六个组合、media frame、runtime error leaf、CartLine demo、Hero transition/failure demo、copy 与 checker/runner 各自职责单一 |
| 2 | PASS | 展示组件只做 props→语义 DOM；金额派生、媒体失败、状态切换、证据采集/验证均拆为独立小函数或边界 |
| 3 | PASS | Route/Browser → Storefront fixture → UI composite → primitive/contracts 单向；无 UI→app、domain→adapter 或 provider 反向依赖 |
| 4 | PASS | `check-workspace` 验证 4 apps/30 packages/34 units 且 0 dependency cycles；RSC/客户端图分别 fail closed |
| 5 | PASS | 金额/locale 复用 canonical contracts；组合 props 以严格 TypeScript 判别联合定义，公开出口精确冻结 |
| 6 | PASS | server 组合输入为可序列化 string/number/plain object；事件回调只存在显式 client 入口，不跨 RSC 传输 |
| 7 | PASS | 无生产域名、密钥、正式品牌、偶像 ID 或 locale→market/currency/payment 特判；内部路由/素材均有显式 preview 边界 |
| 8 | PASS | 未新增依赖；React/CVA/Base UI/axe/Playwright 均沿用现有显式 manifest/lockfile，官方 high audit 无已知漏洞 |
| 9 | PASS | server composite、client interaction、媒体状态叶子、Storefront adapter 与证据 runner 可分别替换，不触及 commerce/domain/provider |
| 10 | PASS | focused 80+102+11+10 tests、16 场景浏览器、完整 PG/S3/format/lint/typecheck/test/build、secret/audit 与独立终审全部通过 |

## P2-05 执行卡

**真机验收续作登记（2026-09-05）**：

- Owner：Codex `/root`；开始：`2026-09-05T03:12:45+08:00`（`2026-09-04T19:12:45Z`）；完成：`2026-09-05T04:13:09+08:00`。本次只续作 P2-05；P2-06 尚未领取。
- 输入：干净工作树 `674ef5b`、已匹配当前源码指纹的 P2-05 桌面证据，以及 USB 配对的 iPhone 16 Pro Max / iOS 26.5.2。
- 范围：本地 production-build 样板、物理 Safari 的三类动效、真实系统 reduced-motion、触摸、录屏及性能；无业务 UI、合同、数据库、正式品牌或部署变更。原桌面 `physicalDeviceEvidence:false` 不改写。
- 实际路径：用户开启 Safari 网页检查器/远程自动化/Developer Mode；WebDriver 触摸未送达，改用普通 Safari + Mac Web Inspector + QuickTime USB Screen。浏览器实测 440×796 CSS px / DPR 3 / zh-CN。

### P2-05 真机续作 DONE 证据

- **产物**：`output/playwright/p2-05-device/device-results.json` 汇总来源、范围、原始/交付录像 SHA-256；`normal-motion.mp4`（80.43 秒）与 `reduced-motion-and-touch.mp4`（167.72 秒）均为 1320×2868，完整解码 exit 0。原始 MOV 保留在 gitignored `.auth` 中；三份 accepted JSON 保存正常/减弱/可信触摸原始数据，README 给出复核方法和边界。
- **普通模式**：8 动作/40 状态采样；Hero/Success 为 720 ms 动画后静止；偶像双向捕获 220 ms opacity 过渡、prepare/settled/清理终态，radio 与 panel 一致；快速反向最终正确。加购 pending→confirmed/count1，错误仍1，重试→count2；40 次采样无横向溢出。
- **真实 reduce**：用户实际开启 iPhone「减弱动态效果」，Safari `matchMedia` 实测 true，未使用媒体偏好模拟。8 动作/40 采样均无 running animation，mode=instant、scroll-behavior=auto，53–56 个 motion 节点的 transform/animation/transition 非零项为0；选择、pending/error/重试及成功状态完整，计数2→3→4。
- **可信触摸**：客户端恢复后用户实际操作产生24个 trusted事件，含9次 touch pointerdown；3次radio change后 checked/panel/image 一致；3次加购4→5→6→7，重置后idle且数量7。pointerdown与click不重复计作两次操作。此真人交互发生在reduce模式；两轮8步序列为物理Safari上的脚本DOM事件（isTrusted=false），明确分开记录。
- **性能与范围**：正常各动作 rAF 间隔p95为17 ms，最大36 ms（Noa窗口一次>33 ms），Hero首个回调距动作39 ms；reduce各步p95为17 ms，Hero窗口一次最大51 ms。此为USB录制/Inspector附着下的JS回调间隔，不宣称compositor零掉帧、固定60渲染fps、field INP或覆盖所有机型。当前证据为单台手机/简体中文，与既有桌面多语言矩阵互补。
- **排障与排除项**：本地预览重建后早期手机页未hydration：root lang仍en、profile缺失、radio.checked能变但panel/image不变。已撤回当时的组件通过判断；Raise Inspector并忽略缓存重载后恢复，重新采集accepted证据。`native-touch-samples.json`、`unhydrated-*`、早期PNG与准备录像只属失败诊断，不混入通过。新runbook必须先核验真实Hero/加购/面板图片行为；空Instruments trace不作为零hitch。
- **新增工具**：`scripts/check-ui-motion-device.mjs` 只做前置连接检查；origin/设备经环境注入，不输出设备/session标识，只清理自建会话，永远输出motionAccepted=false。专项TDD先RED后GREEN、6/6与独立代码复核通过。最后可选live预检返回web-inspector-disabled，失败结果如实存入connection-check.json；它不替代已经完成的普通Safari证据，已停止本次driver，不再要求用户反复改设置。
- **本次检查**：`TURBO_FORCE=true mise exec node@24.20.0 -- corepack pnpm check` exit0，typecheck/test各51/51 Turbo tasks、build34/34，均0 cached；真实本地PostgreSQL 9 migrations/108 tables/可靠事件、TLS S3-compatible、format/lint/合同/架构/导出通过。设备/静态motion/browser-runner组合58/58，secret scan与git diff --check通过；两份录像完整解码及样本断言通过。本轮不重跑fresh clone、远端CI、dependency audit或发布。
- **独立终审**：只读复核对normal、actual reduce与trusted input均ACCEPT；解码/hash/范围说明完成，P2-05最低真机门禁关闭。P2-06只更新为READY；正式品牌与指定视口/语言人工批准均未代签，Phase3保持LOCKED。

### P2-05 续作 S.U.P.E.R 检查

| # | 结果 | 证据 |
|:--|:--|:--|
| 1 | PASS | 新脚本仅检查真机连接前置条件 |
| 2 | PASS | capabilities、响应判定与CLI会话生命周期分别处理 |
| 3 | PASS | 外层工具调用本地WebDriver，不反向依赖业务模块 |
| 4 | PASS | 全仓无环，未新增包依赖 |
| 5 | PASS | 输入严格校验；JSON输出schemaVersion1；连接与动作验收分开 |
| 6 | PASS | 输入输出可序列化；设备/session标识不进入证据 |
| 7 | PASS | driver origin/设备经环境注入，无硬编码业务配置 |
| 8 | PASS | 仅用Node内建功能，无新增依赖 |
| 9 | PASS | 预检工具可独立替换，不影响UI、领域或支付 |
| 10 | PASS | 58项回归、整仓0-cache check、真机normal/reduce/可信触摸、录像解码与独立复核通过 |

**本次执行登记**：

- Owner：Codex `/root`
- 开始：`2026-09-04T23:36:03+08:00`（`2026-09-04T15:36:03Z`）
- 输入：P2-01 已冻结的 motion/design tokens，P2-02 的可访问原语，P2-03 的 overlay/live-region/输入方式边界，以及 P2-04 的 Hero、IdolPortrait、GiftTile 等稳定布局组合组件与八 locale 内部展示页。
- 精确输出：在 `packages/ui` 增加独立、source-owned 的客户端 motion 入口与 token-only 样式，实现主海报进入、偶像切换、加购确认/成功三类标志性动效；在 Storefront 既有 dev/test/preview-only、noindex 树中提供可重复交互样板，不新增公开业务页面。
- 动效命题：主海报以克制的透明度和轻位移建立人物存在感，总时长 600–900 ms；偶像主视觉在 360 ms 内解释上下文切换并保持焦点、滚动和稳定尺寸；加购在 220–320 ms 内以可中断反馈确认动作，成功闭环不超过 900 ms 且结束后静止。
- 等价状态：键盘触发和 `prefers-reduced-motion: reduce` 直接进入清晰最终状态，取消位移、视差和自动序列但保留选中、计数、文本/live-region 等非颜色唯一反馈；触摸不依赖 hover，不增加滚动劫持、自动轮播、持续漂浮或输入延迟。
- 性能边界：预定动效优先 CSS，仅动画 `transform`、`opacity` 等合成友好属性；不引入第二套重型动效框架，不动画布局尺寸，不使用 `transition: all`、夸张弹跳或持续动画。主视觉媒体继续固定尺寸与裁切，交互时不改变文档布局。
- 明确不做：不新增真实购物车/订单状态机、支付成功判定、API、数据库、migration、内容发布、正式品牌/Logo/肖像或 P2-06 人工批准；按用户要求，本阶段不实施或验收 AWS/Akamai、部署、云资源、staging、production 与运维。
- TDD 计划：先写失败测试锁定精确导出、时长上限、允许属性、稳定布局、输入方式、焦点/滚动保持、重复快速触发、live-region、成功静态终态及 reduced-motion 零位移；确认 RED 后逐段最小实现并收敛重复。
- 浏览器与质量计划：production build 在 preview gate 下覆盖 390×844 与 1440×900，并抽查六基准视口、320 CSS px、七 locale + `en-XA`、触摸、键盘、快速重复触发、reduced-motion、axe、CLS/long-task/帧间隔、横向溢出与 console/page/request 错误；证据写入 `output/playwright/p2-05/`。真机录屏/帧率只有在可识别的物理移动设备上取得才计入通过，否则明确保留门禁，不以桌面设备模拟替代。
- 风险映射：`R-07` 以严格时长、合成属性、无布局动画、输入方式降级、reduced-motion、浏览器性能探针与独立复核控制；真实设备掉帧时优先删减动效。
- 并发/所有权：P2-05 是唯一 Lane B executor；Codex `/root` 对 `packages/ui` motion API/样式/测试、Storefront 内部样板、静态/browser gate 及最终状态负责。子代理只做只读架构审计、测试矩阵或独立复核，不形成第二 Lane executor。

### P2-05 原实现与验证结果（2026-09-05，本次真机续作前）

- **源码产物**：`@fan-support/ui/motion` 保持 server-compatible，只导出 `HeroEntrance`、`SuccessReveal`；`@fan-support/ui/motion-client` 以独立 `use client` 边界导出 `IdolSwitcher`、`AddToCartConfirmation`；`./motion.css` 为唯一显式样式入口。Storefront 新增七公开 locale + `en-XA` 的 internal/noindex motion fixture、本地虚构人物素材与受控 replay/error 状态，没有新增公开业务路由或支付权威。
- **主海报与成功终态**：Hero 使用一次性 `opacity + transform` 进入，总时长 720 ms，不延迟首个 CTA；Success 只在调用方明确传入 `confirmed` 时运行 720 ms，结束后无残留 animation。两者不推导订单或支付状态。
- **偶像切换**：鼠标使用 360 ms 空间过渡，触控只做 220 ms opacity，键盘/辅助技术即时切换；焦点和滚动位置保持。新媒体必须 decode 成功或显示可见 fallback 后才释放旧层；快速 A→B→A、连续 10 次触发与 decode reject 均执行 latest-wins，不出现空白帧。首帧证据比较未变换 layout boxes，并验证可见 outgoing rect 覆盖 visual container，不把预备态的刻意 transform 误判为布局缺口。
- **加购反馈**：受控 `idle/pending/confirmed/error` 状态以 220 ms 反馈，pending 阻止重复提交且保留按钮焦点；计数、可见文本和单一稳定 live region 同步，错误可恢复。fixture 只证明 UI 协议，不拥有真实购物车。
- **Reduced motion**：390×844 与 1440×900 下 hero/idol/add/success 的 animation、transition、transform 均归零，scroll behavior 为 `auto`；选中、计数、确认、错误、成功和 live-region 状态仍完整可见。
- **字体与 CLS 根因修复**：首次冷启动矩阵发现 Fontsource `font-display: swap` 导致英语/日语等页面发生真实换行位移。Storefront 私有 PostCSS adapter 现只把 `@font-face` 内 `swap` 改为 `optional`；生产构建的 10 个 CSS chunk、242 个 face、5 个预期 family 全部由 AST 门禁验证。静态校验拒绝重复/escaped descriptor、`!important`、非法 prelude、escaped `@import` 等绕过；每个 locale 又以 `document.fonts`、递归 CSSOM 和 computed font stack 证明实际运行 face 全为 `optional`、当前 profile 精确且至少一个 face 已加载。8/8 场景的 CLS 与 raw layout shift 都为 0。
- **浏览器证据**：`output/playwright/p2-05/` 由 Google Chrome `152.0.7977.82` 对真实 production build 生成；8/8 locale/viewport 场景、22/22 PNG、3 个 axe 原始扫描均通过，critical/serious 阻断为 0。另覆盖 hero start/mid/end、mouse/touch/keyboard、慢图/decode failure、rapid reverse、加购中断/错误/确认、成功静止与 reduced-motion；JS transfer `138475 B`，rAF p95 `16.7–16.8 ms`，均明确为本地桌面代理而非 field INP 或真机性能。
- **全局视觉回归**：字体策略改变后重新生成并通过 `output/playwright/p2-02/`、`p2-03/`、`p2-04/` 的生产构建矩阵；P2-04 新指纹为 `0509535d326e069ae0f127a862fb7edae423365f82d77b6905bbf8f9df7fd605`。P2-01 的历史截图继续保留，其旧 `document.fonts.ready` 结论不单独承担当前 no-swap/CLS 证明；该语义由 P2-05 的 production CSS + runtime font + cold-load CLS 证据接续。
- **Focused 与整仓门禁**：UI `17 files / 94 tests`、Storefront `16 / 113`、motion runner `40/40`、motion checker `12/12`、design/font checker `24/24` 全绿。当前工作树 `TURBO_FORCE=true pnpm check` exit 0：workspace 4 apps/30 packages/34 units 无环、合同/领域/adapter/runtime/observability、真实 PostgreSQL 9 migrations/108 tables/可靠事件、TLS S3-compatible、Prettier/ESLint 全绿，typecheck `51/51`、test `51/51`、build `34/34` 且 0 cached。
- **Fresh clone 与供应链**：全新 clone 使用 Node `24.20.0`、pnpm `11.25.0` 完成 offline frozen install，复用 `433/433`、下载 0；随后完整 0-cache check 与 secret scan 再次通过。当前工作树 secret scan exit 0，npm 官方 registry `pnpm audit --audit-level=high` 返回 `No known vulnerabilities found`。
- **独立复核**：产品实现、证据 runner、字体 runtime gate 与 code-simplifier 收尾均得到独立 `ACCEPT`；对抗复核拦截并修复了 CSS parser 绕过、证据 schema 缺项、崩溃/锁恢复、offscreen focus scroll 与 transform 后 rect 误判，最新结论无剩余 P1/P2。
- **上轮真实设备门禁检查（本次连接前）**：`adb` 与 `idevice_id` 不可用，`xcrun xctrace list devices` 只列本机和模拟器，`system_profiler SPUSBDataType -json` 为空；因此没有伪造真机录屏/帧率。P2-05 按最低验收保持 `REVIEW`，唯一解除条件是在可识别的物理移动设备上完成主海报、偶像切换、加购/成功和 reduced-motion 录屏/帧率复核；不通过则先删减动效。
- **范围边界**：按用户要求，部署、AWS/Akamai、云资源、staging、production 与运维全部暂缓，且不构成本次产品代码阻断；本地 preview/staging/production gate 仅验证 internal route 开关。P2-06 不会在 P2-05 `DONE` 前领取，Phase 3 继续锁定。

### P2-05 原实现 S.U.P.E.R 检查（历史状态，当前结果见续作表）

| # | 结果 | 证据 |
|:--|:--|:--|
| 1 | PASS | Hero、Success、Idol、Add、motion policy、Storefront fixture、字体 adapter 与 browser/checker 各自职责单一 |
| 2 | PASS | activation mode、latest-wins、媒体 readiness、字体 AST/runtime 证明与证据 shape 均拆为可独立测试的纯函数或局部状态机 |
| 3 | PASS | Browser/Route → Storefront fixture → UI motion/composite → primitive/tokens 单向；无 UI→app、domain→adapter 或 provider 反向依赖 |
| 4 | PASS | workspace 4 apps/30 packages/34 units 无环；server/client 导出图、React server condition 与 adapter boundary 全绿 |
| 5 | PASS | motion props/状态使用严格 TypeScript union；跨入口导出精确冻结，证据 `schemaVersion: 1` 与 canonical locale matrix fail closed |
| 6 | PASS | server motion 输入可序列化；DOM/ref/event/decode 状态只存在 client leaf；fixture 不把留言、显示名或支付数据写入日志/证据 |
| 7 | PASS | 无生产域名、密钥、正式品牌、真实偶像 ID 或 locale→market/currency/payment 特判；内部素材与路由均有显式 preview 边界 |
| 8 | PASS | 未新增重型 motion 依赖；本地 PostCSS adapter 显式锁入 manifest/lockfile，offline frozen install、secret 与官方 high audit 全绿 |
| 9 | PASS | CSS motion、React client controller、server wrapper、Storefront adapter、媒体 readiness 和字体构建 adapter 均可在边界内替换 |
| 10 | REVIEW | focused、8 场景/22 图片/3 axe、本地与 fresh-clone 全量门禁、供应链和独立复核已通过；真实物理移动设备录屏/帧率尚未取得，故任务不标 `DONE` |


## P2-06 执行卡

- Owner：Codex `/root`（Lane B 唯一 executor）
- 开始：`2026-09-05T05:32:05+08:00`
- 输入：P2-04 组合组件、P2-05 桌面与真机动效证据；两项依赖均 DONE，Phase 2 ACTIVE。
- 范围：复用当前内部样板，补齐 390×844 与 1440×900 的七语言视觉评审包和 axe 原始结果；从代码固定图片裁切、组件状态、动效、多脚本排版约束；列明正式品牌/字体/摄影决定与批准边界。
- 验证计划：核对 P2-04/P2-05 当前源码 fingerprint；真实 Chrome 双视口七语言截图、axe、布局/图片/字体检查；复用已通过的六视口、键盘、200% zoom、伪语言与真机证据；检查评审包链接、证据 hash、文档格式与独立只读复核。若发现产品问题，先失败测试后修复并重跑受影响门禁。
- 产物计划：`output/playwright/p2-06/`、`docs/decisions/008-phase-2-visual-baseline.md`。
- 风险：R-07 动效与设备范围、R-12 资产授权、R-17 多脚本与语言/市场分离。
- 决策边界：用户本轮“继续下一步”授权准备与验证评审材料，不等于批准未展示的视觉基线或未提供的正式品牌资产。Phase 3 在所需批准完成前保持 LOCKED；AWS/Akamai、云部署和运维继续暂缓。

### P2-06 技术交付与 REVIEW（2026-09-05T05:45:45+08:00）

- **可审阅产物**：`output/playwright/p2-06/index.html`（本地 `http://10.10.0.182:43107/`），可切换七语言与手机/桌面尺寸，查看海报、catalog、购物车和动效；`docs/decisions/008-phase-2-visual-baseline.md` 为 Proposed 候选基线，人工批准字段未填写。
- **浏览器矩阵**：7 locales × 390×844/1440×900 × components/motion，共28 cases、58 PNG；28份原始axe的critical/serious为0，14个motion页仍有heading-order moderate，未隐藏。内容lang/noindex、字体/图片加载、横向溢出、文本裁切及键盘真实React状态检查通过。两份画廊视口检查另验证14种切换、键盘、reduce、axe及静态服务边界。
- **先失败后修正**：真实Chrome发现中文/日文/泰文motion说明标签继承1.44px字距与uppercase，`typography-before.json`断言exit1；仅将`ui-motion-specimen.module.css`的展示样式限制到en/es/pt，重建后所有相应浏览器断言通过。Storefront16个测试文件/113tests通过。未更改业务组件、控制器、合同或数据库。
- **证据刷新与连续性**：完整`node scripts/verify-ui-motion-browser.mjs` exit0，8场景/22PNG/3axe及本地环境开关通过，新指纹`c2feb3e385e479430411fd3e418f682a63ddbe1a71aae5ad8956e143320b197b`。从HEAD的原P2-05证据逐文件核对292个输入，仅上述标签CSS变化、291项相同；真机原记录仍绑定旧指纹，只复用于未变的动效机制，不回写为本轮手机验收。P2-04指纹仍匹配。
- **全仓门禁**：`mise exec node@24.20.0 -- corepack pnpm check` exit0，真实本地PG9迁移/108表与S3-compatible集成、format/lint、合同/架构、typecheck/test各51/51 Turbo tasks、build34/34通过；本轮分别50/50/33项缓存命中，不宣称0-cache。首次检查发现证据脚本缺浏览器globals声明，补充明确globals后完整重跑通过。secret scan和diff检查见`validation.json`。
- **独立评审**：`p206_review_audit`核对全部cases、原始axe、PNG字节/hash、源码SHA与continuity；逐张检查36张CJK/Thai/VI/长西葡关键截图及补充motion图，结论ACCEPT FOR HUMAN REVIEW。未代替项目负责人批准视觉、翻译或品牌。
- **剩余决定**：依照规范§21及Task P2-06，需项目负责人确认双尺寸多脚本样板，并提供/决定品牌名、Logo、正式字体与摄影授权。R-12中内部桌面图片低于正式建议分辨率，明确不算正式摄影交付。仅在这些决定完成或用户明确修改门禁后才可关闭任务；Phase3保持LOCKED，部署/运维继续暂缓。
- **后续入口**：优先打开评审画廊；反馈后在ADR-008登记批准人、时间、范围与具体版本；如有修改，按受影响组件/locale/视口重新验证。不可将本地样板加购/订单反馈当成已交付的购买闭环。

### P2-06 S.U.P.E.R 检查（技术材料）

| # | 结果 | 证据 |
|:--|:--|:--|
| 1 | PASS | CSS负责本地化标签，capture负责证据，builder负责评审画廊，ADR负责候选约束 |
| 2 | PASS | 没有新增产品业务函数；截图与测量边界分开 |
| 3 | PASS | 原产品依赖方向未改，证据只读取UI与原有runner |
| 4 | PASS | 全仓workspace/adapter检查通过，无新增生产依赖 |
| 5 | PASS | 未改变跨模块合同；证据含schemaVersion1与显式字段 |
| 6 | PASS | 所有证据为JSON、PNG或文档；无事件/DOM对象越出浏览器采样 |
| 7 | PASS | 本地预览origin经环境传入；尺寸/语言为验收矩阵与合同；无新增正式品牌/域名/密钥 |
| 8 | PASS | 使用已有Playwright/axe与Python标准库，无新增依赖 |
| 9 | PASS | 评审工具和文档可独立替换，不影响产品模块 |
| 10 | PASS | 失败复现后修正、113tests、浏览器矩阵与全仓check通过；人工批准单独保持REVIEW |


### P2-06 视觉改进续作（2026-09-05T06:15:48+08:00）

- Owner：Codex `/root`，Lane B；用户明确反馈认可黑金气质，要求参考research竞品，适配多场景/多颜色艺人照片与礼物。重新打开本任务，不领取Phase3。
- 已看参考：Vivid桌面首页、商品密度、目录、城堡详情与移动目录；MXCheer首页、商品列表、详情及移动截图。借鉴完整场景礼物图、人物情感入口与双列移动目录；不复制竞品图片/文案、榜单/社区/外部商城等已删除范围。
- 视觉命题：中性深炭画廊承接原色影像，暖白商品底提供留白，香槟金只强调动作与选择；通过构图与间距维持高级感。
- 内容计划：完整首页式内部样板，稳定文字区+独立照片区的Hero，艺人选择，六种色彩/场景礼物陈列，礼物详情/演示加购与反馈。保留前版评审包和既有组件/动效证据。
- 交互计划：复用现有Dialog/Drawer/Media/Price/Button；艺人选择更新上下文，类别筛选、礼物详情与演示购物车可操作；不提交真实订单或支付。沿用受控进入/hover与reduce等价状态，无自动轮播。
- 范围：新增preview-only brand样板、独立样板样式/数据和原创内部素材，不替换正式品牌、不改数据库/支付、不启动云部署。
- 验证计划：合同/失败测试先行；390×844与1440×900、多脚本及长西葡语/伪语言；键盘、错误/空状态、reduce、axe、图片与操作实测；受影响测试、format/lint/typecheck/build及原证据指纹核对。独立审阅后重新提交REVIEW。

- 浏览器失败后的必要范围补充：桌面冷载图像在 hydration 前失败，原生 Hero 与基础 Media 未读取已完成的失败状态；原始失败记录见 `p2-06-brand` 首轮矩阵。复用现有组合媒体挂载检查模式，小范围修正 `packages/ui/src/media.tsx`，补齐 native Hero ref 检查；刷新受影响原语/组合/动效证据，不将新版本冒充为上一轮手机验证。


### P2-06 V2 技术交付与 REVIEW（2026-09-05T07:07:18+08:00）

- **最终方向**：参考 research 完整场景礼物与移动目录，中性炭黑/暖白/香槟金框架承接自然日光人像、粉紫/冰蓝/暗蓝琥珀幻想图和红色鲜花/暖橙食物；原创七张 WebP，人物4:5、礼物1:1、桌面三列/手机双列。来源与实际分辨率见 `apps/storefront/public/ui-brand/README.md`。
- **实现**：八个 internal/noindex brand 路由，七语言与伪语言文案，独立纯模型/严格可序列化 fixture query；选艺人、分类、详情、演示加购/数量反馈/移除/空礼袋完整可操作。每条礼物保持原收礼人，语言切换不改变金额、币种与数量。没有新增公开业务路由、订单、支付、数据库或生产依赖。
- **根因修复**：模型先红后绿；冷载图像在 hydration 前失败时补读原生 Hero 与基础 Media 的完成状态；旧截图 helper 采用原子查询/scroll 防 React 移除竞态；中文按语义断行，长标题balance，独立数量公告；桌面详情方图以真实失败矩形证明后修正完整场景显示。静态令牌与 locale owner 门禁按现有模式修正，未放宽检查。
- **新证据**：`output/playwright/p2-06-brand/`，24/24 cases、86 PNG、26 axe serious/critical0；22条moderate为内部说明的region建议，未隐藏。七语言双视口、320伪语言、768/1024/1920、键盘焦点、筛选、双收礼人、真实locale导航、删除/上限、两档reduce/失败回退通过。最后图片框与图均405²桌面/308²手机，原图完整；每张PNG字节与SHA复核。
- **全仓与回归**：Storefront119/UI94/helper11tests；原语P2-02、组合P2-04、动效P2-05完整浏览器runner刷新通过。最终`pnpm check` exit0，真实本地PG/S3、format/lint、typecheck/test各51tasks、build34通过，缓存如实记录；三环境×八路由本地门禁、secret scan与diff检查通过。命令/结果/缓存详见`validation.json`与README。
- **连续性**：当前315输入指纹`aeaea1e5dec8ddafd21124eebbc3473ec608363628e83a2b7824f622a4585747`。首版之后23个新brand文件与原有`packages/ui/src/media.tsx`变化；旧真机录屏保持原fingerprint，不宣称本版新页面或Media恢复逻辑已在手机验收。原P2-06包留作历史，当前候选见ADR-008的V2条目。
- **独立复核**：代码与code-simplifier只读复核接受；视觉复核累计真实查看竞品/多脚本/移动/桌面/弹层截图，指出并确认修复断行、动画中间帧证据与详情裁切；最终候选可交付。人工品牌批准与正式素材决定未代填，P2-06回到REVIEW、Phase3保持LOCKED；云部署/运维继续按既有要求暂缓。

### P2-06 V2 S.U.P.E.R 检查

| # | 结果 | 证据 |
|:--|:--|:--|
| 1 | PASS | 本地模型、copy、页面装配、样式、素材与证据职责分开；Media只管媒体恢复 |
| 2 | PASS | state变换是独立纯函数；媒体恢复与页面交互分别局部控制 |
| 3 | PASS | Route→fixture model/copy→UI/tokens单向，无业务层反向依赖 |
| 4 | PASS | workspace与adapter全仓门禁通过，无新增环或依赖 |
| 5 | PASS | TypeScript精确类型、schemaVersion1、严格key/ID/数量输入，canonical locale由contracts导入 |
| 6 | PASS | locale导航只有可序列化虚构ID/数量，无函数、DOM或私密内容跨边界 |
| 7 | PASS | 数据/金额/字标明确内部fixture，复用令牌，preview origin通过env传入，无正式域名/密钥 |
| 8 | PASS | 使用现有React/UI/Playwright/axe/工具，无新增生产依赖 |
| 9 | PASS | 内部页面/素材独立替换；Media接口保持不变 |
| 10 | PASS | 失败复现、单位/浏览器/全仓与独立复核通过；人工批准单列REVIEW |

## Phase 3 合同接入后的兼容回归（2026-09-05）

P3-01 增加共享合同和 catalog workspace 依赖，触发原渲染输入指纹过期；在不改变已接受的视觉源码/素材前提下，重新执行两组真实浏览器回归。P2-04：16/16 场景、18 PNG、10 axe，fingerprint `7baa48a87bd2c7045875d14f294b1da6b859555ea1f10267ceea3968a6e13e46`；P2-05：8/8 场景、22 PNG、3 axe，fingerprint `ad3531c37cea657031d80bd6eba08a8a051770a6c6abed5b8139bd1eb9f2e49b`；均 critical/serious 0。日志与完整 check 见 `output/checks/p3-01-foundation/`。这是共享依赖变化后的本地桌面浏览器回归，不新增或改写 P2-06 的用户视觉批准范围与历史 iPhone 证据。

## Phase 3 真实目录接入后的兼容回归（2026-09-05）

P3-01 检查点 2A 的共享合同/锁文件再次变化，已顺序重跑两组真实浏览器门禁。当前 P2-04 指纹 `bb9bbf36596d218454536a9a93d91b4284a7a209fc9dfd8998aeff15f5119e47`：16 场景/18 PNG/10 axe；当前 P2-05 指纹 `59537ebf5cb42da8c5309ab64c98ae590768fee86c2adf00cdd5a6083d0f1286`：8 场景/22 PNG/3 axe；均 critical/serious 0，最终全仓 check exit 0。当前浏览器文件与日志分别见 `output/playwright/p2-04/`、`output/playwright/p2-05/` 与 `output/checks/p3-01-directory/`。上段为检查点 1 当时的指纹历史；本次仍是桌面浏览器回归，无新的手机、品牌视觉批准或发布结论。


## P3-01 媒体处理共享依赖后的浏览器刷新（2026-09-05）

本轮新增图片处理合同和 workspace adapter 后，顺序实际重跑两组浏览器门禁，均 exit 0。P2-04 指纹 `e57299a8ad9d4feaa2ac82840db0b78f36cade9486fa596592ad703d253edb22`：16 场景/18 PNG/10 axe；P2-05 指纹 `5963b4fd468de5b8fcfafd271b8b6a82073894d222fe396d18dbc92cc2183686`：8 场景/22 PNG/3 axe；critical/serious 均 0，双基准视口、键盘、reduced-motion、多语言长文案以及组合组件原生 200% zoom 回归保留。日志见 `output/checks/p3-01-media/p2-04-browser.log`、`p2-05-browser.log`。本轮没有新增前台业务页、真机或视觉审批证据；已批准黑金样板和历史手机材料保持各自原始指纹。

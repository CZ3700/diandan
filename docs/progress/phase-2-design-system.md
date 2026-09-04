# Phase 2 — 设计系统与交互样板

> 状态：ACTIVE
> 任务：6  
> 解锁条件：Phase 0 退出门禁通过；最初与 Phase 1 同时激活，当前 Phase 1 已关闭

## 目标

用真实响应式界面证明“电影感偶像画册 × 精品零售 × 可信支付”的视觉和交互语言，然后再扩展页面。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P2-01 | REVIEW | Codex `/root` | P0-04 | Tokens/分 locale 字体/type/grid/theme 已完成；本地、浏览器与独立复核通过，待 clean clone/PR CI |
| P2-02 | PENDING | — | P2-01 | 基础原语 |
| P2-03 | PENDING | — | P2-02 | Overlay/menu/toast/language-region/focus |
| P2-04 | PENDING | — | P2-02 | 七语言长文案组合组件与状态 |
| P2-05 | PENDING | — | P2-03、P2-04 | 三段标志性动效 |
| P2-06 | PENDING | — | P2-04、P2-05 | 人工品牌样板批准 |

## 必须证明

- 390×844 与 1440×900 人工视觉批准，六个标准视口无破版。
- 所有交互有键盘和 reduced-motion 等价状态。
- axe critical/serious 为 0；真实移动设备无明显卡顿。
- 正式品牌/摄影未确认时，只使用有权使用的内部素材和默认 tokens。
- Latin/Vietnamese/SC/JP/Thai 字体按 locale 分包；CJK/Thai/Vietnamese/长西葡语与 pseudo-locale 在 320/390/1440、200% zoom 下无裁切，语言切换保持 route/cart/market/currency。

## Phase 退出证据

Phase 0 已于 2026-09-03 通过退出门禁，Phase 1 已于 2026-09-04 关闭，Phase 2 现为唯一 `ACTIVE` Phase；P2-01 依赖完成且已由 Codex `/root` 领取，Lane B 当前占用。其余退出证据尚未取得。

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

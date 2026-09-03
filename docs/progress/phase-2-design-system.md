# Phase 2 — 设计系统与交互样板

> 状态：ACTIVE
> 任务：6  
> 解锁条件：Phase 0 退出门禁通过；最初与 Phase 1 同时激活，当前 Phase 1 已关闭

## 目标

用真实响应式界面证明“电影感偶像画册 × 精品零售 × 可信支付”的视觉和交互语言，然后再扩展页面。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P2-01 | IN_PROGRESS | Codex `/root` | P0-04 | 2026-09-04T05:57:07+08:00 开始；Tokens/分 locale 字体/type/grid/theme |
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

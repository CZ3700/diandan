# Task Breakdown

> 总任务数：49
> 状态真相源：`docs/progress/phase-*.md`  
> 领取规则：所在 Phase 已为 `ACTIVE`、依赖全部 `DONE` 且对应 Lane 当前无 executor 后，任务才可从 `PENDING` 改为 `READY/IN_PROGRESS`。

## 执行约定

- 每个 Task ID 只产生一个可独立审查的结果；不要把多个任务压进一次大提交。
- “验证”列是最低证据，不替代总规范第 18、20、22 节。
- 代码任务先写失败测试；基础设施/文档任务先写可重复的检查命令。
- 任何支付、迁移、权限、PII 相关任务必须在完成记录引用风险 ID。
- 命令名称是目标接口；Phase 0 可依据真实工具链调整，但必须在根 `package.json` 保持同等语义。

## Task Metadata

优先级：`P0` 为当前版本不可缺，`P1` 为发布质量不可缺但可在纵切片后完成。工作量只用于拆分和并行，不代表日历承诺：`S ≤ 0.5`、`M ≈ 1–2`、`L ≈ 3–5` 个专注工程日；发现 XL 必须先拆分。Lane：A 合同/领域/数据，B 设计/前台，C 自研 Admin/内容/商城运营，D 测试/平台/交付。

| Phase | ID | 优先级 | 工作量 | Lane | S.U.P.E.R 驱动 |
|:--|:--|:--|:--|:--|:--|
| 0 | P0-01 | P0 | M | D | S,U,E,R |
| 0 | P0-02 | P0 | M | D | U,E |
| 0 | P0-03 | P0 | S | A | P,E |
| 0 | P0-04 | P0 | L | D | S,U,E,R |
| 0 | P0-05 | P0 | M | D | S,U,E |
| 1 | P1-01 | P0 | M | A | P,U,R |
| 1 | P1-02 | P0 | M | C | S,P,E |
| 1 | P1-03 | P0 | L | A | S,U,P,R |
| 1 | P1-04 | P0 | L | A | S,U,P,E |
| 1 | P1-05 | P0 | L | A | P,U,R |
| 1 | P1-06 | P0 | L | A | S,U,P,E |
| 2 | P2-01 | P0 | M | B | S,E,R |
| 2 | P2-02 | P0 | L | B | S,U,R |
| 2 | P2-03 | P0 | M | B | S,U,R |
| 2 | P2-04 | P0 | L | B | S,U,R |
| 2 | P2-05 | P0 | M | B | S,E,R |
| 2 | P2-06 | P0 | M | B | U,E,R |
| 3 | P3-01 | P0 | L | C | S,U,P,E |
| 3 | P3-02 | P0 | M | C | S,U,E |
| 3 | P3-03 | P0 | L | C | S,U,R |
| 3 | P3-04 | P0 | L | B | S,U,P |
| 3 | P3-05 | P0 | L | B | S,U,P |
| 3 | P3-06 | P1 | L | D | U,E,R |
| 4 | P4-01 | P0 | L | A | S,U,P,E |
| 4 | P4-02 | P0 | L | B | S,U,P |
| 4 | P4-03 | P0 | M | A | U,P,R |
| 4 | P4-04 | P0 | L | A | S,U,P,R |
| 4 | P4-05 | P0 | L | A | S,U,P,E |
| 4 | P4-06 | P0 | M | D | S,U,P,R |
| 5 | P5-01 | P0 | L | C | S,U,P,E |
| 5 | P5-02 | P0 | L | C | S,U,P |
| 5 | P5-03 | P0 | L | A | S,U,P,R |
| 5 | P5-04 | P0 | L | A | P,U,R |
| 5 | P5-05 | P0 | L | C | S,U,P,E |
| 5 | P5-06 | P0 | M | D | S,U,P,E |
| 5 | P5-07 | P1 | M | D | P,E,R |
| 5 | P5-08 | P0 | L | D | S,U,P,E,R |
| 6 | P6-01 | P0 | L | D | S,U,P,R |
| 6 | P6-02 | P0 | L | D | S,U,R |
| 6 | P6-03 | P1 | M | D | S,E,R |
| 6 | P6-04 | P0 | L | D | S,U,P,E |
| 6 | P6-05 | P0 | L | D | U,P,R |
| 6 | P6-06 | P0 | L | D | S,U,E,R |
| 7 | P7-01 | P0 | M | C | S,E |
| 7 | P7-02 | P0 | L | C | S,E |
| 7 | P7-03 | P0 | L | D | U,P,E,R |
| 7 | P7-04 | P0 | M | D | S,U,E |
| 7 | P7-05 | P0 | L | D | U,E,R |
| 7 | P7-06 | P1 | M | D | S,U,E |

每个任务的验收条件隐含：其列出的 S.U.P.E.R 原则 Quick Check 必须通过；详细 10 项检查见项目 SKILL。

P1-01 的 OpenAPI 产物只冻结可复用 schema components，并用扩展字段明确该范围。后续每个 API 实现任务必须同步补入对应 `paths/operation`、认证/RBAC、`Idempotency-Key`、`expectedVersion` 与审计 reason 契约；不得把空 `paths` 误报为完整 API 文档。

## Phase 0 — 基线与骨架（5）

| ID | 依赖 | 工作与产物 | 最低验证/证据 | 风险 |
|:--|:--|:--|:--|:--|
| P0-01 | — | 初始化 pnpm workspace、Turbo、根 scripts、TS/lint/format/test 配置；创建规范中的 apps/packages 目录骨架，含独立 `packages/contracts` 与 `packages/i18n` | clean clone 后 `pnpm install --frozen-lockfile && pnpm check`；依赖图无循环 | R-15 |
| P0-02 | P0-01 | 建立 CI：install、format、lint、typecheck、unit、build、依赖与 secret scan；缓存按 lockfile | PR/本地 CI dry run 通过；故意提交测试 secret fixture 时 scanner 能阻断且 fixture 被移除 | R-02, R-14 |
| P0-03 | P0-01 | 建立 `packages/config`：环境 schema、`.env.example`、配置分层、启动 fail-closed；不复制待 P1-01 冻结的 locale 常量，不放真实 secret | 缺少必填配置时明确失败；前端只暴露 allowlist；`rg` 无真实凭据或重复 locale 列表 | R-02 |
| P0-04 | P0-02, P0-03 | 建立 Next.js storefront/admin、Nest API/worker、PostgreSQL/对象存储本地环境与 OCI preview | 四应用与依赖本地启动；API/worker health；预览 URL 有截图与镜像日志 | R-14 |
| P0-05 | P0-04 | 接入 request ID、结构化日志、OTel 初始化、错误边界；编写本地启动/故障排查 README | 一次请求可跨 storefront/API 关联；日志字段 allowlist 测试；不记录 PII | R-02, R-11 |

## Phase 1 — 合同、领域与数据（6）

| ID | 依赖 | 工作与产物 | 最低验证/证据 | 风险 |
|:--|:--|:--|:--|:--|
| P1-01 | P0-01, P0-03 | 在 `contracts` 唯一定义 SupportedLocale schema/type/ordered values/default/native names、LocaleContext、Idol、Gift、PriceBook、Inventory、Cart、SupportIntent、CheckoutQuote/OrderAmount、Payment/ProviderEvent、Order/政策接受/通知语言快照、Refund/Dispute、Fulfillment、错误 envelope 与 schemaVersion；i18n/config/apps 只导入；生成 JSON Schema/OpenAPI | schema snapshot、七 locale 精确集合、仓库无重复 locale 常量、locale/market/currency 分离、兼容/拒绝未知版本测试；OpenAPI 与 Zod 一致性 | R-03, R-14, R-17 |
| P1-02 | P1-01, P0-04 | 定义自研 content/catalog/pricing/inventory/media/policy 与七语言显式 translation/review schema、source hash/stale/完整度/发布校验及虚构 fixtures；明确拆分 base operational status、不可变 revision lifecycle 与 public published view | schema/validator tests；公开 view 不接受 draft/archived；缺价格/适用偶像/合格媒体或任一 locale 关键批准译文的内容不能发布 | R-06, R-08, R-17 |
| P1-03 | P1-01 | 在纯 `domain` 实现金额、价格 revision、适用关系、库存预占/提交/释放、支付/订单状态机、路由和幂等 | domain 单元/属性测试；不 import Next/Nest/Drizzle/PSP；branch ≥90% | R-01, R-03, R-05, R-06 |
| P1-04 | P1-01, P1-02, P0-03 | 建立完整 PostgreSQL migrations：内容与 homepage/policy/media translation/review/locale config、商品/价格、inventory balance/ledger/reservation、cart/intent、contact/order/refund/payment、通知 locale、inbox/outbox、履约、RBAC、审计 | 空库 migrate；最近迁移回退/向前修复；translation `(revision, locale)` 唯一/不可变、余额/活动 attempt/退款上限/唯一键/append-only 约束测试 | R-02, R-03, R-06, R-11, R-16, R-17 |
| P1-05 | P1-01, P1-02, P1-03, P1-04 | 定义 persistence/payment/media/identity/notification/cache-purge/key-management ports；实现 PostgreSQL repositories、S3-compatible/CDN purge、获批 KMS 与 fake adapters | adapter conformance；供应商/Drizzle 对象不越界；fixture 变化能触发失败 | R-02, R-06, R-14 |
| P1-06 | P1-04, P1-05 | 实现 PSP webhook raw-body 验签、inbox 去重、outbox、pg-boss worker、重试/DLQ 骨架 | 无效签名拒绝；重复/乱序 fixture；10 次重复只有一次业务副作用 | R-03, R-11 |

## Phase 2 — 设计系统与交互样板（6）

| ID | 依赖 | 工作与产物 | 最低验证/证据 | 风险 |
|:--|:--|:--|:--|:--|
| P2-01 | P0-04 | 实现 design tokens、按 locale/script 分包的 Latin/Vietnamese/SC/JP/Thai 字体、主题、流体排版、网格和偶像 accent 对比保护 | token lint；字形/附标/断行检查；无散落品牌色/间距；6 视口基准截图 | R-07, R-12, R-17 |
| P2-02 | P2-01 | 实现 Button、Link、Icon、Media、Price、Status、Field、Quantity 等原语，禁止可翻译关键文本固定高度/省略 | 键盘、focus、hover、disabled、loading、axe、RTL 结构 smoke；pseudo-locale 膨胀 | R-07, R-17 |
| P2-03 | P2-02 | 实现 Dialog/Drawer、Toast/live region、Menu、独立 Language/Region 控件与焦点/URL/cookie 管理 | focus trap/return、ESC、背景滚动、读屏宣告；切换保持 route/cart/market/currency | R-07, R-17 |
| P2-04 | P2-02 | 实现 Hero、IdolPortrait、GiftTile、IdolContext、CartLine、OrderTimeline；建立组件展示页 | 每组件 loading/empty/error/图片失败；CJK/Thai/Vietnamese/长西葡语/伪 locale 视觉快照 | R-07, R-08, R-17 |
| P2-05 | P2-03, P2-04 | 实现主海报、偶像切换、加购/成功动效；提供 reduced-motion 版本 | 真实移动设备录屏/性能；reduce 下无位移/视差但状态明确 | R-07 |
| P2-06 | P2-04, P2-05 | 完成品牌交互样板评审，固定桌面/移动图片裁切、组件/动效/多脚本排版约束和视觉基线 | 390×844、1440×900 的英语/CJK/Thai/Vietnamese/最长 Latin 人工批准；axe critical/serious=0；记录决定 | R-07, R-12, R-17 |

## Phase 3 — 自研 Admin、内容与浏览前台（6）

| ID | 依赖 | 工作与产物 | 最低验证/证据 | 风险 |
|:--|:--|:--|:--|:--|
| P3-01 | P1-02, P1-04, P1-05, P1-06 | 实现 locale-aware 内容/媒体/发布 API、不可变七语言 revision、preview token、outbox 与按 locale CDN cache purge | API/事务/权限测试；preview no-store；发布 ≤60 秒可见；locale cache 不串线；失败可重试 | R-08, R-11, R-14, R-17 |
| P3-02 | P2-03, P3-01 | 实现自研 Admin 的首页、偶像、媒体与翻译矩阵/source diff/审核/导入导出/七语言预览/发布/回退 | 草稿不污染已发布内容；缺失/stale/自审发布阻断；媒体状态；键盘/axe；冲突提示 | R-02, R-08, R-12, R-17 |
| P3-03 | P2-03, P3-01 | 实现自研 Admin 的礼物/variant、七语言内容、适用偶像、价格簿、库存流水和上下架 | 调价 revision；库存原因/审计；缺关键批准译文或无效礼物不能发布；权限测试 | R-06, R-08, R-10, R-17 |
| P3-04 | P2-06, P3-01 | 实现 `/:locale` storefront shell、导航/语言切换、首页、偶像目录与详情 | 真实 DB/media fixtures；七语言/全状态；切换保持上下文；无硬编码 ID；视觉/性能/axe | R-01, R-07, R-08, R-12, R-17 |
| P3-05 | P2-04, P3-01, P3-04 | 实现七语言礼物详情、未选偶像流程、政策与加载/空/下架/失败/fallback-noindex 状态 | 不适用/售罄/低库存/预售；关键政策无 fallback 上线；不显示偶像地址；服务端 canonical 数据 | R-01, R-13, R-17 |
| P3-06 | P3-02, P3-03, P3-04, P3-05 | 完成七语言 i18n、SEO、OG、structured data、locale sitemap/self-canonical/hreflang/x-default、性能与运营计时验收 | `en/zh-CN/th/vi/ja/es/pt`；SEO/cache snapshot；运营 3/5/8 分钟证据；LCP 预算 | R-08, R-12, R-13, R-17 |

## Phase 4 — 加购、结账与订单（6）

| ID | 依赖 | 工作与产物 | 最低验证/证据 | 风险 |
|:--|:--|:--|:--|:--|
| P4-01 | P1-03, P1-04, P1-05, P3-05 | 实现匿名 cart token 与 add-to-cart 原子事务：服务端重验、presentation/fan-message locale、cart item、加密 support_intent、幂等 | 篡改 idol/variant/price 拒绝；切换 locale 不改 market/currency；超时重试无第二行；公共 DTO 无留言明文 | R-01, R-02, R-03, R-17 |
| P4-02 | P2-03, P2-04, P4-01 | 实现购物车抽屉/页：多偶像隔离、数量、删除、留言编辑、乐观回滚 | 同 variant 不同 idol 不合并；失败解释；键盘/live region | R-01, R-07 |
| P4-03 | P4-01, P4-02 | 实现 checkout preflight：重验并锁 cart version，持久化 CheckoutQuote/OrderAmount、库存预占、PENDING_PAYMENT 订单 `presentation_locale`、偶像/礼物/媒体各自 TranslationSnapshotRef、政策及其 translation revision | 金额算术/过期报价；五类变化阻止旧数据；并发不超卖；各对象 fallback provenance 可重现；切换 UI 不改历史快照；浏览器金额不入账 | R-01, R-05, R-06, R-17 |
| P4-04 | P1-06, P4-03 | 实现 PaymentProvider、Fake/首个批准 PSP adapter、平台→provider locale 映射、session-scoped capability、首事务固化 provider/rule 的两事务幂等 create Saga、托管 next action、return/UNKNOWN reconcile | provider locale fallback 只改托管 UI；超时/崩溃恢复同一 account+attempt；仅失败终态可重试；回跳不能成功/自动换路 | R-03, R-05, R-17 |
| P4-05 | P4-04 | 用 endpointId 路由的可信 provider evidence 推进既有 payment/order、关联早到事件、commit/release reservation，并实现保持订单 locale 的查单 token exchange、成功页 | 最终一致；UNMATCHED 可恢复；迟到成功 ON_HOLD；token 安全；公共 DTO 无内部 intent ID；历史本地化快照不漂移 | R-02, R-03, R-06, R-09, R-17 |
| P4-06 | P4-05, P1-06 | 实现按订单固化 locale 与不可变 templateVersion 的七语言付款/准备/送达事务通知、英文事故 fallback 告警、重试、幂等及过期 reservation/intent/cart/token 清理 | 七语言 subject/preheader/HTML/text/变量与 review manifest 完整；旧版本可重现；每事件只发一次；fallback 可观测；清理与 webhook 无竞态 | R-02, R-11, R-17 |

## Phase 5 — 运营与支付扩展（8）

| ID | 依赖 | 工作与产物 | 最低验证/证据 | 风险 |
|:--|:--|:--|:--|:--|
| P5-01 | P0-04, P1-04 | 实现自研 Admin 的 OIDC、服务端 session、RBAC、CSRF、MFA 生产要求和审计中间件 | 各角色授权矩阵；伪造 session/CSRF 拒绝；角色来自平台；审计不可改 | R-10 |
| P5-02 | P5-01, P4-05, P4-06 | 实现订单列表/详情、七语言/低置信度留言审核队列、PREPARING/DELIVERED、内部备注与通知重发 | 合法/非法跳转；未知语言不自动批准；未经批准留言不可交付；强制变更需 Manager+原因；2 分钟运营演练 | R-02, R-10, R-11, R-17 |
| P5-03 | P5-01, P4-04, P4-05 | 实现取消、全额/部分退款、拒付与统一对账视图 | sandbox refund；UNKNOWN 对账且金额占用 pending 上限；重复命令幂等；金额边界；事件乱序 | R-03, R-10, R-13 |
| P5-04 | P1-03, P4-04 | 完成 PaymentCapability、规则版本、健康熔断、provider conformance suite | 相同输入/版本输出相同；adapter 替换不改 domain/UI | R-04, R-05 |
| P5-05 | P5-01, P5-04 | 实现含七语言渠道名称/提示的配置 draft/validate/publish/rollback、差异预览、二次确认和缓存传播 | 缺关键本地化文案、非法/空路由拒绝；发布 ≤60 秒；一分钟内回退；完整审计 | R-04, R-05, R-10, R-17 |
| P5-06 | P5-01, P1-06, P5-03 | 实现 webhook 查询/安全重放、DLQ、UNKNOWN 支付、通知失败待办 | 重放不重复退款/履约/通知；敏感原文仅受控访问 | R-02, R-03, R-11 |
| P5-07 | P5-04, P5-05, P5-06 | 编写并演练新增 PSP runbook：代码→沙盒→真实小额→灰度；不实际接多余渠道 | 用 fake adapter 完整跑 conformance/灰度；列出商户资格决策门 | R-04, R-05, R-15 |
| P5-08 | P0-05, P1-05, P3-06, P4-06, P5-05, P5-06, P5-07 | 按 ADR-007 实现 OpenTofu production modules 与 production-like staging：state/locking、VPC、ECR、ECS/ALB、RDS PostgreSQL、S3、CloudFront/WAF、Route 53/ACM、KMS/Secrets 引用、预算/配额/告警和 immutable digest 部署；production apply 仍由 Phase 7 灰度门控制 | `tofu fmt -check/validate/plan`；干净 staging apply/smoke/re-apply；四镜像 digest、private origin/data、pg-boss、S3/presign/checksum、CDN cache/no-store/purge、WAF、KMS/IAM、预算/配额和回退前置证据 | R-02, R-11, R-14, R-15, R-16, R-17 |

## Phase 6 — 加固与恢复（6）

| ID | 依赖 | 工作与产物 | 最低验证/证据 | 风险 |
|:--|:--|:--|:--|:--|
| P6-01 | P4-06, P5-07 | 汇总并补齐 unit/i18n/property/schema/contract/integration/七语言 E2E/SEO/cache 测试矩阵与覆盖门禁 | CI 全绿；规范第 18.2 节 14 条 E2E；消息目录/locale cache/hreflang snapshot；失败 seed 可复现 | R-01, R-03, R-17 |
| P6-02 | P3-06, P4-06, P5-02 | 完成七语言 WCAG 2.2 AA：键盘、VoiceOver/NVDA、200% zoom、320px、断行、reduce motion | critical/serious=0；CJK/Thai/Vietnamese/长西葡语人工记录；核心路径不阻塞 | R-07, R-17 |
| P6-03 | P3-06, P4-06 | 优化 LCP/INP/CLS、按 locale 字体/消息 bundle、图片、缓存与第三方脚本 | 七语言 Lighthouse/bundle；6 视口；RUM dashboard；达到第 16.2 节 | R-07, R-17 |
| P6-04 | P5-06 | 做明确范围的安全检查：越权、XSS、CSRF、SSRF、重放、token、secret、依赖、PII | High/Critical=0；修复回归；扫描报告路径 | R-02, R-03, R-09, R-10 |
| P6-05 | P1-06, P4-06, P5-06 | 故障注入：超时、乱序、重复、队列积压、PSP/邮件/对象存储/DB 短暂失败 | 无丢单/重复扣款；backlog 恢复；UNKNOWN 可对账 | R-03, R-11 |
| P6-06 | P0-05, P1-04, P5-05, P5-08, P6-05 | 演练 PITR、对象存储恢复、storefront/admin/api/worker OCI 回退、配置回退和 webhook 重放 | RPO/RTO/15 分钟代码回退有时间戳证据；演练问题已闭环 | R-11, R-16 |

## Phase 7 — 上线与灰度（6）

| ID | 依赖 | 工作与产物 | 最低验证/证据 | 风险 |
|:--|:--|:--|:--|:--|
| P7-01 | P2-06, P3-06 | 冻结品牌/肖像授权、经营主体、市场/币种、七语言政策/风格口径、SLA、客服、邮件和支付资格决策 | ADR-006 与其余 `docs/decisions/` 有负责人/日期/回退；无未批准占位；语言不推导市场 | R-05, R-12, R-13, R-17 |
| P7-02 | P7-01, P3-06 | 通过自研 Admin/受审计导入器写入正式偶像、礼物、七语言动态翻译/政策、媒体、价格和库存，并复核源码 UI/邮件 review manifest；双人复核 | 内容 QA；破图、缺失/过期/未批准关键译文或 manifest、错误关联均为 0；导入审计与授权可追溯 | R-08, R-12, R-17 |
| P7-03 | P6-01, P6-02, P6-03, P6-04, P6-06, P7-02 | 七语言 staging UAT、真实设备、语言切换保持、真实小额支付/退款、邮件与履约演练 | Release Gate 证据包；七语言核心路径；各首发方式成功支付+退款 | R-03, R-05, R-13, R-16, R-17 |
| P7-04 | P0-05, P6-06 | 完成生产 dashboard、告警、值班、客服、事故/拒付/数据请求 runbooks | 告警测试触达责任人；演练记录；联系人有效 | R-11, R-13, R-16 |
| P7-05 | P7-03, P7-04 | 内部→小流量→目标市场灰度；每级检查错误、支付、队列、退款与性能 | 每一级有 go/no-go 记录；异常可熔断/回退 | R-03, R-05, R-11 |
| P7-06 | P7-05 | 上线后 24/72 小时复盘，整理缺陷、指标与下一版候选，不直接扩 MVP | 复盘文档；未解决风险有 owner/date；MASTER 归档 | R-15, R-16 |

## 任务状态

只允许以下值：

- `PENDING`：Phase 尚未激活、依赖未完成或 Lane 正被占用。
- `READY`：Phase 已激活、依赖完成且 Lane 空闲，可以领取。
- `IN_PROGRESS`：已有唯一执行者。
- `BLOCKED`：存在具体阻断条件。
- `REVIEW`：实现完成，等待独立验证。
- `DONE`：验收与证据全部满足。
- `DEFERRED`：经用户明确同意移出当前里程碑。

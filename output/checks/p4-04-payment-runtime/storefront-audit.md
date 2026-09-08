# P4-04 Storefront 只读审计

审计基线：`codex/p4-04-payment-runtime` / `f1f702f`，2026-09-09；执行者 `/root/storefront_read`。本轮只读取源码、规范及本机 Next 文档，未启动服务、浏览器、构建或测试；除本文外未修改文件。以下是实现入口与验收计划，不是已通过的功能证据。

已读 SPEC v3.0.1、MASTER、Phase 4、P4-04/直接依赖、R-03/05/17、项目 skill、storefront AGENTS 与 frontend-skill。Next 本机文档确认 Route Handler 默认不缓存，但不能以框架默认代替显式私人响应头；客户端组件首屏仍可能 SSR，敏感 action 不能作为 Server Component props 注入 HTML/RSC。本项目尚未开启 Cache Components。

## 现有接线与具体缺口

| 位置 | 当前事实 | 最小接入要求 |
| --- | --- | --- |
| `apps/storefront/src/storefront/cart-body.tsx:164–173` | 购物袋结账按钮始终 disabled，说明 checkout 未开放。 | 有有效非空购物车时进入当前 locale 的 checkout；按钮不代表预检成功，最终价格/库存/政策由 API 重验。空车、无价/失效、过期与锁车状态须分别说明；锁车时恢复已有结算。 |
| `cart-page-factory.tsx:15–46`、`storefront-page-shell.tsx:25–49` | 七语薄路由、server copy、同一个 CartProvider、Header 与独立 Suspense footer 已存在；cart metadata noindex。 | 沿用 shell，不为结账重读全艺人目录或非关键商务上下文。结账正文独立路由模块，不静态挂入 Header/GiftPurchase。 |
| `cart-session.ts:34–91,108–228` | CSRF 仅在 session 闭包；cookie 由浏览器处理；8 秒有界请求，动态载入 schema；旧 response union 只覆盖 cart/editor。 | 新 checkout transport 复用 Cookie/CSRF 协议，不向 cart response 判别器混入 payment。普通 GET 可恢复 CSRF；新模块只在结账路由加载。 |
| `cart-proxy.ts:15–81,129–205,248–281,338–361` | BFF 严格选唯一 `__Host-fan-cart`，验证真实配置 Origin，仅转发允许头；拒绝重定向；验证成功 DTO/CSRF/Set-Cookie。 | API agent 复用同样边界处理 preflight/payment，不暴露 internal API origin，不信任 forwarded host，不把 cookie/state 放入命令。写入已发出后的不可验证响应必须是 UNKNOWN。 |
| `apps/api/src/checkout-preflight-route.ts:92–95,141–201` | 已有 validate/create/status；validate **也要求** Idempotency-Key；POST 要 Cookie+Origin+CSRF，status 不接 locale/query。 | BFF 必须按实际协议接线，不能漏 validate key。CREATE 仅接 preflight/version/email/exact policy acceptances，不再传浏览器金额。 |
| `packages/contracts/src/checkout-preflight-public.ts:23–164` | 安全 review 有逐行艺人/礼物/规格/数量/金额、两个文本 localeContext、完整政策；没有媒体 URL、邮箱或私密文本。 | root 已接受纯文本不可变复核，不加历史图片合同，不以实时 cart 图片冒充订单快照；姓名/标题使用各自 resolvedLocale 的 `lang`。 |
| `site-header.tsx:58–75`、`presentation-locale.ts:27–38` | 切语言保留路径/query/hash，以 `location.assign` 整页导航；CartProvider 按 locale 重建，内存请求不会跨页面保留。 | 活跃 checkout/attempt 依靠服务器恢复，不持久化邮箱、action token 或原私密 body；换语言只改界面，不改已冻结订单/provider locale/市场/币种/attempt。 |
| `apps/storefront/src/proxy.ts:13–51`、`next.config.ts` | 当前 HTML 中间层没有 checkout/return 专属 no-store/no-referrer/CSP 策略；API BFF 的 private headers 不覆盖页面 HTML。 | API/root 同步补 pathname 级私人响应头及按已批准 action 约束的 CSP；不能仅加 metadata robots 当作隐私缓存门。 |

源码搜索未找到现成 storefront payment poller 或 return 页面。旧 `payment.ts:63–118` 已定义五类 PaymentAction，WAIT 的 `pollAfterMs` 为 500–60000；`payment.ts:280–284` 的旧 ReturnQuery 要 attemptId/state，但它只是合同，不是已实现的授权/防重放机制。旧 Fake `payment-fake/src/index.ts:122–138` 返回 `payments.example.invalid`，不能直接作为“可付款页面”交付；需要 API agent 的明确 TEST 托管模拟入口，不能把 UI 点击当可信付款事件。

## 已确认的消费者边界与待冻结最小合同

root 已确认新增 `GET /api/v1/checkout/current/status`，以当前 Cookie 定位该 cart 已锁定的 checkout。它解决 CREATE 已提交但响应完全丢失、刷新和跨语言后无法找 session 的缺口。不能以 `CART_NOT_FOUND`/临时失败为理由自动新建 cart/order；有 ID 的状态读取仍必须同 Cookie 授权。

1. **恢复响应**：严格区分无当前结算、授权失效、临时不可用与成功；成功包含现有 `CheckoutSessionView`，以及当前 attempt 的安全引用/状态（可为空）。必须能在原创建 body/key 已随导航销毁后恢复事实；不返回邮箱/内部 provider 引用/幂等键。
2. **capability 响应**：绑定 checkout、真实 amount/currency/market，提供实际允许的 capability ID、当前语言显示名称、可用状态/安全原因和支持的 action types；含真实 TEST/LIVE 标识。country 若是必要输入须由用户/服务端配置明确提供，不从 UI locale 推导。
3. **attempt create/read/recover**：创建只提交 session + capability 等已冻结选择和幂等 key；成功返回安全 attempt、冻结 requested/provider locale 与 fallback 事实、当前 action、明确允许的下一步。API agent 拟提供显式 POST recover，复用同一 attempt，而不是另付一次；cancel 是否提供以 root 最终合同为准。不能让客户端据 FAILED 字符串自行决定另建 attempt；重试须同时受当前 quote/预占/唯一活动 attempt 资格控制。UNKNOWN 必须不可重建/换路。
4. **状态/等待**：同一安全 DTO 表达 CREATED/REQUIRES_ACTION/PROCESSING/UNKNOWN/确定失败等，服务端给有界刷新建议及 quote/action 的实际过期事实。旧合同 optional WAIT 可复用；若缺 WAIT，新的轮询策略必须明确，而不是紧循环或自动 POST reconcile。UI 显示“结果确认中”，网络超时不推导 EXPIRED/FAILED。
5. **return locator**：冻结同 Cookie 的 session/attempt locator，或独立 return-state 的交换/清理流程；任何 query 的 `success/status` 均无支付权威。root 已明确 P4-04 的可信成功证据先持久待处理，PAID/order/库存完整闭环属 P4-05；本轮 return 不宣称购买成功、不链接尚未实现的成功页。

拟 BFF 本地路径：`POST /api/storefront/cart/validate`、`POST /api/storefront/checkout/sessions`、`GET /api/storefront/checkout/current/status`、`GET /api/storefront/checkout/sessions/:id/status`；capability/attempt/read/recover 沿相同 session 前缀，以 root/API 最终合同为准。仅非授权 session ID 可作恢复 locator；若使用敏感 state，在交换后立即从地址移除，且不得由 Header 复制到所有导航。当前 `storefrontHref` 原样保留传入 query，checkout shell 必须给导航净化后的 browse query。

## 最小可用界面

- **视觉**：沿用黑色底、金色主动作、现有字体和间距 token。桌面复核清单与表单两列，移动端一列；细分隔、少说明，不做营销 hero、支付商卡片墙或装饰性成功动画。
- **checkout 初始**：读取当前结算；没有既有结算时读取购物袋并 validate。显示真实不可变艺人/礼物/规格/数量/金额和适用政策；邮箱只在客户端内存，政策必须明确勾选当前返回的 exact revision，不能预勾。一个“确认并继续”主动作创建订单；重复点击冻结同 body/key。
- **已创建**：清除不再需要的邮箱原文，显示历史复核、真实方式选择及明确 TEST 提示；已存在 attempt 优先恢复。以服务器 action 决定进入托管页或等待；不自行收卡号、不下载不适用的 PSP SDK。当前 Fake 优先 REDIRECT/WAIT；未实现的 iframe/component/QR 不可出现在 supportedActionTypes 声明中。
- **错误/冲突**：价格/内容/政策/版本变化刷新事实并要求再次确认；保留仍在当前页面的邮箱草稿，但撤销过时政策勾选。结果不确定时保留原 body/key，只提供“检查结果/恢复同次请求”；不能自动换 key/支付方式。成功、已提交待确认、明确未提交必须分开呈现。
- **return**：进入即授权 GET，不从 URL 写状态。顺序有界轮询（前一次完成后再计时），隐藏页暂停，pagehide/unmount 清 timer/abort，sequence 忽略晚到响应；恢复可见时重新 GET。超过等待预算提供手动刷新，UNKNOWN 提示仍在核实，不出现新付款主动作。
- **语言与私密**：订单创建前换语言重新取得当前语言政策并重新确认；订单创建后界面语言可变，历史对象/policy/provider locale 不重写。email/action/token 不进入 localStorage、sessionStorage、IndexedDB、history state、分析或 SSR/RSC；页面离开清内存，bfcache 返回不恢复旧敏感 action。未保存邮箱可在返回时重新输入，已创建则走授权恢复。
- **可访问性**：表单常驻 label、44px 触控和 16px 输入，错误定位与 aria-describedby；反馈使用稳定 polite live region，不每次 poll 抢焦点；只在用户主动作后的明确步骤转移焦点。等待占位稳定尺寸，沿用 token 内 220–320ms 状态反馈，reduced-motion 去掉位移。

## 文件所有权建议

本 agent 后续拟独占以下产品与对应测试；新消费者须等 root 冻结协议后开始 TDD：

| 所属 | 文件 |
| --- | --- |
| 新页面/状态 | `apps/storefront/src/storefront/checkout-page-factory.tsx`、`checkout-client.tsx`、`checkout-review.tsx`、`checkout-form.tsx`、`checkout-transport.ts`、`checkout-validation.ts`、`payment-action.tsx`、`payment-status.tsx`、`payment-polling.ts`、`checkout.css`；保持每文件单一职责，名称在实际最小实现时收敛。 |
| 现有入口 | `apps/storefront/src/storefront/cart-body.tsx` 及其有界测试；必要时 `cart-error.ts` 仅新增锁车恢复文案映射。现有 Provider/Header/Drawer 行为不重写。 |
| 七语路由 | 现 `(public)` 的 latin/en/es/pt、simplified-chinese/zh-CN、japanese/ja、thai/th、vietnamese/vi 各新增 `checkout/page.tsx` 与 `checkout/return/page.tsx`，复用现有 locale 字体布局，合计 14 个薄入口。 |
| 七语静态文案 | `packages/i18n/src/storefront/{en,zh-CN,th,vi,ja,es,pt}.ts` 及对应 `.review.ts`；沿现有 StorefrontCopy 类型与现有消息/review 测试。只更新真实 draft hash，保持 DRAFT/null 审批字段。 |
| root/API agent | 新 BFF/Next route handlers、HTML private headers/CSP、return-state、current恢复、payment API/合同/registry/config/实际 TEST hosted endpoint 与浏览器 harness；本 agent 不并写。 |
| 集成一次生成 | 中/日词库冻结后由 root 协调 `packages/design-tokens/styles/fonts/generated/`，不改生成器/阈值、不手填 hash。无需新 shared UI 组件、全局 token 或 PSP SDK 依赖。 |

## 译审、字体与正式付款门

全部七个 `packages/i18n/src/storefront/*.review.ts` 当前均 DRAFT、reviewer/approvedCommit 为 null。`messages.ts:54–88` 严格校验 source/translation hash 与真实批准，`apps/storefront/src/server/storefront-copy.ts:7–11` 在 production 强制执行。新增结账/支付/错误文案只可作为 TEST 草稿；daily DIRECT_OPERATOR 的原文例外不适用于关键政策/付款词库。政策缺当前请求语言或批准证据时必须阻止确认，不生成假译文、假 reviewer、假批准 commit。

`scripts/fonts/ui-corpus.mjs` 与 `font-ui-artifacts.test.mjs:49–55` 对实际中日词库字节计算摘要；新增文案即使字形已存在也可能使摘要失效。统一按 `scripts/fonts/README.md` 原生成器处理两 CSS、两 WOFF2、manifest；现有完整字体仍为动态姓名/原文提供 fallback。七语字体/消息按路由加载，不把所有字体与 payment 代码放到公共首页。

PSP、主体、市场/币种、正式政策与关键人工译审仍 OPEN。TEST Fake 浏览器闭环不等于 sandbox/真实小额付款、生产合规或整个 P4-04 DONE；P3-06 既有性能/人工门保留。P4-05 的成功页、查单 token 和订单/库存可信推进不在本 UI 内伪实现。

## 必要验证（目前全部待执行）

1. 有效 RED：cart CTA与七语 route接线；预检必须带 key；email/policy确认；冲突取消旧确认；UNKNOWN双击/同 key/body；刷新/跨 locale 恢复既有 session/attempt，无重复订单。
2. 真实 HTTPS Cookie + Origin/CSRF + no-store/no-referrer/noindex；无 cookie/错 cookie/异域/重复参数/越权 ID 拒绝；旧 rawstate/provider action 未进入 URL导航、HTML/RSC、日志和任何浏览器持久化。
3. 真实 API/PG quote金额与两类库存：TRACKED 最后一件、多艺人同库存目标；PROCURE_ON_DEMAND/PREORDER 按真实能力重复售卖，quantity 上限仍受合同控制。UI 不自行扣库存或把零现货推成停售。
4. 托管 TEST action、回跳早于证据、伪 success query、取消/已知失败/UNKNOWN、并发双标签、after-commit 丢响应；只注入延迟/失败，不替换成功业务 DTO。Fake 未支持的 action 不冒称通过。
5. 轮询真实取消：隐藏/恢复、离页、重挂、旧 GET迟到、网络失败、quote/action过期；确保单个未完成请求和无隐式付款重试，状态 live region不反复播报同一值。
6. 七语 × 390×844/1440×900；长西葡语/CJK/Thai/越南语、逐对象 `lang`、金额、44px、键盘、错误focus、reduced-motion、320px/200%zoom。截图前清空/遮罩邮箱和敏感action；不保存包含私密payload的 HAR/trace。
7. 先定向 tests/types/lint/format；文案与字体统一冻结后一次真实矩阵和受影响 P2 gate，保留既有 incomplete/真人门。完整 check 由 root 对单一候选统一执行，审计不再自行并发浏览器/重跑 63 次 Lighthouse。

S.U.P.E.R 审计结论：方案保持 UI→BFF→Application→Domain/Port→Adapter，跨界对象沿严格版本化合同、可序列化；无新增业务真相源/环境硬编码。当前只能接受本地实现方向；测试项 #10 和支付/译审/生产边界均待实际证据，不标 PASS。

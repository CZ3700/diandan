# 类似站点的技术架构建议

## 1. 先确定产品边界

两站表面都是商城，但真正决定架构的不是页面样式，而是以下问题：

1. 用户买的是寄给自己、寄给主播的实物，还是纯虚拟礼物/支持金额？
2. 每笔订单是否要归属一个主播/团体，并产生佣金、分账或可提现余额？
3. 主播是否自行入驻、管理商品/内容/库存、查看报表？
4. 是否跨境、多币种、多税区、多语言？
5. 是否需要按地区/渠道切换不同商城，还是一个 canonical 商城即可？

在这些问题确认前，不宜把“商品 variation”直接等同于长期业务模型。

## 2. 平台选择

| 场景 | 建议 | 原因 |
|---|---|---|
| 2–6 周验证，标准商品/礼物、无需复杂分账 | Shopify + 自定义主题/轻量 App | 结账、支付、税费、安全与 CDN 运维成本最低 |
| 已有 WordPress 团队，目录中等、归属仅是订单字段 | WooCommerce + 自定义小插件 | 能快速复刻 mxcheer；但需严格控制插件数量与升级 |
| 主播入驻、佣金/分账、余额、复杂履约、强审计 | Next.js/Nuxt 前台 + 独立 Commerce/API + PostgreSQL | 核心关系与账务需要独立领域模型、幂等和审计，不应依赖商品 variation/脚本 |

推荐决策：若一期只是验证“按主播买礼物”，优先 Shopify；若确认会发展为多主播平台与资金分配，直接按“自定义 Commerce Core + PSP”设计，前端可以先用 Next.js 服务端渲染。

## 3. 推荐逻辑架构

```text
用户浏览器
  -> CDN/WAF/DNS（TLS、301 canonical、图片优化、限流）
  -> Web 前台（SSR/ISR；首页、主播页、礼物页、购物车、账户）
  -> API/BFF
       -> Catalog（商品、价格、库存、语言）
       -> Creator（主播、团体、展示页、可售集合）
       -> Cart/Order（购物车、订单状态机、退款）
       -> Payment Adapter（Stripe/PayPal/Shopify Payments）
       -> Allocation/Ledger（归属、佣金、分账、不可变流水）
       -> Fulfillment（实物、虚拟交付或运营工单）
       -> Admin（商品、主播、内容、订单、风控、审计）
  -> PostgreSQL + Redis/Queue + Object Storage
  -> 事件/可观测（webhook、邮件、指标、日志、告警）
```

不要再建一个 Sonny 式的独立跳板页，除非有真实地区/渠道路由需求。默认一个主域名，HTTP 和所有别名在 CDN 层 301/308 到 canonical URL。

## 4. 核心数据模型

- `creator`：主播资料、状态、地区、语言、结算主体。
- `team` / `team_member`：团体及成员关系，带生效时间。
- `product` / `variant` / `price` / `inventory`：礼物或商品目录。
- `creator_catalog`：主播可售商品、展示顺序、定制价格/可用期；避免把归属塞进变体名。
- `cart` / `cart_item`：每行必须保存 `creator_id/team_id` 与当时的价格快照。
- `order` / `order_item`：订单状态机、币种、税费、地址或虚拟交付信息。
- `payment_attempt`：PSP、intent/order id、状态、幂等键、失败码。
- `allocation` / `ledger_entry`：平台费、主播份额、退款冲回；不可覆盖，只追加。
- `fulfillment`：实物运单、虚拟礼物交付或人工工单。
- `refund` / `dispute`：退款与拒付生命周期。
- `translation`、`media_asset`、`audit_log`、`webhook_event`。

## 5. 关键状态流

### 下单

1. 用户从主播页或礼物页选择受益主播/团体。
2. 服务端创建 cart line，并保存 creator/team，不信任前端隐藏字段。
3. 结账前重新校验价格、库存、地区、币种和可售资格。
4. 服务端创建 PSP Payment Intent/Order；卡信息只进入 PSP 托管组件。
5. 收到签名 webhook 后，以事件 id 幂等更新付款与订单。
6. 同一事务或可靠 outbox 创建 allocation/ledger 与 fulfillment job。
7. 邮件/站内状态异步发送；失败进入重试和死信队列。

### 退款/拒付

1. 后台或 PSP webhook 创建 refund/dispute 记录。
2. 订单状态机校验可退款金额。
3. 追加负向 ledger，不直接修改历史分成。
4. 触发库存/履约补偿、通知和风控标记。

## 6. 非功能基线

### SEO

- SSR/ISR；每个主播、集合、商品都有唯一 title/description/canonical。
- 生成 sitemap index；正式环境不输出全站 noindex。
- Product、Offer、BreadcrumbList、Organization JSON-LD；多语言使用准确 hreflang。
- 入口页如果保留，使用服务端 3xx 或 canonical，不制造可索引重复页。

### 性能

- AVIF/WebP 响应式图片，首图 preload，折叠下 lazy；所有图声明尺寸。
- 首页只请求首屏必要组件，商品分页/虚拟化；按路由加载支付与富交互代码。
- HTML 目标建议 <100 KB compressed，首屏 JS <150 KB，LCP p75 <2.5 s，CLS <0.1。
- CDN 缓存使用内容 hash 和 surrogate key；发布后精确 purge，不能用 30 天 HTML 缓存却无可靠失效。

### 安全与支付

- 全站 HTTPS + HSTS；CSP 至少按 nonce/hash 收紧 `script-src`，`object-src 'none'`。
- X-Content-Type-Options、Referrer-Policy、Permissions-Policy、frame-ancestors/COOP 按需配置。
- PSP 托管字段，绝不让自建服务接触 PAN/CVV；验证 webhook 签名和时间窗。
- 每个支付/退款/webhook 都有幂等键；金额以最小货币单位整数存储。
- Admin RBAC + MFA + 高风险操作二次确认；密钥放 Secret Manager；日志脱敏。
- API 限流、Bot/滥用保护、CSRF、防重放、上传扫描、依赖/SAST/备份恢复演练。

### 可观测与分析

- 事件：`view_creator`、`view_product`、`select_beneficiary`、`add_to_cart`、`begin_checkout`、`payment_success/fail`、`refund`。
- 业务指标：主播页转化率、礼物 GMV、支付成功率、退款/拒付率、履约 SLA、分账差异。
- 技术指标：Core Web Vitals、API p95、队列延迟、webhook 重试、5xx、缓存命中/旧版本命中。

## 7. 分阶段规划

### Phase 0：业务与合规确认（1–2 周）

- 明确实物/虚拟、主播归属、佣金/分账、地区、币种、退款与内容审核。
- 确认支付服务允许的业务类型与 KYC/KYB；输出事件风暴和订单状态机。

### Phase 1：可交易 MVP（4–8 周）

- 首页、主播目录/详情、商品详情、购物车、结账、订单查询、政策页、后台基础 CRUD。
- 单币种、单 PSP、单一履约模型；服务端归属字段、webhook 幂等、基础审计。
- SEO、安全头、监控、备份、真实沙箱与小额生产交易验证。

### Phase 2：增长与运营（4–6 周）

- 多语言/地区、搜索筛选、优惠、内容 CMS、邮件、数据看板、A/B 框架。
- 主播集合运营、商品上架审批、归因与投放事件治理。

### Phase 3：平台化（按需）

- 主播入驻、合同/KYC、佣金规则、余额/提现、税务报表、争议处理、风控和多 PSP。

## 8. 上线验收必须包含

- HTTP/apex/www 到 canonical 的服务端 3xx 矩阵。
- 真实浏览器：搜索 -> 选择主播 -> 加购 -> 结账 -> 支付成功/失败 -> 订单详情。
- webhook 重放、重复回调、超时、退款、部分退款、拒付、库存竞争。
- 移动端/弱网、多语言、无障碍键盘操作、支付回跳、邮件链接。
- Lighthouse/真实 RUM、OWASP 基线、备份恢复、缓存发布与回滚演练。

# mxcheer.com 技术证据

## 1. 网络、域名与托管

### 确认

- HTTP `301` 到 `https://mxcheer.com/`；`https://www.mxcheer.com/` 再 `301` 到 apex，canonical host 清晰。
- Google DNS-over-HTTPS 在本次快照返回多组 Hostinger 边缘 A/AAAA；`www` CNAME 为 `www.mxcheer.com.cdn.hstgr.net`。
- NS：`ns1.dns-parking.com`、`ns2.dns-parking.com`；MX：`mx1.hostinger.com`、`mx2.hostinger.com`；SPF：`include:_spf.mail.hostinger.com ~all`。
- 响应头：`server: hcdn`、`platform: hostinger`、`panel: hpanel`、`x-powered-by: PHP/8.3.31`，并广告 HTTP/3 `alt-svc`。
- RDAP：域名注册于 2025-12-14，注册商 NameCheap；当前公开到期日为 2026-12-14。
- TLS 证书：Let's Encrypt，SAN 覆盖 apex 与 `www`；本次证书有效期 2026-08-11 至 2026-11-09。
- TLS 1.2、1.3 成功；TLS 1.0、1.1 被拒绝或不可用。

### 高置信推断

- WordPress/PHP 源站由 Hostinger 托管，Hostinger CDN 在源站前承担缓存与图片转码。

### 未知

- 源站实际区域、数据库类型/版本、备份、容灾、CI/CD 与运维账号边界。

## 2. 前端、后端、CMS 与插件

### 确认

- 服务端渲染 WordPress 页面，不是 SPA；首页声明 WordPress 7.0.4、WooCommerce 10.7.0。
- 主题：Flatsome 3.20.3；前端依赖 jQuery 3.7.1、jQuery Migrate、Flatsome 分块脚本、WooCommerce AJAX。
- 公开源码或 REST namespace 直接出现：
  - WooCommerce、WooCommerce Payments 资源；
  - Contact Form 7 6.1.4；
  - GamiPress 7.9.9.2；
  - TranslatePress（不同边缘快照出现 3.3.3/3.3.4）；
  - Woo Variation Swatches；
  - AddToAny；
  - Breeze 2.5.13；
  - Google Site Kit 1.181.0；
  - Product Feed PRO/AdTribes；
  - Code Snippets、Jetpack、Hostinger 工具；
  - `wc-stripe/v1`、`paypal/v1`、`wc-ppcp/v1`、Woo Store API 等公开 namespace。
- WordPress REST 首页公开 943 条 route；主页 page id 248，slug `home-2`，模板 `page-blank.php`，公开修改时间 2026-08-02。
- 交互接口同时使用 `wp-admin/admin-ajax.php`、`?wc-ajax=` 和 `wp-json/wc/store/v1`。

### 高置信推断

- 页面结构主要由 Flatsome/UX Builder 配置生成；目录、账户、购物车和结账由 WooCommerce 模板与 AJAX 驱动。

### 未知

- 插件许可、后台自定义代码、Code Snippets 内容、插件是否全部保持更新。

## 3. 业务数据与购物逻辑

### 确认

- 导航：Home、Streamers、Shop、Checkout、About；About 下有退款、隐私、FAQ；顶部有搜索、登录与迷你购物车。
- Woo Store API 本次公开返回总计 91 个商品，全部 In Stock，货币 USD；公开价格折算后约 USD 30–3000。
- 91 个商品都在 `Feed your idol` 分类；15 个 simple，76 个 variable。
- 76 个可变商品统一使用 `Select Member's Group` 属性，最多 14 个 variation；可见选项包括 `GoTG.`、`starry`、`MX-山萬里`、`other team` 等。
- 商品平均约 3.37 张图；91 个商品当前公开 review_count 均为 0。
- 首页渲染 36 张商品卡，商品范围包括餐饮、饮品、美妆、服装、服务、礼盒等；这不是传统垂直 SKU 店铺，而是“给主播/团体选择礼物或支持项目”的横向目录。
- 搜索表单是 GET `/ ?s=...&post_type=product`；登录弹窗是 WooCommerce POST 并带 nonce；购物车片段通过 Woo AJAX 刷新。
- 首页加载 GamiPress，商品卡含 `user-has-not-earned` 状态，但公开页面不足以确定具体积分/成就规则。

### 高置信推断

- variation 选中的“Member's Group”很可能承担订单归属/受益团体字段；用户购买后由运营或后台流程把礼物、收益或履约归到对应主播团体。

### 未知

- 商品是实物直送买家、送主播、虚拟礼物、代购还是混合履约。
- 团体归属是否影响库存、佣金、主播收入、税费、退款或结算。
- GamiPress 是否实际用于忠诚度/任务体系。

## 4. 支付、表单、分析与第三方集成

### 确认

- 页面公开配置列出可用支付方法：`stripe_cc`、PayPal、PayPal Card、Google Pay、Apple Pay。
- PayPal 插件配置版本 2.0.24，环境字段为 `production`，有公开 client id，货币 USD、国家代码 CN；支持 PayPal/Pay Later/Card，并声明 Google Pay/Apple Pay 区域。
- Stripe 配置版本 4.0.8，`mode: test`，公开 key 为空；虽然 `stripe_cc.enabled: true`，当前配置不能证明真实可用。
- 页脚显示 PayPal/Apple Pay 等支付图标。
- Site Kit 插件存在，但首页源码未找到 GA/GTM measurement id；Lighthouse 网络中没有 Google Analytics/Tag Manager 请求。
- WooCommerce Order Attribution 脚本会记录 UTM、referrer、入口页、会话页数等归因字段。
- AddToAny 向 `static.addtoany.com` 发请求；Google Fonts 向 `fonts.googleapis.com/fonts.gstatic.com` 发请求。
- 客服只确认到 `mailto:support@mxcheer.com`；未发现 WhatsApp、在线客服或工单 SaaS。
- Contact Form 7 资源和 REST namespace 存在，但首页没有 Contact Form 7 表单。

### 高置信推断

- PayPal 是当前主要生产支付通道；Stripe 处于未完成或测试配置。
- Site Kit 已安装但至少在本次首页快照未真正下发分析标签。

### 未知

- 任何支付方式是否能完成真实授权/扣款/退款；未做交易测试。
- Apple Pay 域名验证、Google Pay 商户验证、3DS、风控、税务、对账是否完成。
- Contact Form 7 在其他页面的具体用途与收件人。

## 5. SEO 与结构化数据

### 确认

- 首页和抽查的 Shop、Streamers、About、商品页均输出 `meta robots=noindex, nofollow`。
- `robots.txt` 有效，主要屏蔽 Woo 日志、临时上传、add-to-cart 参数和 wp-admin；它本身没有屏蔽普通内容。
- `/sitemap.xml` 301 到 `/wp-sitemap.xml`，最终 404；`/sitemap_index.xml` 也 404。
- 首页 title 只有 `mxcheer`，没有 meta description、Open Graph、Twitter Card，也没有 JSON-LD。
- 有 canonical 和多语言 hreflang（en、ar、bn、zh-CN、zh-HK、fr、de、ja、ko、pt、th、es、ru 等）。
- 商品页有 WooCommerce 生成的 `Product` + `BreadcrumbList` JSON-LD，但仍然 `noindex,nofollow`。
- Lighthouse SEO 61，主要直接原因是 noindex 与缺 meta description。

### 高置信推断

- 这是上线时遗留的全站“阻止搜索引擎”设置，导致大部分 SEO 能力实际上失效。

### 未知

- 是否刻意做私域/投放站而不需要自然搜索；若是，noindex 可能是业务选择而非错误。

## 6. 性能与缓存

### 确认

- 原始首页 HTML 约 324 KB；源码含约 1512 个标签、102 个 img、32 个外链脚本、11 个 stylesheet。
- 102 张图都带 width/height；97 张带 `loading=lazy`。
- Lighthouse 13.4.1 mobile lab（单次快照）：
  - Performance 82，Accessibility 97，Best Practices 96，SEO 61；
  - FCP 2.8 s、LCP 3.6 s、Speed Index 5.2 s、TBT 10 ms、CLS 0；
  - 68 请求、约 696 KiB transfer；根文档约 380 ms。
- 浏览器实际收到 WebP 图片，说明 Hostinger/CDN 做图片内容协商或转码。
- Lighthouse 指出约 23.8 KB 未使用 CSS；首页浏览器控制台有一个 MutationObserver 目标非 Node 的 TypeError。
- 首页/目录响应常见 `s-maxage=2592000`（30 天）。多次请求命中不同 Phoenix edge 时，观察到 WordPress 7.0.2/7.0.4、TranslatePress 3.3.3/3.3.4 等不同快照；带查询参数的请求命中动态源站版本。

### 高置信推断

- 当前缓存 purge/发布原子性不足，部分用户可能在不同边缘看到旧版本页面或旧静态引用。
- 首页一次性渲染过多商品和插件资源，是首屏 2.8–3.6 秒的主要可控成本之一。

### 未知

- 真实用户 Core Web Vitals；本次没有可用 CrUX/PSI field data，单次本地 Lighthouse 不能代表全球用户。

## 7. 安全响应基线

### 确认

- 有 HTTPS，HTTP 会 301 到 HTTPS；TLS 1.2/1.3 可用。
- CSP 只有 `upgrade-insecure-requests`。Lighthouse 明确指出缺 `script-src` 和 `object-src`，因此不是有效的 XSS 防护策略。
- 首页未见 HSTS、X-Content-Type-Options、Referrer-Policy、Permissions-Policy、COOP/COEP；账户页有 `X-Frame-Options: SAMEORIGIN`，但并非全站一致。
- 商品浏览设置 `woocommerce_recently_viewed` cookie，带 Secure，但未见 SameSite/HttpOnly（该 cookie 可能需要客户端读取）。
- REST route、CMS/插件精确版本、PHP 版本均公开暴露，增加指纹信息。

### 未知

- WAF、登录 MFA、管理员 IP 策略、补丁 SLA、数据库权限、密钥管理、支付 webhook 签名与幂等实现。

## 8. 可复用与应避免

可复用：主播/团体归属作为商品可选维度、Woo 标准目录/购物车/账户流程、响应式图片、服务端渲染、多语言路由、PSP 托管支付。

应避免：全站 noindex、失效 sitemap、30 天缓存不一致、首页全量插件资源、生产站显示测试 Stripe 配置、缺完整安全头、把业务核心仅编码成 Woo variation 而没有独立归属/分账审计模型。

# 两站技术调研总览

调研时间：2026-09-02（Asia/Shanghai）

范围：只读请求公开首页、公开静态资源、`robots.txt`、站点地图、公开 REST/Store API、DNS/RDAP、TLS 与浏览器 Lighthouse。未登录、未提交任何表单、未加购、未发起付款，也未绕过访问控制。

置信度口径：

- **确认**：可由当前 HTTP 响应、页面源码、公开 API、DNS/RDAP 或浏览器网络记录直接复现。
- **高置信推断**：由多条公开技术证据共同指向，但无法看到服务端源码或合同关系。
- **未知**：公开页面无法证明，必须向业务方确认或做有授权的后台/E2E 验证。

## 一句话结论

- **确认**：`mxcheer.com` 是一个以“主播/团体 + 礼物或商品”为核心目录关系的 WordPress + WooCommerce 商店；首页、目录、搜索、账户、购物车、结账、多语言和支付配置都在同一个站内。
- **确认**：`sonnystargroup.com` 不是完整业务站，而是一个约 6 KB 的静态入口页。它用浏览器 JavaScript 强制跳到 `www`，用户点“进入”后在新标签打开 `vividlivestar.com`。
- **确认**：`vividlivestar.com` 才是 Sonny 入口背后的实际商店，使用 Shopify，公开目录至少返回 250 个商品、184 个以主播/成员名命名的集合。
- **高置信推断**：两条链路都在实现同一类“按主播/团体归属购买礼物或商品”的业务模型，只是一个直接在 WooCommerce 中完成，另一个通过入口域名导向 Shopify。
- **高置信推断**：若要做“类似的”，值得复用的是业务信息架构与归属关系，不应照抄 Sonny 的 JavaScript 跳转壳，也不建议把复杂分账/归因逻辑长期压在大量 WordPress 插件之上。

## 两站技术画像对照

| 维度 | mxcheer.com | sonnystargroup.com |
|---|---|---|
| 站点角色 | 完整电商前台 | 导流入口页 |
| 页面生成 | PHP/WordPress 服务端渲染 | 单个静态 HTML，内联 CSS/JS |
| 商城 | WooCommerce 10.7.0 | 本域无商城；点击进入 Shopify 站 `vividlivestar.com` |
| 主题/前端 | Flatsome 3.20.3、jQuery、Woo AJAX/Store API | 无框架、无外部 JS/CSS |
| 主域规范化 | HTTP 301 到 HTTPS；`www` HTTPS 301 到 apex | HTTP/HTTPS、apex/www 服务端均 200，靠 JS 跳到 HTTPS www |
| CDN/托管 | Hostinger CDN/hPanel/PHP 8.3 | nginx；Google Cloud IP；SiteGround 风格代理头（托管商为高置信推断） |
| 多语言 | TranslatePress，公开 13 个地区语言入口 | 入口仅中英混排；目标 Shopify 有 en/ja/th/es/ko |
| 支付迹象 | PayPal、卡、Google Pay、Apple Pay；Stripe 配置为 test 且无公钥 | 本域无支付；目标 Shopify 有标准结账/数字钱包迹象 |
| SEO | 全站观察页面 `noindex,nofollow`，无有效 sitemap；主页无描述 | 可索引，但无描述、canonical、结构化数据或 sitemap |
| 浏览器性能快照 | Lighthouse mobile：82 / 97 / 96 / 61（性能/可访问性/最佳实践/SEO） | 95 / 96 / 96 / 91；但 JS 重载与跳转浪费约 2.5 秒 |
| 安全头 | 仅 `upgrade-insecure-requests`；无 HSTS 等完整基线 | 未见 CSP/HSTS/XFO/XCTO 等；HTTP 不强制 HTTPS |

## 公开索引与公司定位

- **确认**：对 `mxcheer.com`、`sonnystargroup.com`、`vividlivestar.com` 的公开网页搜索没有找到可可靠对应的官方公司简介、注册主体或媒体报道。
- **确认**：搜索结果中存在若干同名或近似名称公司，但域名、产品和页面证据无法把它们与本次两站可靠关联，因此未采用。
- **确认**：第三方域名评分页面只说明域名较新等技术信息，且其评论区混有明显与本站无关的内容；不应把此类“信任分”当作业务真实性结论。
- **未知**：实际公司主体、主播合作合同、资金结算、商品履约与售后责任归属。

## 最值得复用的部分

1. “主播/团体”是一级入口；同一礼物可绑定不同受益主播或团体。
2. 礼物/商品目录、主播集合、搜索、购物车、账户、订单与政策页组成完整漏斗。
3. 商品卡使用响应式图片、固定宽高、首屏按需加载；目标商城还提供语言/地区入口。
4. 支付交给成熟 PSP/托管结账，前端不接触卡号原文。
5. 用服务端 canonical redirect、CDN、图片转码和边缘缓存承担基础交付。

## 不建议照抄

1. Sonny 的 `localStorage + reload(true) + setInterval`“版本检测”并不会主动检查服务器版本，首次访问还制造额外刷新。
2. Sonny 的 HTTP、apex/www 规范化全部依赖浏览器 JS；爬虫、禁用 JS 用户与分享链接会得到不一致结果。
3. Sonny 七天 `urlMap` 当前全部指向同一个 URL，增加维护噪音，没有业务价值。
4. mxcheer 首页约 324 KB 未压缩 HTML、32 个脚本、11 个样式，并把多个未必使用的插件资源加载到首页。
5. mxcheer 30 天 CDN `s-maxage` 下不同边缘曾返回不同插件小版本，说明缓存发布/失效策略不稳。
6. 两站都缺少完整安全响应头与合格 SEO 基线；mxcheer 的全站 `noindex` 尤其不能复制到正式站。

更细证据见：

- `mxcheer-evidence.md`
- `sonnystar-evidence.md`
- `architecture-recommendations.md`
- `reproduction-commands.md`

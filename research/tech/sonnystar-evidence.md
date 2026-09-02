# sonnystargroup.com 技术证据

## 1. 网络、域名与托管

### 确认

- apex 与 `www` 的 HTTP/HTTPS 四个 URL 在服务端都返回 200，没有 HTTP 到 HTTPS 或 apex 到 www 的 3xx 规范化。
- A 记录：`35.213.176.43`，公开网段归 Google Cloud；无 AAAA、MX、TXT、CAA。
- NS：`dns29.hichina.com`、`dns30.hichina.com`；RDAP 注册商为 Alibaba Cloud/HiChina。
- RDAP：域名注册于 2026-01-24，公开到期日 2027-01-24。
- 响应头：nginx、`x-httpd-modphp: 1`、`x-proxy-cache`/`x-proxy-cache-info`；页面有 Last-Modified 与 ETag，可条件请求 304。
- TLS：Let's Encrypt，SAN 覆盖 apex 与 www，有效期 2026-07-23 至 2026-10-21；TLS 1.2/1.3 可用，1.0/1.1 被拒绝或不可用。

### 高置信推断

- 页面托管在使用 Google Cloud 基础设施的共享主机/代理栈上；响应头样式很像 SiteGround，但仅凭公开头无法百分百确认服务商合同。

## 2. 页面与前端逻辑

### 确认

- 页面大小 6203 bytes，单文件 HTML；CSS 和 JavaScript 全部内联，无外部脚本、样式、图片或字体。
- 视觉结构只有：渐变全屏背景、白色圆角卡片、欢迎标题、一个“进入”按钮、版权文字。
- `lang=zh-CN`，正文中英混排；移动端只有一个 480px media query。
- 页面启动逻辑顺序：
  1. `currentVersion = 2`，从当前 origin 的 localStorage 读 `pageVersion`；不一致就写入并 `location.reload(true)`；
  2. 每 3600 秒再次比较同一个常量与 localStorage；
  3. 若 hostname 不是 `www.sonnystargroup.com`，用 `window.location.href` 跳到 HTTPS www；
  4. DOMContentLoaded 后把按钮文案改成“进入”；
  5. 点击按钮后禁用、显示“跳转中...”，按星期查 `urlMap`，在新标签打开目标；1 秒后恢复按钮。
- 周一到周日七个映射当前全部是 `https://www.vividlivestar.com/`，fallback 才回到 Sonny www。
- 现代浏览器中 `location.reload(true)` 的布尔参数已无强制绕过缓存语义。
- localStorage 按 origin 隔离；apex、www、HTTP、HTTPS 都是不同 origin，首次跨域/跨协议会分别触发版本写入/刷新。
- 页面注释称“每 5 分钟”，实际是 3600 秒（1 小时）。

### 高置信推断

- 这是为随时切换落地目标而做的“入口/跳板域名”；当前没有星期分流，配置只是未来扩展或遗留模板。

### 未知

- 是否会按投放渠道、地理、用户或日期动态更换目标；当前公开代码没有这些逻辑。
- 入口域名与目标商店的法律主体关系。

## 3. 关键实现缺陷

### 确认

- “版本检测”没有向服务器发版本请求；当已加载的新 HTML 自身常量变化时才刷新一次，因此不能主动发现远程更新。
- 同一 HTML 同时使用 meta no-cache、浏览器 localStorage 版本和 HTTP ETag/代理缓存，缓存策略互相矛盾。
- `setInterval` 只比较内存常量和已写入 localStorage，正常情况下永远相等，不会发现新版本。
- 首次访问会产生多次 document 导航；Lighthouse 网络记录包含 apex 文档、www 文档、www 条件请求/刷新以及一次被中止导航。
- Lighthouse 报告 `Avoid multiple page redirects`，估算可节省约 2518 ms。
- 按钮在 HTML 中写“进入Enter”，DOMContentLoaded 改成“进入”，1 秒恢复又写“进入Enter”，文案状态不一致。
- `window.open(..., '_blank')` 没显式 `noopener,noreferrer`，也没有处理弹窗被阻止的情况。
- favicon 请求 404，是浏览器唯一明显控制台错误；404 响应 transfer 约 14 KB，反而大于正文压缩传输。
- 页面没有 `<main>` landmark，Lighthouse 可访问性审计因此扣分。

## 4. 目标站 vividlivestar.com

### 确认

- Sonny 按钮唯一当前目标是 `https://www.vividlivestar.com/`；该 URL 301 到 apex `https://vividlivestar.com/`。
- 目标站响应明确 `powered-by: Shopify`，前有 Cloudflare；使用标准 Shopify Dawn 风格资源、Shopify Analytics/Monorail、隐私 banner、hCaptcha、数字钱包/加速结账模块。
- RDAP：Vivid 域名注册于 2026-01-26，比 Sonny 晚两天；同为 HiChina 注册商，NS 也在 HiChina 体系。
- 目标站 language 入口：en、ja、th、es、ko；货币 USD。
- 公开 `/products.json?limit=250` 返回满 250 个商品，说明商品至少 250 个；本批全部 available，价格 USD 20–2000，vendor 仍为占位 `My store`，product_type 为空、tags 为空。
- 公开 `/collections.json?limit=250` 返回 184 个集合；大量集合以 `团队缩写-主播名` 命名，如 WOW-Sylas、SKT-ACE、VCT-Star、UNI-Leo。
- 商品标题大量含主播代号、双语虚拟礼物名以及 `(Anchor development)`，如 “紫禁大典 / The Grand Ceremony ... (Anchor development)”。
- 目标站 title、OG site_name/vendor 仍显示 `My store`，说明品牌/SEO 配置尚未完成。

### 高置信推断

- Vivid 的实际信息架构是“主播集合 -> 可购买礼物”，购买金额通过商品/订单与主播集合关联；Sonny 只是这个商城的流量入口。
- Sonny 与 Vivid 注册时间、注册商、DNS 体系及代码直连关系一致，极可能由同一项目方控制，但公开证据不能替代主体证明。

### 未知

- Shopify 订单如何结算给主播、是否有自建 App/webhook、是否属于实物或虚拟支持。
- Sonny 为什么存在：品牌隔离、投放跳板、容灾、地区分流或历史迁移均无法从前端确认。

## 5. SEO、性能与安全

### 确认

- `robots.txt` 只有 `User-agent: *` 与 `Crawl-delay: 10`；无 sitemap，`/sitemap.xml`、`/sitemap_index.xml` 404。
- 首页 title 只是域名；没有 meta description、canonical、Open Graph、Twitter、hreflang、JSON-LD。
- 没有 noindex，所以页面可被索引，但信号非常弱。
- Lighthouse 13.4.1 mobile lab：Performance 95、Accessibility 96、Best Practices 96、SEO 91；FCP 2.0 s、LCP/TTI 2.7 s、TBT 0、CLS 0、5 请求、约 18 KiB transfer。
- 得分高主要来自页面极小；多重刷新/跳转仍浪费约 2.5 秒。
- HTTP 没有跳 HTTPS；HTTPS 响应未见 HSTS、CSP、X-Frame-Options、X-Content-Type-Options、Referrer-Policy、Permissions-Policy。

### 未知

- WAF、服务器补丁、主机后台、部署流程与访问日志保护。

## 6. 可复用与应避免

可复用：入口页内容聚焦、一个明确 CTA、极少依赖、移动端适配、把完整商城交给成熟托管平台。

应避免：JS canonical redirect、无效版本轮询、首次强制刷新、七天重复映射、缺 SEO/法务页/品牌信息、`window.open` 无显式 noopener、HTTP 可直接访问、缺安全头。

如果确实需要“可切换目标的入口域名”，应在 CDN/边缘配置中用 301/302/307 规则或可审计的短链服务完成，并保留 allowlist、变更记录、健康检查和回滚，不要把目标表硬编码在页面脚本里。

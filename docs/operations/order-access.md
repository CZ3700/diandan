# 安全查单运行与恢复

P4-05 提供订单范围授权、历史只读视图、PostgreSQL 持久限流，以及七语言付款完成/查单页面。邮件编排与 TEST 网关见 [订单通知与到期清理](order-notifications.md)。当前完整验收状态以 phase-4-commerce 与本轮 final-verification 为准。

## 接口与权限

| 入口 | 授权与行为 |
|:--|:--|
| 内部 Application `issue` | 只供可信服务调用；确认已付款订单，撤销旧活动链接/会话，生成的原始随机值仅留调用侧内存。没有公开签发路由。 |
| `POST /api/v1/order-access/exchange` | 严格 Origin、JSON、一次性 256-bit token；带 pepper 的摘要查找原订单，同事务消费并建立订单会话。 |
| `POST /api/v1/checkout/sessions/:checkoutSessionId/order-access` | 原购物车 Cookie 与 CSRF、未过期会话、已付款且购物车已转换；只授予该 checkout 的订单权限。过期报价不会抹除已付款订单。 |
| `GET /api/v1/orders/:publicOrderId` | 订单 Cookie 与 publicOrderId 精确匹配，读取前后检查实际有效期；只返回购买时快照和当前业务状态。 |
| `POST /api/v1/order-access/revoke` | 同一订单 Cookie、独立 CSRF 与严格 Origin；撤销自己的活动授权，不能仅凭订单号撤销别人。 |
| `POST /api/v1/order-access/locate` | 只凭本浏览器该订单的有效会话把公开短号解析为 publicOrderId（F1-2）；只读、不签发凭据。 |
| `GET /api/v1/orders/:publicOrderId/delivery-proofs/:proofId/:rendition` | 送达照片（F1-4）：无锁确认会话有效且属于该订单，照片属于已送达的实物行且未撤回，再从私有 source 桶读取并核验字节，以 `image/webp` 返回；另加 nosniff、sandbox CSP、同源 CORP。查不到与无权限返回相同的 401。 |

Cookie 为 `__Host-fan-order`，Secure、HttpOnly、SameSite=Strict、Path=/、无 Domain；原始会话凭证不进响应正文；token/CSRF 不进 localStorage 或 sessionStorage。响应包含 private/no-store、no-referrer、noindex/nofollow。限流按 EXCHANGE、BOOTSTRAP、READ、REVOKE 四个桶独立计数；locate 与送达照片读取共用 READ 桶，数据库先独立提交计数，后续授权失败不回滚计数。设置 `readMax` 时要把照片请求算进去：一次查单页展示会读取 1 次详情，外加每张照片 1 次缩略图，打开大图再加 1 次。WAF 在边缘按客户端 IP 另行限流（ORDER_ACCESS 规则已包含 locate 与照片路径）。

原始 token 只出现在明确禁用正文日志的交换请求中。KMS 使用已有 ORDER_ACCESS_TOKEN purpose，再以 ORDER_LINK_V1、ORDER_SESSION_V1、ORDER_CSRF_V1、ORDER_RATE_LIMIT_V1 的固定前缀隔离用途；不会修改旧 purpose 枚举。最多四个 pepper 版本支持受限重叠，签发使用活动版本。

## 失败与恢复

- 重复消费已交换链接返回 ACCESS_DENIED，不生成新会话。一个订单只有一个活动会话；新签发/新交换会撤销旧会话。
- 收到 Cookie 但丢失 JSON：需要已知的原 publicOrderId，才能用该 Cookie 调用受保护 GET；Cookie 本身没有订单发现接口。
- Cookie 和正文都丢失：当前付款浏览器可凭原有效 checkout 重新 bootstrap；没有原 checkout 的浏览器需要未来重新签发的新邮件链接。不得重新激活已消费 token。
- 邮件发送器接续时，应生成 `/:locale/order-access#token=<一次性凭证>&order=<publicOrderId>`。当前页面在首段同步脚本中立即清除 fragment/query，再从最多保留15秒的一次性内存闭包交换；交换后以服务端订单为准。丢失 JSON 时仅用已知订单号尝试受 Cookie 保护的 GET；不同订单的提示不能获得访问。不要把 token 放入 query 或日志。
- 点击“End access on this device”（结束本设备访问）后立即隐藏订单。若撤销响应未知，重试或恢复页面仍继续关闭；为恢复 CSRF 而读取的中间结果不重新显示。页面隐藏/离开时清除可见订单，重新可见时再次向服务端验证，过期或被另一浏览器轮换后展示恢复说明。
- RATE_LIMITED 返回 429 与 Retry-After；KMS、数据库或结果合同异常返回通用 503，不放行也不暴露原始错误。
- 查单读取不查询 PSP、不入账、不改购物车、不发邮件；不会把浏览器回跳当成付款证据。

## 前台与 BFF

- `/:locale/orders/lookup`：填写非秘密订单号；必须有该订单的有效浏览器授权才能读取，仅凭订单号不开放详情。
- `/:locale/orders/:publicOrderId`：订单详情与当前进度；`/:locale/thank-you/:publicOrderId`：同一授权下的付款结果。只有 canonical 已入账历史订单读取成功才显示结果。
- 当前付款浏览器在可信入账后先尝试已授权读取，必要时使用原 checkout 的购物车 Cookie/CSRF bootstrap；成功读取后清除临时授权回调，刷新不会反复轮换会话。
- 送达照片经 `/api/storefront/orders/:publicOrderId/delivery-proofs/:proofId/:rendition` 同源代理读取：只接受 GET，只转发订单 Cookie，要求上游 200、`image/webp`、private/no-store 且字节数在上限内（缩略图 512 KiB、大图 4 MiB）。页面不会拿到存储地址或签名地址。
- 其余 `/api/storefront/` 入口对应上述 `/api/v1/` 接口；BFF拒绝其他路径/查询和错 Origin，严格分开购物车与订单 Cookie/CSRF。BFF总请求截止10秒，浏览器15秒，正文有操作级预算；凭证仅留内存，浏览器存储不保留 token/CSRF。
- 七语言切换只改变外壳，保留购买时名称、规格、图片、金额与内容来源。DAILY原文明确标识，不伪装成已审核译文。进度显示付款/订单/争议/准备四个当前状态；唯一已有真实时间是下单时间，不能编造准备/送达时刻或承诺日期。
- 订单HTML及响应为 private/no-store、no-referrer、noindex，订单HTML拒绝外部脚本与连接。链接失效时没有“邮件已重发”的虚假操作；实际重发随后续通知/运营工作接入。

## 历史数据与数据库

原 0004 的 token/session 表继续使用，仅保存 keyed digest。0028 新增持久计数与不可变访问审计，不改 0001–0027。访问写入遵循 cart→order→token/session 的锁顺序，READ COMMITTED 配合明确行锁；消费、轮换、审计与返回值校验在同事务完成。bootstrap 在锁后和授予前再次按数据库 clock_timestamp 校验原购物车有效期。0029 将 checkout bootstrap token 与邮件 LINK 分开；bootstrap 同事务消费临时 token，不撤销活动邮件链接。

订单名称、原始语言、媒体 alt、数量、价格与金额来自不可变订单行，v2 规格标签来自原 checkout observation；v1 未保存规格标签时返回 null，不读取今天的商品标签。DAILY 保持实际原文来源，与已审批英语 fallback 分开。展示图必须绑定订单固化的原媒体资产与校验和，解析该资产的 READY 展示衍生图；不能将私有 SOURCE 原图路径当作公开图，也不能跟随当前商品换图。

数据库若已有新的计数或审计数据，0028 down 会拒绝丢失数据的回退。不要删除授权审计来绕过保护。过期凭证即时拒绝；批量状态到期由 P4-06 的数据库维护任务执行；个人数据删除策略仍独立。

## 启用配置

服务端显式提供 `FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON`，严格 schemaVersion=1：publicStorefrontOrigin、sessionTtlSeconds、linkTtlSeconds，以及 rateLimit 下的 windowSeconds、exchangeMax、bootstrapMax、readMax、revokeMax。没有该配置时不装配授权服务，固定入口在解析凭证前返回带隐私响应头的 503；配置不完整或 Origin 与站点部署不一致则启动失败。复用已有数据库、对象存储 public origin、购物车 KMS 服务端配置，不生成密钥或商户资料。

session TTL 为 1–86400 秒，link TTL 为 1–604800 秒，计数窗口 1–3600 秒，各预算 1–10000；1 秒仅用于实际过期测试，运营值应随真实部署选定。Key rotation 会形成新版本计数桶，应由受控配置流程执行。

应用限流身份是 Fastify 的 `request.ip`，存储前经 KMS 摘要。未设置 `FAN_SUPPORT_TRUSTED_PROXY_CIDRS` 时它就是 TCP 对端，不信任任何 X-Forwarded-For；设置后只信任列出的精确地址或网段（不接受跳数、`/0` 或过宽网段），从 TCP 对端向左跳过受信任的代理，取第一个不受信任的地址。BFF（查单与送达照片代理）把边缘代理给出的 X-Forwarded-For 原样转发，超过 512 字节时只从左侧丢弃，绝不截掉右侧。staging/production 配置了查单时必须设置该变量（VPC CIDR + CloudFront origin-facing 前缀），否则启动失败；本地体验/stg 由运行时设为回环 `127.0.0.0/8,::1/128`，依赖 Caddy 对不受信任的访客重写 X-Forwarded-For。边缘 WAF 的 ORDER_ACCESS 规则仍按源 IP 另行限流。

## 验证入口

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:order-access
mise exec node@24.20.0 -- corepack pnpm verify:orders:browser
mise exec node@24.20.0 -- corepack pnpm check
```

定向入口使用真实 PostgreSQL、TLS S3、正常后台/购物车/checkout、独立持久 TEST PSP 与实际 HTTP。真实 socket 丢响应与事务 callback 内提交前故障注入/真实回滚分别记录，不能称为真实数据库断网或 COMMIT 结果不明。证据在 `output/checks/p4-05-order-access/`。

订单浏览器证据在 `output/checks/p4-05-order-storefront/browser-verification.md`：七语言双端、实际 TEST PSP/验签webhook/worker与授权Cookie通过。JSON正文丢失在Next响应边界注入，不能称真实TCP断连；原生Back发生重新加载，本轮未命中真实bfcache，生命周期探针与实际Back证据分别记录。它们不替代真实商户、物理手机或人工译审。

Cookie 语义参考 [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)；会话凭证与固定权限边界参考 [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。这些参考不能替代本仓库浏览器、真实商户、staging 与生产验收。

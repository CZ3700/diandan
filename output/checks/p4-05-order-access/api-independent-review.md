# P4-05 安全查单 API 非作者复核与 UI 接续

Reviewer：`/root/access_postgres`。本复核只读审查 `/root/access_api` 编写的 API；不把本人编写的 PostgreSQL 实现视作非作者复核。本次仅新增此报告与独立故障探针，未修改生产源码或其他作者的测试。

当前结论：**接受 P4-05 安全查单服务端第二检查点的 API 实现，未发现阻断问题；40 项质量门已有按差分分段覆盖的通过证据。** 这不是单条完整 `pnpm check` 成功，也不是全部 40 门都在 source-third 上运行。此结论不代表整个 P4-05、前台查单、邮件、真实商户或生产发布已经完成。

## 已复核范围与结论

1. `order-access-credentials.ts` 生成独立的 32-byte 随机 link/session，严格校验 canonical base64url。原始 link/session、CSRF 与网络地址停留在凭证适配层，Application 命令只有带版本的 keyed digest。固定的 link/session/CSRF/rate scope 与 NUL 分隔共同使用原 KMS purpose，不与旧购物车 MAC 输入重合。
2. pepper 版本最多四个、不得重复、活动版本必须在列表中；新签发使用活动版本，解析支持有限旧版本。KMS 返回必须匹配指定版本、操作、成功状态和摘要长度；任意异常转换为固定错误，不能把 KMS 私密诊断向上传播。CSRF 与同一 session 绑定，并在各有效版本上用 timing-safe 比较。
3. `order-access-route.ts` 四入口分别完成 exchange、已付款 checkout bootstrap、protected read、已授权 revoke。没有公网 issue/按邮箱或订单号签发入口。read/revoke 将 publicOrderId 作为授权范围，不将其作为唯一权限；read/revoke 响应再次验证身份匹配。无效路径 UUID 已在前置解析中返回 400，仍计入持久限流。
4. 所有 POST 要求单一严格 Origin 与 JSON Content-Type；跨源及 same-site 子域请求拒绝。存在 Sec-Fetch-Site 时仅接受 same-origin/none。GET 不接受 query/body/带正文传输。body 上限 1 KiB，额外字段和无效 JSON 拒绝；错误仅输出固定 schema/code。
5. `singleHeader` 从真实 rawHeaders 计数，不依赖 Node 合并结果。订单 Cookie 同名重复也拒绝。bootstrap 使用购物车 Cookie/CSRF，revoke 使用独立订单 Cookie/CSRF；exchange 使用一次性 link 与严格 Origin。真实 HTTP 单测在合法 Host/Content-Length 下发送重复 Origin、Cookie、CSRF，未派发业务操作。
6. `__Host-fan-order` 为 Secure、HttpOnly、SameSite=Strict、Path=/、无 Domain；仅已验证 GRANTED 结果才设置 Cookie，revoke 成功时按同属性清除。原始会话值不进入 JSON；CSRF 仅作为响应头提供。错误或异常不签发 Cookie。所有已装配入口含 private/no-store、no-referrer、noindex/nofollow，解析错误和故障响应也保持这些头。
7. 入口在正文解析与凭证授权前独立调用持久限流；scope 分开，使用 TCP 对端地址的 KMS 摘要，忽略任意 X-Forwarded-For。限流拒绝返回 429/Retry-After；限流异常、KMS 异常和不符合 schema 的限流结果返回 503，不能继续业务。Application 独立事务提交计数的实现已由另一非作者复核，本文不把本人 PG 测试重复算作独立证据。
8. 结果经严格 orderAccessResponseSchema 校验，私密额外字段、错误 action、跨订单响应均拒绝。API 没有 payment/PSP/fulfillment 写入口调用；查单不会根据回跳参数推进金融事实。
9. `bootstrap.ts` 使用 `logger: false` 的 Fastify adapter 与已有 allowlist observability。观察路径为 route template，错误 hook 不传原 error；请求上下文只提取合法 request/trace headers，不记录 Cookie/CSRF/body。独立重跑的真实 API logger 测试证明 exchange token/Cookie 未进入记录。外部代理、CDN 和未来 BFF 的日志配置不由这个单测证明，仍须部署验收。
10. `order-access-composition.ts` 在创建持久化前验证完整配置、媒体 origin 与凭证设置；未显式启用时返回 undefined，固定路由在解析凭证前统一 503，缺配置不生成密钥。生产配置要求 storefront Origin 与部署一致。生产装配接入 orderAccessRuntime，构造失败纳入清理；compose 的 stop 缓存同一个关闭 Promise，通用 API 生命周期负责 start/close，重复 stop 不重复关池。

限流使用实际 TCP 对端的共享预算是明确部署边界。经过 BFF/反向代理时不能把每名粉丝错误描述为拥有独立应用层 IP 配额，也不能为了区分访客而信任任意客户端转发头；下一部署检查点需配置可信 ingress 的独立访客限流和合适的 API 总预算。

## 独立验证记录

- `review-api-unit.log`：命令 `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test -- src/order-access-route.test.ts src/order-access-credentials.test.ts src/order-access-composition.test.ts src/order-access-bootstrap.test.ts src/order-access-observability.test.ts`，exit 0。该 package 的 `--` 透传实际执行了完整 API 套件：**62 文件、245 tests PASS**，含全部新查单测试；不把这个结果错误记作仅五个文件。用例覆盖凭证/轮换/CSRF、异常 KMS、隐私、真实重复头、bootstrap、响应身份和生产装配清理。
- `review-api-rate-faults.mjs` / `review-api-rate-faults.log`：通过 tsx 直接导入本轮 API 源码，实际 Fastify inject 四入口；分别注入数据库异常、缺 schemaVersion、拒绝却零等待、允许却正等待、KMS 异常。**20 请求、125 断言 PASS**，每个响应均通用 503、无 Cookie、隐私头齐全，业务调用次数为 0。此探针使用故障 stub，不宣称进行了实际数据库断网。命令：`mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api exec tsx /Users/mario/Desktop/下单/output/checks/p4-05-order-access/review-api-rate-faults.mjs`，exit 0。
- 真 PostgreSQL/S3/独立 TEST PSP 的全链路由协议作者独立运行。六轮开发中的五个失败结果原样保留；第六轮 `run-2026-09-15T13-11-19.689Z/run-result.json` / `http-sixth.log` 为 **6,860 断言 PASS**，本复核已读取结果，`browserStarted=false`，不宣称浏览器验收。最终全仓质量门仍以 root 的 final-verification 为准。
- 最终只读核实 `remaining-gates-result.json`：全部列出步骤 exit 0，且明确 `singleFullCheckPassed=false`。第二候选已有原门 1–30 的证据；最后一处保留期 SQL 窄修后重跑整个 PG 门 14（376.188 秒，含新 13 断言与原并发/验签门）、原 order-payment 门 31（4 短测试 + 6,827 长链断言）、order-access 门 32（7 短测试 + 6,860 长链断言）、TLS S3 门 33（媒体 423 断言）及原质量门 34–40。其余未受该差分影响的早期证据限定范围复用，不能写成一次完整运行或统一最终源运行。
- 已逐项读取 `source-third-delta.json`、`compatibility-and-protection.json`，并独立核对两个最终 manifest 的文件集合、聚合摘要及当前磁盘每个文件：`source-third.json` 与 `source-after-check.json` 均为 **2,070 文件**，SHA `9603ad3c5123470fda4b5e30440eef836a3c049698190b1aa2c772ea693b6dd4`，全部匹配。原 555 合同根、92 API 路径、171 公共组件、54 SQL 和 2,412 个原未跟踪文件的保护结果 PASS。源码差分仅最后保留期表达式、对应实际 SQL 探针与 PG 门注册；其生产修复由 API 作者另行非作者审查，本报告不把本人 PG 修复作为本人独立代码验收。

## S.U.P.E.R

| 项           | 结果 | 依据                                                                                |
| :----------- | :--- | :---------------------------------------------------------------------------------- |
| 1 单模块职责 | PASS | credentials / route / composition 分开                                              |
| 2 单函数责任 | PASS | 传输校验、MAC、装配和清理职责可追踪；未混入金融用例                                 |
| 3 单向依赖   | PASS | Route → Application → port；生产适配器仅由 composition 装配                         |
| 4 无新增循环 | PASS | bootstrap 类型引用为 type-only；运行时接线单向                                      |
| 5 合同校验   | PASS | 配置、命令、请求、结果和 KMS 响应均严格 schema 校验                                 |
| 6 可序列化   | PASS | 跨业务边界仅 JSON 摘要/版本/trace，没有 FastifyRequest/原始凭证                     |
| 7 环境独立   | PASS | origin/TTL/额度/pepper 来源于显式配置，无生产默认密钥或商户号                       |
| 8 依赖声明   | PASS | 复用已声明的 contracts/application/config/PG/KMS/observability/Fastify              |
| 9 可替换组件 | PASS | 凭证通过 KMS port，业务通过 useCases，装配可注入 persistence                        |
| 10 验证      | PASS | 独立 API/故障探针通过；最终真实协议及 40 门差分分段证据已核实，范围与源码来源见上文 |

## 下一 UI 检查点接续清单（只读规划，尚未实现）

现状核对：七语言 `/orders/lookup` 都仍由 `page-factory` 的 unavailable 占位生成；站点导航已经指向该入口。七语言 `/checkout/return` 使用 `checkout-page-factory.tsx` 与 CheckoutClient；回跳仅接 session/attempt 定位符。`checkout-controller.ts` / `checkout-transport.ts` 仍只处理 cart/preflight/checkout/payment，CSRF 只留内存。`payment-status.tsx` 将 SUCCEEDED 显示为处理中的文案，因为目前还没有 canonical order 授权/成功视图。现有 `checkout-proxy.ts` 只允许 cart Cookie 与原 checkout/payment 合同，不支持新订单 Cookie、新查单 API 或其 Set-Cookie。

1. **先独立查单 BFF 与 transport 合同。** 明确仅放行四个新路径，严格 request/response/status/身份匹配、正文限额、超时、no-store、redirect:error。bootstrap 只转发 cart Cookie/CSRF；read/revoke 只转发 order Cookie/CSRF；exchange 不转发无关 Cookie。精确校验 GRANTED Cookie 属性/Expires、revoke clear、CSRF 与 429 Retry-After，禁止泛化为任意路径/任意 Set-Cookie 代理。浏览器只有 HttpOnly Cookie，CSRF 和一次性 token 仅在内存。
2. **接入付款后 canonical 订单授权。** 在成功/等待/需核对状态中，以 bootstrap 返回为准进入订单视图；PSP SUCCEEDED 或 URL 参数都不能直接生成“已完成订单”。已收款但仍待 order application 时保留处理中与明确刷新入口，处理 409/429/503；使用原 checkout Cookie 和恢复所得 cart CSRF。报价过期不能阻止已付款 bootstrap，原 cart 过期必须拒绝。避免每次 render/自动重试反复 bootstrap 而轮换已有效会话。
3. **建立 fragment 交换与丢响应恢复。** 方案按运行手册：原始 token 和非授权 publicOrderId 提示只放 fragment；客户端最早读取并立即 history.replaceState 清除，在清除前不触发分析/第三方请求。失败不能盲目重放已消费 link；收到 Cookie 但丢 JSON 时，仅用已知 publicOrderId 走受保护 GET。提示篡改不得改变授权结果。无 Cookie 且无原有效 checkout 时，显示链接失效/需要新链接；不要虚构本轮尚未实现的邮件重发功能。
4. **订单视图使用历史合同。** 展示购买时艺人/礼物/规格/图片/金额，以及当前 canonical 支付、争议和履约状态；v1 variantLabel=null 时省略规格，不补当前商品信息。按每段历史 locale provenance 设置 lang，DAILY 原文与审批 fallback 不混淆；切语言只换 UI 文案，不改订单原文、币种、金额、商品或支付 attempt。当前 detail 只有状态，没有事件时间戳；若做时间线先补基于事实的合同，不能按状态猜测准备/送达时间。
5. **完成会话结束与异步控制。** 退出撤销经 order CSRF 确认，成功后清除页面私有状态；pagehide/unmount abort、generation 防迟到响应、bfcache 恢复重新授权，复用现有 checkout 生命周期模式。过期/撤销/轮换、错订单、丢 Cookie/JSON、双击与并发、429 等待均要有明确错误/重试/恢复状态，避免把未知提交结果当作未执行。
6. **先失败测试，再真实浏览器。** BFF、transport/controller 与视图状态测试先行；真实 API+PG+S3 链路覆盖七 locale 的桌面 1440×900/手机 390×844，键盘/焦点/错误/reduced motion，CJK、泰语、越南语和长西葡文案；检查 fragment 不留 URL/history/日志/存储/截图、Cookie 属性与 CSRF、源图不泄露、换语言订单不变。手机实机仍需实际连接后另留证据，不能以桌面模拟替代。邮件发送保持 P4-06 边界。

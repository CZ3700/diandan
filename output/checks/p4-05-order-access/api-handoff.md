# P4-05 安全查单 API 子任务交接

## 已实现范围

- 独立 `order-access-credentials.ts`：真实 32 字节随机凭证、canonical base64url 校验，`ORDER_ACCESS_TOKEN` purpose 中分别使用 `ORDER_LINK_V1`、`ORDER_SESSION_V1`、`ORDER_CSRF_V1`、`ORDER_RATE_LIMIT_V1` 前缀。摘要保留 pepper version，最多四版读取；CSRF 使用 timing-safe 比较。raw token 和网络地址只留在传输适配器内存。
- `order-access-route.ts` 四条明确端点：
  - `POST /api/v1/order-access/exchange`：精确 Origin + JSON 中一次性 token，成功设置订单 Cookie。
  - `POST /api/v1/checkout/sessions/:checkoutSessionId/order-access`：已有 cart Cookie + CSRF；已付款资格由 Application/PostgreSQL 判断。
  - `GET /api/v1/orders/:publicOrderId`：仅凭订单 Cookie + publicOrderId 查询；不接受 query 或 body，不调用金融/PSP/通知用例。
  - `POST /api/v1/order-access/revoke`：订单 Cookie + CSRF + publicOrderId，成功撤销后清除 Cookie。
- Cookie 为 `__Host-fan-order`，`Path=/; HttpOnly; Secure; SameSite=Strict`，到期时间来自数据库 grant；不共享 cart Cookie，不返回 raw session 正文。
- `order-access-composition.ts` 实际连接新 Application/PG manager；生产配置仅由显式 `FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON` 启用，KMS 复用部署密钥引用而以 purpose/前缀分隔用途。配置缺省关闭，错误配置拒绝启动。
- `bootstrap.ts` 和 `production-application.ts` 已注册真实路由与生命周期；未配置时四端点在解析输入前返回 private 503，启动失败关闭自有数据库资源。`main.ts` 无需变更。

## 请求保护与错误语义

- 所有响应包含 `private, no-store`、`noindex, nofollow`、`no-referrer`。JSON body 最大 1024 字节，未知字段/非法 JSON/非 canonical token/路径 UUID/query 均拒绝。
- 单 raw header 校验拒绝重复 Origin/Cookie/CSRF；Cookie 内重复订单键拒绝。POST 必须提供精确 Origin；GET 可以没有 Origin，但若提供必须匹配；`Sec-Fetch-Site` 只接受 `same-origin` 或 `none`。
- 在 body 解析及业务授权之前独立提交数据库限流。使用实际 socket peer IP 的 keyed 摘要，不信任 `X-Forwarded-For`。代理部署下，这是 API 所见 peer 的保守限流，精细用户限流需正式可信入口配置，不能把任意转发头当作真实地址。
- 统一不存在/跨订单/过期/撤销拒绝为 `ACCESS_DENIED` 401；Origin/CSRF 为 403。非法请求 400、超大 body 413、未确认付款 409、限流 429 + Retry-After、不可用 503。异常不泄漏内部详情且不设置授权 Cookie。
- Fastify 标准 JSON parser；本轮未单独改变重复 JSON 属性的解析语义，不能宣称拒绝重复属性。生产 `createApiApplication` 使用关闭原生请求日志的既有观测，实际测试证明日志仅含路由模板，不含交换 body/token/Cookie。

## 验证与原失败

- `api-credentials-red.log` 是首轮缺模块 import 失败，未算有效 RED；scaffold 后 `api-credentials-red-valid.log` 为 5 个有效失败，随后 `api-credentials-green.log` 为 5 PASS。
- `api-route-red.log`：6 个有效 RED；`api-route-first-green.log`：6 PASS。
- `api-bootstrap-red.log`：2 个有效 RED（未配置 404 和生产 factory 未调用）；接线后新测试通过。
- `api-composition-red.log`：2 个有效 RED；实际 Application 连接后通过。
- 路径 UUID 原先误归入 503，保留 `api-path-red.log` 的 1 FAIL/6 PASS；前置 schema 校验后 `api-path-green.log` 7 PASS。
- `api-targeted-green.log`：10 文件 30 PASS，包含 18 个本轮测试及旧 cart/checkout/payment 生产接线回归。实际 Node HTTP 重复头以及实际 API logger canary包含在本轮测试中。
- `api-types-first.log`：新测试 fixture 缺品牌 schema 和 exact optional 标注，以及 PG manager 当时尚未构建；`api-types-second.log` 只剩 PG manager 暂缺。PG 装配完成后 `api-types-green.log` exit 0。
- `api-lint-green.log` scoped ESLint exit 0；新文件经过 Prettier。code-simplifier 仅将新 route 错误处理的嵌套三元表达改为明确分支，之后原 30 测试仍通过。
- `api-contracts-build.log` 保留共享 registry 编写中 audience 不匹配的构建失败；由 root 修正后重新生成合同。`api-dependencies-build.log` Application 依赖构建通过；protocol agent 的 `protocol-build-first.log` 25 包构建通过。

真实 PostgreSQL/完整 HTTP 协议与最终全仓门由协调者整合；上述单测和 Fastify 测试本身不替代其证据。

## 恢复与后续边界

- 一次性 token 已消费不能再次签发新 session。若只有成功 Cookie，恢复 GET 仍需要原 `publicOrderId`；四端点没有仅 Cookie 自动发现订单入口。
- 后续 UI/邮件可将非授权的 publicOrderId 作为 fragment 中 scope hint，与 token 一起立即清除；成功只信服务端 grant，丢 JSON 时用已知 hint + Cookie GET 并精确授权。跨订单 hint 仍 401。这是后续设计，不是本轮已完成 UI 或真实邮件证据。
- Cookie 和 JSON 同时丢失且没有仍有效的 checkout 授权时，需要未来重新签发的安全链接；不以重放已消费 token 绕过一次性语义。
- 现有 cart 授权可通过 bootstrap 轮换新访问；实际服务端期限始终重新校验。极短 1 秒 TEST TTL 的浏览器 Expires 秒精度行为留给 UI 真实浏览器门，不声称此次 Node HTTP 已证明浏览器存储行为。
- 不涉及成功页、语言外壳/Timeline、通知、真实商户、生产密钥/部署或资金操作；没有推送或提交动作。

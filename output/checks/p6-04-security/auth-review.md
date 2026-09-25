# P6-04 AUTH / RBAC / CSRF / token / payment 安全复核

审计基线：`e65c9ffde4e9651c7c3b6e86df6426db05fbf410`，工作分支 `codex/p6-04-security`。复核者为本任务子代理，不另行领取 Lane。原始只读授权后，root 明确分配六类 edge 限流修复；本报告范围内产品代码、合同、迁移、业务数据库及原 acceptance 实例未修改。无 push、云 apply、真实 PSP 或真实用户请求。

## 结论与覆盖范围

未在已核对的路径确认 High/Critical 的身份绕过、横向查单、CSRF 绕过、超额退款或支付重放问题。确认 1 项 Medium 资源控制缺口：已批准 CloudFront→private ALB 部署定义原来只有全局 IP 规则，缺少 SPEC §15 的操作差异化保护。购物车与登录挑战的受控复现表明应用自身不限制固定时间内的新对象数量。root 批准的最小修复已添加六类 WAF 配置；**这关闭本地 IaC 配置缺口，不等于已验证云阻断，也不为独立直连 API 增加应用级配额。**

| 攻击面            | 实际信任边界与敏感终点                                                        | 复核内容                                                                                         |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Admin 登录        | Browser BFF → internal access API → OIDC adapter → challenge/session PG       | origin/callback binding、state/nonce/PKCE、issuer/audience/signature/MFA、挑战单次消费、身份映射 |
| Admin 已认证请求  | cookie/CSRF → BFF allowlist → API envelope → PG 授权与业务事务                | body 不能替换 actor/session/action、权限与 locale grant、会话撤销/过期、锁后重新授权、审计       |
| 游客查单          | 链接或 cart/session cookie → purpose HMAC → order access PG                   | bearer 不等于 UUID、publicOrderId 绑定、单次兑换、旧凭据退休、已支付 gate、事务提交的限流        |
| 购物车与支付创建  | cookie/CSRF → cart/checkout/attempt binding → PG/PSP                          | 不可信金额/状态不授予权威、canonical 数据、幂等性、UNKNOWN 恢复边界、请求成本                    |
| 退款与管理重放    | 已认证 finance/exceptions 命令 → 锁定身份/订单/原支付 → receipt/outbox        | 细分权限、expectedVersion、原 capture/币种/account/env、待定退款总额、永久幂等回执               |
| Webhook/reconcile | raw request → endpoint/server config → 验签 → encrypted inbox → effect/ledger | 签名及时间窗、account/env/event 绑定、原始 body、持久化后 ACK、事务内 effect 去重                |

扫描仅作为其他 root 子任务背景，本报告不将依赖审计代替授权路径复核。Next 补丁升级由 root 所属工作负责。

## F-AUTH-01 — 敏感操作缺少独立请求预算

- 严重度：**Medium**。CWE-770 / CWE-400。影响主要是资源、KMS 调用与持久对象增长，并非登录或财务授权绕过。
- 证据：`apps/api/src/cart-route.ts:156` 注册公开 POST carts；`:221–236` 允许无 Cookie 并每次签发新凭据；`packages/application/src/cart-runtime.ts:210–246` 每个新凭据生成新 cartId 并初始化；`packages/persistence-postgres/src/cart-runtime-repository.ts:101–114` INSERT carts。原 `infra/opentofu/modules/edge/main.tf:186–210` 只有无 scope-down 的全局 IP rate rule（此处行号为基线；当前新增规则位于 `:280–387`）。
- 生产可达性：`apps/api/src/production-application.ts:76–98` 在配置存在时组合 cart/checkout/payment/order-access；`cart-production.ts:13–34` 明确没有 cart KMS 配置时不可用，完整配置才启用。攻击前提是被配置启用的 cart 入口及有效 market/currency，普通脚本可提供正确 Origin，故 Origin/Fetch Metadata 不能作为机器人配额。无登录、付款或有效旧 Cookie 前提。
- 原有保护必须计入：8KB body，canonical schema，32-byte 随机凭据，CSRF、PG 事务和全局 WAF。原全局 limit 是必填变量，唯一离线样例为 2000；原代码未指定评估窗口，AWS 默认 300 秒。默认 `waf_enforce=false` 仅 count，true 才 block。不能把当前应用没有 limiter 写成生产完全没有任何 limiter。
- 清理与成本：cart 默认 TTL 为 **24 小时**（`cart-runtime.ts:163`），可注入范围 1 分钟–30 天；`commerce-expiry-repository.ts:98–109` 将对象改为 EXPIRED，不删除记录。每次新凭据会触发 access/CSRF HMAC（`cart-session-credentials.ts:76–83`，每个 pepper version 各两个调用），再执行 PG 查找/插入。TTL 限制有效期，不限制新对象总量。
- 登录同类变体：`apps/admin/src/server/admin-access-bff.ts` begin 不要求已有登录；`packages/application/src/admin-access.ts:100–166` 每次开始写新 challenge；`packages/persistence-postgres/src/admin-access-repository.ts:87–113` INSERT。challenge TTL 30–600 秒，但迁移 `database/migrations/0030_admin-access.up.sql:53–56` 禁止 DELETE/TRUNCATE，未找到保留期清理。**当前 Admin 普通 production composition 没有接入正式 IdP，此变体仅在明确配置的 LOCAL_OIDC/local 验收部署可达，不能据此宣称生产 Admin High。**
- 最小复现：运行下述隔离测试。固定时钟下，100 次无 Cookie login BFF 请求得到 100 个唯一 challenge 持久化调用；100 次全新 cart 凭据得到 100 个唯一 cart 持久化调用。采用真实 BFF/application 实现，数据库/provider 端口仅记录 sink，不访问网络/PG，记录中均为自有 TEST 数据。2 项通过证据在 `auth-review-rate-repro.json`。执行耗时约 40ms/4ms 仅是 unit 时间，不能推导生产吞吐。
- 修复选择：已批准架构让公网必须先进入 CloudFront WAF，最小安全修复为边缘按操作分组，而非对 BFF/ALB 共享 socket IP 施加容易误限的 PG 配额。若以后允许直连或需要精确对象预算，再复用 `order-access-rate.ts` 的独立提交单语句 UPSERT/HMAC 桶模式；需要可信 viewer identity 契约，不能直接信任 X-Forwarded-For。

## 当前修复、入口强制性与边界

`infra/opentofu/modules/compute/main.tf:103–111` 将 ALB 设为 internal；`:217–220` task 无 public IP；`network/main.tf:103–127` 仅 CloudFront origin-facing prefix list/应用 SG 可到 ALB，应用只接受 ALB。CloudFront 使用 VPC origin，并绑定 WAF；ALB 仅 `/api/v1/*` 路由至 API，Next BFF 留在对应前端。以上是源码证明的入口设计，真实 SG/路由/ALB 无旁路仍需云验收。

新增配置为严格六 key `operation_rate_limits` map；每项显式 limit、window_seconds，全局窗口也显式输入；无商户默认阈值。WAF 来源 IP 聚合，每类独立桶，BFF/API 同类合并；ID、Cookie 或路径变化不分新桶。方法精确匹配、路径首尾锚定，经 URL_DECODE/NORMALIZE_PATH。全局规则保留，所有 sampled_requests=false，count→block 继续统一受 waf_enforce 控制。

完整方法/路径覆盖见 `docs/runbooks/infrastructure-offline.md` 新增表格以及 edge 源码 `operation_rate_routes`。涵盖 LOGIN begin/callback/logout；ORDER_ACCESS read/exchange/bootstrap/revoke；CART 初始化、read、items、editor、validate；PAYMENT_CREATE checkout session、attempt、recover；REFUND 两个公开入口；WEBHOOK endpoint。支付只读状态/回跳不被 payment-create 规则误当创建，继续经过全局规则。

[AWS 官方窗口说明](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-high-level-settings.html)定义窗口闭集和默认 300 秒；[官方执行限制](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-caveats.html)明确近似执行、检测传播延迟和改规则后计数重置。此实现不保证精确第 N+1 个请求阻断；保留 staging 下真实请求、PSP 重试、共享 NAT、误限和回退的验收门。

## 已核对并有测试支持的控制

- OIDC：`packages/identity-oidc/src/real-oidc.ts` 固定 issuer/client/redirect、HTTPS discovery、S256/code/RS256、openid-client non-repudiation/signature 检查；验证 state、nonce、PKCE、issuer/azp、exp/iat/auth_time 与明确 MFA ACR/AMR 配置。传入配置被复制冻结。外部 email/IdP role 不授予平台权限，issuer+subject 用域隔离 HMAC 映射。
- Session/CSRF：Admin BFF 严格 configured origin、同源元数据、重复 Cookie 拒绝、HttpOnly/Secure/__Host cookie、恒时 CSRF 对比；只转发 allowlist 操作，API 再验证单一 envelope/body。callback 绑定 login Cookie，challenge 先单次 claim 再 exchange，成功才发新 session/CSRF。logout 确认 durable revoke 后才清 Cookie。
- RBAC 事务：`admin-orders-authorization.ts` 锁 identity/session 与权限/locale grants，敏感路径在等待资源锁后用数据库新时间再次核对 session/MFA/active。finance、payment configuration、exceptions 命令分别要求细分 capabilities；replay 仍经过授权和一致的 request hash/target。未把有格式正确的 UUID 视为权限。
- 查单：`order-access-credentials.ts` 的 LINK/SESSION/CSRF/RATE_LIMIT 目的隔离；PG `order-access-data.ts` sessionDigest+publicOrderId 共同绑定，要求已支付，过期/撤销拒绝；交换更新单次状态与 session/audit 在同一事务，旧会话退休；`order-access-rate.ts` 请求配额单独提交，后续授权失败不会撤消已消费额度。
- 支付与退款：payment-runtime 的 cart/session/attempt ownership 查询绑定；永久幂等键限定 cart/session/request hash。退款锁原 capture/order，限制原币种、商户 account/environment，UNKNOWN/待定退款计入已占用额度；审计与 receipt/outbox 同事务。authenticated reconcile 需持久审计证据，浏览器只读回跳不能确认支付。
- Webhook：原始 buffer 有 49,152-byte 上限；endpoint/provider account/env/key 来自服务端，签名先于 JSON；时间窗、恒时签名、event ID/account/env 一致。加密 raw payload/inbox/job 提交后才 ACK；consumer 将 handler、processed effect 与状态提交同一事务，失败回滚且重放跳过已记录 effect。reconcile/capture/ledger 关联由 schema/migration 与定向测试约束。

## 运行证据与准确计数

全部在 Node 24.20.0。最初默认 Node 26 的 pnpm 命令仅引擎失败、未运行测试，不计作测试失败。锁文件更新期间 pnpm 自动 install 因镜像 tarball 超时退出，未启动测试；root 随后用官方来源恢复。之后本复核使用直接 node vitest，避开自动同步。

| 组                      | 文件数 | 通过测试 |
| ----------------------- | -----: | -------: |
| identity-oidc           |      2 |       75 |
| API routes/credentials  |      9 |       51 |
| persistence             |      9 |       44 |
| application             |     10 |       91 |
| Admin BFF               |      5 |       44 |
| Storefront BFF          |      4 |       48 |
| payment-gateway webhook |      1 |        7 |
| 合计                    | **40** |  **360** |

前次快速汇报的 **170** = 前三组 75+51+44；追加 190 后为 **360 总数**，不是 170+360。依赖恢复后以上 360 再次通过，真实 Vitest JSON 为本目录 `auth-tests-*.json`（含准确实际文件清单，未匹配到的命令参数不算测试）。另有独占复现 2 项、Node IaC/path 工具测试 7 项，不混入 360。

IaC RED：`iac-red/14-stack-test.log`，合法 mock plan，7 pass/1 fail，明确缺少六个操作规则。GREEN：`iac-green/`，bootstrap 1、registry 1、stack 16，全部通过。最终增加资源 scope 内容断言后在 `iac-final/` 重跑，同样全部 18 个场景通过，`result.json` 为 PASS。所有调用均直接 import `checkInfrastructure({root,tofu,evidenceDirectory})`，evidenceDirectory 为本轮 p6-04 新目录；旧 p5-08 仅只读 toolchain/tofu，没有运行默认 CLI 覆写旧证据。

`tofu fmt`、新增脚本 ESLint、Prettier、Node 工具测试通过。全仓 lint/typecheck/build/真实 PG/browser 门由 root 在隔离副本执行；本复核不将轻量 unit 结果冒充真实 PG/浏览器/云验收。

## 可重复命令

独占受控复现（在仓库根目录，无数据库/网络）：

```sh
mise exec node@24.20.0 -- node node_modules/vitest/vitest.mjs run --config output/checks/p6-04-security/auth-review-rate-repro.config.mts --reporter=json --outputFile=output/checks/p6-04-security/auth-review-rate-repro.json
mise exec node@24.20.0 -- node --test scripts/security-rate-limit.test.mjs scripts/check-infrastructure.test.mjs
```

定向既有单测的可运行逐组命令在 `auth-review.json` 的 unitTestRuns；使用 package cwd 和直接 node vitest，避免 pnpm 对变化中的工作区触发自动 install。JSON 保存实际文件清单与数量。

下列既有集成入口由 root 统一调度，创建各自临时 TEST Postgres；启动前应有当前源码构建，不能将历史 dist 当本次源码。**本子代理没有运行这些真实集成**：

```sh
mise exec node@24.20.0 -- pnpm --filter @fan-support/api test:postgres:cart
mise exec node@24.20.0 -- pnpm --filter @fan-support/api test:postgres:order-access
mise exec node@24.20.0 -- pnpm --filter @fan-support/api test:postgres:payment-runtime
mise exec node@24.20.0 -- pnpm --filter @fan-support/api test:postgres:admin-access
mise exec node@24.20.0 -- pnpm --filter @fan-support/api test:postgres:admin-finance
mise exec node@24.20.0 -- pnpm --filter @fan-support/api test:postgres:admin-exceptions
mise exec node@24.20.0 -- pnpm --filter @fan-support/persistence-postgres test:postgres:payment-configuration
```

直接复用已有底层脚本时，需先构建依赖：`packages/persistence-postgres/scripts/postgres-admin-access.mjs`、`postgres-cart-runtime-parameters.mjs`、`postgres-order-access-constraints.mjs`、`admin-finance-integration.mjs`。它们使用 withEphemeralPostgres，不应改为旧 acceptance 的数据库地址。

## S.U.P.E.R 与交付界限

1–2 单一职责：edge 仅请求流量策略；测试只核对路径与部署不变量。3–4 单向依赖/无环：未改变业务分层和 imports。5–6 接口/序列化：OpenTofu typed map+validation，配置和证据均 JSON-compatible。7 环境：无商户/域名/密钥默认值；固定路径是当前仓库 API 契约，非环境/业务配置。8 依赖：未新增依赖。9 可替换：策略局限 edge/stack，业务合同未变。10 测试：上述受影响验证通过，root 总集成仍独立记录。

剩余边界：真实 IdP/MFA、KMS/PSP sandbox、小额资金、staging WAF、网络旁路/共享 NAT/恢复时延均未由本次本地复核证明。挑战保留期及独立直连服务的应用级精确配额仍是明确残余项；不可据此签署 production DONE。

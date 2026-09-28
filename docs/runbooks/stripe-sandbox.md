# Stripe 沙盒验证

本入口只验证现有 Stripe adapter；不会创建本站订单，也不会经过本站 Inbox、Worker、通知和查单。报告始终保留 `siteOrderFlowVerified=false`。本站交易验收另按当前上线计划 L3 进行。

## 本地准备

在项目根目录、Node 24.20.0 / pnpm 11.25.0 下执行。当前 Mac 可在命令前加 `mise exec node@24.20.0 --`；其他环境使用仓库已有 Node 配置。

测试凭据保存在被 Git 忽略的根目录 `.env`，或通过进程环境变量注入（优先于文件）。不要粘贴到聊天、源码或命令参数里：

```dotenv
STRIPE_TEST_SECRET_KEY=
STRIPE_TEST_WEBHOOK_SECRET=
```

API 凭据支持 `rk_test_` 受限密钥或 `sk_test_` 测试密钥，拒绝正式密钥和可公开密钥。受限密钥需具备脚本所用 Checkout、PaymentIntent 查询、退款等权限；配置检查仅核对本地格式，不证明远端权限。Webhook 签名密钥与 API 密钥不同，使用对应 CLI 转发会话提供的 `whsec_` 值。参考 [Stripe API keys](https://docs.stripe.com/keys)。

## 先检查配置（零网络）

```sh
corepack pnpm --filter @fan-support/payment-stripe sandbox:check-config
node packages/payment-stripe/scripts/stripe-sandbox.mjs --check-config --webhook-port 4242
```

只输出缺失/非法变量的名称与状态，不输出值。退出码 0 表示格式齐全，1 表示尚未准备好；不会创建付款、加载 adapter 或联系 Stripe。

## 分级验证

| 命令模式 | 能证明 | 不能证明 |
|:--|:--|:--|
| `--no-wait` | 创建、幂等重放、查询与取消的连接烟测 | 扣款、退款、webhook 或本站订单闭环 |
| 不加参数 | 人工完成托管支付后的 adapter 查询、退款与对账 | webhook 实收或本站订单闭环 |
| `--webhook-port 4242` | 上述 adapter 行为，加本次付款和本次退款的已验签成功回调 | 本站入账、通知、查单与生产收款 |

网络模式先构建依赖及 adapter：

```sh
corepack pnpm exec turbo run build --filter=@fan-support/payment-stripe...
```

完整 adapter webhook 验证需启动 Stripe CLI 转发；选择与 API 凭据相同的沙盒，按 [Stripe CLI 官方说明](https://docs.stripe.com/cli) 登录，或安全注入 `STRIPE_API_KEY` 进程环境变量（不要放入命令参数）。本机已验证可通过 `npm exec --yes --package=@stripe/cli@1.51.1 -- stripe` 临时执行官方 CLI，无需加入项目依赖。CLI 输出的签名密钥保存到本地 `STRIPE_TEST_WEBHOOK_SECRET`；禁止把完整终端输出复制进普通证据，重启转发后核对对应密钥。

```sh
stripe listen --forward-to localhost:4242/webhook
node packages/payment-stripe/scripts/stripe-sandbox.mjs --webhook-port 4242
```

转发与验证脚本分别运行在两个终端。验收完成后停止本次转发；CLI 本地签名密钥不可代替随后本站 API endpoint 的正式签名密钥。

按脚本提示打开 `output/checks/r1-03-stripe-sandbox/` 下的私有链接文件，在 Stripe 托管测试页完成付款；使用 Stripe 官方测试方式，不输入真实卡信息。链接不写入普通日志或 JSON 报告。脚本会对同一笔测试付款执行部分退款及退款幂等验证。

零回调、其他付款/退款的事件、验签失败、金额或币种不符均不能通过 webhook 验收。回调默认最多等待 30 秒，可用 `--webhook-timeout-ms` 显式设为 1–300000 毫秒；超时仍失败，不改写为已通过。`--no-wait` 不能与 webhook 模式混用。

## 如何读结果

- `result` 是本轮整体结果，退出码必须同时成功；不能只挑某条 PASS。
- `evidenceLevel` 区分 `CONNECTION_SMOKE / ADAPTER_TRANSACTION / ADAPTER_TRANSACTION_AND_WEBHOOK`。
- 部分检查成功但整轮失败时，保留实际部分证据，不升级为完整验收。
- 报告不保存秘密、原始 webhook、Checkout URL 或客户资料。
- 取得上述 adapter 证据后，仍须在隔离实例使用本站 API webhook 入口完成订单入账、邮件查单和后台退款；现有公开 TEST 实例不会因填入密钥而自动切换。

本地回归（无 Stripe 网络）：

```sh
corepack pnpm --filter @fan-support/payment-stripe test
```

## 本站完整沙盒链路（L3-04）

2026-09-28 已通过独立实例的本站交易验收：正常后台上传内容，粉丝选艺人/礼物并结账，在Stripe官方托管页测试付款USD48；正式API验签Inbox/Worker关联原订单，邮件查单使用新浏览器；管理中心部分退款USD5，粉丝与管理端状态一致。两种成功回调原签名重放后不重复入账、退款、履约或通知。这里的邮件和身份仍为明确标记的本地TEST服务。

证据是同一订单的分段组合，入口 `output/checks/l3-04-site-stripe/acceptance-summary.json` 与 `independent-l3-04-review.md`。原run的失败和恢复报告保留，最终只读恢复没有再次付款或退款；不能把单个PARTIAL_PASS脱离组合证据当成完整结论。此处不改变上方adapter命令的 `siteOrderFlowVerified=false` 边界。

复验时创建独立 `test-regression-` 实例并显式选择 `--payment-provider stripe-test`，保持单仓库一次一个Next运行实例。官方CLI选择同一沙盒，API只接收当前签名密钥；不复制到Web/Worker，不输出托管URL、客户信息或原始回调。完成后停止专用监听与实例，保留订单和数据库；原体验不迁移、不清空。

托管页测试表单使用逐键输入，并以真实页面字段/提交状态为准；发现hcaptcha脚本或iframe并不代表有可见人工挑战。平台跳转action默认有效期仍为300秒。L3-07复用现有recover入口：过期后先由原账户认证查询同一个PSP会话，再获取当前可用action；原订单、报价、私密应援意图和库存预占均有效时，才保存有界加密授权。粉丝点击“恢复付款”后，再显式继续进入托管页。刷新、切语和响应丢失重试均不得创建另一笔付款；明确失败/取消/过期且服务端允许重试时，页面自动读取当前支付方式，由粉丝再次选择。

本地恢复回归使用独立PG、严格TLS的自有TEST PSP和真实生产Next构建，不调用Stripe或外部邮件：

```sh
corepack pnpm --filter @fan-support/api test:postgres:payment-runtime
corepack pnpm verify:payment-action-recovery:browser
```

浏览器命令覆盖七语言390×844和1440×900，从真实授权到期、恢复、托管付款、原签名回调到Worker入账和查单。原生PostgreSQL可由`POSTGRES_TEST_BIN`指定本机PG18的bin路径。证据写入`output/checks/l3-commerce-recovery/integration/run-*/`；本地TEST协议通过不替代Stripe真实沙盒续接验收，也不改变生产发布门。不要为过期会话直接延长旧URL、修改PSP会话期限或启用会创建新会话的供应商恢复功能。

退款可能先由已认证的PSP响应形成canonical退款事件，后续已验签webhook通过canonical关联去重；应核对原账户/TEST、订单/attempt、退款reference、金额/币种、账本与canonical关联，不能只要求每个回调都有直接attempt association，也不能跳过归属核对。原签名重放必须在有效期内，超期保留缺口，禁止自行重签冒充原回调。

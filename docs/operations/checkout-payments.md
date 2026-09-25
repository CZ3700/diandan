# Checkout 与支付运行时

P4-04 在 P4-03 已创建的订单、报价和库存预占上创建支付。公开入口为 `/:locale/checkout`，支付商回跳为 `/:locale/checkout/return`。页面沿用购物车的受保护会话；刷新和切换语言从服务端找回原结账，不在浏览器持久保存支付链接、邮箱或私密留言。

## 当前交付边界

- 独立 TEST 支付服务使用独立 PostgreSQL 数据库和 HTTPS，通过部署时注册的 payment port 接入。它用于检验两事务创建、断线、进程重启、幂等与受认证恢复，不代表实际支付商 sandbox 或真实收款。
- 收款主体、首发市场/币种、首个批准支付商仍需确定。没有部署注册的 adapter 与有效配置时，生产组合不开放付款能力，不自动使用 Fake。
- 本任务只保存可信成功证据及必要交易流水，并显示确认中。订单 `PAID`、库存正式扣减、通知和安全查单属于 P4-05/P4-06 的完整处理链；浏览器回跳始终没有完成支付的权限。
- 七语言界面文案与合成测试支付配置均不能代替正式人工译审。TEST fixture 的独立审核身份是合成测试身份，证据明确标记 `syntheticReviewOnly`。

## 配置与 adapter

API 使用 `FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON` 声明公开 HTTPS 来源、lease、恢复间隔和动作有效期，使用 `FAN_SUPPORT_PAYMENT_PROVIDER_BINDINGS_JSON` 声明账号、环境、已部署 adapter 标识、七语言映射和允许的托管来源。前台 CSP 的动作来源由 `FAN_SUPPORT_PAYMENT_ACTION_ORIGINS_JSON` 配置。格式以 `packages/contracts/src/payment-runtime-config.ts` 为准。

这些配置只有元数据。实际 provider 实现通过 composition root 的注册表注入，禁止从配置载入可执行代码。商户凭据留在 secret provider 中，不得写入 JSON 元数据、浏览器或测试报告。

可用支付方式还必须通过数据库当前发布的配置、账号健康、商户状态、明确国家、订单市场/币种/金额和浏览器动作支持检查。当前网页支持托管跳转；尚不支持的动作不显示。国家由用户明确选择，语言切换不选择国家或改变交易币种。当前仅开放配置为全量启用的路由；部分比例的灰度配置不会被当作全量启用。

TLS 在反向代理终止时，Next 的内部 `Request.url` 可能使用内部监听地址。内部监听必须仅对可信反代可达；部署入口应覆盖 `Host`、`X-Forwarded-Host` 和 `X-Forwarded-Proto`，分别传递配置的公开 host、同一 host 和公开 scheme，不能追加客户端传入的值。BFF 只接受公开 URL 本身，或三项同时精确匹配配置的代理请求；缺失、多个值或其他域名仍拒绝。这只是公开来源校验，原 Origin、Fetch Metadata、受保护 Cookie、CSRF 和固定路径校验继续执行。

## 付款与恢复

运行时必须同时配置 `FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON`：数组逐一匹配已部署账户和环境，元素符合 `PaymentHealthPolicy`。参数包括版本、固定失败窗口与阈值、暂停时长、探测租期和重试间隔，不包含凭据。它仅显式引导 PostgreSQL 首次建立不可变策略；同版本值冲突、未经发布更换版本或遗漏账户都会关闭该实例的新付款资格。正式阈值须由实际 PSP 验收决定，不直接照搬 TEST 值。

只有受控技术故障累计熔断；拒付、取消、有效空能力与配置错误不作为技术故障累计。普通成功响应不清除窗口，避免迟到响应擦掉新故障。熔断账户停止接受新付款；到期后使用先前真实结账与已发布路由的能力查询上下文进行无资金探测。PG 租期、代际、账户版本及当前配置共同防止过期结果恢复渠道；未知或失效上下文保持关闭。已发出的创建、UNKNOWN 和对账始终使用原账户与原幂等键；健康记录故障不会改写原资金结果或重发创建。

1. 第一事务检查原订单和预占，保存永久请求收据、唯一活动 attempt、固定的 provider 命令及恢复 lease，并提交历史与 outbox。
2. 事务外调用原账号的 `createPayment`，随后用 KMS 加密托管动作。
3. 第二事务按 lease/generation 与原 attempt 精确匹配保存结果。结果不确定时进入 `UNKNOWN`，不另建付款、不自动换渠道。
4. 恢复调度器从 PostgreSQL 获取到期工作。确定未完成的 `CREATED` 仅在原报价与预占仍有效时重发同一幂等命令；过期后转为 `UNKNOWN` 并查询。持久 `UNKNOWN` 只执行有审计的 reconcile。
5. 若经过认证的 reconcile 确认原付款仍等待用户操作，可通过同一 external reference 查询原托管动作，校验身份、冻结语言和允许来源后加密保存。该查询不能确认金融终态。

永久创建收据优先于当前渠道配置读取。同一个幂等键重放原 attempt；同键不同请求拒绝。并发请求发现已有活跃 claim 后只重新读取永久收据，不第二次派发该 claim。普通 GET 和回跳仅查询拥有者可访问的状态，不触发 create 或 reconcile。

动作解密在事务外进行；返回动作前再次核验会话授权、版本和完整记录。原动作过期或支付证据待处理时不返回可点击动作。需要新的 attempt 时，原 attempt 必须有可信失败/取消/到期证据，原订单仍未支付且报价与预占有效；否则要求重新结账，禁止修改历史金额。

## 本地复验

从仓库根目录执行：

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:payment-runtime
mise exec node@24.20.0 -- corepack pnpm verify:payment:browser
mise exec node@24.20.0 -- corepack pnpm check
```

数据库和 HTTP 检验使用本轮独有的临时容器/数据库与 loopback 端口，退出时按精确所有权清理。不要把测试 seed 指向已有业务数据库。不要关闭 trigger、延迟约束或把普通会话切为 replica 来制造通过。

运行结果保存在 `output/checks/p4-04-payment-runtime/`。评估实际证据时分别查看应用层测试、PostgreSQL 提交/回退、独立 PSP 重启、HTTP 协议和浏览器结果；其中任一项通过不能代替其他项，更不能代替实际 PSP、staging 或发布验收。

## 故障诊断

- `TRANSACTION_OUTCOME_UNKNOWN`：从当前结账和永久收据读取原 identity；不得当作已回滚后新建付款。
- `UNKNOWN` / `RECONCILE_REQUIRED`：检查原账号注册、恢复工作和经过认证的 provider 查询。不要解除购物车锁或修改金额。
- `EVIDENCE_PENDING`：可信成功证据已保存，等待完整订单/库存处理；本轮不能人工把它改成 `PAID`。
- 支付方式不可用：检查已发布配置、健康、币种/金额范围、明确国家及动作来源；已有付款继续按冻结的账号恢复。
- 调试只记录稳定错误码、请求/关联编号和允许的 schema 路径。不要输出 SQL 参数、原始支付请求、密钥、完整邮箱或托管动作。

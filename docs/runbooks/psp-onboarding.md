# 新增 PSP 接入与渐进启用（P5-07）

本手册从代码接入走到 sandbox、真实小额支付/退款和 `disabled → internal → 5% → 25% → 100%`。新增 PSP 必须经过部署；管理中心只调整已经部署的渠道配置，不上传或执行支付代码。本手册不选择供应商，不批准商户、真实资金、云部署或生产发布。

当前可重复演练使用 FakePaymentAdapter、仓库的 TLS TEST 网关和真实临时 PostgreSQL。它证明平台接入边界、配置传播和恢复流程，不证明任何真实 PSP、卡网络或 USDT 商户已经可用。P4-04/P5-03/04/05 的外部验收和 Phase 7 发布门继续保留。

每次接入复制[证据模板](psp-onboarding-evidence-template.md)，指定技术、财务、业务/法务、运维负责人和独立复核人。每道门只接受 `GO / NO-GO / 未执行`；有条件或证据缺失即不得进入下一道依赖它的门。本地 P5-07 演练可以完整通过，同时 sandbox、真实资金和发布仍为未执行。

## 1. 商户资格先于渠道启用

以下是本项目的决策清单，不是对任一司法管辖区的法律结论。适用地区和经营主体未确定时，业务/法务不能填写“全球适用”；应继续 TEST 开发并保留生产 NO-GO。敏感商户资料放在受控资料库，仓库只记录批准记录的非敏感引用、日期和负责人。

| 决策门 | 责任人 | 必需证据 | GO 条件 / NO-GO 示例 |
| --- | --- | --- | --- |
| 经营主体、经营/收款国家、实益拥有人、银行账户与 KYC | 业务 + 财务 | 主体决策、PSP 商户审核状态、账户与结算资料的受控引用 | 真实收款账户获准；仅注册 sandbox、资料待审或主体不匹配为 NO-GO |
| 礼物业务性质与商户类别 | 业务/法务 + PSP 商户负责人 | 对“粉丝付款、工作室准备/采购并转交艺人”的书面业务描述、商品限制/MCC/承保确认 | 实际业务获得接受；不能写成未获准的捐款、众筹、储值或分账 |
| 首发市场、付款人国家、币种、支付方式、金额与设备 | 财务 + 产品 | 按商户账户逐项批准的能力矩阵、限制和核验日期 | 所有拟开放组合均有证据；官网支持某国家不等于本商户获准 |
| 退款、部分退款、取消、争议与资金成本 | 财务 + 客服 | 退款期限/费用、拒付响应时限、结算周期、准备金/冻结条件、对账及联系路径 | 团队可承担并执行；不支持所需退款或无法核实 UNKNOWN 为 NO-GO |
| 税务、消费者政策、隐私与跨境数据 | 业务/法务 | 对实际主体/市场的税费及发票方案、条款/退款/隐私批准、保留与删除方案 | 站点、PSP 商户描述和政策一致；不得以测试政策收真实款 |
| 艺人授权、肖像、收货及可能涉及未成年人 | 业务/法务 + 运营 | 授权/隐私/监护与留言审核流程的批准引用 | 覆盖实际经营情形；虚构 fixture 不代替授权 |
| 托管认证与 PCI 责任 | 技术 + 合规负责人/收单方 | PSP 托管集成方式、供应商合规证明、商户适用验证方式和责任记录 | 卡号/CVV/钱包凭据不进入平台；不能仅凭跳转页宣称 PCI 合规 |
| 正式品牌、域名、客服、邮件、七语言支付安全文案 | 产品 + 运营 + 译审 | 已批准配置和内容 revision、独立语言审核引用 | 支付/退款/政策/订单/邮件关键文案齐全；日常内容直接发布例外不适用 |
| 运行与事故处理 | 技术 + 运维 + 财务 | 固定镜像 digest、staging 验收、值班及告警、停止新流量和恢复方案 | 有权限的人能在 60 秒目标内完成配置生效/恢复验证；不能删除旧连接 |

Visa/Mastercard 在本项目中是 PSP 提供的卡网络。要接的是获准的收单/PSP 账户与其协议，不是把卡网络名当成通用商户 API。Visa 官方说明直接 VisaNet 接口面向收单机构、处理机构和获准技术伙伴；Mastercard 对支付服务参与方也有收单注册关系说明。[VisaNet 接入对象](https://developer.visa.com/capabilities/visanet-connect-acceptance)、[Mastercard 支付服务参与方](https://www.mastercard.com/us/en/business/support/payment-facilitators.html)。

托管页会改变平台接触卡数据的范围，但不能单独决定适用 SAQ 或证明平台合规。由收单方/合规负责人确认全部适用条件；嵌入式支付页还须评估对应脚本要求。[PCI SSC SAQ 资格](https://www.pcisecuritystandards.org/faqs/if-a-merchant-s-e-commerce-implementation-meets-the-criteria-that-all-elements-of-payment-pages-originate-from-a-pci-dss-compliant-service-provider-is-the-merchant-eligible-to-complete-saq-a-or-saq-a-ep/)、[PCI SSC 脚本资格说明](https://www.pcisecuritystandards.org/faqs/1588/)。

## 2. 代码接入门

先冻结接口映射和失败测试，再实现独立 adapter 与 endpoint verifier。PSP SDK、原始字段、签名及状态名留在 adapter 内；不修改礼物页面、购物车、订单状态机来适配某供应商。金额和身份从 PostgreSQL 的冻结订单/attempt 取得，禁止信任浏览器或 PSP 自报订单总额。

### 2.1 七个正式操作与独立 webhook verifier

权威接口为 `packages/payment-port/src/index.ts`，跨模块合同为 `packages/contracts/src/payment-port-contracts.ts`。全部输入/输出携带 schemaVersion，可序列化，并严格检查账户、环境、attempt、金额/币种和引用关联。

| 正式操作 | adapter 必须证明 |
| --- | --- |
| `GET_CAPABILITIES` / `getCapabilities` | 返回该账户、国家/市场、币种、金额和设备真实适用能力；无产品可用可返回空列表 |
| `CREATE_PAYMENT` / `createPayment` | 使用冻结 merchant reference、provider idempotency key 和订单金额；托管 action 符合 allowlist；创建响应不直接认定已付款 |
| `GET_PAYMENT` / `getPayment` | 查询原 attempt，不能把普通查询响应或浏览器回跳变成入账证据 |
| `CANCEL_PAYMENT` / `cancelPayment` | 取消请求幂等；已收款/状态不明不伪装取消成功，不提前释放资源 |
| `REFUND_PAYMENT` / `refundPayment` | 全额/部分退款、原币种、原 capture 上限；相同键回放相同结果，同键不同内容拒绝 |
| `RECONCILE_PAYMENT` / `reconcilePayment` | 经认证查询并绑定真实审计记录；无 external reference 时也能从原 merchant reference 找回；证据与原 attempt 相符 |
| `RECONCILE_REFUND` / `reconcileRefund` | 查询原退款/原账户/原键，支持退款 UNKNOWN 恢复；不再发一笔退款来试探 |

`PaymentWebhookVerifier.verifyPaymentWebhook` 是另一个接口，对应 `VERIFY_PAYMENT_WEBHOOK`。它先使用 endpoint 的可信绑定校验原始请求，产生 `VerifiedWebhookEventCandidate`。冻结 v1 的 `VERIFY_AND_PARSE_WEBHOOK` 只用于历史解码和 TEST-only legacy conformance；它不属于正式七操作，也不能挂到生产入口。

至少覆盖成功、明确失败、取消、3DS/本地验证、仅授权未捕获、超时与丢响应。当前 MVP 只允许自动捕获；仅授权保持处理中并对账。增加人工 capture 需要新合同、测试和已批准 ADR，不能在 adapter 中把授权翻译成收款成功。

### 2.2 绑定、幂等和冻结路由

1. 用已部署的静态工厂注册 adapter key/version/protocol。`packages/payment-gateway/src/registry.ts` 校验完整快照并原子切换进程目录，不能以 HTTP 模板或上传脚本接新代码。
2. 将 `providerAccountId + environment` 绑定到唯一商户、API origin、允许托管/返回 origin、七语言映射、adapter 版本和 Secret 引用。不同商户、环境或不可变连接参数需要新账户，不原地改写历史账户。
3. 通过受控服务端 Secret Store 解析凭据；业务表/配置只存引用。TEST 与 LIVE 分离，轮换窗口、旧密钥停止接受时间和负责人有记录，不能让同一引用改指另一个商户。
4. 支付创建的第一数据库事务锁定并重验 P4-03 已创建的 canonical checkout、订单金额快照及预占，保存 attempt UUID merchant reference、provider idempotency key、配置/规则和账户绑定；不重新创建订单/报价/预占。提交后才调用外部创建；第二事务保存外部引用及规范化结果。
5. 创建丢响应或进程中断时恢复同一 attempt、账户、环境和键。`UNKNOWN` 是未决资金，不能重新路由、再建扣款或把库存释放当付款失败。只有可信终态和受控命令满足既有条件时才允许新 attempt；旧已付款不可重试。
6. 退款的 `UNKNOWN` 继续占用退款上限；`successful + pending refunds <= captured amount`。只有可信失败证据才释放该退款额度；取消/退款按钮的“已受理”不是资金终态。

本仓库 `fan-support-gateway-v1` 是自有规范化协议；只有实际实现它的网关才能用 `createNormalizedGatewayFactory`。它不等于 Stripe、Adyen 或其他聚合商的 API。外部幂等记录的保留期与作用域可能不同：例如 Stripe 官方文档说明旧键清理后重用会创建新请求；Adyen 文档列出 7–14 天及不同区域间不共享去重的限制。adapter 必须结合永久平台回执与引用查询证明恢复安全，不能把短期外部幂等声明成永久保障。[Stripe 幂等](https://docs.stripe.com/api/idempotent_requests)、[Adyen 幂等](https://docs.adyen.com/development-resources/api-idempotency/)。

### 2.3 webhook 到可信证据的步骤

1. `POST /api/v1/webhooks/payments/:endpointId` 先从数据库将 endpoint 映射到账户、环境及验签密钥引用；endpoint ID 不等于授权，不能从未验签 payload 选密钥。
2. verifier 接收未改写的 raw body，按该 PSP 官方协议校验签名/时间窗/来源/账户和环境，再输出受限 candidate。签名方案按厂商实现；不能把本仓库 HMAC 算法直接套给其他 PSP。
3. candidate、短期加密原文、inbox/provider event 和仅含 ID 的持久任务同事务提交后才 ACK；verifier 成功或返回 `200` 本身都不能替代数据库的可信 receipt。
4. 以 `(provider_account_id, environment, provider_event_id)` 去重。早到事件用 merchant reference 关联；暂无法关联保留 `UNMATCHED` 等待原 external reference 落库，不丢弃、不抢先入账。
5. worker 由标准化可信事件驱动订单/付款/退款，状态与 outbox 原子提交。连续重复 10 次、乱序、早到、延迟与重放均不得多扣款、多退款、多发货或重复通知。
6. 原文受限加密保存并有 TTL；普通管理中心不提供原文下载。失败重试有上限并进入死信；通过既有安全重放恢复，不清空 inbox/effect/receipt。

官方签名差异例证：Stripe 要求未经改写的 raw body；Adyen 的 Standard webhook 和其他 webhook 的签名位置及计算步骤可能不同。当前 normalized gateway 使用 Standard Webhooks v1 的 `id.timestamp.rawBody` 对称签名形式，不能宣称所有 PSP 都采用它。[Stripe webhook](https://docs.stripe.com/webhooks)、[Adyen HMAC](https://docs.adyen.com/development-resources/webhooks/secure-webhooks/verify-hmac-signatures/)、[Standard Webhooks 规范](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)。

### 2.4 USDT 的额外 NO-GO 门

目前 `normalized-gateway` 工厂只接受 `CARD / LOCAL_PAYMENT`，拒绝 `STABLECOIN`。现有 stablecoin 合同与纯评估函数不是可收款 adapter；报价持久绑定、认证链上入款关联与去重、专属恢复路径仍须另行完成。不能因为工具函数通过就启用 USDT。

- 订单继续保存 ISO 法币和整数 minor units；支付资产另记 USDT、确切 network、token reference、decimals。不同链/token 不互换，不能假设 USD 与 USDT 永远 1:1。Tether 官方按链列出不同标识并单列已弃用协议，实际商户支持和网络状态需要重新核对。[Tether 支持协议](https://tether.to/en/supported-protocols/)。
- quote 必须冻结账户、环境、attempt、quote ID、原法币金额、资产/链/token/精度、应付原子数量、报价开始/到期和最少确认数；数字用十进制整数字符串及 BigInt，禁止浮点、科学计数、截断或隐式汇率。
- 认证观察必须先关联已持久 quote，并根据已去重入款计算总量、首/末入款时间和确认数。两个调用者自报对象相等不构成财务证据。
- 少付、多付、错币、错链、错 token、错精度、迟到和重组进入 REVIEW；确认不足为 PENDING。到期前已足额、到期后仅增加确认与到期后补足是不同情形。
- `MATCHED_EVIDENCE` 仅是评估结果，不能直接写 PAID。退款币种/网络、费用、退回方式、地址核验及异常处理须由批准的商户规则和专属合同覆盖；不自动原路转账或接受任意浏览器地址。

## 3. 本地代码与 conformance 门

从仓库根目录按固定运行时执行。`--plan` 只展示步骤，不提供验收证据；实际运行会建立本次拥有的临时数据库/TEST 服务并清理，不是长期保存运营数据的启动命令。

```sh
mise exec node@24.20.0 -- corepack pnpm verify:psp-onboarding --plan
mise exec node@24.20.0 -- corepack pnpm verify:psp-onboarding
```

可用 `--output` 指定新的证据目录，已有目录会被拒绝；默认目录为 `output/checks/p5-07-psp-onboarding/drill-<时间戳>/`。需用已安装的 PostgreSQL 18 时，设置 `PSP_ONBOARDING_TEST_POSTGRES_BIN` 为其绝对 `bin` 目录；未设置时使用隔离 Docker PostgreSQL。不要指向用户现有数据库或数据目录，不在命令行粘贴凭据。根目录保留 `plan.json`、`result.json` 和各步骤 `.txt` 日志；HTTP 演练另写自己的 `integration-<时间戳>` 目录，位置见 staged-rollout 日志。根报告逐项列出退出码及未执行步骤，首个失败后停止；失败阶段与原日志应保留。

总入口执行构建、fake 的正式共用七操作套件、gateway 测试（包括真实本地 TLS 共用套件和故障 adapter）、正式 webhook verifier 测试，以及真实 PG/双 API 的分级配置演练。共用套件入口是 `packages/testing/src/conformance.ts` 的 `runPaymentProviderConformance`；它校验七个操作、可信付款对账、部分退款、退款重放、同键冲突、超额拒绝及退款恢复。legacy 测试另列，不能替代正式 verifier。

本地分级演练必须核对以下事实，实际通过数量、退出码和源 hash 由报告记录，不预填 PASS：

| 场景 | 必须观察到的结果 |
| --- | --- |
| disabled / 0% | 有效路由仍保留，但新 checkout 无该渠道资格；不是删除历史连接 |
| internal TEST | 在隔离 TEST 账户/环境下演练内部步骤，记录实际账户状态；不声称测试了 INTERNAL 状态或具备生产员工过滤 |
| 5% / 25% / 100% | 真实服务端 checkout ID 驱动两个桶；边界和 PG 准入一致，记录两个比例与实际规则 UUID |
| 七语言/重试/两节点 | 相同 checkout 与规则身份的桶不变，语言不改订单金额、market/currency 或 attempt |
| 发布与回退 | 管理授权/独立译审/校验/原因/确认；两个独立 API 读到新 revision；实际传播/恢复均满足 60 秒门 |
| 停止后 UNKNOWN | 既有 attempt 继续用原账户/环境/幂等键核实；新付款被排除；不增加创建或退款次数 |
| 回退后旧交易 | 回退追加新 publication，历史规则/receipt 不改；旧支付不切到恢复后新路由 |

正式新 adapter 还须用相同 suite 实例化自身，加入供应商专用失败 fixture。既有 fake/gateway 通过不会自动认证新 adapter。生产 conformance 不使用真实资金；sandbox/小额场景另行登记。

最后运行相应质量门并记录是否命中缓存：

```sh
mise exec node@24.20.0 -- corepack pnpm check:dev
mise exec node@24.20.0 -- corepack pnpm check:contracts
mise exec node@24.20.0 -- corepack pnpm check:adapter-boundaries
```

`check:dev` 不包含实际 PG/PSP/browser 验收。付款/管理 UI、托管交互或文案有变化时，另跑受影响真实浏览器检查，至少七语言 390×844 与 1440×900、键盘、错误及 reduced motion；桌面模拟手机不能替代 Phase 7 实体设备。新支付/权限代码须经非作者复核并逐项完成项目技能中的 S.U.P.E.R 十项。

## 4. 获准 PSP sandbox 门

技术负责人取得选定 PSP 的正式官方文档、SDK/API 版本、sandbox 账户和允许能力后，在证据模板登记；外部资料核验日期不能沿用本手册日期冒充再次核查。使用独立 TEST 账户绑定、PSP 测试凭据与官方测试支付资料，不使用真实卡或钱包资金。

1. 在 production-like staging 部署已审查固定 digest，保持公开 LIVE 渠道关闭。验证 HTTPS、endpoint、Secret 注入/轮换、系统时钟、允许 origin、日志脱敏及告警。不要把本地 TLS 进程写成 PSP sandbox。
2. 从真实前台选择礼物→checkout→托管认证→只读回跳→可信证据入账→安全查单。覆盖商户批准范围内每个拟开放支付方式和币种；3DS 挑战、拒绝、取消、pending、仅授权未捕获分别记录。
3. 创建响应丢失、webhook 先到、回跳先到、缺 external reference、签名错误、跨环境/账户、重复 10 次、乱序与迟到全部验证。只有认证且持久证据允许入账；已过期预占遇迟到成功进入 ON_HOLD/人工处理，不静默超卖。
4. 测试全额、连续部分退款和原币种金额上限、同键冲突、退款丢响应/UNKNOWN、可信失败后释放占用。对账核对 capture/refund 交易引用；不得把 PSP“已接受退款”当到账完成。
5. 在退款和 UNKNOWN 尚未终结时关闭新渠道、发布新路由、重启和配置回退，验证原账户恢复。健康熔断只影响新付款；技术故障与业务拒绝区分，安全探测只调用 GET_CAPABILITIES。
6. 在真实管理中心验证发布/回退传播、四类异常处理和最小权限；记录新鲜 MFA、CSRF、原因/确认、幂等恢复与审计。检查 webhook backlog、dead letters 和 UNKNOWN 是否闭合或有明确负责人。

sandbox GO 需要实际 merchant/provider 证据和独立技术/财务复核。平台工具全部绿但某方式不能测试、退款不支持、事件关联不完整或观察不确定时，该方式保持 NO-GO。只能缩小拟启用范围并重新批准/验证，不能伪造支持。

## 5. 真实小额支付与退款门

真实资金只在经营主体/政策/商户资格、sandbox、staging 和当次资金操作授权均已确认后执行；ADR-016 的本地排期不提供该授权。财务先登记付款人、受控内部测试路径、每种方式/币种的金额上限、笔数、手续费预算、退款方案及操作者；不在仓库存放真实付款人资料。

每个首发方式至少取得一笔真实小额付款及退款的完成证据；需支持部分退款的方式另覆盖部分退款后剩余金额。真实卡号/CVV/钱包授权只输入 PSP 托管界面，禁止复制进脚本、截图、工单或报告。

依次核对平台订单金额/币种、PSP capture/退款原生交易引用、验签 inbox 或认证 reconcile、平台不可变回执和订单投影，再由财务核对 PSP 账单/结算或余额记录。费用、结算延迟与退款到账状态如实分开；仅 PSP 接受请求、支付回跳或平台 UI 成功截图不足以 GO。超时、金额差异、重复入账、争议或无法核实资金时停止后续付款并按第 7 节处理。

该门只对实际验收的商户账户/方式/币种/代码配置组合成立。替换商户、网络、捕获模式或影响资金/签名的 adapter 版本时重新评估和验收；不能复制另一个 TEST 或 LIVE 账户的通过记录。

## 6. 分级灰度与配置发布

### 两个独立桶的含义

`packages/domain/src/payment-rollout.ts` 与 PostgreSQL 的 `payment_rollout_bucket_v1` 按 v1 算法，将**已获会话授权的服务端 checkout UUID** 分别与账户 ID、不可变规则行 UUID 计算两个 0–9999 桶。两桶都小于对应已发布 basis points 才具备新创建资格；0 全关，10000 全开。桶只是非保密流量分配，不是身份授权、员工白名单或精确人数配额。

下面以账户比例 100%、规则比例逐级增长表达目标 5%/25%；停止时账户比例为 0%。这是运行方案，必须把实际两个值写入发布证据；保留有效路由并将规则比例设为 0% 也可停止该规则的新流量。若账户与规则都设 5%，交集约 0.25%；都设 25%，约 6.25%。有限样本和其他业务资格会影响实际数量，不能承诺精确百分比。

| 阶段 | 账户 bps | 规则 bps | 进入与退出条件 |
| --- | ---: | ---: | --- |
| disabled | 0 | 10000 | adapter 已部署、连接/恢复可用；有效路由保留；无新付款资格 |
| internal | 10000 | 10000 | 本次演练使用隔离 TEST 账户，按实际账户状态记录。真实 LIVE 内部试运行须先证明环境访问隔离，不能直接向公众全开 |
| 5% | 10000 | 500 | sandbox、小额、内部观察与本阶段批准齐全；按规则限制获准市场/金额 |
| 25% | 10000 | 2500 | 5% 观察窗口与样本达到预先批准门槛，无阻断事件，签署后推进 |
| 100% | 10000 | 10000 | 25% 通过及 Phase 7 相应发布门成立；继续按批准市场范围开放 |
| stop | 0 | 10000 | 事故时停止新创建；保持旧账户/endpoint/回执及恢复路径 |

**代码中的 INTERNAL 不提供 LIVE 员工筛选。** 当前配置校验拒绝 INTERNAL+LIVE；TEST 账户状态也不验证浏览者是不是员工。真实 internal 阶段必须用经过验收的部署/网络/身份访问边界隔离整个试运行入口，同时保留 PSP webhook 的必要受控访问；隔离不存在或未验收就不能执行 LIVE internal。不要发明 `INTERNAL` 灰度 API、根据 locale 限制员工或让浏览器自选 seed。

新 adapter 的正式验收仍应联合检查 API 资格、管理发布、持久准入、账户身份不可变约束和数据库 guard，覆盖错账户/错环境等对抗场景。当前账户身份 trigger 冻结 status/environment，不能假设可把既有 LIVE ACTIVE 账户原地改成 INTERNAL；本轮没有确认该正常链路存在合法绕过路径。TEST 演练不替代新 adapter 与真实商户的对应验收。

相同 checkout/provider/rule UUID 的重试、语言切换和节点切换不重新抽样。发布新配置通常产生新的规则行 UUID；相同人类可读 ruleKey 不保证同 cohort。每次记录 configuration revision、publication ID、ruleKey、实际 routeRuleId 和两个 bps，按当前新规则重新核对；已创建 attempt 始终按永久 receipt 恢复，不读取新桶改路。

### 每一级的操作顺序

1. 发布前填写批准的观察时长、最少样本数、成功率/技术失败/UNKNOWN 阈值和退出负责人。阈值因商户、方式与流量不同，模板不预填生产数值；未定义时不能升级。有意制造的 TEST 故障不混入生产基线。
2. 按[支付设置手册](admin-payment-configuration.md)建立草稿，选择已部署账户，保存完整七语言名称/安全提示及健康政策；新改关键文案由独立审核人批准。只改规则时仅沿用同账户已发布且完全未改的有效审核证据。
3. 检查草稿与真实部署目录、商户资格、健康状态、country/market/currency/amount/device 一致；查看差异。启用配置不能以删除全部有效路由表达停止，应保留有效路由并用 0% 排除新流量。
4. 具备权限的人员提供原因、expectedVersion、幂等键和二次确认，发布不可变 revision。断网/丢响应使用“恢复本次请求”，不能另造键重复发布。
5. 从提交的 publication 时刻到每个独立服务实例读回该配置并表现出新资格为止计时，必须 ≤60 秒。记录默认 10 秒轮询或实际部署值；TEST 1 秒轮询成绩不直接外推生产。
6. 在批准窗口观察分账户/方式/币种/市场的能力曝光、创建数、成功率分母、技术失败、取消/拒绝、UNKNOWN 数量和年龄、退款 pending/UNKNOWN、webhook backlog/延迟/重复、死信、通知失败、传播延迟和健康探测；证据只用允许的聚合维度和安全 ID。
7. 达到样本/时长且无阻断项，由财务、运维和发布负责人签署下一阶段。无流量或样本不足时保持本阶段，不自动升档；任何资金错配、重复副作用或证据不可信立即停止。

## 7. 停止、恢复与异常处理

健康熔断和运营发布是不同机制。技术故障在 PostgreSQL 固定窗口累计；普通拒付/取消或无适用产品不冒充技术失败。恢复探测由已验收的账户/策略版本、代际和租约约束，只使用当前允许且曾由真实结账产生的 GET_CAPABILITIES 上下文；比例为 0 或没有安全上下文时不要随意拼造探测。

| 情形 | 操作 | 必须保留/核实 |
| --- | --- | --- |
| 成功率突降、异常扣款、签名/金额/账户错配 | 暂停升档；发布 0% 并通知当前值班流程 | 新 checkout 被排除；旧 UNKNOWN/退款仍走原账户；技术/财务判断影响范围 |
| 发布或恢复超过 60 秒 | 判本阶段 NO-GO，核查各实例 revision、DB/轮询/目录激活 | 不能仅看 Admin“发布成功”；DB 不可用可能继续保留上份配置，应启动事先验收的入口级停止方案 |
| 新配置有误且旧版本仍满足资格 | 管理中心选择历史版本→检查差异→原因/确认→恢复 | 生成新 publication/健康策略版本；不覆盖旧记录；恢复被拒绝时先查当前资格，不强写 SQL |
| webhook / 死信 | 在“待处理”查看受限详情，按原因/确认重处理原验证事件或原允许消费者 | 保留去重、effect、outbox、lease/generation 和历史；不得编辑/上传原文或清空回执 |
| UNKNOWN 付款/退款 | 使用原账户的认证 reconcile，恢复原操作及幂等键 | 不创建新扣款/退款；退款占用不释放；矛盾证据留 REVIEW |
| 通知失败 | 只对确定失败且符合条件记录受控重发 | SENT/UNKNOWN 不重置；通知失败不回滚付款/履约 |
| 代码回退 | 使用已经验证且兼容当前 schema/回执的上一 digest，按部署 runbook 执行 | 目标 ≤15 分钟另行计时；不得直接 down 非空资金/审计迁移，不卸载历史账户的恢复 adapter |

值班人员通过[异常处理手册](exception-operations.md)、[退款与对账手册](admin-finance-local.md)和[支付健康手册](payment-health-local.md)执行。停止新付款不等于停止 webhook、查询、退款和恢复 worker。事故后先核清所有已发请求与资金，再恢复配置和新流量，保留失败与修复后证据。

若当前数据库不可用导致 0% 发布不能提交，不能宣称“已停用”。应使用预先验收的部署入口级新结账停止措施，并单独验证 webhook/恢复链路仍可工作；该措施、权限和恢复步骤缺失时，正式发布为 NO-GO。本地 P5-07 不声称已经验证真实云入口停止或生产代码回退。

## 8. 证据与维护入口

- 代码依据：`packages/payment-port/src/index.ts`、`packages/payment-gateway/src/{registry,factory,client,webhook,stablecoin}.ts`、`packages/testing/src/conformance.ts`。
- 入账/恢复：`packages/application/src/{receive-payment-webhook,payment-runtime-create,payment-runtime-recovery,admin-finance-runtime}.ts`；数据库与运行时的实际约束优先于 adapter 描述符。
- 配置/灰度：`packages/domain/src/{payment-configuration,payment-rollout}.ts`、`packages/persistence-postgres/src/admin-payment-configuration-publication.ts`、`apps/api/src/payment-configuration-runtime.ts`。
- 操作入口：同一管理中心的“支付设置”“付款与退款”“待处理”；开发流程不能成为第二业务真相源。
- 当次源版本、命令、退出结果、receipt/publication/审计安全引用、故障前后副作用计数、两节点时间和剩余风险写入[证据模板](psp-onboarding-evidence-template.md)及相应 phase。原始失败不覆盖，修正以新运行、新证据追加；用 hash 证明归档文件未变，但 hash 不等于独立批准。

证据禁止包含密钥、授权头、Cookie/token、卡号/CVV、钱包凭据、完整邮箱/姓名/留言、艺人地址和 PSP 原始 payload。真实商户文件及账单在受控库保存，公开或 Git 报告只存必要非敏感引用、脱敏摘要和访问责任人。数据库中的永久审计/幂等回执不可删除或改写；短期加密 webhook 原文仍遵循自身 TTL，不因“永久证据”无限保留。

上文外部官方资料核验于 **2026-09-22**；仅用于说明协议/资格差异，不构成供应商选择或商户批准。每次真实接入重新核对官方版本、账户实际能力和受控商户证据。完整持久本地体验仍以[本地体验交付清单](local-experience-readiness.md)为准，本手册演练不代表长期可用环境或生产上线。

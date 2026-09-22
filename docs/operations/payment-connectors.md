# 通用支付接入与商户配置

本轮对应 P4-04。商城继续使用同一套支付端口、固定订单金额、持久幂等、回调收件箱和认证对账；通用接入模块位于 `packages/payment-gateway`。**尚未接入真实商户，也没有完成任何实际支付商 sandbox 验收。**

## 当前可用范围

| 类型 | 本轮基础 | 取得商户资料后仍需完成 |
| --- | --- | --- |
| Visa / Mastercard | 明确卡网络配置；仅 PSP 托管跳转、PSP 管理 3DS、自动捕获模型；统一创建/查询/取消/退款/对账端口 | 收单机构/PSP adapter 的官方字段映射、授权与捕获区别、商户允许卡网络、真实 sandbox |
| 聚合支付 | 已部署工厂注册、版本化账户连接、HTTPS 请求、严格响应关联、回调验签、凭据解析 | 该平台的认证、签名、金额单位、状态、退款和查询协议映射及真实验收 |
| USDT | 独立资产/网络/token/精度/确认数配置；报价、观察和异常评估；精确原子金额运算 | 保存并冻结该商户的真实报价，建立去重入款与持久 attempt 的关联，专用 adapter 与网络验收 |

Visa/Mastercard 是卡网络，并不是两套所有商户通用的收款 REST API。聚合平台也各有协议。`fan-support-gateway-v1` 是本仓库定义的**规范化网关协议**，不是对 Stripe、Adyen、NOWPayments 等现有 API 的兼容声明。只有实现该协议且通过验收的网关才能使用本轮 HTTP adapter。新厂商协议仍需仓库代码、部署和 conformance；不能上传脚本或动态执行 HTTP 模板。

USDT 通用数据合同可供后续专用 adapter 使用。当前规范化 HTTP adapter 只注册 CARD/LOCAL_PAYMENT，主动拒绝 STABLECOIN 连接；不能凭一个厂商 `finished` 或自报法币金额就认定 USDT 足额付款。没有开通的支付方式不会由连接配置自动变为前台可用。

## 配置如何更新

`createPaymentConnectorRegistry` 只接收编译部署的工厂。`applyPublishedSnapshot` 接收可信服务端读取的、已经发布的完整配置投影，先校验并构造全部新增账户，全部成功后才切换可见目录。运行中的支付用例通过 `providerDirectory` 读取目录，无需重建订单或清空历史付款。

- PostgreSQL 的账户、已发布规则、健康状态与能力判断仍决定是否可以发起新付款。注册器既不批准商户，也不代替数据库配置发布流程。
- 同 revision 的相同内容可重放；相同 revision 的不同内容、倒退 revision、未知 adapter/version/protocol、重复账户和非法配置会被拒绝。
- 完整快照必须保留历史连接。账户的 merchant、环境、协议版本、API origin、允许的托管 origin、语言映射及 Secret 引用不可就地改写。换商户或协议应新增账户；新路由使用新账户，旧订单继续查询旧账户。停用新付款通过 PostgreSQL 发布路由处理，不能删除旧恢复连接。
- Secret 由服务端 `GatewayCredentialResolver` 在调用时解析。请求与回执绑定账户、环境、用途、引用，回执有独立版本。Secret Store 可在同一引用背后轮换凭据；所有进程从该服务端来源重新读取，不把明文放进配置文件、数据库业务列、前端、日志或错误响应。
- 注册器是可重建进程投影；重启后必须重新装载同一份完整已发布快照。它不负责持久发布、授权、审计或多进程广播。P5-05 已完成管理中心规则草稿、验证、发布/回退与多进程传播，见[支付设置手册](../runbooks/admin-payment-configuration.md)。商户凭据录入、Secret 写入和真实商户连接测试仍待具体接入；不存在“上传配置即可真实收款”的公共端点。

`secret-ref:v1` 的 `v1` 是引用格式版本，并非密钥版本。回调旧密钥和新密钥可在 Secret Store 的短期轮换窗口并存；窗口结束后应只返回仍有效的密钥。引用不允许改指向另一个商户。

## 后续商户与凭据录入约定（尚未实现）

沿用用户要求的简单管理中心，不让运营编辑这份 JSON 或协议模板。取得真实商户资料后，界面仅暴露选择已支持渠道、商户号/所需凭据、测试连接、启用/停用和配置历史；测试通过后走服务端授权的持久发布流程。Secret 写入受控 Secret Store，PG 只保存引用。协议版本、网络/token 校验、locale 映射、endpoint 与托管 origin 白名单由部署配置和已批准适配器处理，不能以简化表单为由省略验证。此段仅是商户/凭据录入的续作约定；现有规则设置沿用同一管理中心。新增渠道的完整接入与验收步骤见[PSP 接入手册](../runbooks/psp-onboarding.md)。

## 规范化网关 v1 协议

部署配置：固定 HTTPS `apiOrigin`、商户标识、账户/环境、完整七语言 mapping、托管页面 origin 白名单、返回 origin、超时和支付方式配置。没有用户传入的完整请求 URL。

HTTP 请求为 `POST /v1/payment-commands`，`Content-Type: application/json`、`Authorization: Bearer <resolved credential>`；变更操作携带原命令的幂等键。正文：

```json
{
  "schemaVersion": 1,
  "protocol": "fan-support-gateway-v1",
  "merchantAccount": "configured-merchant",
  "command": { "schemaVersion": 1, "operation": "GET_CAPABILITIES" }
}
```

上面的 command 仅展示结构。创建请求还包含从固定连接中按 paymentMethod 取得的 `instrument`，能力查询包含固定的 `instruments` 列表；CARD 的品牌、PSP 管理 3DS 与自动捕获要求随该 profile 传给网关，网关必须据此实现或拒绝该能力，不能忽略。浏览器不能覆盖这些字段。实际 command 必须满足 `PaymentPortCommand` 的完整对应操作合同，且只接受以下七个操作：`GET_CAPABILITIES / CREATE_PAYMENT / GET_PAYMENT / CANCEL_PAYMENT / REFUND_PAYMENT / RECONCILE_PAYMENT / RECONCILE_REFUND`。响应必须是 HTTP 200 JSON 的完整 `PaymentPortResponse`，其账户、环境、attempt、金额/币种、引用与原命令严格匹配。创建不能直接返回成功支付；托管跳转只能来自允许的 origin。

网关实施者必须持久保存变更幂等记录和原请求摘要，拒绝同键不同请求；`DURABLE` 表示该协议没有自动过期后重新创建的窗口。按 merchant reference 查询必须可用于无 external reference 的认证对账。描述符只是声明，实际保证仍要独立验证。厂商原始幂等期限短于本协议时，不能简单透传冒充永久保证；须在该厂商 adapter/网关内正确处理幂等与恢复。

客户端不自动重试或跟随 HTTP redirect。网络断开、超时、非预期状态、超大/畸形响应与错关联的变更结果均不能当作明确失败后再扣一次，而是进入待对账。查询失败不产生新的创建。响应正文与凭据不会出现在异常消息中。

## 回调与财务权威

本协议采用 Standard Webhooks v1 的对称签名形式，独立于各 PSP 原生验签方式：

- 头：`webhook-id`、Unix 秒 `webhook-timestamp`、`webhook-signature`；签名项为 `v1,<base64>`，允许轮换窗口多个签名。
- 待签内容是 `id.timestamp.` 加**原始正文的字节**，HMAC-SHA256；Secret Store 返回 `whsec_` 前缀的 base64 密钥。先验证签名、时间和绑定，再解析 JSON，不排序或重新编码正文替代验签。
- 正文为 `{ schemaVersion: 1, protocol: "fan-support-gateway-v1", providerAccountId, environment, candidate }`，candidate 满足 `VerifiedWebhookEventCandidate`，`candidate.providerEventId` 必须等于签名保护的 `webhook-id`。
- verifier 的 endpoint/account/environment/key-reference-hash 必须匹配已配置入口；它只输出经过验签的候选证据，不写订单、不去重替代 inbox、不发货。原回调持久收件箱、认证对账与订单事务仍承担最终权威。

公开浏览器回跳仍然只查询，不能把订单改成 PAID。P4-05 的成功/库存/查单通知闭环不属于本轮接入基础。

## USDT 评估规则

订单金额保留 ISO 法币与整数最小单位；USDT 是独立支付资产，不塞进三字母 `currency`，不假设 USDT 与 USD 恒定兑换。应付和实付使用十进制整数字符串表示原子数量，转换只使用 BigInt，禁止浮点、科学计数、超精度截断和负数。

每份 quote 固定账户、环境、attempt、quote ID、原订单金额、资产/网络/token/精度/确认门槛、应付数量和有效期。认证 observation 应包含该 quote 关联且去重后的总额、首笔/最后一笔入款时间、最少确认数和重组事实。调用者必须先从持久事实核对 quote；两个自报对象彼此相等不构成可信证据。

少付、多付、错币、错链、错 token、迟到款或重组都返回 `REVIEW`；确认不足返回 `PENDING`。有效期内足额入款、有效期后仅新增确认可以匹配；过期后补足不能匹配。精确匹配只返回 `MATCHED_EVIDENCE`，不会产生 `SUCCEEDED/PAID`。重组后须重新评估，不把先前匹配视为不可撤销终态。

## 官方依据（查阅于 2026-09-09）

- [EMVCo 3DS 已发布 2.3.1.1 规范资料](https://www.emvco.com/dynamic/emv-3-d-secure-whitepaper-v2/3-d-secure-documentation/3-d-secure-specification-v2-3-1/)；不把 2.4 draft 宣称为成熟发布版。实际挑战、豁免与卡信息由 PSP 托管实现。
- [PCI SSC 文档库](https://www.pcisecuritystandards.org/document_library/)列出 PCI DSS 4.0.1；托管跳转不等于可以宣称本平台已取得 PCI 合规认证。
- [Stripe 幂等请求](https://docs.stripe.com/api/idempotent_requests)与[Adyen 幂等请求](https://docs.adyen.com/development-resources/api-idempotency/)显示保存期限与账户/区域作用域不同；不能把各平台外部幂等当作本地永久回执。
- [Stripe raw-body 验签](https://docs.stripe.com/webhooks/signature)、[Adyen HMAC 验签](https://docs.adyen.com/development-resources/webhooks/secure-webhooks/verify-hmac-signatures/)和 [NOWPayments IPN](https://nowpayments.zendesk.com/hc/en-us/articles/21395546303389-IPN-and-how-to-setup)是不同协议；本仓库网关采用[Standard Webhooks v1](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)。
- [Tether 支持的协议](https://tether.to/en/supported-protocols/)与 [NOWPayments 支付状态](https://nowpayments.zendesk.com/hc/en-us/articles/18395434917149-Payment-statuses)用于明确多网络、部分支付和商户状态配置的边界；本项目不据此自动开通任何网络。

## 验证入口

执行环境固定为 `mise exec node@24.20.0 -- corepack pnpm ...`。本轮定向测试是 contracts 的 `payment-connector/payment-stablecoin`、payment-gateway 全部测试、application 的 `payment-runtime-directory`、API 的 `payment-runtime-composition`，以及 adapter 边界检查。原整仓 `pnpm check` 继续保留 PostgreSQL/HTTP/TLS S3 和完整质量门。最终实际命令、退出码、源摘要及余项见 `output/checks/p4-04-payment-connectors/final-verification.md`，不要把本地 TLS 夹具称作真实 PSP sandbox。

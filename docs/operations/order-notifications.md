# 订单通知与到期清理

P4-06 为已付款订单提供付款确认、开始准备和确认送达三类事务邮件。PostgreSQL 保存事件、历史内容、发送版本、重试和失败记录；Worker 使用持久 Outbox/pg-boss 调用邮件适配器。当前仅有本地 TEST 接收器证据：不会向真实收件箱发送邮件。邮件服务商、发信域名与人工译审仍是正式启用条件。

## 历史内容与语言

- 邮件使用订单的 `presentation_locale`，支持七种首发语言。商品、艺人、规格名称来自购买时快照，并保留各自原文语言。
- 每个事件只创建一条订单通知。渲染版本包含七语言正文、布局、变量规范和摘要规则的摘要，已经发出的版本必须保留；发布新文案应新增版本，不能覆盖旧渲染器。
- subject、preheader、HTML、text 和变量都有合同验证。最多展示前十个订单项，超出部分显示本地化余项数量；总额始终是完整订单总额。
- 准备和送达邮件描述已经发生的事实，当前状态由查单页显示，不推测时间或服务承诺。
- `incidentFallbackLocales` 只影响新创建的通知：指定语言发生事故时整封采用英语，原请求语言仍保留；数据库保存原因，Worker 发出 `NOTIFICATION_LOCALE_FALLBACK`。重试沿用原版本和语言。
- `packages/i18n/src/notifications/` 中全部 review manifest 当前为 DRAFT。生产装配要求全部 APPROVED，匹配内容/变量摘要、译审人及批准 commit；TEST 模式不能绕过生产装配。

## 查单与隐私

邮件链接指向 `/:locale/order-access#token=…&order=…`。前台现有专用入口立即清除 fragment，再执行一次性 token exchange。邮箱、完整邮件和原始 token 仅存在瞬时解密/发送输入中，不写入 Outbox、日志或通知表。

Worker 在独立事务提交收件人访问审计后才调用 KMS 解密。通知冻结收件人的 lookup HMAC/版本，发送前再次检查保留状态与身份。通知 token 使用固定 nonce、通知 ID、固定 KMS 版本和隔离用途前缀重现；数据库只保存 keyed digest，重试不会生成另一条不同链接。

同一订单按付款→准备→送达顺序处理。新通知只轮换旧的活动邮件链接，不撤销已经建立的浏览器会话；粉丝应使用最新邮件。付款浏览器的 checkout bootstrap 使用独立 `CHECKOUT_BOOTSTRAP` token，同事务消费，既不占用活动 LINK 唯一槽位，也不使邮件失效。显式签发/撤销接口继续保留其原权限语义。

模板渲染和收件人解密在轮换旧链接之前完成；模板不可用时不撤销已有可用链接。UNKNOWN 发送后的已消费链接允许使用同一命令查询原接收回执，不能重新激活 token。

## Worker 配置

未提供 `FAN_SUPPORT_NOTIFICATION_CONFIG_JSON` 时通知消费关闭；到期清理仍运行。生产配置会在分配数据库/队列之前验证，任何不完整或未批准模板配置使装配失败。发信凭据通过服务端环境引用解析，推荐使用 `MAIL_GATEWAY_CREDENTIAL` 等非 `FAN_SUPPORT_` 业务配置前缀的变量名，不把 secret 写入 JSON。

通知配置的字段由 `apps/worker/src/notification-config.ts` 校验：

| 字段 | 含义 |
|:--|:--|
| `schemaVersion` | 固定 1 |
| `siteName`, `publicStorefrontOrigin` | 实际站名和 HTTPS 前台 Origin，必须与部署、查单配置一致 |
| `profiles`, `activeProfile` | 保留的邮件网关配置及新任务采用的配置名称；旧任务按其冻结 hash 找原配置 |
| profile `protocol`, `environment`, `apiOrigin` | `fan-support-mail-v1`、TEST/LIVE、HTTPS 网关 Origin |
| profile `fromEmail`, `fromName`, `replyToEmail` | 经审核的发信与回复身份 |
| profile `timeoutMs`, `idempotencyRetentionSeconds` | 总请求截止和网关保证的去重保留时间 |
| `credentialEnvironmentVariable` | 对应 profile 的服务端凭据变量引用 |
| `linkPepperVersion`, `acceptedPepperVersions` | 与既有 checkout/order-access KMS 版本集合一致 |
| `linkTtlSeconds`, `leaseSeconds`, `retryDelaySeconds`, `maxAttempts` | 受限链接、租约与重试预算；profile 请求截止须短于租约 |
| `incidentFallbackLocales` | 事故期间允许整封英语回退的语言，英语本身不可列入 |

全部活动和保留 profile 的凭据在启动时校验并固定；缺失或非法凭据直接拒绝启动，凭据轮换须重新装配/重启 Worker。

Worker 复用既有 `FAN_SUPPORT_CART_KMS_*` 密钥引用和 SDK 凭据链；需要 `FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON`。旧 profile、旧渲染版本与旧 KMS 版本必须保留至相关通知和链接不再需要，不能通过修改旧 profile 或换供应商重试 UNKNOWN 发送。

## 网关协议与重试

这是仓库自有的网关协议，并非任意邮件厂商都实现的标准 API。未来接入厂商时需要实现并验收接收端，尤其是接收去重与实际投递副作用的一致性，不能仅用 HTTP 成功模拟真实投递。

`POST /v1/notification-commands` 使用 HTTPS、服务端 Bearer 凭据和 `Idempotency-Key`，固定正文包含 profile hash、发信身份及严格通知合同。网关回执须回显通知 ID、幂等 key、请求 hash、profile hash；适配器拒绝重定向、超大/无效响应和超时，整个请求/读取共用截止时间。`SENT` 仅表示网关 `ACCEPTED`，不表示收件箱已收到或粉丝已阅读。

每条命令携带不可变 `dispatchNotAfter`，由创建时冻结的 profile 去重保证推导。接收端在该时刻之后不得创建新的发送，只能返回仍保留的原回执；成功回执的 `acceptedAt` 必须早于截止。这能防止最后一次在途请求跨过接收端去重保留窗口后被当成新邮件。

未知结果只能重放同一网关、同一 key、同一正文。数据库 lease 串行化同一通知，失去 lease 的执行者不记结果；进程中断后以 UNKNOWN attempt 恢复。最大次数、固定截止、已撤销/过期链接或内容漂移均转为可见失败，发送前真正失去锁则安全跳过。失败原因与 UNKNOWN 尝试保留，后续运营待办/受控重发属于 P5。

通知的 `NOTIFICATION_FAILED`、`NOTIFICATION_RETRY_SCHEDULED` 和 locale fallback 日志只带稳定错误码；维护任务另有 `NOTIFICATION_MAINTENANCE_FAILED` 与 `COMMERCE_EXPIRY_FAILED`。日志中禁止放邮箱、邮件内容、凭据、provider 原始异常或用户留言。

## 到期与支付竞争

清理使用数据库当前事实，按 cart→order→attempt/intent→库存余额与预占的既有顺序加锁，遇到持锁支付操作延期。每个购物车独立事务，失败不会中断整批。

- 活动购物车及未下单 intent 真正到期后标记 EXPIRED。
- 报价已过期且没有可能成功的 attempt 时，取消待付款订单、相关 intent 和 checkout，并按账本释放预占；不会重新启用旧购物车。
- CREATED、REQUIRES_ACTION、PROCESSING、SUCCEEDED 不因普通清理被取消。UNKNOWN 仅可到期其真实已到期的库存预占，订单/购物车/intent 继续保留，等待可信对账。
- UNKNOWN 的资源已经过期时，认证查询不能重新开放付款入口或把 attempt 恢复到可付款的非终态；仍可保存查询证据并继续对账。
- 迟到成功继续记录真实 PAID，库存不足时进入 ON_HOLD/人工核对，不能为了清理而丢弃到账证据。
- 到期 order token/session 标记 EXPIRED，已有请求仍逐次校验有效性。状态清理不会将加密历史假称为已经执行个人数据删除。

0029 新增运行记录、收件人访问凭据及约束，不修改旧迁移。回退拒绝丢失已经产生的新通知/授权历史；不要删除审计或绕过 trigger 来执行降级。

## 验证入口与范围

使用锁定 Node/pnpm 环境，运行 `pnpm --filter @fan-support/persistence-postgres test:postgres:notifications` 验证实际通知链路，运行 `pnpm --filter @fan-support/persistence-postgres test:postgres:commerce-expiry` 验证实际到期竞争（包含 UNKNOWN 支付恢复和提交时截止探针）；根 `pnpm check` 已包含这两项。

可重复检查包括通知合同/历史模板单测、真实 PostgreSQL/TLS TEST 网关、持久队列、邮件链接浏览器和真实过期竞争；具体命令、时间、源文件摘要与失败修复记录见 `docs/progress/phase-4-commerce.md` 及 `output/checks/p4-06-notifications/`、`output/checks/p4-06-commerce-expiry/`。

Quality CI 执行预算为 45 分钟：上一轮完整本地检查已耗时 1737.580 秒，本次额外加入两个到期夹具与通知整合，每个实际运行约 2 分钟。原检查项全部保留，Security 仍为 20 分钟；该预算不代表远端 CI 已通过。

本地 TEST 网关持久化接收回执，用独立进程重启、丢 HTTP 响应、并发和真实截止测试副作用。它不执行 SMTP/真实服务商投递，不能替代 SPF/DKIM/DMARC、真实邮箱客户端、退信/投诉、人工译审、云 KMS、商户、staging 与生产验收。

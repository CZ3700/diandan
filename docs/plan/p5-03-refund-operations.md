# P5-03 本地实施与验收边界

基线：`17b7230`。执行：Codex `/root`，Lane A；依据 ADR-016 消费 P5-01、P4-05、P4-04 已独立验收的本地接口。一个 Task，三个独占目录的助手；不同时领取 P5-05。

## 交付路径

现有管理中心 → 订单详情资金面板 / 对账列表 → 独立 Admin Finance API → 应用编排 → PostgreSQL 事务端口 → 原账户 PaymentProvider。不增加另一套管理系统、不更改艺人/礼物上传流程、不添加新的财务角色。

- 读取沿用当前平台 `orders.read`；退款、取消、人工对账必须具备 Manager 的 `finance.manage`、有效 MFA/session、同源/CSRF、原因、明确确认、版本与幂等键。
- 新的 `admin-finance` 公共和内部合同保持既有 659 个定义兼容。普通 DTO 不含 provider 凭据、私密留言、完整署名或邮箱。退款币种固定为 capture 币种，金额为整数最小货币单位。
- 管理命令先提交永久收据与工作记录。退款 REQUESTED、派发 SUBMITTING 和后续结果分别在合法事务内落地；外部 HTTP 不占数据库事务。
- provider-facing refundReference 固定为本平台 refundId，沿用已有七操作合同。PSP 原生交易号仅来自标准证据的 transaction 字段。
- 订单存在 OPEN/LOST 拒付时，管理中心暂不申请额外退款，要求通过原支付渠道处理；WON 后仍依全部余额/权限规则。此通用保守策略用于避免拒付扣回与退款叠加，不代替商户政策或选定某个 PSP。参考 [Stripe 官方争议处理说明](https://support.stripe.com/embedded-connect/questions/how-disputes-work?locale=en-GB)（2026-09-22 查阅，正式争议开启时不能绕过争议流程另行退款）。
- 已接收/丢响应/超时均不等于已退款。只有验签 webhook 或经认证、审计的 reconcile 推进金融结果；UNKNOWN 持续占用金额且只核对原退款，不自动再申请退款。
- 所有非 FAILED 的退款占用 capture 与订单行金额。创建时重查完整集合和行分配，不能仅校验 UI 提供的余额。
- 支付取消意图先持久化、阻止新收费尝试；只按可信结果释放资源。取消与收款竞态中，成功收款保持成功并明确提示需要退款处理。
- 退款/拒付独立投影；成功 payment attempt 永远保持 SUCCEEDED。早到、迟到、重复及矛盾证据必须可诊断，不凭空补造中间 provider 事件。
- 接口返回收据仅表示提交已接收。界面随后读取真实状态；网络错误重放原请求/原键，已受理的未知结果使用核对入口。

## 目录归属

| Owner | 实施范围 |
| --- | --- |
| root | contracts / persistence-port、OpenAPI / artifacts、集成协调、最终回归与交接 |
| refund_persistence_audit | postgres finance repositories、0035 新迁移、可信 ledger/canonical 接线与 PG 验证 |
| refund_runtime_audit | application finance、API/worker 生命周期、独立 TLS TEST PSP、HTTP 协议验证 |
| refund_admin_audit | 管理中心 finance UI/BFF、七语关键文案与审核清单、实际浏览器验证 |

共享合同先冻结再消费；旧迁移不改、根 lockfile 不改。需要扩展共享合同必须先协调 root。

## 验收矩阵

1. 合同拒绝多余字段、假确认、错币/小数/负数、重复行、分配不等；公开文档完整声明认证、权限、幂等、版本、原因和确认。
2. 实际 PG：全额/部分/多行、并发同键和不同键、金额上限、FAILED 释放和 UNKNOWN 保留；审计/outbox/永久收据同事务，租约过期与旧结果 fencing。
3. 实际 HTTP + 独立 TLS TEST PSP：原账户取消、退款、对账；丢响应、重启恢复、签名事件、相同交易多个证据来源、乱序和矛盾终态。
4. 授权：Operator 只读、Manager 变更、撤权/过期/MFA/CSRF、相同键不同请求冲突。
5. 浏览器：七语言、390×844 与1440×900、金额输入、确认、加载/空/错误、键盘与 reduced motion、axe；不截图私密内容。
6. 原支付/订单相关回归、format/lint/typecheck/build、迁移与 artifacts freshness、秘密扫描、保护清单核对、非作者复核与 S.U.P.E.R 十项。

实际商业 PSP sandbox refund、正式商户/消费者政策、真实资金、staging、云 apply 与生产发布仍保留为外部验收。本地 TEST 不能冒充上述结论；本轮本地提交，不 push。

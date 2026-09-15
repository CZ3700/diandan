# 订单付款证据应用

本入口属于 P4-05 本地开发。P4-04 负责持久化验签回调或认证查询证据；本检查点负责把证据应用到既有订单、支付尝试、购物车、私密意图与库存，并留下永久回执。安全查单服务端接续见 [查单运行手册](order-access.md)；成功页和事务邮件分别在下一 UI 检查点及 P4-06 接通，当前界面仍显示付款确认中。

## 运行链路

1. API 通过已配置 endpoint 验签，保存加密原始正文、来源事件、inbox 和持久队列引用。
2. Worker 的 `PAYMENT_STATUS` handler 仅传内部证据行 ID，所有账户、金额、币种及关联事实由 PostgreSQL 重新读取。
3. 处理器与 inbox 使用同一个事务。成功应用一次性提交订单、attempt、意图、库存流水、历史、审计、Outbox 及应用回执。异常整体回滚。
4. Worker 每轮维护扫描尚无最终回执的持久证据，覆盖认证 reconcile 及暂未关联的早到回调。每个事件单独事务，某一项失败不阻止本批其他项。

付款创建/查询的外部网络调用继续在事务外。P4-04 的证据接收事务先提交；P4-05 另启应用事务，保留原 EVIDENCE_PENDING 收据。已有最终应用回执后读取 canonical 状态，不篡改旧接收事实。

## 结果与恢复

| 结果 | 含义与处理 |
|:--|:--|
| APPLIED / PAID | 可信收款与订单、库存等业务效果已同事务提交。 |
| APPLIED / PAID_REVIEW | 已核实收款，原预占已释放/过期；保留付款成功，履约 ON_HOLD，待工作室处理。 |
| APPLIED / FAILED_RELEASED | 明确失败/取消/过期的可信证据已处理，释放属于本次失败且仍可释放的资源。 |
| ALREADY_APPLIED | 永久收据重放，不重复库存或通知事件。 |
| UNMATCHED | 外部引用尚未绑定；无终态回执，后续扫描恢复。inbox handler 抛出可重试失败，不能当作成功处理。 |
| REVIEW | 证据或状态有冲突，保留永久原因记录供后续运营处理，不能自动再次付款。 |
| IGNORED | 非终结或已被后续状态覆盖的观察，保留明确原因。 |

按单准备的礼物按保存的独立库存策略处理，没有现货余额也可正常结算；不能伪造库存。限量礼物只转换其真实预占。多个艺人行共享一个库存余额时，按实际最新版本逐笔更新。

同一笔 capture 的回调和主动查询保留各自来源证据，通过 canonical 交易关联共用唯一账本；不能修改金额/币种或创建第二笔 capture 来绕过唯一约束。冲突与晚到事实留在持久记录中。

## 验证入口

在仓库根目录运行：

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:order-payment
mise exec node@24.20.0 -- corepack pnpm check
```

第一条使用正常业务准备链路、真实 PostgreSQL、独立持久 TEST PSP、API/Worker 与签名回调，具体实际覆盖和失败记录见 `output/checks/p4-05-order-completion/`。完整检查保持原步骤并加入此协议，不以单元测试代替数据库验收。

迁移只追加 0027，已有 SQL 保持。具有新业务证据的数据库回退必须遵守迁移保护；不得为了回退删除已支付订单、别名证据、收据或账本。进程中断后从持久观察/回执恢复，不依赖浏览器回跳或进程内队列。

扫描锁用于队列工作分配，金融正确性仍由聚合锁、唯一约束、状态机及事务提交保证。实现核对 [PostgreSQL 18 行锁](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE) 和 [事务隔离](https://www.postgresql.org/docs/18/transaction-iso.html)；实际验证以本仓库锁定的数据库及迁移为准。

实际商户/PSP 配置、Secret Manager、USDT 真实映射、sandbox/小额与生产部署仍按 P4-04 和发布门验收。TEST 环境不代表对外收款，邮件未接通时不能显示“已发送查单邮件”。

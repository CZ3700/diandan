# ADR-003：支付代码适配器化，运营配置版本化

> 状态：Accepted  
> 日期：2026-09-02  
> 决策者：用户确认逐步增加渠道并支持配置热更新  
> 关联：P4-04、P5-04、P5-05、P5-07；R-03、R-04、R-05

## 背景

目标是尽可能覆盖全球粉丝，但真实可用支付受经营主体、KYC、国家、币种、设备、金额和 PSP 资格约束。未来需要快速启停或调整渠道，又不能把生产支付变成任意代码插件系统。

## 决策

- 所有 PSP/支付提供方实现统一、可测试的 `PaymentProvider` adapter port；平台 checkout 本身属于自研 application use case。
- 新 PSP 是代码变更：审查、沙盒、真实小额、退款/对账和灰度后部署。
- 运营可热更新的仅是已部署 adapter 的国家/币种/金额/排序/灰度/健康/启停规则。
- 配置采用不可变版本与 `draft → validate → publish → rollback`。
- 已创建或状态未知的支付固定 provider，不自动切换或再次扣款。

## 后果

- 前端调用 capability API，只展示当前真实可用方式，不硬编码渠道。
- 支付回跳只查询；最终状态只能由验签 webhook，或经认证、审计且持久化的 PSP reconcile 证据驱动。
- 密钥仍由 Secret Manager 管理，不能通过后台配置或数据库更新。
- 首版只实现必要渠道，避免为“数量”增加合规和维护面。

## 验证与回退

- fake adapter 与每个正式 PSP adapter 必须通过同一套 conformance suite。
- 配置在 60 秒内生效并能在一分钟内恢复上一版本。
- 关闭渠道只影响新 checkout，不能改变既有 payment attempt。
- 每个正式 adapter 上线前完成创建、失败、取消、退款、部分退款、对账、重复/乱序 webhook 测试。

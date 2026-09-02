# ADR-001：Shopify Headless + 模块化单体

> 状态：Superseded  
> 被替代：ADR-004  
> 日期：2026-09-02  
> 决策者：产品方向已由用户确认；技术基线由本规范锁定  
> 关联：P0-01、P0-04、P1-05；R-06、R-14、R-15

> 历史说明：用户于 2026-09-02 明确要求完全自研源码，不使用 Shopify 建站。本 ADR 仅保留决策历史，不得作为实施依据。

## 背景

平台需要高品质定制前台、低成本内容运维、可靠商品/价格/库存/结账，以及未来可控的支付扩展。首版团队和交易规模未知，不应承担微服务与多套基础设施成本。

## 决策

- 前台使用 Shopify 正式稳定 Hydrogen + React Router，部署 Oxygen。
- Shopify Metaobjects 管偶像/首页，Product/Variant 管礼物/价格/库存，Shopify 托管首期 checkout。
- 自研核心为 NestJS 模块化单体；领域规则保持纯 TypeScript。
- PostgreSQL 保存 support intent、订单投影/快照、履约、支付配置、审计和可靠事件。
- MVP 使用 Transactional Outbox + pg-boss/等价 PostgreSQL 持久队列，不引入 Redis。

## 考虑的方案

| 方案 | 优点 | 缺点/风险 | 结论 |
|:--|:--|:--|:--|
| 全 Shopify theme | 运维简单 | 高级交互与自研订单/支付边界受限 | 拒绝 |
| Headless + 模块化单体 | 体验自由、运营成熟、复杂度可控 | 需要维护 API/投影一致性 | 选择 |
| 自研商城 + 多微服务 | 控制最强 | 首版成本、合规和运维过重 | 拒绝 |

## 后果

- 不在 PostgreSQL 建独立商品/库存真相源。
- 供应商数据必须经 adapter 映射。
- 当且仅当有测得的吞吐/隔离需求时，才以 ADR 评估 Redis 或拆服务。

## 验证与回退

- Phase 0–1 用依赖图、domain tests、Shopify fixture 与数据库恢复验证。
- Shopify adapter 可通过 port 替换；业务核心不能依赖 Shopify SDK。
- 出现平台资格限制时，先评估替换 storefront hosting/checkout adapter，不重写 domain。

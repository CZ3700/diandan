# ADR-004：完全自研源码的模块化商城

> 状态：Accepted  
> 日期：2026-09-02  
> 决策者：用户明确要求完全自研源码  
> 关联：Supersedes ADR-001；P0-01、P0-04、P1-02、P1-04；R-06、R-14、R-15

## 背景

平台不能依赖 Shopify 或其他建站、CMS、commerce engine 管理内容、商品、购物车、订单或结账。与此同时，自行收集卡号/CVV、自建邮件网络或对象存储硬件会带来不必要的合规与运维风险。

## 决策

- 本仓库拥有粉丝前台、自研 Admin、API、Worker、内容、商品、价格、库存、购物车、checkout、订单、履约、支付编排、迁移和 IaC。
- 使用 Next.js 自托管前台/后台、NestJS + Fastify 模块化单体、PostgreSQL、Drizzle query layer、显式 SQL migrations 和 PostgreSQL Outbox + pg-boss；实际 PostgreSQL catalog 与已评审 migration 是 schema 权威，Drizzle 仅作 query/types 并由 CI 检查 drift。
- PostgreSQL 是业务真相源；S3 兼容对象存储只保存媒体二进制，CDN/缓存/分析仅是可重建投影。
- PSP 只通过托管页面/托管字段处理支付敏感数据；OIDC、邮件、对象存储、缓存失效和 KMS 通过 ports/adapters 接入；观测由 composition root 以不进入 Domain 的横切 instrumentation 注入。
- MVP 不引入 Redis、微服务、托管 CMS、commerce engine 或独立搜索集群。

## 考虑的方案

| 方案 | 优点 | 缺点/风险 | 结论 |
|:--|:--|:--|:--|
| Shopify/托管 commerce | 交付快 | 业务真相和结账受平台控制，不符合要求 | 拒绝 |
| 开源 commerce/CMS engine | 有现成功能 | 核心模型仍被第三方框架主导，升级面过大 | MVP 拒绝 |
| 自研模块化单体 + 基础设施 adapters | 源码/数据自主，范围可控 | 需要实现目录、价格、库存、后台 | 选择 |
| 自建所有基础设施/支付采集 | 理论控制最强 | PCI、安全和运维风险不可接受 | 拒绝 |

## 后果

- Phase 1–4 必须实现完整商城数据模型和管理工作流，不能用 fixture 永久替代。
- 外部服务不能拥有价格、库存、订单或履约状态。
- 业务包保持供应商无关，容器/IaC 可迁移到其他运行平台。
- “完全自研”不允许平台服务器接收 PAN、CVV、3DS 凭据或钱包密码。

## 验证与回退

- 通过依赖图和源码扫描阻断建站/CMS/commerce SDK。
- Docker Compose 在本地启动 PostgreSQL、对象存储兼容服务与四个应用。
- 使用 fake adapters 证明无外部服务时核心交易规则可测。
- 如更换云、PSP、对象存储或身份源，只允许改 adapter/IaC，不改 domain。

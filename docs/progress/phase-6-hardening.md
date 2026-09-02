# Phase 6 — 质量、安全与韧性加固

> 状态：LOCKED  
> 任务：6  
> 解锁条件：Phase 5 退出门禁通过

## 目标

系统化证明产品在可访问性、性能、安全、事件故障与恢复方面达到发布门槛。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P6-01 | PENDING | — | P4-06、P5-07 | 全量测试 + i18n/SEO/cache/七语言 E2E 矩阵 |
| P6-02 | PENDING | — | P3-06、P4-06、P5-02 | 七语言 WCAG 2.2 AA/断行/缩放 |
| P6-03 | PENDING | — | P3-06、P4-06 | 分 locale 字体/消息 bundle/Performance/RUM |
| P6-04 | PENDING | — | P5-06 | Scoped security checks |
| P6-05 | PENDING | — | P1-06、P4-06、P5-06 | Fault injection |
| P6-06 | PENDING | — | P0-05、P1-04、P5-05、P5-08、P6-05 | Recovery/rollback drill |

## 必须证明

- High/Critical 安全问题为 0，axe critical/serious 为 0。
- 核心流程在故障注入下无丢单、重复扣款或重复履约。
- 性能预算由 Lighthouse CI 与 RUM 同时支持。
- PITR、部署回退、配置回退和 webhook 重放有带时间戳实操证据。
- 七语言消息目录、核心路径、SEO 互返、cache 隔离、PSP locale fallback 与历史订单/邮件语言均有自动和人工证据。

## Phase 退出证据

尚未解锁。

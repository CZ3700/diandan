# Phase 1 — 合同、领域与数据真相源

> 状态：ACTIVE
> 任务：6  
> 解锁条件：Phase 0 退出门禁通过；与 Phase 2 同时激活

## 目标

冻结可序列化合同、纯领域规则、自研内容/商品/价格/库存模型、数据库与可靠事件骨架，使 UI 和运营工作可以在稳定边界上并行。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P1-01 | READY | — | P0-01、P0-03 | SupportedLocale/LocaleContext/订单通知语言快照/CheckoutQuote/OrderAmount/schemaVersion/OpenAPI |
| P1-02 | PENDING | — | P1-01、P0-04 | 自研 content/catalog/pricing/inventory/media/policy/translation schema/fixtures |
| P1-03 | PENDING | — | P1-01 | 纯 Domain、价格/库存/状态与属性测试 |
| P1-04 | PENDING | — | P1-01、P1-02、P0-03 | 完整 migrations、七语言 translation/review、inventory balance、订单金额/退款约束与加密边界 |
| P1-05 | PENDING | — | P1-01/02/03/04 | Repositories 与 payment/media/identity/notification/cache/KMS ports/adapters |
| P1-06 | PENDING | — | P1-04、P1-05 | Inbox/outbox/worker/webhook |

## 必须证明

- Domain 无 Next.js、NestJS、Drizzle 或供应商 SDK。
- 公共 API、对象元数据和浏览器持久化中没有留言明文或偶像地址。
- 空库迁移、库存并发、订单金额/退款上限、重复/乱序 webhook 和唯一副作用有自动测试。
- 事件、API、queue 全部有 schemaVersion。
- `SupportedLocale` 精确为 `en/zh-CN/th/vi/ja/es/pt`，locale 与 market/currency 分离；翻译唯一、不可变、source hash/stale/审核/发布门有自动测试。

## Phase 退出证据

Phase 0 已于 2026-09-03 通过退出门禁，Phase 1 已激活；P1-01 依赖完成且 Lane A 空闲，状态为 `READY`。其余退出证据尚未取得。

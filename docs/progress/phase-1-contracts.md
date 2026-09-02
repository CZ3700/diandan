# Phase 1 — 合同、领域与数据真相源

> 状态：ACTIVE
> 任务：6  
> 解锁条件：Phase 0 退出门禁通过；与 Phase 2 同时激活

## 目标

冻结可序列化合同、纯领域规则、自研内容/商品/价格/库存模型、数据库与可靠事件骨架，使 UI 和运营工作可以在稳定边界上并行。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P1-01 | IN_PROGRESS | Codex `/root` | P0-01、P0-03 | 2026-09-03T06:02:09+08:00 开始；SupportedLocale/LocaleContext/订单通知语言快照/CheckoutQuote/OrderAmount/schemaVersion/OpenAPI |
| P1-02 | PENDING | — | P1-01、P0-04 | 自研 content/catalog/pricing/inventory/media/policy/translation schema/fixtures |
| P1-03 | PENDING | — | P1-01 | 纯 Domain、价格/库存/状态与属性测试 |
| P1-04 | PENDING | — | P1-01、P1-02、P0-03 | 完整 migrations、七语言 translation/review、inventory balance、订单金额/退款约束与加密边界 |
| P1-05 | PENDING | — | P1-01/02/03/04 | Repositories 与 payment/media/identity/notification/cache/KMS ports/adapters |
| P1-06 | PENDING | — | P1-04、P1-05 | Inbox/outbox/worker/webhook |

## P1-01 执行卡

- **Owner / 开始时间**：Codex `/root`，2026-09-03T06:02:09+08:00。
- **范围**：在 `@fan-support/contracts` 唯一定义带 `schemaVersion` 的跨模块 Zod 合同、七语言常量与 locale provenance；生成并提交 JSON Schema/OpenAPI；让 `i18n` 只导入这些 locale 定义。
- **非目标**：不实现领域规则、数据库 migration、repository、供应商 adapter、业务 API 或 UI；不从 locale 推导 market、country、currency 或 payment capability。
- **测试先行计划**：先写失败测试覆盖七语言精确集合、规范化、strict/version 拒绝、金额不变量、隐私公共视图、序列化与 OpenAPI/JSON Schema 一致性，再实现最小合同与生成器。
- **验证计划**：受影响包测试、契约生成 freshness/仓库重复 locale 检查、format、lint、typecheck、完整 `pnpm check`、secret scan、clean-clone frozen install/check，以及独立契约/安全评审。
- **风险护栏**：私密留言和完整显示名不得进入公共 DTO、日志、事件元数据或浏览器持久化；金额使用整数 minor unit；未知 `schemaVersion` 必须 fail closed；供应商 SDK 类型不得进入合同。

## 必须证明

- Domain 无 Next.js、NestJS、Drizzle 或供应商 SDK。
- 公共 API、对象元数据和浏览器持久化中没有留言明文或偶像地址。
- 空库迁移、库存并发、订单金额/退款上限、重复/乱序 webhook 和唯一副作用有自动测试。
- 事件、API、queue 全部有 schemaVersion。
- `SupportedLocale` 精确为 `en/zh-CN/th/vi/ja/es/pt`，locale 与 market/currency 分离；翻译唯一、不可变、source hash/stale/审核/发布门有自动测试。

## Phase 退出证据

Phase 0 已于 2026-09-03 通过退出门禁，Phase 1 已激活；P1-01 已由 Codex `/root` 领取并进入 `IN_PROGRESS`。其余退出证据尚未取得。

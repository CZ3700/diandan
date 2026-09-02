# Phase 4 — 加购、结账与订单闭环

> 状态：LOCKED  
> 任务：6  
> 解锁条件：Phase 3 退出门禁通过

## 目标

形成选择偶像、礼物、私密留言、测试付款、canonical 订单及查询读模型、安全查单与通知的真实纵切片。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P4-01 | PENDING | — | P1-03/04/05、P3-05 | 匿名 cart + presentation/fan-message locale + cart_item/support_intent 原子事务 |
| P4-02 | PENDING | — | P2-03/04、P4-01 | Cart UI |
| P4-03 | PENDING | — | P4-01、P4-02 | Preflight/quote+amount + order presentation locale + per-object TranslationSnapshotRef + policy revision |
| P4-04 | PENDING | — | P1-06、P4-03 | PaymentProvider/provider locale mapping/idempotent create Saga/hosted action/reconcile |
| P4-05 | PENDING | — | P4-04 | Provider evidence/order/reservation/locale-preserving token exchange |
| P4-06 | PENDING | — | P4-05、P1-06 | 七语言 Notification/fallback alert/expiry cleanup |

## 必须证明

- 浏览器篡改偶像、variant、价格、币种或库存不能生效。
- 公共 cart/order DTO、日志、分析、对象元数据和录像不含留言/完整显示名。
- 成功、失败、取消、回跳早于 webhook、UNKNOWN 和 10 次重复 webhook 均正确。
- 同一变体送不同偶像保持独立，历史订单不随实时商品变化。
- cart/订单固化 presentation locale；偶像/礼物/媒体各自固化 TranslationSnapshotRef，政策固化 translation revision，payment 固化平台 requested/provider actual locale，notification 固化 requested/resolved locale + templateVersion。切换 UI 不改变 market/currency/金额/attempt，七语言邮件完整且历史翻译不漂移。

## Phase 退出证据

尚未解锁。

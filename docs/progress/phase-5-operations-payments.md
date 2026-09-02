# Phase 5 — 运营、退款与支付扩展边界

> 状态：LOCKED  
> 任务：7  
> 解锁条件：Phase 4 退出门禁通过

## 目标

让内容、订单和财务人员按最小权限处理日常工作；用安全的 adapter + versioned config 支持未来支付扩展。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P5-01 | PENDING | — | P0-04、P1-04 | OIDC/server session/RBAC/CSRF/MFA/audit |
| P5-02 | PENDING | — | P5-01、P4-05/06 | Orders/七语言及低置信度 message moderation/fulfillment/notifications |
| P5-03 | PENDING | — | P5-01、P4-04/05 | Refund/cancel/dispute/reconcile |
| P5-04 | PENDING | — | P1-03、P4-04 | Capability/routing/conformance |
| P5-05 | PENDING | — | P5-01、P5-04 | 七语言 payment label/config publish/rollback |
| P5-06 | PENDING | — | P5-01、P1-06、P5-03 | Replay/DLQ/UNKNOWN queue |
| P5-07 | PENDING | — | P5-04/05/06 | New PSP runbook/fake adapter drill |

## 必须证明

- 角色越权失败；高风险操作二次确认且 append-only 审计。
- 重复退款/重放不产生第二次副作用。
- 配置 60 秒内传播且一分钟内回退；已创建支付不改 provider。
- 新 PSP 需要代码部署和认证测试，运营不能上传代码。
- 不支持/低置信度语言的留言进入人工队列而不自动批准；用户可见支付名称/提示七语言完整。

## Phase 退出证据

尚未解锁。

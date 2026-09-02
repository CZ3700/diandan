# ADR-002：用加密 Support Intent 保存粉丝私密上下文

> 状态：Superseded  
> 被替代：ADR-005  
> 日期：2026-09-02  
> 决策者：技术基线  
> 关联：P1-01、P1-04、P4-01、P4-05；R-01、R-02、R-03

> 历史说明：私密隔离目标继续有效，但 Shopify line/Saga 实现已被自研购物车原子事务替代。本 ADR 仅保留历史。

## 背景

订单必须证明礼物送给哪位偶像，并保留粉丝私密留言和署名偏好。把这些内容直接放在 Shopify line attributes 会扩大后台、日志、应用和第三方可见面，且浏览器字段不可作为可信归属。

## 决策

加购时由服务端校验偶像/礼物关系并创建加密 `support_intent`。Shopify line 只保存不透明 `_support_intent_id`、安全的偶像展示名和 schema version；下单事件通过该 ID 关联并生成不可变订单行快照。

## 后果

- 私密留言和完整显示名不进入 Shopify 行属性、分析或普通日志。
- 加购成为 Saga：创建 intent → 加 Shopify line → 标记 linked；失败需要补偿与幂等重试。
- intent 需要过期、撤销、加密轮换和孤儿清理策略。
- 订单渲染依赖快照，不依赖实时商品或偶像内容。

## 验证与回退

- 篡改 line attribute 或 display name 不能改变归属。
- 超时重复同一幂等键不能生成第二 intent/line。
- `rg`/自动测试证明留言明文不出现在 Shopify fixture、日志、分析和截图。
- 如果 Shopify cart 失败，intent 标记取消；如果事件延迟，worker 可用不透明 ID 重建关联。

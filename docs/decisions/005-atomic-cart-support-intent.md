# ADR-005：自研购物车与加密 Support Intent 原子事务

> 状态：Accepted  
> 日期：2026-09-02  
> 决策者：技术基线  
> 关联：Supersedes ADR-002；P1-01、P1-04、P4-01、P4-03；R-01、R-02、R-03、R-06

## 背景

平台需要在不泄露留言的情况下，可靠证明每件礼物对应的偶像。完全自研后，购物车与 intent 位于同一 PostgreSQL，不再需要外部 cart line 或跨商城 Saga。

## 决策

- 游客浏览器只持高熵购物车 token，数据库只保存摘要；cookie 为 HttpOnly、Secure、SameSite。
- 加购在单一数据库事务内重验偶像、礼物、适用关系和已发布价格，并创建 `cart_item + support_intent + idempotency_record`；cart item 唯一拥有 variant/quantity/observed price，intent 只拥有 idol 与加密私密上下文。
- `support_intent` envelope-encrypt 留言与完整显示名；通用订单快照只引用 intent ID，不复制敏感明文。
- checkout 锁定 cart version、重算并持久化 CheckoutQuote/OrderAmount、创建库存预占、`PENDING_PAYMENT` 订单、不可变行快照和 payment attempt。
- payment attempt 在第一事务同时固化 provider account/method/config/rule、UUID merchant reference 与 provider idempotency key，再在事务外调用该 PSP，第二事务保存 external reference/next action；超时或崩溃只允许对同一 provider account + attempt 重试/reconcile。
- 验签 webhook 或受控 PSP reconcile 证据提交/释放预占并推进正交状态；迟到成功且预占已释放时进入人工 `ON_HOLD`，不得丢单或静默超卖。

## 后果

- 加入购物车不预占库存；只有 checkout 才预占并设置 TTL。
- 同一 variant 送不同偶像始终是不同 cart item。
- 幂等重试不能创建第二个 intent、订单或支付尝试。
- 受权运营按需解密留言并记录访问审计；公开 API、日志、分析、对象元数据和截图不含明文。
- `order_items.support_intent_id` 是唯一关系拥有方；创建订单行时 intent 同事务进入 `CHECKOUT_LOCKED`，成功后进入 `CONVERTED`，被取消订单引用的 intent 不清理、不移动 FK，只能显式复制成新的 cart item + intent。

## 验证与回退

- 并发加购/checkout、价格 revision 变化、库存临界值和超时均有事务测试。
- 重复命令和 10 次重复 webhook 只产生一次业务副作用。
- 故障注入证明事务回滚后不留下孤儿 cart item/intent/reservation。
- 数据 schema 采用可向前迁移方式；历史 intent 和订单快照保持可读。

# P4-02 API / BFF 独立只读复核

结论：ACCEPT，未发现本次范围内可复现的阻断缺陷。复核者 `storefront_directory` 非这些文件的作者；只读当前实现、相对 `c6ca6ba` 的旧 route / composition diff 和测试，没有修改产品代码。

## 边界核对

- `apps/api/src/cart-edit-route.ts:75`：PATCH / DELETE / editor POST 均先执行精确 Origin、单头读取、Cookie 绑定 CSRF 和严格请求 schema；itemId 只取固定路径，operation 由路由注入，拒绝正文重定义、query 和额外字段。mutation 幂等键只来自 header。8192 字节限制和安全错误映射保留。
- `apps/api/src/cart-edit-route.ts:155`：普通 mutation 与私密 editor 使用不同严格响应 schema。返回 item 必须匹配请求；editor 的 cart / item 两版本必须精确匹配，普通响应绑定 locale 与 action。原文只出现在专用 editor 响应，错误不回显异常或请求内容。所有响应维持 private / no-store、noindex 和 no-referrer。
- `apps/api/src/cart-route.ts` 的旧行为只扩展 CurrentResponse 以表达历史 ADD 重放时已删除，不复活旧行。共享现有 Cookie / privacy helper 未改判定。`cart-composition.ts` 为两类用例复用同一凭据解析器、KMS 和 persistence 生命周期；`bootstrap.ts` 在能力未配置时安全 503，不启用临时凭据或测试适配器。
- `apps/storefront/src/server/cart-proxy.ts:145`：站点和内部 origin 均来自配置；四个 route handler 共用固定方法 / 路径门，全部 force-dynamic。只向固定 API 路径转发，item UUID 经合同解析；不转发任意 URL、Authorization、其它 Cookie 或 forwarded headers。仅保留 `__Host-fan-cart`，重复或无效已有凭据不会被当作首次访问重置。
- `cart-proxy.ts:254`：上游调用仅一次、禁止重定向且 no-store。mutation 发出后发生传输、状态、响应 schema 或安全头校验失败，统一返回 TRANSACTION_OUTCOME_UNKNOWN；不自动重试、不生成替代幂等键。上游已验证的 TEMPORARY_UNAVAILABLE 仍由客户端现有 uncertain 分类保留原请求，未发现提交不明后丢键的路径。
- `cart-proxy.ts:274`：严格限定响应类型、状态、item / editor 版本、locale / scope / action。普通 cart 或 mutation 不接受 editor 原文。拒绝公共缓存、超限或非法 UTF-8 / JSON 及未知字段，不转发被拒响应内容。Set-Cookie 仅允许初始化成功的新 host-only Secure / HttpOnly / SameSite=Lax cookie，或 CART_EXPIRED 的精确清除；其它失败不能新建会话。

## 证据与未测范围

已读作者的最终日志：`cart-api-final-unit.log` 为四文件 14 tests PASS，覆盖 edit / 旧 cart / bootstrap / composition；`cart-proxy-final-unit.log` 为一文件 10 tests PASS，覆盖 Cookie、Origin、路径、私密响应隔离、版本、未知提交和失败 Set-Cookie。另读 `cart-final-api-types.log`、`cart-final-storefront-types.log` 与 `cart-final-lint.log`。本报告不将作者执行记为独立重跑。

本次没有运行 PG、Next、浏览器、TLS / 代理断连实验或整仓检查。真实事务回滚、同键恢复和浏览器交互的最终状态由 root / E2E 汇总；本结论仅为 API / BFF 源码与现有测试证据的非作者边界复核。未新增依赖、生产配置、合同放宽或额外代理入口。

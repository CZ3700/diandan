# 匿名购物车运行与恢复

本入口对应 P4-01。页面抽屉与编辑属于 P4-02，结账预占属于 P4-03；本阶段加购不创建支付、不扣库存。前台继续使用已确认的视觉。

## 客户端顺序

1. 同源 `POST /api/v1/carts` 提交 schemaVersion、presentationLocale、market、currency。先等服务端设置 `__Host-fan-cart` Cookie，再发第一条加购。初始化响应整体丢失只可能留下一个空车，24 小时到期。
2. 服务端在私有 `x-csrf-token` 响应头返回会话 CSRF 令牌，只存内存。Cookie 为 Secure、HttpOnly、SameSite=Lax、Path=/、无 Domain；原始购物车令牌从不进入 JSON、URL、日志或浏览器存储。
3. `POST /api/v1/cart/items` 带精确 Origin、JSON、CSRF 和随机 Idempotency-Key；具体字段以生成的 `CartRuntimeAddRequest` 为准。每次主动加购生成新键，网络重试复用原键和原请求，包括留言、署名及所选价格 ID。
4. `GET /api/v1/cart?presentationLocale=…` 只接受一个语言参数。重新读取当前内容和报价；切换语言保留市场、币种与原来观察到的价格，不自动接受涨价。后续同源反代/BFF 接入与交互属于 P4-02。

## 拒绝与恢复

- `CART_EXPIRED` 返回 409 并清 Cookie；之后重新初始化空车，不在失败响应里悄悄建车。
- `PRICE_CHANGED`、库存不足、艺人暂停或资格变化需要刷新选择。创建意图、购物车行、版本、幂等记录与 outbox 在同一事务内提交，失败整体回滚。
- 相同键及相同请求返回原行的 `REPLAYED` 与当前安全视图；相同键改请求返回 `IDEMPOTENCY_CONFLICT`。不同游客可使用同一个请求键；事件自身使用全局唯一的行事件键。
- 已成功请求先读安全回执，无需新的加密操作。新请求的临时幂等探测必须确认回滚后才调用 KMS，再进入最终事务重新校验。仅已确认 `TRANSACTION_ABORTED` 最多尝试三次；`TRANSACTION_OUTCOME_UNKNOWN` 保留不确定结果，由同 Cookie、同键的重试恢复，不能改键再加一遍。
- 按单准备/预售没有虚构的库存数字；限量礼物按当前真实可售量验证。虚拟/实体/心愿/周边分类与库存策略分开。每次主动加购保留独立行与独立私密意图。

## 运行配置

`.env.example` 列出五个 `FAN_SUPPORT_CART_*` KMS 配置。必须一起设置：区域、加密当前版本及不可变 key ARN 表、MAC 当前版本及 ARN 表。MAC 最多保留四个版本供轮换；旧 Cookie 在对应版本仍配置时可继续验证。全未配置时三个购物车接口均返回私有 503；部分配置错误使启动失败。

AWS SDK 使用服务器凭据链。运行角色需要相应 key 的 GenerateMac、GenerateDataKey、GenerateDataKeyWithoutPlaintext 权限；后续受权解密另需 Decrypt。匿名且无留言仍生成真正的封装密钥，不创建假留言。测试的 AES-GCM/HMAC 使用真实适配器，远端 KMS 调用边界由显式 TEST 实现替代，不构成 AWS/IAM 或生产 KMS 验收。

## 验证入口

- 日常：`mise exec node@24.20.0 -- corepack pnpm check:dev`。
- 购物车真实协议：`mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:cart`，自建临时 PostgreSQL 和 TLS S3，不连接生产数据库。
- 正式本地组合门：`mise exec node@24.20.0 -- corepack pnpm check`，包括迁移、PG、S3、接口与构建回归。
- 本轮证据：`output/checks/p4-01-cart-runtime/` 与 `output/checks/p4-01-cart/`；进度与限制以 `docs/progress/phase-4-commerce.md` 为准。

CI 的 Quality 执行预算调整为 30 分钟：已有完整本地回归耗时 1186–1207 秒，本阶段还增加真实购物车链路；原检查步骤不减，Security 保留 20 分钟。该配置修改和本地检查不构成远程 CI 已通过。

0023 扩展购物车历史资格守卫，以支持正常管理中心的全部艺人规则；同时修复旧自动审核守卫把 NULL 待审状态误当自动审核的问题。真正的自动审核仍需精确不可变证据。存在仅靠动态资格合法的历史意图，或仍有待审意图时，回退到有缺陷的旧守卫会被明确拒绝；不能删历史数据、假审核或伪造显式资格来强行回退。空库 up/down/up 与带业务数据的拒绝回退需分别验证。

# 匿名购物车运行与恢复

本入口覆盖 P4-01 会话与加购、P4-02 页面抽屉与编辑。结账预占属于 P4-03；当前加购不创建支付、不扣库存。前台继续使用已确认的视觉。

## 会话与服务端协议顺序

1. 同源 `POST /api/v1/carts` 提交 schemaVersion、presentationLocale、market、currency。先等服务端设置 `__Host-fan-cart` Cookie，再发第一条加购。初始化响应整体丢失只可能留下一个空车，24 小时到期。
2. 服务端在私有 `x-csrf-token` 响应头返回会话 CSRF 令牌，只存内存。Cookie 为 Secure、HttpOnly、SameSite=Lax、Path=/、无 Domain；原始购物车令牌从不进入 JSON、URL、日志或浏览器存储。
3. `POST /api/v1/cart/items` 带精确 Origin、JSON、CSRF 和随机 Idempotency-Key；具体字段以生成的 `CartRuntimeAddRequest` 为准。每次主动加购生成新键，网络重试复用原键和原请求，包括留言、署名及所选价格 ID。
4. `GET /api/v1/cart?presentationLocale=…` 只接受一个语言参数。重新读取当前内容和报价；切换语言保留市场、币种与原来观察到的价格，不自动接受涨价。

浏览器统一调用同源 `/api/storefront/cart` BFF：GET 对应上述读取，POST 对应初始化；`/items` POST 对应加购；`/items/:itemId` PATCH/DELETE 对应修改/删除；`/items/:itemId/editor` POST 对应私密编辑读取。BFF 只转发固定路径、方法和允许的头，使用既有 `FAN_SUPPORT_SITE_ORIGIN` 与 `FAN_SUPPORT_INTERNAL_API_ORIGIN`。只有真正没有购物车 Cookie 的首次读取返回 `CART_NOT_FOUND`；伪造凭据不会被静默当成新访客。

## 数量、删除与私密编辑

- PATCH、DELETE 携带 `expectedCartVersion`、`expectedItemVersion` 和 `Idempotency-Key`；路径决定行 ID，正文不接受 `operation` 或 `itemId`。数量修改还带观察到的价格 ID，并重新检查当前艺人、资格、价格及库存。数量不变更收礼人或私密意图。
- 点击编辑才调用独立 editor POST。此读操作也验证 Origin、Cookie 与 CSRF；服务端先提交授权读取审计，再在事务外解密，返回前再次核对归属、有效期、cart/item/intent 版本与审计绑定。普通 cart DTO 只含“已填写/匿名”等状态，不带原文。
- 留言替换重新加密并重置审核；空留言、匿名署名仍保留真实封装密钥。编辑器仅内存保存草稿，关闭或离开页面会清除，迟到响应不得恢复原文。人工截图前须关闭私密编辑器，不生成含原文的 trace 或录像。
- 删除将意图置为 `CANCELED`，保留行、历史与回执。重复删除用原键返回当前视图；旧 ADD 重放返回 `CART_ITEM_REMOVED`，不会恢复已删除行。
- 每次更新在同一事务写 cart/item/intent 版本、不可变回执及 ID-only `cart_edit_outbox_events`。新事件暂保持持久 `PENDING`，不进入只支持旧事件合同的 dispatcher，也不假报已派发；购物车展示直接读取 PostgreSQL。未来消费者需显式接入新事件族。
- 版本冲突刷新公开事实、保留未保存草稿，等待粉丝确认再提交；不确定结果保留相同正文与幂等键，只允许显式恢复。

## 拒绝与恢复

- `CART_EXPIRED` 返回 409 并清 Cookie；之后重新初始化空车，不在失败响应里悄悄建车。
- `PRICE_CHANGED`、库存不足、艺人暂停或资格变化需要刷新选择。创建意图、购物车行、版本、幂等记录与 outbox 在同一事务内提交，失败整体回滚。
- 相同键及相同请求返回原行的 `REPLAYED` 与当前安全视图；相同键改请求返回 `IDEMPOTENCY_CONFLICT`。不同游客可使用同一个请求键；事件自身使用全局唯一的行事件键。
- 已成功请求先读安全回执，无需新的加密操作。新请求的临时幂等探测必须确认回滚后才调用 KMS，再进入最终事务重新校验。仅已确认 `TRANSACTION_ABORTED` 最多尝试三次；`TRANSACTION_OUTCOME_UNKNOWN` 保留不确定结果，由同 Cookie、同键的重试恢复，不能改键再加一遍。
- 按单准备/预售没有虚构的库存数字；限量礼物按当前真实可售量验证。虚拟/实体/心愿/周边分类与库存策略分开。每次主动加购保留独立行与独立私密意图。

## 运行配置

`.env.example` 列出五个 `FAN_SUPPORT_CART_*` KMS 配置。必须一起设置：区域、加密当前版本及不可变 key ARN 表、MAC 当前版本及 ARN 表。MAC 最多保留四个版本供轮换；旧 Cookie 在对应版本仍配置时可继续验证。全未配置时购物车接口均返回私有 503；部分配置错误使启动失败。

AWS SDK 使用服务器凭据链。运行角色需要相应 key 的 GenerateMac、GenerateDataKey、GenerateDataKeyWithoutPlaintext 权限；私密编辑解密还需 Decrypt。匿名且无留言仍生成真正的封装密钥，不创建假留言。测试的 AES-GCM/HMAC 使用真实适配器，远端 KMS 调用边界由显式 TEST 实现替代，不构成 AWS/IAM 或生产 KMS 验收。

## 验证入口

- 日常：`mise exec node@24.20.0 -- corepack pnpm check:dev`。
- 购物车真实协议：`mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:cart`，自建临时 PostgreSQL 和 TLS S3，不连接生产数据库。
- 正式本地组合门：`mise exec node@24.20.0 -- corepack pnpm check`，包括迁移、PG、S3、接口与构建回归。
- 购物车编辑真实协议：`mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:cart-storefront`。
- 七语言真实购物车浏览器：`mise exec node@24.20.0 -- corepack pnpm verify:cart:browser`。临时预览使用 `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api preview:cart-storefront`，保留至停止信号；URL以本次启动输出为准。
- 证据：`output/checks/p4-01-cart-runtime/`、`output/checks/p4-01-cart/` 与 `output/checks/p4-02-cart-storefront/`；进度与限制以 `docs/progress/phase-4-commerce.md` 为准。P4-02每次独立输出到 `run-*`；所有数据来自显式 TEST 夹具，不是生产内容。

P4-01 曾将 CI Quality 执行预算调整为 30 分钟。P4-06 新增通知与到期竞争的真实集成后，预算为 45 分钟；原检查步骤不减，Security 保留 20 分钟。当前依据和入口见 `docs/operations/order-notifications.md`。该配置修改和本地检查不构成远程 CI 已通过。

0023 扩展购物车历史资格守卫，以支持正常管理中心的全部艺人规则；同时修复旧自动审核守卫把 NULL 待审状态误当自动审核的问题。真正的自动审核仍需精确不可变证据。存在仅靠动态资格合法的历史意图，或仍有待审意图时，回退到有缺陷的旧守卫会被明确拒绝；不能删历史数据、假审核或伪造显式资格来强行回退。空库 up/down/up 与带业务数据的拒绝回退需分别验证。

0024 只增加编辑审计、修改回执、独立事件表及其守卫；只要其中存在历史数据就拒绝回退，禁止清表绕过。验证应同时保留原 0023 的两种危险回退保护。

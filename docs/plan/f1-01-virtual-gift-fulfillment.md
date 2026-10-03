# F1-1 虚拟礼物自动履约：实现设计

> 日期：2026-09-26 · 依据：ADR-019（数字应援凭证）、规范 §12.2（履约状态机）、§11.3（订单行快照）、V2 方案 §4 第 8 项、`docs/handoff/2026-09-26-core-features-first.md`
> 前置：本机便携 PostgreSQL 18.6 已可运行原生测试集群（`POSTGRES_TEST_BIN`），迁移与目录快照可在本机验证

## 1. 结论一句话

`gift_kind = VIRTUAL` 的订单行在支付聚合进入 PAID 的同一事务内，由系统直接从 PENDING 推进到 DELIVERED（authority=SYSTEM，写审计与 outbox），混合订单的实物行照常走 PENDING → PREPARING → DELIVERED；粉丝端、邮件与后台按"数字应援凭证"语义显示，后台不再对 VIRTUAL 行提供准备/送达操作。

## 2. 数据模型

| 变更 | 说明 |
|:--|:--|
| `order_items.gift_kind`（新列，可空，CHECK 五类枚举） | 购买时礼物类别的快照。结账写入时从该行引用的礼物修订解析（`gift_revision_profiles.gift_kind`，日更发布则取 `daily_publication_revisions.document->>'giftKind'`），迁移对既有行用同一规则回填；无法解析的历史行（profile_version 1 / 无档案）保持 NULL，视为非数字履约 |
| `fulfillments` | 不加列。数字送达时 `prepared_at = delivered_at = 事件时间`，满足既有时间约束 |
| `fulfillment_events` | 复用 `authority_kind='SYSTEM'`，`reason_code='VIRTUAL_GIFT_AUTO_DELIVERED'`，并引用一条 `audit_logs`（actor SYSTEM，task 为支付应用任务名） |

为什么快照而不是每次联表推导：订单行已经不可变地引用了礼物修订，类别本可推导；快照只是把这条推导固化一次，供支付写入、查单读模型、后台动作门控与 F2 榜单投影共用，避免四处重复两段式联表。后台既有的 `historicalGiftKind` 改为优先读快照、NULL 时回退推导。

## 3. 迁移 0038 `virtual-gift-fulfillment`

up：
1. 加列 + 回填（见上）。
2. `CREATE OR REPLACE` `guard_fulfillment_transition`：新增允许 `PENDING → DELIVERED`，仅当该履约行对应 `order_items.gift_kind='VIRTUAL'`；该路径不做"留言未审核不得送达"检查（数字凭证的送达不向任何人展示留言，留言仍走独立审核）。
3. `CREATE OR REPLACE` `validate_fulfillment_event`：允许 `PENDING → DELIVERED` 事件，仅当 `authority_kind='SYSTEM'`、`reason_code='VIRTUAL_GIFT_AUTO_DELIVERED'` 且行为 VIRTUAL。
4. `CREATE OR REPLACE` `notification_source_authority`：履约分支加 `e.authority_kind='ADMIN'`，系统数字送达不再触发实物"送达确认"邮件。
5. `CREATE OR REPLACE` `notification_order_snapshot`：每个 item 增加 `giftKind`（可为 null），并回填 `notification_runtime_state.base_variables`（一致性触发器要求变量与函数输出逐字节相等）。

down：`notification_runtime_state` 有行则拒绝（与 0029 的 down 同一口径）；恢复四个函数为 0004/0029 原文；删列。列内容可由回填规则重建，不属于不可逆历史。

订单聚合状态的推导规则（DB 触发器 `assert_fulfillment_aggregate` 与 TS `deriveAdminOrderFulfillment`）不改：全部 DELIVERED → DELIVERED；有 ON_HOLD → ON_HOLD；有 PREPARING/DELIVERED → PREPARING；否则 PENDING。混合订单付款后聚合为 PREPARING（数字行已送达、实物行待准备），纯虚拟订单直接 DELIVERED。

## 4. 领域层

`decideFulfillmentTransition` 的 authority 扩成联合类型：既有 `OPERATOR_COMMAND` 不变；新增 `SYSTEM_DIGITAL_DELIVERY`，只接受 `PENDING → DELIVERED`，仍要求乐观版本一致，返回 `reasonCode='VIRTUAL_GIFT_AUTO_DELIVERED'` 与效果 `FULFILLMENT_STATUS_CHANGED`。合同层的 `fulfillmentTransitionCommandSchema`（后台命令）保持只允许操作员权限，系统权限只在进程内构造。

## 5. 持久化写入

- 新模块 `digital-fulfillment.ts`：`deliverDigitalFulfillments(client, outbox, {order, lines, at, actor, requestId, correlationId})`。对每条 VIRTUAL 且当前 PENDING 的行：领域决策 → `UPDATE fulfillments`（DELIVERED，prepared_at/delivered_at=at）→ `audit_logs` → `fulfillment_events`（SYSTEM）→ outbox `FULFILLMENT_STATUS_CHANGED`（幂等键 `digital-fulfillment:<fulfillment>:<version>`）。返回送达后的各行状态，调用方据此算聚合。
- `order-payment-write.ts`：行查询加 `i.gift_kind`；成功路径在既有的"ON_HOLD 处理"之后调用上面的助手。规则：数字行只在其自身预占未失效时送达；库存失效（PAID_REVIEW）时数字行若自身预占失效则与实物行一样 ON_HOLD。`orders.fulfillment_status` 与 `order_events.to_fulfillment_status` 改为按各行结果推导（推导函数迁到共享模块 `fulfillment-aggregate.ts`，后台写入同样引用）。
- `checkout-preflight-write.ts`：写 `order_items` 时同事务解析并写入 `gift_kind`（新模块 `order-line-gift-kind.ts`，与迁移回填规则一致）。
- 后台：`readAdminOrderLines` 增加 `i.gift_kind`；`fulfillmentActions` 对 VIRTUAL 行只保留 ON_HOLD 时的 RESUME；`mutateAdminOrderFulfillment` 的 RESUME 若命中 VIRTUAL 行，恢复到 PENDING 后在同一事务立即数字送达；`reviewAdminOrderMessage` 允许 VIRTUAL 且已 DELIVERED 的行继续审核留言（凭证已送达不影响留言审核）。
- 查单读模型 `orderAccessItem` 输出 `giftKind`（NULL → null）。

## 6. 合同

- `orderAccessItemSchema.giftKind: giftKindSchema.nullable()`（公开 HTTP，工件注册自动带上）。
- `orderNotificationItemSchema.giftKind: giftKindSchema.nullable().optional()`（可选是为了让归档的 v1 变量继续解析）；v2 的 `variables.schema.json` 由合同生成。
- 后台 `adminOrdersLineSchema` 不变（`giftKind` 已存在）。

## 7. 粉丝端与文案

- `@fan-support/orders`：`fanOrderProgress(order, { digitalOnly })`，纯虚拟订单的时间线去掉"准备中"一步（已付款 → 已送达）；默认行为与 500 组合测试不变。
- 前台 `order-status.ts`：VIRTUAL 行 DELIVERED 显示"已计入艺人的应援记录"，PENDING/ON_HOLD 显示"应援记录待生成"；纯虚拟且已送达的订单帮助文案改为数字凭证语义；成功页复用同一组件。
- 新增 storefront 文案 key（七语言，DRAFT，更新审校哈希）：`orderDigitalDelivered`、`orderDigitalAwaiting`、`orderDigitalDeliveredHelp`。
- 通知邮件：按 `packages/i18n/src/notifications/README.md` 的规则新增模板版本 **v2**（`v1/` 保持归档、字节可复现，历史消息按钉死的 v1 身份重放）。v2 在正文后追加"数字应援已计入艺人应援记录"段落（订单含 VIRTUAL 行时，三种事件都加），条目加"数字应援"标记；模板加 `[[NOTE]]`/`[[KIND]]` 槽位；七语言 copy 新增 `digitalSupport`、`digitalItem`；v2 自带 `variables.schema.json`（由合同生成，`giftKind` 为可选可空，兼容 v1 变量）、`reviews.json` 21 条 DRAFT、`identity.fixture.json` 与 `history.fixture.json`。新选择只用 v2；`render` 按版本前缀分派。
- 后台：VIRTUAL 行显示"数字应援凭证，付款后自动送达"提示（管理中心文案七语言）。

## 8. 测试夹具调整

`apps/api/scripts/gift-storefront-fixtures.mjs` 的类别轮转改为 `PHYSICAL, WISH, MERCHANDISE, OTHER, VIRTUAL`，使默认下单礼物（`gifts[0]`）为实物，既有支付/通知/后台流程的断言不受自动送达影响；VIRTUAL 落在 `gifts[4]`、`gifts[9]`…，现有脚本未按这些下标下单。`storefront-catalog-fixtures.mjs`（rose-palace VIRTUAL）只服务目录/SEO 测试，不改。

## 9. 验证计划

| 层 | 内容 |
|:--|:--|
| 领域单测 | SYSTEM_DIGITAL_DELIVERY 只接受 PENDING→DELIVERED；其他起点/终点拒绝；版本不一致拒绝 |
| 持久化单测 | 混合订单成功：VIRTUAL 行 UPDATE→DELIVERED、SYSTEM 事件、outbox、聚合 PREPARING，实物行不动；纯虚拟订单聚合 DELIVERED；库存失效时数字行随预占决定；结账写入 gift_kind；后台动作门控与审核门控 |
| 真实 PG（本机可跑） | 迁移往返 + 目录快照（含四个函数体）；`postgres-order-payment-parameters` 覆盖 `digital-fulfillment.ts` 的 SQL；回滚前缀守卫加 0038 并在真实 PG 上验证 0038 的 down/up |
| 真实 PG + API（CI） | `admin-orders-fixture.mjs` 新增：VIRTUAL+PHYSICAL 混合订单付款后各行状态、SYSTEM 事件与审计、outbox 不产生送达邮件来源、通知变量含 giftKind、后台对数字行无动作、已送达数字行仍可审核留言、纯虚拟订单聚合 DELIVERED |
| 前台 | order-detail 单测覆盖 VIRTUAL 行文案与纯虚拟时间线；七语言 copy 审校哈希测试 |
| 邮件 | 渲染测试：含 VIRTUAL 行时出现数字段落与条目标记（每封各一次），纯实物不出现；v1 归档身份仍按字节复现；v1/v2 各 21 条 DRAFT 审校哈希测试与历史夹具 |
| 浏览器 | 查单页 VIRTUAL 文案七语言：本机无 S3，交 CI（草稿 PR） |

## 10. 不做与延后

- 不做方案 B/C（直播鸣谢、站外特效）。
- 不新增 `DIGITAL_DELIVERED` 邮件事件类型：会牵动通知表的 CHECK、来源函数、后台枚举与七语言新模板，收益低；数字语义并入付款确认邮件。
- 部署提示：迁移 0038 会重冻结既有 `notification_runtime_state.base_variables`（加入 `giftKind`），已发出消息的 v1 模板身份不变、仍可原样重放；这是预生产阶段可接受的一次性代价，正式上线后变量形状变更须同时保留旧快照函数。

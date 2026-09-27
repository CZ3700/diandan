# ADR-018：艺人应援榜、粉丝榜与公会赛成绩展示

> 状态：**Withdrawn（2026-09-28 用户决定全部取消）**，原为 Accepted（2026-09-26 用户批准全部子决策）
> 日期：2026-09-26（撤回：2026-09-28）
> 撤回说明：用户决定榜单、粉丝榜、应援值与公会赛成绩全部暂不做，先把应援礼物做扎实再考虑。规范 4.2.0 恢复 §2.2 对"排行榜、赛季"的禁止。本 ADR 与实现设计草案 `docs/plan/f2-leaderboards-guild.md` 只作参考保留；以后恢复须用户重新确认，并按当时的订单、支付与隐私实现重新评估。
> 决策者：Cz（2026-09-26 拍板恢复榜单与公会赛，要求"比对标站做得更好"）
> 关联：规范 §2.2 范围变更；`docs/analysis/2026-09-26-competitor-benchmark-and-launch-gaps.md`；ADR-005（加密 support intent 与署名）、ADR-012（简单管理中心）、`docs/plan/2026-09-26-v2-launch-plan.md`

## 背景

规范 §2.2 原将"排行榜、赛季"列为非目标。用户于 2026-09-26 明确要求恢复榜单与公会赛成绩展示。对标事实：mxcheer 的公会赛是停更的静态海报榜（不可翻译、不可访问、三个月未更新）；starvideoai 的消费榜公开粉丝真实姓名、完整邮箱和消费金额，是隐私反面教材。

可直接复用的既有资产：§11.1 `displayMode: anonymous|nickname`（粉丝署名机制已存在，无需新增同意流程）；§12 支付/退款状态机与 outbox 事件流；§9.0 原文直发内容体系与媒体管线；§10.4"投影只能可重建、不得成为第二真相源"约束。

## 决定

对规范 §2.2 做正式范围变更：允许"榜单与赛季成绩展示"，其余非目标（社区、私信、任务签到、众筹、分账、储值等）不变。新增三个只读展示能力：

1. **艺人应援榜**：公开。周期（周/月/赛季）运营可配置。计分只认订单支付聚合进入 PAID 的事件；退款、部分退款、拒付按事件自动冲销。数据是从订单/支付 outbox 事件重建的 PostgreSQL 投影表，可清空重放重建，绝不反写订单。读接口 30–60 秒 TTL 缓存。
2. **粉丝榜**：默认匿名。聚合键为粉丝邮箱的 keyed HMAC 摘要（密钥在 KMS，不可逆，表内不存明文邮箱）。仅当粉丝在订单中选择 nickname 署名时显示昵称快照，否则显示"匿名粉丝"。展示"应援值"（积分制，由版本化计分规则从订单金额折算并取整到 10 分粒度），不显示货币金额——汇率无关、弱化攀比、防止反推单笔消费。应援值仅用于展示，不可兑换、不解锁任何特权，与 §2.2 仍然禁止的"积分/储值体系"不冲突。
3. **公会赛成绩**：站外赛事成绩由运营录入的结构化内容对象（赛事名/周期/名次列表+关联艺人/海报媒体/来源说明），走既有 revision→VALIDATED→PUBLISHED 发布体系与媒体管线；七语言按 §9.0 原文直发、译文后补。

**比对标站更好的五点**：规则透明页（计分公式、周期边界、退款冲销、防刷单说明公开可查）；历史赛季永久存档；异常订单人工复核不计分；七语言；全部页面过既有可访问性门禁。

**明确不做**：资金分账、粉丝储值、按消费解锁特权的付费墙、粉丝等级/任务/签到、实时推送。

## 数据模型草图（均为投影或配置；公会赛沿用内容真相源）

| 表 | 关键列 |
|:--|:--|
| `leaderboard_rules_revisions` | id, points_per_usd_minor, rounding, effective_from（版本化，供透明页与重算） |
| `leaderboard_periods` | id, kind(WEEK/MONTH/SEASON), starts_at, ends_at, status(OPEN/CLOSED/ARCHIVED), rules_revision_id |
| `idol_support_scores` | period_id, idol_id, support_points, paid_order_count, last_event_id；PK(period_id, idol_id) |
| `fan_support_scores` | period_id, fan_key_hmac, display_mode, display_name_snapshot(仅 nickname), support_points, last_event_id |
| `leaderboard_projection_state` | consumer_name, last_event_id（重放游标；重建 = 清表 + 归零游标） |
| `guild_match_result_revisions` | revision_id, event_name, event_period, entries(名次+艺人)[], poster_media_id, source_note, 原文 locale；经 content_publications 发布 |

冲销：投影消费 PAID / REFUNDED / PARTIALLY_REFUNDED 及 dispute LOST 事件，按 last_event_id 条件更新做幂等增减分，负值归零显示。

## API 端点草图（只读公开，Zod 合同先行）

- `GET /api/v1/leaderboards/periods?kind=` —— 周期与历史存档
- `GET /api/v1/leaderboards/idols?periodId=&limit=` —— 艺人榜（Top50 上限）
- `GET /api/v1/leaderboards/fans?periodId=&limit=` —— 粉丝榜（纯脱敏视图）
- `GET /api/v1/leaderboards/rules` —— 当前计分规则
- `GET /api/v1/guild-matches?idolId=&page=` —— 已发布公会赛成绩
- 后台配置与录入复用既有 admin 发布通道，不新开公开写接口

## 页面清单

- 首页模块：应援榜 Top3 卡 + 最新公会赛成绩卡
- `/:locale/leaderboards`：艺人/粉丝双 Tab、周期切换、赛季存档、规则入口
- `/:locale/leaderboards/rules`：计分/周期/退款冲销/防刷说明
- 艺人详情页成绩区：当期名次徽章 + 公会赛历史成绩
- 后台：公会赛录入（沿用"一张图+短表单"交互）、周期与规则配置

分析事件按 §16.3 新增：`view_leaderboard`、`view_guild_match`、`leaderboard_period_switch`。

## 隐私红线（违反即回退发布）

- 永不显示、永不经 API 返回：邮箱、真实姓名、单笔订单明细、订单号、金额币种。
- 默认匿名；昵称展示复用 §11.1 既有明示选择，无新增同意流程。
- 应援值取整（10 分粒度），防止反推单笔消费。
- 榜单表不存明文邮箱；日志沿用 allowlist，不携带 fan_key。

## 考虑过的方案

| 方案 | 优点 | 缺点/风险 | 结论 |
|:--|:--|:--|:--|
| A 交易表实时聚合 | 无新表 | 高频扫交易表，易演化成第二真相源 | 拒绝 |
| B 外部分析仓库出榜 | 现成聚合 | 新增供应商，脱离 §10.4 可控投影 | 拒绝 |
| C outbox 事件投影（本案） | 可重建、幂等、冲销自然 | 需重放游标逻辑 | **采纳** |
| 粉丝榜显示美元金额 | 直观 | starvideo 反面教材：隐私+攀比 | 拒绝 |
| 公会赛纯海报图 | 录入快 | mxcheer 式：不可翻译、不可访问、易停更 | 拒绝；结构化为主、海报为辅 |

## 验证方式

- 单元：计分/冲销/取整；负分归零；周期边界（含时区）。
- 集成（真实 PostgreSQL）：全量事件重放重建投影 = 按订单直接重算，逐行一致；退款/拒付后名次回落；重复投递不重复计分。
- 合同测试：榜单响应过隐私断言（扫描邮箱格式、金额字段等禁止内容）。
- 浏览器验收：七语言双端、320px/200% 缩放、键盘导航；TTL 缓存生效。
- 回退：功能开关下线路由；投影表可整体删除，不影响订单/支付数据。

## 工作量分解（粗估）

| 项 | 人日 |
|:--|--:|
| 规范修订 + contracts 合同 | 2 |
| 迁移（周期/规则/投影表+索引） | 2 |
| 投影消费、冲销与重建命令（worker） | 4 |
| API + 缓存 + 管理配置 | 3 |
| 前台页面/模块（七语言 + 可访问性） | 5 |
| 后台公会赛录入 + 发布接线 | 3 |
| 测试（单元/集成/隐私断言/浏览器） | 4 |
| **合计** | **23** |

## 子决策批准记录

2026-09-26 用户批准：

1. 粉丝榜显示"应援值"（积分）而非美元金额 —— **是**。
2. 榜单周期首发采用 月榜 + 赛季榜（周榜后续再开）—— **是**。

本 ADR 即日起为 Accepted；规范 §0.2、§2.2 与 §16.3 已于 2026-09-26 随 R0 修订为 4.0.0。虚拟礼物的应援值入账语义见 ADR-019。

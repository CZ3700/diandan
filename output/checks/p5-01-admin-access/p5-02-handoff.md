# P5-02 技术交接（只读准备，未领取）

2026-09-18。本文件仅供 P5-01 完整本地验收 DONE 后使用；当前不登记 P5-02 owner、不修改生产代码、不新增迁移、不启动服务或测试。依赖与验收以 `docs/plan/task-breakdown.md:138`、SPEC §9.8/11.2/12.2/14 及 ADR-015 为准。

目标是原来一个管理中心内的“订单”入口：列表 → 详情 → 审核留言 → 准备中/已送达；内部备注和重发最新状态通知放在同一详情页。内容上传短表单保持原样，不增加独立复杂后台、退款、争议、支付路由、粉丝地址寄送或艺人登录。

## 可直接复用与明确缺口

| 能力 | 已有文件/数据库依据 | P5-02 最小缺口 |
| --- | --- | --- |
| 身份、会话、权限 | `packages/contracts/src/admin-access.ts`；`packages/application/src/admin-access.ts`；`packages/persistence-postgres/src/admin-session-repository.ts`；Admin 的 `src/server/admin-access-bff.ts`；API 的 `src/admin-access-route.ts` | 新订单权限与命令授权。现 `adminSessionPermissionSchema` 只包含内容/资源权限，不能把订单权限塞进旧响应或授予 `management.direct` 来绕过。P5-01 六角色夹具的 Order Operator 内容权限为 `[]`，这并不等于订单业务已实现。建议新增独立版本化订单权限/上下文合同，由平台数据库读取；旧 schema roots 保持。 |
| 订单列表与详情 | `contracts/src/order.ts` 的内部不可变快照和安全公共投影；`order-access.ts` 是粉丝安全查单；PG `order-access-read.ts`、`order-access-data.ts`；`checkout-preflight-write.ts` 已写订单行与履约初始行 | 缺少管理员分页/筛选列表、详情 application/port/repository/route。新增管理员专用只读投影，默认不含留言、完整显示名、邮箱、地址；不要复用粉丝 bearer-token 权限。按历史订单快照显示名称、媒体、数量与金额，禁止拼接当前商品价格。 |
| 履约状态机 | `domain/src/fulfillment-state-machine.ts`；`domain/src/state-machine-commands.ts` 的 `decideFulfillmentTransitionCommand`；`contracts/src/fulfillment-notification.ts`；0004 的 `fulfillments`、`fulfillment_events`、`order_events` 与事件头约束 | 缺少管理员执行用例/事务仓储。以 canonical order + fulfillment 双版本执行，在一个短事务中写状态、逐履约事件、订单聚合事件、审计和 Outbox；并发、幂等与事务回滚不可拆开。 |
| 私密留言审阅 | `contracts/src/commerce.ts` 的 `supportIntentSchema`/moderation；0003 的 `support_intents`、`moderation_evidence`；0023 修订 moderation guard；`key-management-port` 与 KMS adapter | 缺少管理员审核队列、私密读取授权与逐次访问审计、人工审核命令/收据。现 `fan_message_locale` 只有七语或 `und`，并没有充分表达检测置信度与审核员语言能力；应独立增加必要元数据/授权，不把内容翻译人员的 `admin_content_locale_grants` 当作阅读粉丝留言的授权。 |
| 解密时序 | `application/src/cart-edit.ts`、`cart-editor-private.ts` 已有“先审计，再 KMS 解密，再重新检查授权/版本”的模式；`notification-recipient.ts`、PG `notification-access.ts` 同样隔离解密 | 新增订单审核敏感读取路径，复用 `SUPPORT_INTENT_MESSAGE`/`SUPPORT_INTENT_DISPLAY_NAME` 的 purpose 与 subject 绑定。KMS 网络调用在 SQL 外；返回明文前重验 session、角色、隐私状态和 intent 版本。普通列表/SSR/RSC/日志/截图/Outbox 不得承载明文。 |
| 内部备注 | 当前已读 contracts/ports/PG 未发现订单内部备注完整链 | 新增受权限保护、长度受限、幂等、追加式备注与审计。备注不进入通知或粉丝 DTO，避免把秘密/地址抄进普通字段；若允许敏感内容，必须定义加密与保留策略，不能默认任意明文备注安全。 |
| 自动通知 | `contracts/src/order-notification.ts`；`persistence-port/src/order-notification.ts`；`application/src/order-notifications.ts`；PG `notification-{data,request,lifecycle,access}.ts`；`apps/worker/src/notification-composition.ts` | PREPARING/DELIVERED 模板与发送管线已有。新履约写入必须满足0029 `notification_source_authority` 对 fulfillment event、order event、Outbox 的同订单/同版本/同时间/同请求证明，不能自行构造一个 status payload 就发送。通知失败不能回滚履约。 |
| 人工重发 | 0004 有 `UNIQUE(order_id,event_type)`；`requestNotification` 对已有业务事件返回 `REPLAY`；发送有租约、dedupe 截止、不可变快照与一次性查单凭证 | **现 request/retry 不等于人工重发。** 缺少受授权、幂等且审计的重发命令/追加收据。建议 UI 仅“重发最新状态通知”，另行冻结最小追加式 resend/generation 模型；不能把 SENT 改回 REQUESTED、删除唯一约束、改旧快照或随意复用已消费链接。迟到旧状态通知/重复点击/邮件响应丢失必须不会触发重复发送。 |
| 同一个管理中心 | `apps/admin/src/management-center/{shell,workspace,center,api}.tsx/ts`、七语 `copy-*.ts`；`apps/admin/src/server/admin-bff.ts`；现有登录/退出 | 在现有壳中加权限可见的订单入口和详情，保持简单。普通行按钮仅显示合法下一步；消息明文需要显式打开；Manager 的异常处理与原因输入收起。不能仅靠前端隐藏按钮授权。 |

## 首先冻结的三个边界

1. **权限与审阅能力。** 订单查看、敏感留言读取、审核、履约、备注、通知重发、Manager 强制变更分别有明确 canonical 权限；一般内容编辑/译审/Daily Operator 不获得敏感权限。语言能力授权独立于 UI locale，未知语言/低置信度始终人工待审，不默认英文或自动批准。
2. **强制变更的有限含义。** 现 domain 与0004只允许正常邻接：PENDING→PREPARING→DELIVERED、ON_HOLD往返及允许的取消；没有通用 force authority。先明确有限异常白名单，再用新增合同/迁移实现 Manager+原因+双重确认+审计。不能放宽现有普通状态机，也不能跳过已付款证明、私密审核、订单归属、不可变历史或终态保护。该验收项未定义/未验证则不能标 P5-02 DONE。
3. **人工重发。** 与自动首次发送的业务事件幂等分开设计，明确最新状态、次数/时间边界、同键重试和查单令牌更新规则；沿用已实现 receiver 幂等与有效期，不引入新邮件供应商或真实外发。

## 四种礼物共同履约规则

`VIRTUAL / PHYSICAL / WISH / MERCHANDISE` 均为粉丝付款后由工作室准备/采购并转交艺人，MVP 仍是 `internal_to_idol`；`OTHER` 保持合同兼容。虚拟礼物不自动送达或产生余额；心愿不是众筹；周边不启用寄给粉丝的地址链。

`giftKind` 与库存策略是独立维度。`TRACKED` 使用真实库存，`PROCURE_ON_DEMAND` 允许无现货持续售卖并显示按单准备/采购，`PREORDER` 按明确约定履约；不得从礼物类型推断无限库存，也不在准备/送达时重复扣除支付链已消费的库存。读取历史礼物类型应通过订单绑定的翻译/内容 revision 找到 `gift_revision_profiles` 的不可变分类证明；库存策略应绑定已保存的 checkout observation/历史证据，不能读取最新 variant 后伪装成当时约定。旧 profile 的 LEGACY 必须依来源证明识别，缺失证明不可自动当 OTHER。

0004 的数据库 guard 已要求有留言时 APPROVED 且未PURGED才能 PREPARING/DELIVERED；无留言仍须排除 REJECTED/REDACTED。这是必须保持的安全门。锁定/转换后的 intent 私密内容及 `fan_message_locale` 不可改写；人工确定的审核语言与能力证据应追加记录，不应更新已锁定原始语言来绕约束。

## P5-01 DONE 后的最小并行分工建议

同一 P5-02 仍只有 root 一名 Lane C executor；下列是该任务助手的文件分工，不是并行领取多个任务。先由 root 冻结新合同/port/OpenAPI，再并行消费者。

| Owner 建议 | 独占范围（新增名为建议，尚未建立） | 交付顺序 |
| --- | --- | --- |
| root | 新 `contracts/src/admin-orders*.ts`、`persistence-port/src/admin-orders.ts`、application/API composition与高风险命令OpenAPI、注册生成文件 | 先RED合同/权限矩阵 → 正常读写用例 → 统一HTTP/worker/浏览器整合；冻结重发/强制变更含义 |
| 持久化助手 | 新 `persistence-postgres/src/admin-orders*.ts` 与下一未使用迁移序号、真实PG脚本 | canonical授权/历史投影 → 追加审核/备注/履约收据 → 状态+审计+Outbox原子提交 → 并发与不可变约束；不改0001–0030 |
| UI助手 | 管理中心新增订单列表/详情/审核组件、BFF、七语文案与双视口验证 | 先read-only列表/详情，再逐步接按钮；保留短表单；敏感面板无持久客户端缓存 |
| 独立复核/通知助手 | 只读审敏感访问和并发边界；合同冻结后可独占人工重发/通知适配扩展及对应测试 | 复用已有worker发送链，保留首次发送历史与原 dedupe，不与持久化助手改同一迁移 |

建议先形成一条真正可操作的纵向闭环：本地OIDC Order Operator登录 → 已付订单列表/详情 → 一条已授权语言留言人工批准 → PREPARING → DELIVERED → TEST通知一次。随后覆盖低置信度/多行订单、备注、受审计重发和Manager异常处理；不先铺一批不可用页面。

## 可复用验证入口（本次均未运行）

- 所有命令前缀：`mise exec node@24.20.0 --`。构建受影响依赖后运行，不使用环境默认Node；统一整合门仅root执行。
- Domain：`corepack pnpm --filter @fan-support/domain exec vitest run --config ../../vitest.config.ts --root . src/fulfillment-state-machine.test.ts src/state-machine-subject-bindings.test.ts src/state-machines.property.test.ts`。
- 私密访问模式：`packages/application/src/cart-edit.test.ts`（解密前审计、解密中失权/过期/版本变化）和 `packages/key-management-kms/src/support-intent-key.test.ts`；新增管理员用例不能只重用粉丝授权测试。
- PG旧约束：`node packages/persistence-postgres/scripts/postgres-constraints.mjs`、`postgres-cart-moderation-guard.mjs`；按实际变更选择，不把全部重复跑当进度。
- 真实订单/通知夹具：`apps/api/scripts/order-payment-http.mjs`、`order-access-http.mjs`；`packages/persistence-postgres/scripts/notification-integration.mjs`；worker `notification-composition.test.ts`。复用真实已付订单、TLS TEST gateway及故障注入，不写假PAID/假DELIVERED绕证据。
- 新身份入口：`apps/api/scripts/admin-access-http.mjs`、`admin-access-fixtures.mjs`、`admin-access-browser.mjs`、`admin-access-next.mjs` 可复用真实本地OIDC与会话；按新订单权限扩展夹具，不能复制固定Cookie当登录证据。
- 新P5-02 RED必须包括：无支付/UNKNOWN拒绝履约；未审核/未知或低置信度留言拒绝；错误语言权限拒绝；同订单多艺人/多行聚合；错误归属/版本/CSRF/角色；双击和响应丢失只一份事件；Manager与非Manager强制差异；审计/Outbox回滚；敏感读授权撤回；被PURGED拒绝；通知失败不撤销状态；重发幂等与旧消息防倒退。
- 完整验收仍须七语390×844/1440×900、键盘/焦点/reduced-motion、错误/冲突/重试状态、2分钟运营演练；截图前关闭/遮蔽所有私密留言、显示名、邮箱、地址与凭证。这里只使用合成TEST数据，不对外发送邮件。

本地实施不等于正式运营：生产IdP/MFA恢复、邮件服务与译审、真实PSP、履约政策/隐私保留期限、生产UAT和P3/P4未完门继续保留。退款/争议/支付设置属于后续任务，不能由本交接提前扩展。

# P4-05 — 订单结果与安全查单接续方案

> 状态：ACTIVE，本地实施（2026-09-10，ADR-014）；基线 `acbdedc`。

## 顺序检查点状态

- 付款证据原子应用：2026-09-15本地验收通过，39项原门分段覆盖；详见本轮final-verification。
- 安全查单：2026-09-15服务端检查点本地验收通过；实际PG/HTTP、历史图片与原文、凭证会话完成，40门按差分分段覆盖，详见安全查单final-verification。
- 七语言成功页与时间线：依赖查单授权和历史读模型，尚未接通。

## 开发顺序

用户先明确商户资料后补，再要求继续下一阶段；据 ADR-014 接续已验收 TEST 支付与通用接口检查点。P4-04 保留未完商户验收且无 executor，P4-05 本地范围已从 READY 领取；实际 PSP、P3 验收和 Phase 5 门不变。按证据原子应用、安全查单、界面三个顺序检查点开发，同一候选统一验证。

## 粉丝将得到的行为

1. 支付返回后，先显示“确认付款中”；服务端可靠处理完成才显示付款成功及订单号。
2. 能安全查看原订单的礼物、艺人、金额和履约进度，商品下架或后来修改文案不会改写历史订单。
3. 限量礼物提交真实预占；按单准备、虚拟/心愿等礼物按照已保存的独立库存策略处理，不伪造库存、不限制本来可以重复售卖的礼物。
4. 迟到收款且预占已经释放时，显示“已付款，待工作室处理”，保留已收款事实并进入 ON_HOLD，不静默超卖。
5. 失效或已使用的查单链接给出清晰说明，不允许只凭订单号读取私密订单。

## 已核实的复用点

| 现有能力 | 代码入口与边界 |
|:--|:--|
| 订单及媒体/金额/语言快照 | P4-03 已创建 orders/order_items、联系人、政策与履约初始记录；`packages/contracts/src/order.ts` 已提供内部快照及移除内部 ID/object key 的公开映射，不重复创建订单。 |
| 原始验签与持久 inbox | `packages/application/src/receive-payment-webhook.ts` 在验签后原子保存加密原文、provider event、UNMATCHED 关联和 ID-only job。验签 candidate 不是可直接入账的最终证据。 |
| Worker 幂等骨架 | `packages/application/src/process-webhook-inbox.ts` 在同事务记录 effect 和处理结果；`apps/worker/src/reliable-events-composition.ts` 已注册默认订单付款 handler，并以真实协议证明原子应用与维护扫描恢复。 |
| 认证 reconcile 证据 | P4-04 已持久化真实查询证据、关联与 capture 流水；EVIDENCE_PENDING 仍表示等待订单应用，普通 GET 没有处理副作用。 |
| 金融与库存规则 | `packages/domain/src/order-state-machine.ts`、`inventory-reservation.ts` 和 `late-payment-success.ts` 已有纯决策；晚到成功使用协调 planner，不能给普通订单状态函数放开 CANCELED→OPEN。 |
| 查单存储 | 原 0004 已有 order_access_tokens/order_access_sessions、摘要、作用域、唯一性、消费/过期约束；现有七语言 `/orders/lookup` 页面还是 unavailable 占位。新读模型必须支持0025的DAILY v2原文快照，旧v1 mapper不能直接复用。 |

## 必须先解决的衔接点

### 1. 把关联、入账与副作用放在同一事务

当前 webhook 都先作为 UNMATCHED 保存。补充同一个 PostgreSQL client 上的证据关联与应用 repository，严格绑定 endpoint/account/environment、merchant reference/attempt、external reference、金额和币种。不得只凭浏览器 order ID 或 provider event ID 猜关联。

早到事件没有匹配 attempt 时保留可恢复状态；不能记录为业务处理成功后永久丢弃。重复 webhook 与同一笔 reconcile 最终汇入原持久 provider event/transaction，不重复 capture、订单、库存流水或通知事件。包含交易的事件在匹配时必须满足原 0005 的 payment_transactions 延迟约束。

现有 verifiedWebhookEventCandidate 没有 merchantReference，provider_events 也没有相应列；当前只可依据已验签 externalReference 做延后关联。如果要覆盖 merchant UUID 的早到快速匹配，必须先添加兼容、可序列化的可信关联合同与存储，不能从未验签 URL/客户端提示取值。

原 provider_events 对同 account/environment/transaction type/reference 有唯一约束。webhook 与 reconcile 可能以不同 event ID 报告同一 capture，必须让可信重复观察引用原始 ledger/evidence；不能删唯一约束或编造新的交易 reference。TEST reconcile 的稳定 event ID 只证明同来源重放，不能代替双来源同 capture 验证。

### 2. 分开“已接收证据”和“已应用订单”

0026 的 payment runtime operation 在 EVIDENCE_PENDING/COMPLETE 后不可任意更新。优先新增独立的 evidence application receipt/job，保留原接收事实；需要精确扩展状态时必须使用新迁移及带数据回退证明，不改原 0001–0026。

前台读取应根据已应用的 canonical 订单事实结束“确认中”，不能只把旧 recovery 字段改为成功。新的读模型必须先锁定兼容合同，旧合同根保持不变。原 public payment runtime schema 禁止 SUCCEEDED 配合非 NONE recovery，因此应用回执与读取映射必须一起接通；不能只更新 attempt 后把无效组合返回浏览器。

成功应用要满足原 0005 的完整聚合守卫：attempt SUCCEEDED、订单 OPEN/PAID、cart CONVERTED、准确预占和履约，以及 PAYMENT_STATUS_CHANGED / ORDER_PAYMENT_CONFIRMED outbox 同时成立。不能拆成先显示成功、以后补库存的事务。

原 SQL 的已释放/过期预占晚到成功分支要求旧 attempt 为 UNKNOWN；已失败终态或存在竞争 attempt 不能强行翻转。符合条件时剩余 ACTIVE 预占正常提交，保留 RELEASED/EXPIRED 行，并将订单履约置为 ON_HOLD。共享库存行的多个订单项必须递进同一 balance version；重复处理先命中永久回执。

### 3. 失败释放库存与受控重试不能互相矛盾

P4-04 的可信失败目前终结 attempt，保留有效预占，因此可以受控重试同订单。P4-05 按规范释放预占后，原 beginCreate 会拒绝 RECHECKOUT_REQUIRED，这是正确保护，不能删除检查或复活 RELEASED reservation。

实现前必须明确分支并写失败测试：资源仍有效、没有被释放时保留受控同订单重试。预占已释放/过期，但原订单仍可付款且原报价有效时，经粉丝明确确认和重新预检后才能建立新预占；订单已取消、报价过期或金额变化时，必须创建新的合法订单与快照，普通重试不能重开 CANCELED。旧订单只允许符合原状态机的可信迟到成功恢复。保留旧键查询和历史关联；不自动复制付款、不移动旧 intent FK。旧失败事件不能释放后来活跃 attempt 正在使用的资源。

### 4. 查单令牌及授权

新增有 schemaVersion 的令牌签发/交换、撤销/过期、受保护读取合同，随机高熵凭证仅保存 keyed digest。token 放在邮件链接 fragment，页面读取后立即从地址移除，以 POST 交换 Secure/HttpOnly 订单范围会话；不写 query、URL 日志、localStorage 或公共 DTO。

数据库的一 token 一 session 与单订单活动 session 约束需要覆盖并发交换、重复点击、丢响应、过期和撤销。不能把重放当成新的授权；失败状态需保留可理解的恢复入口。成功页与查单页都只读快照，普通读取不触发 PSP 查询、财务处理或发邮件。

支付后的当前浏览器访问也要经明确的订单范围授权交换，不能因为拿到 publicOrderId 就开放查询。实际邮件发送、不可变七语言邮件模板与大范围清理仍属于 P4-06；本轮不展示虚假的“邮件已发送”。

## 实施顺序与独占范围

1. 协调者冻结新的合同、公开状态映射和重试/重新预检行为，先补有效失败测试。
2. PostgreSQL：同 client 的证据关联、永久应用收据、稳定锁顺序、订单/attempt/cart/intent/履约/库存/history/audit/outbox 原子处理；只新增前向迁移，使用原 Domain 决策。
3. Application/Worker：注册真实处理器，使 webhook 与 reconcile 接入同一幂等处理入口；恢复任务仅消费持久引用，不携带 secret 或私密内容。
4. API/BFF 与查单：受保护交换、只读历史视图、媒体 URL 映射、无权限/失效/暂时失败状态。
5. 七语言界面：付款成功/确认中/待人工处理、订单详情与时间线，沿用已批准黑金样式，语言切换只改变界面外壳。
6. 各模块定向通过后冻结一个候选，统一实际集成与全仓验收；不重复跑多套相同的完整检查。

合同、迁移序列、根配置和生成物由协调者独占。PG、API/协议、UI 仅在合同冻结且文件明确划分后并行；它们是同一个 P4-05 的子步骤，不同时领取多个 Task ID。

## 验证矩阵

- 验签失败、错误 endpoint/account/environment/金额/币种拒绝；早到事件恢复；重复与乱序 webhook；webhook/reconcile 同时到达。
- 服务重启、事务回滚、COMMIT 响应未知与重放；每一业务效果只能出现一次。
- 有限库存成功提交、失败释放、超时不误释放；按单准备无需库存；晚到成功 ON_HOLD；过期释放与成功提交并发；旧失败与新 attempt 并发。
- 快照在商品/艺人/价格/语言修改后不漂移；无内部 intent ID、对象 key、完整邮箱、留言或凭证泄漏。
- token 并发交换、重放、丢响应、过期/撤销、跨订单/跨 Cookie；fragment 清除；Origin/CSRF/no-store/noindex。
- 七语言 × 390×844/1440×900，键盘、焦点、加载/空/错误与 reduced motion；截图不含凭证或私密信息。
- 真实 PostgreSQL、独立 TEST PSP、队列、HTTP 与浏览器；随后原 format/lint/typecheck/test/build/架构/出口门和非作者 S.U.P.E.R 复核。旧证据只按明确输入范围复用。

## 下一个界面检查点的具体范围

安全查单服务端验收后，继续同一 P4-05，使用现有黑金组件与七语言文案，不引入新的后台操作流程。

1. 增加独立订单 BFF/transport，仅允许四个已定义 API；订单 Cookie、CSRF 与购物车隔离，严格校验 Set-Cookie、正文大小、返回动作/订单范围及 Retry-After。沿用 no-store/no-referrer/noindex。
2. 付款结果以 canonical 已入账订单为准：确认中保留等待状态；成功后通过原有效 checkout 获取受保护授权，报价过期不阻断已付款查单。避免每次渲染或自动重试都重新轮换会话。
3. 查单页面立即清除 fragment。未来邮件链接携带 token 与非授权 publicOrderId 提示；交换成功以服务端结果为准，收到 Cookie 但正文丢失时仅用已知订单号尝试受保护 GET。全部响应丢失且没有原 checkout 时展示如实的恢复说明，不假装已重发邮件。
4. 订单展示使用新历史 DTO：保留购买时艺人/礼物/规格/图片/金额及真实内容语言；旧 v1 规格 null 如实处理。切换七语言仅改变界面外壳，不改订单价格、币种或原文来源。
5. 覆盖 abort、过期/撤销、后退恢复、并发响应顺序；重新进入页面要重新验证授权，旧响应不能覆盖新的订单状态。时间线只能使用真实已保存的事件时刻；当前仅有状态的字段不得编造准备/送达时间，必要时先补兼容事件读合同。
6. 验证七语言 × 390×844/1440×900、键盘、错误恢复和 reduced motion，包含真实浏览器 Secure/HttpOnly Cookie、fragment 清除及跨订单拒绝。实际邮件发送继续属于 P4-06。

## 当前执行入口

执行登记与实际证据以 `docs/progress/phase-4-commerce.md` 为准。正式 PSP 及支付账户信息不由代理猜测，本地验收不等于生产发布。

# 2026-09-15 项目恢复：进度与下一检查点只读审计

审查者：`/root/progress_audit`。范围：完整大纲、当前权威进度、Git/现有证据、后继安全查单设计。只读产品代码，不启动服务或大测试；此记录不代替付款代码的独立终审。本文件是本代理唯一写入。

## 1. 当前项目事实

已按入口阅读 SPEC、MASTER、ACTIVE Phase 3/4、完整 task-breakdown 与项目 SKILL；进一步核对风险表、P4-05 顺序计划、关键源码/SQL、真实结果文件与 Git。优先采用当前状态表和最终证据，不把 phase 中倒序保存的历史 `LOCKED`/`READY` 记录当成当前状态。

- 当前 Git HEAD 为 `acbdedc feat(payment): add versioned gateway connector foundation`。之前紧邻提交为 `53340ca` 查单方案、`7d3f9d9` 支付验收来源、`f5435cd` 托管支付运行时、`f1f702f` 真实结账订单、`059dd9d` 前台购物车。
- P4-05 原子付款应用存在于未提交工作区。任务表仍为 **25 DONE / 3 IN_PROGRESS / 21 PENDING = 49**，按任务数量约 51%；这个比例不能解释为上线完成率、剩余工时或功能权重。
- Phase 0/1/2 CLOSED；Phase 3/4 ACTIVE。P3-06 验收待续、P4-04 商户待续均无 executor；P4-05 是唯一在执行的任务。Phase 5/6/7 LOCKED。
- 用户同意本地提交、最后统一推送。现场无新 commit，不能声称 GitHub 已同步本轮实现。
- 上下文出现的 brand/admin agent 名称不是代码证据。未发现相应新提交；本报告不把代理名、拟议品牌素材或过去任务标题计为新增成果。

## 2. 已完成与剩余大纲

| 阶段 | 已实现/已验收事实 | 仍须完成的门 |
| --- | --- | --- |
| P0 基础工程 | pnpm/Turbo/TS、四应用、配置/密钥边界、OCI 本地预览、CI/trace、基础设施 ADR | 生产 apply 不属于历史本地通过 |
| P1 合同与数据 | 七语言、内容/价格/库存/订单/支付状态机、PostgreSQL、可替换 ports、验签 inbox/outbox/pg-boss | 领域/存储骨架不代表所有业务入口已接通 |
| P2 视觉与组件 | 已批准中性黑金视觉、混合色摄影、原语/组合/动效、reduced motion；历史物理 iPhone 验证 | 正式品牌/肖像授权与当前版本真机结论独立 |
| P3 浏览与管理 | 实际艺人连续浏览/搜索定位、礼物分页/筛选/价格排序、七语言路由/SEO/cache；真实媒体处理；用户要求的一图短表单管理中心、海报历史恢复 | P3-06 真实性能预算仍失败，非开发运营计时、实际读屏、当前关键文案人工译审待续 |
| P4 购买闭环 | P4-01/02/03 DONE：加密私密意图、真实购物车、当前事实预检、政策/金额/语言/媒体快照、库存预占及既有待付款订单 | P4-04 实际 PSP；P4-05 安全查单及成功/订单 UI；P4-06 七语通知/重试/清理 |
| P5 运营与支付 | 大纲已定义；底层部分能力存在 | 正式 OIDC/MFA、订单准备/送达、审核、退款/争议、规则配置发布回退、待办重放、PSP runbook、production-like staging；阶段尚不可领取 |
| P6 加固与恢复 | 验证工具/历史门可复用 | 整体七语言 E2E、真实读屏、性能、安全/故障/恢复演练 |
| P7 上线 | 尚未开始 | 正式主体/素材/市场/政策、staging UAT、实际支付退款、告警/值守、渐进发布与复盘 |

商品语义已经落地：`VIRTUAL/PHYSICAL/WISH/MERCHANDISE/OTHER` 与 `TRACKED/PROCURE_ON_DEMAND/PREORDER` 分离。按单准备可零现货重复售卖；全部由工作室准备/采购后转交艺人，不能扩成众筹、余额或寄粉丝。

语言规则已变更并落地：普通艺人/礼物/海报可按真实原文直接发布，不需要伪造七份批准译文；政策、付款安全、订单/邮件及站点关键文案仍需严格七语言规则。后续查单必须保留此差别。

## 3. P4-05 当前真实证据，比旧摘要更新

现场 `check-full-result.json` 为 **exit 1 / 1653.618 秒**，已经结束，不能继续称“正在执行”。`check-full.log` 末端是 `postgres-persistence.test.ts` 的 repository key 精确清单未包含新增 `orderPaymentApplication`，该包 574 PASS / 1 FAIL，Turbo 58 successful / 61 total；这不是实际 HTTP 原子付款失败，也不是最终质量门全绿。Root 应按当前源码复核该窄测试修正与精确剩余质量门，不改旧业务守卫。

已实际读取两份完整协议结果：

- `run-2026-09-09T19-07-38.723Z/run-result.json`：PASS、6827 断言、已尝试自有 fixture 清理。
- `run-2026-09-09T19-10-51.808Z/run-result.json`：PASS、6827 断言。对应 `protocol-results.json` 为 5763 准备 + 1064 协议断言；另 8 项 rollback 验证，35 表数据哈希保护。
- 后者包含七语言 reconcile→PAID、PREORDER 无预占、共享限量库存、验签 webhook 入账及重复、三个双来源顺序、UNMATCHED 恢复/批次公平、真实 FAILED/CANCELED 释放、实际过期后迟到 capture→PAID_REVIEW/ON_HOLD。
- 双来源第一次并发中的 40001 与 PERSISTENCE_FAILURE 如实保留；最终两来源收据收敛，不把首次事务都成功作为条件。COMMIT 前回滚/COMMIT 后结果未知有真实数据库 COMMIT，但 `actualNetworkDisconnect=false`。
- 明确 `actualIndependentTestPsp=true`、`actualPspSandbox=false`、`orderLookupImplemented=false`、`browserEvidence=false`。这是实际本地 PG/HTTP/TEST PSP 验收，不是外部 PSP sandbox、真实收款或查单 UI。

当前 `independent-review.md` 仍写 REQUEST_CHANGES，两项 P1 等待真实 HTTP GREEN 的独立复核。现有晚于审查的 PASS 结果足以作为复核输入，但须由非作者核对当前源码和确切场景后更新，不能自行把旧审查改成 ACCEPT。

P4-05 顺序计划的“已核实复用点”仍保留“默认业务 handler 尚未注册”等初始现状描述，而工作区当前已实现默认 handler。Root 收尾时应更新成“基线缺口已在检查点 1 解决”以免后续代理重复实现。

## 4. 下一安全查单 checkpoint 的最小实现边界

先收尾并固定当前原子付款候选，再继续 **P4-05 检查点 2**，不领取 P4-06 或 Phase 5。本子检查点提供受保护的订单访问：当前结账浏览器建立订单范围会话、一次性邮件式 token 的安全交换、历史订单只读 DTO；界面情绪闭环和完整七语订单页是检查点 3。邮件实际投递、模板/重发和全局清理继续 P4-06。

推荐固定下列入口形状后再开始消费者并行实现（具体名称由 Root 冻结）：

1. 内部 `issue/rotateOrderAccessToken`：仅可信 checkout 授权或以后受授权通知工作流可调用；随机 32 字节、版本化 keyed digest，仅一次返回 raw token。不能匿名用 publicOrderId/邮箱发行凭证。
2. `POST /api/v1/order-access/exchange`：body 只接受版本化 token/必要展示上下文，精确 Origin/JSON/body limit；不接受 caller order ID、金额、已付款标志或 session digest。成功仅设置短时 Secure/HttpOnly cookie，响应非敏感 publicOrderId/期限。
3. 当前浏览器 `POST checkout-session/.../order-access`：已有 cart/checkout Cookie+CSRF 权限和实际 PAID/PAID_REVIEW 是发行依据；不能以浏览器回跳、UUID 或仅支付证据已接收授权。可把内部 token 签发→消费→session 创建在同事务完成，使原 session FK 仍有真实消费来源，raw 一次性 token 不必进入浏览器。
4. `GET /api/v1/orders/:publicOrderId`：每次校验订单范围 session 摘要、状态、实际期限和 path publicOrderId；只读 canonical 历史事实，不触发 PSP、付款应用、邮件、库存或业务状态推进。
5. 内部 token/session 撤销、过期与轮换接口保持权限限定。没有当前需求时不开放通用管理 CRUD。

访问凭证和 financial evidence 必须是完全不同的授权体系；token 只能读已有订单，不能推进付款/履约。

## 5. 可复用点与需要先冻结的缺口

| 所在层 | 当前准确入口 | 复用方式/必要增量 |
| --- | --- | --- |
| Identifiers | `packages/contracts/src/identifiers.ts` | `publicOrderIdSchema` 与 `orderAccessTokenSchema` 已有；后者是 43–128 字符基型，运行凭证仍应验证 32 字节 canonical base64url；补独立 order-session token/id 类型，不滥用 cart 类型 |
| 公开订单 v1 | `packages/contracts/src/order.ts` | 金额算术及公共字段 allowlist 可复用；`toPublicOrderItemView` **不能直接解析当前所有订单**，见下文 |
| 真实快照 | `checkout-preflight.ts`、`checkout-preflight-internal.ts`；PG `checkout-preflight-write.ts` | 已有 `checkoutTranslationSnapshotSchema`、`checkoutMediaSnapshotSchema`、严格与 DAILY 来源、immutable observation/receipt；读取历史 order_items 及对应 observation，而非再次跑当前发布资格 |
| 旧 SQL | `database/migrations/0004_orders-fulfillment.up.sql:250` | token/session 表、不可变摘要/作用域、消费与过期状态、每 token 唯一 session、每 order 一条 ACTIVE token/session 已存在，优先复用，不改旧迁移 |
| Credential adapter | `apps/api/src/cart-session-credentials.ts` | 32 字节随机值、canonical base64url、KeyManagement `computeBlindIndex`、4 版本 pepper 解析、timing-safe CSRF 可参考；应新建订单职责 adapter，不能用 cart purpose/同一凭证 |
| KMS port | `key-management-port-contracts.ts` | 已有 `ORDER_ACCESS_TOKEN` purpose，可做明确用途前缀隔离 link/session（或新增兼容扩展）；raw 值停在 transport，Application/PG 只收摘要；不改旧冻结 enum 后宣称旧根字节不变 |
| API | `cart-route.ts`、`checkout-preflight-route.ts`、`payment-runtime-route.ts` | 严格 Cookie/单 header/Origin/CSRF、private no-store/noindex/no-referrer、错误 allowlist、当前 request trace 模式；新路由注册及 production composition 必须接通，禁止只做 handler stub |
| Port | `packages/persistence-port/src/checkout-preflight.ts` | 专属 serializable transaction manager 模式；目前无 order-access repository/application，须新增并绑定同一 PG client |
| 媒体 | `packages/media-port/src/index.ts` | `resolvePublicUrl` 可由历史 asset/checksum/objectKey 生成当前 CDN URL；不能持久化临时 URL，不能返回内部对象 key。确认历史引用保留策略，不能因商品下架就丢历史订单图 |
| BFF/UI | `apps/storefront/src/app/(public)/.../orders/lookup/page.tsx` | 七语言页面当前 unavailable，占位不是查单；须新增 fragment 交换页/固定 BFF。`OrderTimeline` 已有可访问展示组件，但并未有真实订单状态映射 |

### 必须预先处理：订单 v2 与原文语言

0025 已将真实 `order_items.schema_version` 扩为 1/2，新增 DAILY translation FK 并绑定 `checkout_preflight_observations`。订单可能在英语界面购买中文原文商品，四类 source/alt 都应保留真实 resolved locale。

旧 `internalOrderItemSnapshotSchema` 固定 schemaVersion 1，`TranslationSnapshotRef` 只支持同语言或英文事故 fallback；`toPublicOrderItemView` 先解析该旧 schema，且公开 v1 item 没有每对象语言来源字段。直接把当前 v2 SQL 行映射进去会拒绝合法 DAILY 数据，或丢失真实 `lang`。**应新增独立版本化 order-read 公共/内部合同，复用金额规则和安全字段思想；保留全部旧 v1 定义。** 历史名称、价格、媒体 alt 取订单快照，当前 UI locale 只改变外壳。不要将原文重新标为已批准英文。

## 6. Token/session 行为必须明确的风险

1. **消耗与丢响应**：0004 一 token 一 session；EXCHANGED token 不允许重新 ACTIVE。浏览器有已成功设置的 cookie 时只读恢复；cookie 也丢失时不能单凭已消费 token 重签，否则一次性语义失效。此时只有仍有效 checkout 授权可新代发行，或以后 P4-06 发新安全链接。若要求无 cookie 也自动恢复，应先设计额外独立恢复证明，不使用可重放 token 本身替代。
2. **轮换与撤销**：token 的 EXCHANGED 是终态，撤销已建立访问必须撤销 session。旧 UNIQUE 是按 status ACTIVE 而非期限判断；到期行未转 EXPIRED 仍会阻挡新 token/session。发行/交换时在 order 锁下先处理原 ACTIVE 行并原子创建新代，保留不可变历史，不清空旧表。
3. **并发锁**：统一 cart→order→token/session 顺序，与支付既有 order 锁协调；同 token 两次交换只一个成功，事务失败不消费；旧 session 被轮换后不可继续读取。READ 应重验实际时刻并不依赖浏览器 cookie 到期作为安全边界。
4. **权限细节**：cookie 无 token 正文/内部 ID；跨 order、跨 cookie、重复 Cookie/header、伪 Origin、未知 pepper、撤销/过期必须拒绝。返回值不透露“该订单存在但你没权限”的可枚举差别。
5. **页面泄漏**：fragment 读取后立即 `replaceState` 清除，异步库/分析前完成；交换页不含第三方脚本；token 仅内存和禁 body logging 的 POST。no-store/noindex/no-referrer 贯穿页/BFF/API/error，不能用 localStorage/sessionStorage 记恢复值。
6. **限流缺口**：本次搜索未找到现成 order-access rate limiter。接口合同必须定义有界、可配置、防滥用的失败策略；不以进程内 Map 冒充多实例可靠限流，也不引入 Redis。可复用 PostgreSQL 时间窗计数或正式边缘策略，但必须实际接线/测试。
7. **单订单 ACTIVE session**：旧约束会使新设备交换撤销旧设备；产品必须如实给出重新打开新链接的状态，不能暗中放开多设备、多订单无限会话。若要改变唯一性，应单独冻结兼容设计和新增迁移；此最小检查点不随手扩权。
8. **身份/商户边界**：尚无生产 OIDC、真实支付商户、正式邮件发件域；全部本地 TEST 来源明确标记。不从这次查单实现反向认定 Phase 3/4 退出或 Phase 5 解锁。

## 7. 最小验证矩阵与执行顺序

- 合同 RED：v1 保持、v2 DAILY/严格历史来源、金额一致、未知字段/版本拒绝、公共 DTO 无 intentId/objectKey/contact/token。
- 真实 PG：消费与 session 创建同 COMMIT、并发一成功、回滚 token 不消耗、token/session 到期及撤销、轮换旧 session 失效、跨订单、旧数据迁移往返/必要数据拒退。
- 实际 HTTP：当前 checkout 来源签发、正确/错误 Cookie/Origin/CSRF/headers、raw token 不记录、no-store/noindex/no-referrer、两种丢响应结果、未知 pepper、限流、普通 GET 零 PSP/金融/通知效果。
- 历史读取：严格七语言和 DAILY 原文，分别改动/下架现商品、艺人文案及媒体域名后订单快照不漂移；无需解密邮箱/留言、订单下架仍可查。
- 界面检查点 3：七语 × 390×844/1440×900、fragment 清除、refresh/Back/并发 tab/失效链接、键盘和 reduced motion，沿用黑金与现有 Timeline，不显示“邮件已发送”直至通知确实落地。
- 提速：先补当前候选窄质量缺口和独立复核，提交原子付款检查点；再冻结查单合同→分文件并行 PG/API 与 Root Application；定向 tests→一个最终源候选→实际集成/浏览器→原质量门。不要重复先前 63 次 P3 性能采样来代替本阶段订单验证。

本报告未运行测试或接受生产发布。下一开发入口可以清晰表述为：**先收尾付款入账检查点，再完成安全查单，然后七语言付款结果/订单时间线，最后接通知。**

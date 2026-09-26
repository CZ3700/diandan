# F1-2 订单公开短号：实现设计

> 日期：2026-09-26 · 依据：V2 方案 §4 第 4 项、规范 §5.8（成功页与订单查询）、§4 路由表、`docs/handoff/2026-09-26-core-features-first.md`（范围已获批准）
> 前置：F1-1 已完成（迁移头 0038）；本机便携 PostgreSQL 可验证迁移、目录快照与回滚前缀守卫

## 1. 结论一句话

每个订单在创建时由数据库分配一个不可变的公开短号 `FS-` + 6 位 Crockford base32 随机码（如 `FS-7K3M9C`）。粉丝在成功页、查单页、邮件里只看到短号，运营在后台订单、财务、异常三个工作台看到短号并可按短号搜索；`publicOrderId`（UUID）只留在 URL、API 与内部。只凭短号不能读取订单：查单页按短号定位订单时仍需有效的访问会话。

## 2. 格式与取值空间

- 字母表为 Crockford base32：`0123456789ABCDEFGHJKMNPQRSTVWXYZ`（去掉 I、L、O、U，避免与 1、0 混淆及意外组成不雅词）。
- 6 位共 32^6 ≈ 10.7 亿个号。每位取一个强随机字节的低 5 位，分布均匀。规范 §5.8 禁止用连续号暴露订单，所以不用序列。
- 输入归一化（查单与后台搜索共用）：去掉首尾空白、空格与连字符，不区分大小写，`FS` 前缀可省略，`O→0`、`I/L→1`；归一化后必须恰好是 6 个字母表字符，否则视为不是短号。
- `FS-` 是标识符格式的一部分，不是品牌值；数据库 CHECK 约束钉死格式，更换前缀需要新迁移。

## 3. 生成方式：数据库列默认值

`orders.public_order_no` 的默认值是函数 `public.generate_public_order_no()`。函数从 `gen_random_uuid()` 的随机字节取码，查唯一索引确认未被占用，最多重试 16 次；应用层插入订单时不传该列。

选择在数据库生成、而不是交接建议的"应用生成 + 保存点重试"，理由：

1. 回填、结账写入和测试脚本里的直写 SQL（`postgres-constraints.mjs` 等 9 处直接 `INSERT INTO orders`）共用同一个生成器，不需要改这些脚本。
2. "与已提交订单冲突"是库满后唯一现实的冲突，函数内的存在性检查就是这种冲突的重试。
3. 只有两个并发事务在同一时刻抽到同一个码时才会撞唯一约束，概率约为并发数 / 10.7 亿；这时结账整笔回滚、返回可重试的失败，粉丝重试即可。为这种情况加保存点重试不划算。

## 4. 迁移 0039 `public-order-number`

up：
1. 创建 `generate_public_order_no()`。
2. `orders` 加可空列 `public_order_no text`，加格式 CHECK `^FS-[0-9A-HJKMNP-TV-Z]{6}$` 与唯一约束 `orders_public_order_no_unique`。
3. 回填既有订单：逐行 UPDATE（每条语句都能看到之前已分配的号），期间 `DISABLE TRIGGER USER`。`guard_order_transition` 禁止改订单身份列；延迟约束触发器校验的事件头与聚合状态与新列无关。这是一次性的 schema 演进，与 0038 暂停 `order_items` 只追加守卫同一口径。
4. 设默认值并 `SET NOT NULL`。之后 `guard_order_transition` 的 `to_jsonb` 差异比较自动把新列当作不可变身份列，无需改触发器。
5. `CREATE OR REPLACE notification_order_snapshot`：增加 `publicOrderNo`；按 0038 的做法重冻结 `notification_runtime_state.base_variables`。

down：
- `notification_runtime_state` 有行时拒绝回滚，因为短号已进入冻结的邮件变量，与 0038 口径一致。
- 否则恢复 0038 版快照函数，删列，删函数。
- 回滚会丢失已分配的短号，重新 up 会分配新号。只适用于预生产演练。

回滚前缀守卫 `notification-rollback-prefix.mjs` 与其测试加入 `"0039"`，测试里的未知头探针改为 `"0040"`。

## 5. 合同

| 合同 | 变更 |
|:--|:--|
| `identifiers.ts` | 新增 `publicOrderNoSchema`（品牌类型 `PublicOrderNo`） |
| `public-order-number.ts`（新） | 字母表常量；`normalizePublicOrderNo(input)` 按 §2 归一化，失败返回 `null` |
| `orderAccessDetailSchema` | 必填 `publicOrderNo`；后台订单详情复用此结构，自动带上 |
| `adminOrdersListItemSchema`、`adminFinanceOrderSummarySchema` | 必填 `publicOrderNo` |
| `adminExceptionItemSchema` | `publicOrderNo` 可空，与 `publicOrderId` 同时为空或同时非空 |
| `orderNotificationBaseVariablesSchema` | `publicOrderNo: publicOrderNoSchema.nullable().default(null)`；归档的 v1 变量没有这个字段，解析为 null |
| 查单定位（F1-2b） | 请求 `{schemaVersion, publicOrderNo}`，命令加 `sessionCandidates`，响应新增 `action: "LOCATED"`、返回 `publicOrderId` |

`checkoutSessionViewSchema` 不变。结账成功后页面跳转到 `/thank-you/:publicOrderId`，由查单组件渲染订单详情，短号从查单读模型取得。

## 6. 持久化读模型

- `orderAccessOrderColumns` 加 `o.public_order_no`；`readOrderAccessDetail` 输出 `publicOrderNo`。后台详情用 `o.*`，自动带上。
- 后台订单列表：输出 `publicOrderNo`。搜索条件在原有 UUID、偶像名、礼物名基础上增加两项：短号部分匹配（`ILIKE`），以及查询串归一化为短号后的精确匹配。所以 `fs 7k3m9c`、`7K3M9C`、`FS-7K3M9O` 都能找到。
- 财务列表：同样输出短号并支持按短号搜索（原来只按 UUID 子串搜索）。
- 异常列表：投影联表带出 `o.public_order_no`。

## 7. 粉丝端

- 查单详情的"订单号"显示短号（`data-order-number`）；页面根节点的 `data-order-id` 仍是 UUID，供脚本定位实体。
- 成功页复用同一组件。
- **F1-2b 按短号查单**：查单入口页原来只接受 UUID，而粉丝以后只知道短号。
  - 输入框改为同时接受短号与 UUID。
  - 输入短号时，页面先调用新的 `POST /api/storefront/order-access/locate`（代理到 API 的 `POST /api/v1/order-access/locate`），再跳到 `/orders/:publicOrderId`。
  - 定位只在当前浏览器的访问会话（`__Host-fan-order`）属于该短号的订单时成功，否则返回 `ACCESS_DENIED`，页面提示使用邮件里的安全链接。
  - 定位是只读操作：不锁行、不签发凭据、不写审计，限流与读取共用 `READ` 桶。
  - 不做"按短号 + 邮箱找回链接"：那会引入按邮箱查单的新攻击面，不在本项范围。

## 8. 邮件：原地修订 v2

`ORDER_ID` 槽位改为显示 `publicOrderNo`；v2 渲染器要求它非空，归档的 v1 不变。

不开 v3 而是原地修订 v2，理由：v2 是 F1-1 在同一个未发布分支上新建的（c41ef5b），从未部署到任何环境，也从未在临时测试库之外请求过消息。README 的归档规则保护的是"已发出的版本"。本次修订需要重生成 v2 的 `variables.schema.json`、`reviews.json`（21 条 DRAFT 哈希）、`identity.fixture.json` 与 `history.fixture.json`，并在 README 记录"v2 在首次发布前修订过一次，此后冻结"。

## 9. 后台

- 订单列表行、详情标题显示短号。
- 财务列表行、异常列表与详情显示短号。
- 搜索框文案原本就是"搜索订单号"，不改文案。

## 10. 验证计划

| 层 | 内容 |
|:--|:--|
| 合同单测 | 短号格式接受/拒绝；归一化用例（大小写、空格、连字符、缺前缀、O/I/L 替换、非法字符、长度）；查单详情、后台列表、财务、异常、通知变量的新字段 |
| 持久化单测 | 查单读模型输出短号；后台订单与财务搜索绑定归一化参数；异常投影带短号；定位查询（F1-2b） |
| 真实 PG（本机） | 新脚本 `postgres-public-order-number.mjs`：0038 头直写订单后升到 0039 全部获得唯一合规短号；新插入走默认值；重复号 23505、非法格式 23514、UPDATE 短号被 `guard_order_transition` 拒绝（55000）；有通知运行时行时 down 被拒绝，无行时 down/up 往返成功。另跑迁移往返与目录快照（39 迁移）、回滚前缀守卫（含 0039）、查单参数推断脚本 |
| 应用/API | 定位用例与路由测试：会话匹配成功、短号不匹配或无会话返回 `ACCESS_DENIED`、非法短号返回 `INVALID_REQUEST`、限流共用 READ 桶 |
| 前台 | 查单详情显示短号；查单入口的短号/UUID 两条路径及失败提示；代理路由解析 |
| 后台 | 列表、详情、财务、异常视图显示短号 |
| 邮件 | v2 渲染显示短号；v1 归档身份仍按字节复现；v2 审校/身份/历史夹具重生成 |
| CI（需 S3/浏览器） | 更新依赖界面显示订单号的浏览器脚本（`local-experience-browser.mjs`、`regression-journey-browser.mjs`、`order-storefront-browser.mjs` 等）改用 `data-order-number` / `data-order-id`；随 F1 完成后的草稿 PR 一起跑 |

## 11. 提交拆分

1. **F1-2a**：迁移、合同、读模型、粉丝端显示、后台显示与搜索、邮件 v2 修订。
2. **F1-2b**：按短号查单（定位端点 + 查单入口）。

两次提交都要通过 `check:dev` 后再推送。

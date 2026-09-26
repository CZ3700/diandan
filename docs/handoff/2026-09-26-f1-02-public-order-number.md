# 交接：F1-2 订单公开短号完成 → 下一条 F1-3 首页改版、四分类、价格直显第二阶段

> 日期：2026-09-26
> 项目：`C:\Users\admin\Desktop\下单\下单`
> 分支：`v2/r1-production`（已推送 origin，工作区干净）
> 新会话冷启动顺序：
> 1. 本文件；
> 2. `docs/handoff/2026-09-26-core-features-first.md`（核心功能范围与顺序，用户已批准，不必再确认）；
> 3. `docs/progress/v2-progress.md` 的"R2 站点核心功能"一节；
> 4. 开工 F1-3 前按 `AGENTS.md` 读方案 §4 第 2、3 项，ADR-017 及其增补，规范 §5.2、§5.5.1；再读 `docs/plan/v2-friction-items.md` 的第 2 项（价格直显第一阶段的实现记录）。

## 背景

用户 2026-09-26 批准站点核心功能按 F1→F2→F3 推进，沙盒与外部配置放最后。上一会话完成 F1-1（虚拟礼物自动履约）。本会话完成 F1-2：订单公开短号 `FS-XXXXXX`。

- 粉丝在成功页、查单页和邮件里只看到短号。
- 运营在后台订单、财务、异常三个工作台看到短号，订单和财务可以按口述的短号搜索。
- 查单入口可以输入短号，但只有本浏览器持有该订单的访问会话时才能定位到订单。

设计文档：`docs/plan/f1-02-public-order-number.md`。

## 已完成

| 提交 | 内容 | 验证 |
|:--|:--|:--|
| `bb447dd` | **F1-2a**：迁移 0039（`orders.public_order_no` 列、`generate_public_order_no()` 默认值、既有订单回填、通知快照带短号）；合同 `publicOrderNoSchema` 与 `normalizePublicOrderNo`；查单详情、后台订单/财务/异常读模型与视图；后台订单与财务搜索；邮件 v2 原地修订；CI 脚本改用 `data-order-id` 与链接片段 | 合同 532；持久化/应用/API/前台/后台/i18n/worker 套件通过。本机真实 PG：迁移往返与目录快照（39 个迁移），回滚前缀守卫 54/54，新脚本 `postgres-public-order-number.mjs`。`check:dev` 前五段通过，test 段串行复跑 69/69，build 38/38 |
| `PENDING_F12B` | **F1-2b**：`POST /api/v1/order-access/locate` 全链路（合同与 OpenAPI → 端口 → 持久化 → 应用 → API 路由 → 前台代理/传输/控制器）；查单入口同时接受短号和 UUID | contracts 533；持久化/应用/API/前台定位用例通过；真实 PG：`postgres-public-order-number.mjs` 增加会话定位语义（本单会话能定位，他单号与过期会话被拒，非规范号为 INVALID_REQUEST），查单 SQL 参数推断 18 条。`check:dev` 前五段通过（typecheck 69/69），test 段串行复跑 69/69，build 38/38 |

未覆盖（需要 S3 模拟，本机没有）：API 级协议脚本与浏览器验收，包括 `order-access-protocol.mjs` 新增的定位用例、`order-storefront-browser.mjs` 的按短号查单用例、`admin-orders-protocol.mjs` 的口述短号搜索用例，以及 `local-experience-browser.mjs` 等改过的定位方式。这些脚本已按新界面修改，**从未实际运行过**，要等 CI。

## 关键决策及理由

1. **短号由数据库列默认值生成，没有采用上一份交接建议的"应用生成 + 保存点重试"。**
   - `generate_public_order_no()` 从 `gen_random_uuid()` 的前 6 个随机字节各取低 5 位映射到 Crockford 字母表。字母表去掉了 I、L、O、U，分布均匀，号码空间 32^6 ≈ 10.7 亿。
   - 生成时先查唯一索引确认号码未被占用，最多重试 16 次。
   - 理由一：回填、结账写入和 9 处直写 `INSERT INTO orders` 的 SQL 测试脚本共用同一个生成器，这些脚本一行都不用改。
   - 理由二：与已提交订单冲突是库满后唯一现实的冲突，函数内的检查已经覆盖。只有两个并发事务同时抽到同一个码才会撞唯一约束，概率约为并发数 / 10.7 亿；发生时整笔结账回滚，粉丝重试即可。
   - 结果：`checkout-preflight-write.ts` 没有任何改动。
2. **URL 仍用 UUID。**
   - 规范 §4 路由表与 §5.8 明确"后续查单使用 `publicOrderId` + 访问会话"，规范优先于 V2 附录里"查单 URL 也用短号"的写法。
   - 换成短号 URL 会牵动查单控制器的身份比较、邮件链接片段校验以及大量只能在 CI 跑的浏览器脚本，收益低。
   - 页面根节点 `data-order-id` 保留 UUID，供脚本定位实体；可见文本只显示 `data-order-number` 里的短号。
3. **新增定位端点，没有扩展读取端点。**
   - 查单入口原来只接受 UUID，而粉丝以后只知道短号。
   - 让读取路由同时接受两种标识，需要改控制器里所有以 UUID 为身份的比较。单独的 `locate` 只把短号解析成 `publicOrderId`，之后仍走原有的读取与授权。
   - 定位是只读操作：不加锁、不签发 Cookie 或 CSRF、不写审计，与读取共用 `READ` 限流桶，所以不需要改限流配置和数据库 CHECK。
   - 条件：会话必须是 ACTIVE、未过期、属于该短号的订单，并且与本浏览器 Cookie 的摘要匹配。
   - 失败时统一返回 `ACCESS_DENIED`，前台沿用现有的"无法用当前访问打开"与"恢复方式"文案，所以没有新增七语言文案，也没有审校哈希变更。
4. **原地修订邮件模板 v2，没有开 v3。**
   - v2 是 F1-1 在同一个未发布分支上新建的，从未部署，也从未在临时测试库之外请求过消息。README 的归档规则保护的是已发出的版本。
   - 重生成了 v2 的 `variables.schema.json`、`reviews.json`（21 条 DRAFT 哈希）、`identity.fixture.json` 与 `history.fixture.json`，README 写明"首次发布前修订过一次，此后冻结"。
   - v2 渲染器要求 `publicOrderNo` 非空。合同里该字段是 `.nullable().default(null)`，归档的 v1 变量解析为 null，v1 输出字节不变。
   - 生成脚本在 scratchpad（`gen-v2-schema.mjs`、`gen-v2-fixtures.mjs`），没有入库。逻辑是：先由合同生成 schema，构建 i18n，再按旧身份映射事件，重算审校哈希与 21 条渲染摘要。
5. **回填期间对 `orders` 执行 `DISABLE TRIGGER USER`，而不是只关 `orders_transition_trigger`。**
   - 后者单独关闭时，延迟约束触发器（事件头、聚合）仍会对每一行排队。它们检查的内容与新列无关，而且会让用 replica 模式直写的测试订单在提交时失败。
   - 这是一次性的 schema 演进，同一事务内会重新启用。
6. **down 在 `notification_runtime_state` 有行时拒绝回滚，与 0038 同一口径。**
   - 回滚会丢失已分配的短号，重新 up 会分配新号，只适用于预生产演练。
   - 回滚前缀守卫依赖"有订单但没有通知时可以回滚"，所以不能因为存在订单就拒绝。
7. **后台搜索**：查询串先经 `normalizePublicOrderNo` 归一化，再按短号精确匹配（例如 `7k3m 9c`、`fs-7k3m9o` 都能找到 `FS-7K3M90`），同时保留片段子串匹配和原有的 UUID、偶像、礼物搜索。归一化规则：6 个字符一律视为裸码，8 个字符且以 FS 开头时去掉前缀。
8. **`checkoutSessionViewSchema` 不变**：成功页跳转到 `/thank-you/:publicOrderId` 后，由查单组件渲染订单详情，短号从查单读模型取得。

## 在途

没有改到一半的代码。待外部条件或待确认的事项：

- **CI 验证**：本分支仍然没有 PR。F1-1 与 F1-2 的 API/浏览器级用例都只能在 CI 跑。计划在 F1 全部完成后开草稿 PR 一起跑，**开 PR 前要向用户确认**。F1-2 改了多个浏览器脚本的定位方式，这是 CI 首跑时最可能出问题的地方。
- 既有问题未动：`pnpm deploy` 缺 `@opentelemetry/core` 对等依赖，CI 有四组回归既有失败，并行负载下有慢测试超时（本会话在 `check:dev` 里遇到 5 个，串行复跑通过）。
- R0 遗留、待用户拍板的事项：main 分支、`output/` 历史文件、归档目录、远端 `codex/*` 分支。

## 下一步（按优先级）

1. **F1-3 首页改版、四分类、价格直显第二阶段（可以直接开工）**。先写 `docs/plan/f1-03-home-categories.md`，要点：
   - 目录 API 增加 `kind` 参数，并进入 URL 状态（规范 §5.5.1）；`gift_kind` 在合同与数据中都已存在。
   - 首页：满屏偶像海报首屏（规范 §5.2），下接四个分类磁贴（虚拟打赏/实物投喂/艺人心愿/周边），链接到 `/gifts?kind=`。
   - 价格直显第二阶段：`/gifts` 与首页目录显示价格；规范 URL 去掉隐含作用域；页眉与页脚在单一市场时隐藏"选择地区"。
   - 必须保持"页壳与内容先于商业上下文流式输出"（ADR-017 增补；第一阶段的首版入口等待方案曾破坏过它，已回退）。
   - 前台改动要在真实浏览器验证 390×844 与 1440×900 两种尺寸，文案覆盖英语、一种中日韩语言、泰语、越南语，以及最长的西/葡语。本机可以用 Chrome（`accessibility-admin-search.test.mjs` 在本机跑通过），但完整本地体验需要 S3，要先评估哪些页面能用前台单测加 mock 验证。
2. **F1-4 送达证明照片**（方案 §4-6）。
3. F1 全部完成后开草稿 PR 跑 CI（先问用户），再进入 F2 榜单与公会赛（按 ADR-018 拆子里程碑）。

## 环境注意

- **Bash 工具不能在前台 `sleep`**。等后台任务结束，用 `run_in_background` 加完成通知；长门禁（`check:dev` 约 8–10 分钟）一律放后台，并把日志写到 `output/checks/<条目>/`。
- **`check:dev` 的 test 段在并行负载下会有 5 秒超时**（本会话出现在 storefront 的 rum/specimen/order-controller 等 5 个文件，单跑均通过）。复跑方式：先 `corepack pnpm exec turbo run test --concurrency=1 --output-logs=errors-only`，再跑 `turbo run build`。
- **测试里 mock 函数的参数不能用下划线占位名**：eslint 的 `no-unused-vars` 会报错。写成 `vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>(async () => …)`。
- **后台视图测试的数据要经过合同 `parse`**，否则品牌类型（Currency、MinorAmount、PublicOrderNo 等）会导致 typecheck 失败。
- **Python 用 `/d/python/python`**，补丁脚本写成文件再执行，避开 heredoc 超过 8KB 被截断。
- **本机 Chrome 可用**：`node --test apps/api/scripts/accessibility-admin-search.test.mjs` 能直接跑，可用于验证不依赖 S3 的浏览器脚本单测。
- 真实 PG 验证脚本清单（本会话都在本机跑过）：
  - `packages/persistence-postgres` 下 `migrations:manifest`、`migrations:catalog`；
  - `node --test ./scripts/notification-rollback-prefix.test.mjs`（约 80 秒）；
  - `node ./scripts/postgres-public-order-number.mjs`（约 70 秒，已并入 `test:postgres`）；
  - `node ./scripts/postgres-order-access-parameters.mjs`。
- 上一份交接（`2026-09-26-f1-01-virtual-fulfillment.md`）的环境注意仍然有效，包括：合同改动后要跑 `contracts:generate`；改了 `packages/*` 要先构建再跑下游测试；storefront 文案要更新审校哈希；domain 的导出清单有测试钉死。

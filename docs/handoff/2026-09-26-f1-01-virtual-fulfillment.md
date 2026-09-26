# 交接：F1-1 虚拟礼物自动履约完成 + 本机 PostgreSQL 验证能力建立 → 下一条 F1-2 订单公开短号

> 日期：2026-09-26
> 项目：`C:\Users\admin\Desktop\下单\下单`
> 分支：`v2/r1-production`（已推送 origin，工作区干净，HEAD `c41ef5b`）
> 新会话冷启动顺序：
> 1. 本文件；
> 2. `docs/handoff/2026-09-26-core-features-first.md`（核心功能范围与顺序，用户已批准，不必再确认）；
> 3. `docs/progress/v2-progress.md` 的"R2 站点核心功能"一节；
> 4. 开工 F1-2 前先按 `AGENTS.md` 读方案 §4 第 4 项、规范 §5.8。

## 背景

用户 2026-09-26 决定先做站点核心功能、沙盒与外部配置放最后，并批准了范围顺序 F1→F2→F3。本会话按交接建议先解决本机 PostgreSQL 验证能力（方案 A：便携 PostgreSQL），然后完成 F1 的第一项：ADR-019 虚拟礼物（`gift_kind=VIRTUAL`）在支付进入 PAID 后由系统自动送达。两项都已提交推送并通过日常门禁（test 段用串行方式复跑，见"环境注意"）。

## 已完成

| 提交 | 内容 | 验证 |
|:--|:--|:--|
| `a06e916` | F0：修复原生 PG 测试框架真缺陷（`postmaster.pid` 数据目录行是正斜杠，原逐字节比较在 Windows 拒绝清理集群）；`CLAUDE.md` 记录便携 PG 与 heredoc 限制 | 单测 2 文件 16 通过；`postgres-integration.mjs` Windows 通过；persistence-postgres 完整 `test:postgres` 链 47 段全部通过（约 40 分钟） |
| `c41ef5b` | F1-1 全部：迁移 0038、领域权限、支付写入数字送达、后台门控、查单/邮件合同、前台与后台文案、通知模板 v2、夹具与 CI 用例、设计文档与进度记录 | domain 222、persistence 752、i18n 62、contracts 527、storefront/admin/api/application 相关套件通过；本机真实 PG：迁移往返 + 目录快照（38 迁移）、回滚前缀守卫 53/53（含 0038 down/up）、支付 SQL 参数推断；`check:dev` 前五段通过 + `turbo run test --concurrency=1` 69/69 + build 38/38 |

未覆盖（需 S3 模拟，本机没有）：`admin-orders-fixture.mjs` 新增的混合/纯虚拟 API 用例、七语言浏览器验收。要跑它们只能开草稿 PR 让 CI 跑（用户已同意在便携 PG 不可行时用 CI；现在便携 PG 可行，**为 API 级用例开 PR 仍需向用户确认一次**）。

## 关键决策及理由

1. **`order_items.gift_kind` 做购买时快照，而不是每次联表推导。** 订单行已不可变地引用礼物修订，类别本可推导（后台 `historicalGiftKind` 就是两段式联表：日更发布文档优先，否则礼物修订档案；无档案的历史行没有类别）。快照把这条推导固化一次，供支付写入、查单读模型、后台门控和将来 F2 榜单投影共用。迁移 0038 用同一规则回填，回填期间临时禁用 `order_items_append_only_trigger`（一次性 schema 演进）。NULL 只出现在无档案的历史行，视为实物流程。
2. **数据库触发器放开 PENDING→DELIVERED 只对 VIRTUAL 行 + SYSTEM 权限 + 固定 reason。** `guard_fulfillment_transition` 与 `validate_fulfillment_event` 原本在 SQL 层强制邻接矩阵，所以必须 `CREATE OR REPLACE`。该路径不做"留言未审核不得送达"检查：数字凭证的送达不向任何人展示留言，留言审核独立进行（`reviewAdminOrderMessage` 也相应允许 VIRTUAL 且 DELIVERED 的行继续审核，否则自动送达后留言就无法审核）。
3. **订单聚合推导规则不改。** 混合订单付款后聚合为 PREPARING（数字行已送达、实物行待准备），纯虚拟订单直接 DELIVERED。改推导需要同时改 `assert_fulfillment_aggregate` 触发器，收益低。推导函数抽成 `fulfillment-aggregate.ts`，支付写入与后台写入共用。
4. **库存失效（PAID_REVIEW）时的数字行：自身预占完好则照常送达，否则随实物行 ON_HOLD。** ADR-011 允许 VIRTUAL 礼物配 TRACKED 库存，不能无条件送达。被 HOLD 的数字行由 Manager RESUME 时在同一事务立即送达（复用 `deliverDigitalFulfillments`），不给数字行 PREPARE/DELIVER/HOLD 动作。
5. **系统数字送达不产生实物"送达确认"邮件。** `notification_source_authority` 的履约分支加 `authority_kind='ADMIN'`。否则混合订单付款瞬间粉丝就会收到"礼物已送达"邮件。
6. **邮件用新模板版本 v2，而不是改 v1。** `packages/i18n/src/notifications/README.md` 明确 v1 是归档，`history.test.ts` 钉死 21 条 v1 输出字节。v2 复制 v1 后加数字段落/条目标记；`index.ts` 的 `select` 只发 v2 身份，`render` 按版本前缀分派（v1 仍可重放）；`review.ts` 改为按身份参数化。v2 的 `variables.schema.json` 由合同 `toJSONSchema` 生成，`reviews.json`/`identity.fixture.json`/`history.fixture.json` 用 `scratchpad/gen-v2.mjs` 一次生成（脚本未入库，逻辑简单：遍历 3 事件 × 7 语言取哈希与渲染摘要）。
7. **合同 `orderNotificationItemSchema.giftKind` 用 `.nullable().default(null)`。** 归档的 v1 变量没有这个字段，`.optional()` 会让类型带 `undefined`，与应用层要求的 `JsonValue` 冲突（门禁 typecheck 就是这样失败的）；`default(null)` 让 v1 变量解析为 null、输出类型不含 undefined。查单合同 `orderAccessItemSchema.giftKind` 则是必填可空。
8. **迁移会重冻结既有 `notification_runtime_state.base_variables`。** 一致性触发器要求变量与 `notification_order_snapshot` 输出逐字节相等，函数加了 `giftKind` 就必须回填（临时禁用 `notification_runtime_immutable`）。这是预生产阶段可接受的一次性代价；down 在存在运行时行或数字送达历史时拒绝，与 0029 的口径一致。
9. **夹具类别轮转改为 `PHYSICAL, WISH, MERCHANDISE, OTHER, VIRTUAL`。** 原 `gifts[0]` 是 VIRTUAL，而所有默认下单流程都用 `gifts[0]`，自动送达会改写数十个既有断言（`assertPaid` 要求履约 PENDING 等）。现在 VIRTUAL 落在 `gifts[4]`、`gifts[9]`…；混合用例放在 `admin-orders-fixture.mjs`，不放在 `order-payment-protocol.mjs`，因为后者所在夹具随后跑 `order-payment-rollback-proof`，回滚前缀守卫要求没有数字送达历史（我把 `digital_deliveries` 加进了守卫的计数）。
10. **便携 PostgreSQL 的信任锚是 HTTPS 官方源。** EDB 不发布 zip 校验和，zip 内二进制也没有 Authenticode 签名（安装器才有）。已把 SHA256 `fbe23da234ee31547bf8a36d29dfd81e82b849df2d2b78d2eecb43d360252f8c` 记入进度文档供复核。

## 在途

没有改到一半的代码。待外部/待确认：

- **CI 验证**：本分支仍无 PR。F1-1 的 API 级用例（`admin-orders-fixture.mjs` 的"digital support lines deliver at payment and stay reviewable"）与浏览器验收只能在 CI 跑。建议在 F1 若干项完成后开一个草稿 PR 一起跑，开 PR 前向用户确认。
- 上一份交接列出的既有问题未动：`pnpm deploy` 缺 `@opentelemetry/core` 对等依赖、CI 四组回归既有失败、`persistence-postgres` 慢测试在并行负载下偶发超时（本会话发生了两次，见环境注意）。
- R0 遗留决定（main 分支、`output/` 历史文件、归档目录、远端 `codex/*` 分支）仍待用户拍板。

## 下一步（按优先级）

1. **F1-2 订单公开短号（可直接开工）。** 先写 `docs/plan/f1-02-public-order-number.md`，要点：
   - 迁移 0039：`orders.public_order_no text UNIQUE`，格式 `FS-` + 6 位 Crockford base32 随机码（规范 §5.8 禁止连续号），生成放在结账写入（`checkout-preflight-write.ts` 插入 `orders` 处），唯一冲突重试；既有行回填。回滚前缀守卫 `notification-rollback-prefix.mjs`/`.test.mjs` 要加 `"0039"`（并把测试里的未知头探针改为 `"0040"`）。
   - 合同：`orderAccessDetailSchema`、`checkoutSessionView`（成功页）、`adminOrdersListItem/Detail`、通知变量（又是模板版本变更——评估是否并入 v2 的一次性修订：v2 目前只在 TEST_DRAFT 下用过、尚无历史消息，但 `history.fixture.json` 已钉死 v2 字节；若改 v2 需重生成 v2 夹具并说明理由，或直接开 v3）。
   - 查单页、成功页、邮件、后台列表/详情、客服显示短号；`publicOrderId`（UUID）只留在 URL 与内部。只凭短号不能读取订单（仍需访问会话）。
   - 本机可用真实 PG 验证迁移与参数推断；API/浏览器级交 CI。
2. **F1-3 首页改版、四分类、价格直显第二阶段**（方案 §4-3、§4-2，ADR-017 增补），随后 **F1-4 送达证明照片**。
3. F1 全部完成后开草稿 PR 跑 CI（先问用户），再进入 F2 榜单与公会赛（按 ADR-018 子里程碑拆分）。

## 环境注意

- **Bash 工具的 heredoc/命令超过约 8KB 会被截断**，报 `unexpected EOF while looking for matching`。长补丁脚本用 Write 写到 scratchpad 再 `python <file>`。已写进项目 `CLAUDE.md`。
- **Python 补丁脚本里含 `C:\Users` 要用原始字符串**（`r'''...'''`），否则 `\U` 被当成 unicode 转义。
- **`check:dev` 的 test 段在并行负载下会让 persistence-postgres 的若干既有慢测试超过 5 秒**（本会话两次分别 2 个和 5 个）。它们单跑 2–4 秒通过。可接受的复跑方式：`corepack pnpm exec turbo run test --concurrency=1 --output-logs=errors-only`（已通过的包命中缓存），再 `turbo run build`。根因是这些测试首次导入合同的开销，不是本次改动。
- **便携 PostgreSQL**：`C:\Users\admin\.tools\pgsql-18.6\pgsql\bin`，`xiadan-env.sh` 已导出 `POSTGRES_TEST_BIN`，所有 `withEphemeralPostgres` 调用自动走原生模式。本机可跑：`pnpm --filter @fan-support/persistence-postgres test:postgres`（约 40 分钟，建议后台）、`migrations:manifest`（生成清单）、`migrations:catalog`（先要清单一致，再写 `expected-catalog.json`，目录快照含函数体，改触发器函数后必须重生成）、`node --test scripts/notification-rollback-prefix.test.mjs`（含真实 PG 回滚，约 80 秒）。
- **改了 `packages/*` 的源码后要先 build 该包**，下游 vitest 读的是 dist（例如 storefront 测试因 `@fan-support/orders` 未重建而全红）。
- **`packages/contracts/generated/*.json` 是入库的**（尽管早期 .gitignore 记录提过它），合同变更后要跑根目录 `corepack pnpm contracts:generate`，否则 `artifact-documents.test.ts` 失败。
- **前台/后台文案改动后的哈希**：storefront 七个 `*.review.ts` 的 `sourceHash`/`translationHash` = `sha256(JSON.stringify(默认导出))`，用构建后的 dist 计算（本会话用 node 脚本算好再写入）；通知模板哈希由 `identity.ts` 计算，夹具重生成见决策 6。
- `domain` 包的 `index.test.ts` 钉死了导出清单，新增导出要登记。
- 后台订单视图的共享夹具在 `apps/admin/src/management-orders/fixtures.test-support.ts`（不是 `*.test.tsx`），改查单条目合同时别漏掉。
- 上一份交接的环境注意仍有效：`/d/python/python`、lockfile 的 `third-party-web` 漂移、`git checkout HEAD --`、前台 mock 同步等。

# P4-02 合同、持久化与应用层复核

结论：本轮边界检查 ACCEPT。复核基线为 `c6ca6ba`，作者／复核者为 `storefront_directory`。合同和 PostgreSQL 实现是本代理所写；Application 为 root 所写，本代理进行了非作者只读复核。此结论不代表整个 P4-02 已验收完成。

## 独立兼容核对

直接用 `git show c6ca6ba:<path>` 与当前 JSON 逐项比较，不依赖作者提供的兼容摘要：

- JSON Schema 从 448 根增为 468 根；448 个旧 `$defs` 全部逐项一致，没有删除或变更。新增 20 根全部为 CartEdit／CartEditor／CartRuntimeCurrentResponse。
- 旧 OpenAPI 的 145 个 components.schemas、2 个 headers、6 个 securitySchemes 均逐项不变；新增 7 个 schema component。
- 82 个旧 path 保留。新增 `/api/v1/cart/items/{itemId}` 与其 `/editor` 两个 path。旧三条 cart path 的全部差异精确为 24 个响应 `$ref` 从 CartRuntimeResponse 指向 CartRuntimeCurrentResponse；请求、headers、security、状态码集合未变。新响应仅补充删除后历史 ADD 重放的 `CART_ITEM_REMOVED`，不会复活旧行。
- 0001–0023 的 46 个 up/down SQL 文件与基线原字节相同；旧 23 个 manifest entry 全部相同，只新增 0024。
- catalog 的所有旧 entry 均保留且逐项相同。增加 3 表、46 列、76 个约束 entry、9 个索引、10 个 trigger、5 个 function；原 159 表增至 162 表，没有旧定义修改。

检查时 SHA-256：

| 文件                  | SHA-256                                                            |
| --------------------- | ------------------------------------------------------------------ |
| contracts.schema.json | `04ea15bf1bd73bfc140f00a4a5f1b3c58ec86c5b0692af6ab65fe7568744994f` |
| openapi.json          | `947dd465645e7d114d6274bb2e22af7cf80dd3aea97b8782732d341093a4b42b` |
| expected-catalog.json | `50b8e03b9817fdfa3115830922b5262a7bb36886cd6ef93756c24f89c5b41492` |
| migration manifest    | `b2a2519a4e58536baa57216ee7f954af40ab9ed00b923da3b20d9722520f3701` |

## 实现与应用层复核

独立 CartEdit manager 将 cart、edit、canonical commerce、idempotency 与原 outbox 绑定同一 SERIALIZABLE client。QUANTITY 读取当前完整商品／资格／价格证明后只更新数量和观察价格；intent 版本不变。PERSONALIZATION 在事务外用原 intent ID 加密，重入后再次核验所有版本与权限，替换密文与投影 flags，并将审核完整重置为 PENDING。REMOVE 仅将 intent 改为 CANCELED，保留原 item、密文、原始 request/correlation 和历史；普通列表只排除明确 CANCELED，不过滤损坏的空关联。

私密编辑器先提交 SYSTEM/cart-private-editor 的授权审计和绑定 cart/item/intent 三版本的 access receipt，再进行 KMS 解密；第二事务重新授权并核验版本、隐私状态、真实过期与精确 audit/request/correlation。普通 cart DTO 不带私密字段。解密 buffer 使用后清零，返回的编辑器原文仅在专用私密响应中存在。

Application 的 completed replay 先验证不可变 mutation receipt，再读取当前 cart，避免再次加密／写入；receipt UUID 是幂等结果引用，完整校验 cart/item/intent 归属及 quantity +0、其他 +1 的 intent 版本增量。只对明确 TRANSACTION_ABORTED 最多执行三次，UNKNOWN 不自动重发。抽离的 current gift/view 两个函数保留原严格公开读、校验与失败行为，未另开数据库事务。未发现必须修复的应用层问题。

编辑事件写入独立 `cart_edit_outbox_events`，与同事务不可变 receipt 精确绑定，永久保存为 PENDING。旧 DomainEvent v1 dispatcher 不扫描该表。当前界面读取真实 PG，不依赖异步投影；本阶段没有声称这些事件已分发。后续消费者须显式接入并新增投递收据，不能伪造 SUCCEEDED 或修改原 append-only 事件。

## 已运行检查与实际范围

所有执行使用 `mise exec node@24.20.0 --`；pnpm 使用 `corepack pnpm`。

- Contracts：`pnpm --filter @fan-support/contracts exec vitest run --config ../../vitest.config.ts --root . src/cart-edit.test.ts src/cart-edit-internal.test.ts src/cart-runtime.test.ts`，3 文件／13 tests PASS。最初缺失合同模块的有效 RED 保留。
- PG：同样命令在 `@fan-support/persistence-postgres` 下执行 cart-edit-repository、cart-edit-migration、cart-edit-transaction、cart-runtime-repository、cart-runtime-transaction 五个 test 文件，5 文件／22 tests PASS。仓储 RED 4 例和组合／取消过滤 RED 4 例均保留。
- Contracts／PG typecheck、PG build、上述产品和测试文件的 scoped ESLint／Prettier 均通过。新增 migration 使用现有 manifest 生成脚本，无手工修改旧 hash。
- `node packages/persistence-postgres/scripts/postgres-cart-edit-parameters.mjs`：独立真实临时 PG 上应用全部 24 迁移、PREPARE 全部 10 条新增 SQL、执行私密材料 hash，共 12 assertions PASS。两次早期失败保留；42601 来自 TEST 查询的 first/second 别名，修为 hash_a/hash_b，未修改产品 hash 实现来掩盖失败。
- `node packages/persistence-postgres/scripts/postgres-integration.mjs --write-catalog`：真实 up/down/up，24 migrations／162 tables PASS。
- 旧六个 harness 的适配仅更新 full-up head 或先退空 0024，再执行原 0023 以下历史校验；原 jobs／admin history／旧回滚保护保留。旧 cart rollback helper 完成旧保护后恢复空 0024。适配后 scoped format/lint PASS，未另重复全部旧 PG suites；留给 root 统一 gate。
- root 的 Application 证据已只读检查：`receipt-version-green.log` 为 3 文件／26 tests PASS。本代理未冒充该测试的执行者。

本代理检查日志位于上一级 `output/checks/p4-02-cart-edit-*.log`；root／HTTP 证据位于本目录。新 `cart-edit-rollback-proof.mjs` 可在真实编辑和私密访问后核验拒绝回退 0024，并比较十张表的 count/SHA，仅输出安全聚合。

## S.U.P.E.R 10 项

| 项             | 范围内结论与证据                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| 1 单一职责文件 | PASS：合同、映射、授权读取、写入、组合与测试分离。                                                          |
| 2 单一概念函数 | PASS：writeCartMutation 只完成一个原子编辑；私密读取与确认独立。                                            |
| 3 单向依赖     | PASS：App → Domain/Port，PG 实现 Port；没有 provider 回流。                                                 |
| 4 无循环依赖   | PASS：新模块直接依赖合同／已有叶模块；当前 typecheck 通过，未新增 package 反向依赖。                        |
| 5 schema 接口  | PASS：新 command、snapshot、receipt、专用 editor DTO 和 event 均版本化。                                    |
| 6 可序列化     | PASS：跨端口使用 JSON；Buffer 仅限 PG／KMS 适配边界。                                                       |
| 7 配置隔离     | PASS：无新增产品域名、密钥、固定市场或 locale 数组；测试常量仅夹具。                                        |
| 8 显式依赖     | PASS：仅使用既有依赖与 Node 内建模块，没有新增依赖。                                                        |
| 9 可替换部件   | PASS：App 只依赖独立事务／加密端口；旧 manager 与旧事件消费者保持原合同。                                   |
| 10 验证完成度  | 局部 PASS；实际编辑 HTTP、私密读写完整关系、浏览器、P2 和整仓 gate 由 root/E2E 继续汇总，不能据此宣称全过。 |

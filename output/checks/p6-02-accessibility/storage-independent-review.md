# P6-02 gift browse：存储层独立复核

结论：**PASS，未发现本次新增存储实现的阻塞问题。**

复核者：`/root/home_gift_audit`。复核者没有编写本报告涉及的 PostgreSQL 实现；本轮未修改产品源代码、没有启动浏览器、没有接触用户体验实例。此前编写的合同、应用和 API 不列为本报告的独立审查对象。

## 范围与证据身份

审查了 `output/checks/p6-02-gift-browse/author-report.json` 及其 unit / postgres 输出，并完整阅读以下变更及测试：

- `packages/persistence-postgres/src/gift-browse-repository.ts`、`gift-browse-sql.ts` 与对应测试。
- `catalog-verified-manifest.ts`，`catalog-publication-loader.ts` / `catalog-publication-mapper.ts` 的完整 diff，以及 loader 的新增测试。
- `catalog-directory-repository.ts` 组合入口与 package scripts。
- `scripts/gift-browse-postgres.mjs`、`gift-browse-strict-postgres.mjs`、`gift-browse-publication-cases.mjs`。
- 既有 published-content reader / projector / manifest 校验、SERIALIZABLE 内容读取事务、不可变 revision 数据库约束，以及 TEST SQL 故障注入器，作为信任边界的追踪依赖。

独立计算作者报告所列全部 **13 个文件**的 SHA-256，**0 个不匹配**。本次验证直接使用现有构建产物，不触发共享构建；根任务负责最终完整构建与整体门禁。

## 主要结论

1. **旧目录默认行为保持。** 旧 `readGifts` / `readIdols` 没有启用 `verifiedLocaleFallback`。没有 optional 参数时 mapper 仍取请求语言和原来的 translation manifest 构造路径；只有新 `browseGifts` 传入 opt-in。loader 对 strict projector 返回内容种类增加一致性校验，是收紧检查。独立运行旧实际 PostgreSQL 目录脚本通过。

2. **发现与购买分离。** 新 query 不接收 market / currency；SQL 不查询价格、价格簿、市场、库存余额或购物车。返回真实发布 `GiftDirectoryRecord`，不生成 offer、不写入价格或其他业务状态。已有 gift variant / recipient relation 只用于可选艺人筛选。这里的只读表示没有业务写入；严格发布 reader 仍使用 `SET LOCAL` 与 `FOR SHARE`，不是 PostgreSQL 的 READ ONLY transaction。

3. **分页计数与顺序一致。** 绑定参数依次为 locale、category、idolId、pageSize、offset，没有输入拼接进 SQL。查询在同一 CTE 中先筛选发布 head / owner / revision / lifecycle / successor，再算总数与分页窗口；顺序固定为 `published_at DESC, id ASC`，返回 ID 聚合也采用相同顺序。仓储拒绝非规范或溢出计数、重复 ID、异常窗口数量以及 hydration 缺行、错序，不用静默丢弃记录掩盖损坏。发现和 hydration 位于既有 SERIALIZABLE 事务中。

4. **catalogVersion 覆盖本路径的业务变动。** 哈希包含礼物及 head、翻译与审核、variant 和 recipient rule、艺人状态及 head、发布事件/manifest、daily document/manifest、媒体处理/权利/变体和媒体翻译审核。正常发布、礼物暂停、媒体权利变更已由实际 PG 验证会改变版本；不可变内容通过 revision / publication 身份和 manifest/hash 绑定。价格和库存不会因无市场浏览而介入该版本。本次没有进行大规模数据吞吐量基准。

5. **fallback 不构造假的已批准译文。** proof 2 先经真实 published-content reader 验证 manifest 的存储表示与摘要、发布 head/receipt 及完整 canonical proof，再由 `projectPublishedContent` 成功确定 requested / resolved locale。`catalogVerifiedManifest` 仅按原冻结 approvals 转换现有合同字段，保留 publication、approval、translation identity 与内容摘要；它不生成文字或新的审核身份。mapper 仍必须从当前 SQL 结果取得对应英文正文与全部媒体英文翻译，最终复用公开 projector。正文或媒体缺英文、当前译文篡改、缺审核均失败关闭。proof 3 仍返回严格校验后的 daily context；历史 proof 1 保留旧的精确语言证据要求。

6. **艺人筛选保持约定语义。** explicit relation 的暂停/不再接受礼物艺人仍可发现关联礼物，不代表可购买；ALL_ACTIVE_ARTISTS 分支要求 active、accepting、当前真实发布 head/revision 且无 successor。实际 PG 新脚本直接覆盖 explicit 关联与暂停艺人边界；ALL_ACTIVE_ARTISTS 本次独立审查为 SQL/单测静态验证，不声称新增脚本实际覆盖了该分支的全套 PG 状态转换。

## 独立执行

工作目录：`/Users/mario/Desktop/下单`。

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres exec vitest run --config ../../vitest.config.ts --root . src/gift-browse-repository.test.ts src/gift-browse-sql.test.ts src/catalog-directory-repository.test.ts src/catalog-directory-sql.test.ts src/catalog-publication-loader.test.ts
```

结果：**5 files / 49 tests PASS**，退出码 0。

```sh
POSTGRES_TEST_BIN='/Users/mario/Desktop/下单/output/checks/p5-03-refund-operations/native-runtime/dist/postgresql@18/18.6/bin' mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/postgres-catalog-directory.mjs
```

结果：**PASS，120 artists / 120 gifts / 7 locales / 315 assertions**；正常 triggers seed，无 replica bypass；退出码 0。

```sh
POSTGRES_TEST_BIN='/Users/mario/Desktop/下单/output/checks/p5-03-refund-operations/native-runtime/dist/postgresql@18/18.6/bin' mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/gift-browse-postgres.mjs
```

结果：**PASS，803 checks**；25 个真实历史发布礼物，7 语言 × 第 1–4 页，12 / 12 / 1 / 0 窗口，时间相同情况下完整稳定 ID 次序，分类/艺人筛选，真实空页，状态与媒体权利版本变化，无 offer；退出码 0。

```sh
POSTGRES_TEST_BIN='/Users/mario/Desktop/下单/output/checks/p5-03-refund-operations/native-runtime/dist/postgresql@18/18.6/bin' mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/gift-browse-strict-postgres.mjs
```

结果：**PASS，69 checks**；真实隔离 PostgreSQL 中通过现有授权、VALIDATE / PUBLISH 事务建立 proof 2 发布，7 语言读取；退出码 0。

## 故障证据与交付边界

strict PG 脚本的缺译/篡改/缺审核情况，是**实际 PostgreSQL SELECT 的返回叶子由 TEST 包装器移除或修改**：一处处理 preflight translation/review/copy 读取，另一处同步处理旧目录 mapper 的 gift / media translation 聚合。它没有删除或篡改持久化的不可变发布行，也没有替换最终仓储响应/DTO。测试前后完整 publication manifest rows 相等，并确认注入经过 translation-review SQL 叶子。可据此证明真实 PG strict reader 与新桥接路径对这些读取故障的处理；不能描述为“在真实生产数据库删除不可变翻译后恢复”。

本次运行使用自动创建并清理的隔离 PostgreSQL，不连接用户数据库，不启动 HTTP/浏览器，不验证 PSP。daily proof 3 本次做代码追踪，相关真实发布端到端由根任务及其他作者证据覆盖；本报告不借用它们扩充独立 PG 测试计数。本次不重报作者 typecheck/lint/build 为独立运行结果，也不替代根任务的最终质量与浏览器验收。


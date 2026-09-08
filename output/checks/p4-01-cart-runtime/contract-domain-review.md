# P4-01 合同、纯领域与交叉复审

范围：本 agent 编写 `packages/contracts/src/cart-runtime{,.test}.ts` 与 `packages/cart/src/cart-runtime{,.test}.ts`；Application、KMS、API、PG、0023 由其他 agent 编写，本 agent 只读复审。尚未据此判定 P4-01 或 Phase 4 完成。

## 本次实现

- 新增独立版本化初始化、读取、加购合同及内部仓储 records；原合同文件与原 roots 不由本 agent 修改。
- 留言 / 昵称按 Unicode code point 限制 280 / 40，保留原文并拒绝孤立 surrogate；生成 JSON Schema 同样为 280 / 40。
- quantity 限 PostgreSQL int 上限 2147483647；总价用 BigInt 计算并拒绝不安全金额。
- `decideCartRuntimeAdd` 只消费本事务已验证的真实 commerce response，绑定 gift / variant / idol / locale / market / currency、价格提示、当前资格和库存。
- `projectCartRuntimeView` 保留独立行、当前价格变化、各对象原文 provenance；公共 DTO 只有私密字段是否存在的安全布尔，没有留言、全名、密文、supportIntent ID 或 token。
- 非跟踪库存的 null maxQuantity 表示没有有限的库存上限，命令仍受数量上限约束；不会宣称无限实体库存。类型、采购策略与预售分别保留。
- `canonicalCartRuntimeRequest` 仅返回内存内待散列原文，不用于日志或持久化。

## 作者验证

| 验证               | 结果 / 证据                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 合同有效 RED       | `contracts-red.log`：5 个缺少新 schema 的断言失败；`contracts-expiry-red.log`：PG expired 字段门；`contracts-codepoint-schema-red.log`：生成 maxLength 560 与要求 280 不符 |
| 领域有效 RED       | `domain-entry-red.log`：8 个缺少新函数的断言失败。更早 `domain-red.log` 是依赖 dist 未更新的 import 错误，不能作为功能 RED                                                 |
| 合同定向 GREEN     | `contracts-final-green.log`：1 文件 / 8 tests PASS                                                                                                                         |
| 领域完整小包 GREEN | `domain-final-green.log`：2 文件 / 12 tests PASS                                                                                                                           |
| 类型               | `contracts-final-types.log`、`domain-final-types.log`：各包 tsc exit 0                                                                                                     |
| ESLint             | `cart-contracts-lint.log`：以上 4 文件，max-warnings 0，exit 0                                                                                                             |
| 格式               | `domain-contract-format-final.log`：4 文件 Prettier check PASS                                                                                                             |

可重复命令：在相应包执行 `mise exec node@24.20.0 -- pnpm exec vitest run --config ../../vitest.config.ts --root . src/cart-runtime.test.ts`，cart 小包也可执行 `pnpm test`；类型执行对应包 `pnpm typecheck`。依赖 dist 由 root 统一构建。

## 非作者只读结论

- API 会话 / 配置 / 装配：ACCEPT。32B opaque cookie 与 CSRF 只在传输边界处理，全部 1..4 个 pepper 证明完成后才调用 Application，任一 KMS 错误不降级；精确 Origin、CSRF、严格请求 / 响应校验及 private,no-store 保留。未重复真实 HTTP。
- PG / Port / 0023：ACCEPT。授权集合限制 cart 子对象读取，所有 pepper 单查询仅许 0 或 1 个 cart；真实 PG expiry 与末次 ACTIVE/version/expiry 再检查；receipt 绑定真实 outbox 和微秒时间。0023 扩结构资格并修正下述 PENDING 的 NULL 判断，当前发布、艺人状态、价格和库存仍由同事务 commerce 证明；down 拒绝使既有 dynamic-only 或 PENDING 行失效。
- Application / KMS：ACCEPT。重放新增加密依赖的具体问题已反馈并修为私有 marker 回滚探测。真实 transaction runner 仅在成功回滚后保留 marker；外部 KMS 后重新授权及 begin，再同事务写入 item / intent / outbox / idem。未知提交保留安全未知状态；空 intent 仍是真 wrapped key 加两个 NULL 私密字段。测试现显式设置 pending claim、模拟事务 rollback 恢复，并在 KMS 调用时断言 pending=false；这属于 Application 模型测试，没有冒称真实 PG 集成。
- OpenAPI：ACCEPT。Idempotency-Key 原 maxLength 128 已改为真实 256 和原 pattern，GET Origin 可省也已修。
- 最终独立 `node scripts/check-contracts.mjs` exit 0，见 `contracts-independent-freshness.log`。与 base `7ae44bd8c1c07057d746ab2c77242d1e3261fcb2` 比较 421 旧 JSON Schema roots、79 旧 OpenAPI paths、139 旧 schemas、2 headers、4 security schemes 的逐项 JSON.stringify 字节 / 键序全部不变；仅增 27 roots、3 paths、6 schemas、2 cookie / CSRF schemes，见 `contracts-independent-compatibility.json`。整体文件有意增大，未声称整体字节相同。首轮 git show 的 40 MiB subprocess buffer 不足以读取 47 MiB 产物，工具 ENOBUFS 已保留为 `contracts-independent-compatibility-initial-error.json`；改用 256 MiB 后比较通过，没有修改源或生成物。

## S.U.P.E.R（本子任务）

| #   | 结论                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | PASS：合同声明与纯决策 / 投影分别归属自己的模块                                                                                                                                  |
| 2   | PASS：验证、选择、可用性、金额、公共投影各有边界；无无关流程框架                                                                                                                 |
| 3   | PASS：Application → cart → contracts；cart 无 I/O / adapter 依赖                                                                                                                 |
| 4   | PASS：未引入反向或循环 import                                                                                                                                                    |
| 5   | PASS：跨模块值均有 schemaVersion / 严格 schema                                                                                                                                   |
| 6   | PASS：边界数据可序列化；BigInt 只在内部计算                                                                                                                                      |
| 7   | PASS：生产域无站点、币种、市场、艺人 ID、密钥硬编码                                                                                                                              |
| 8   | PASS：cart 的 contracts 依赖由 root 明确登记                                                                                                                                     |
| 9   | PASS：纯域与 PG / KMS / HTTP 通过合同和 Port 分离                                                                                                                                |
| 10  | PARTIAL：本范围定向 tests / types / lint / format 与独立旧产物兼容 / freshness 全绿；已核其他作者的真实 PG / 第七轮 HTTP 及本 agent 的 P2 证据；整仓检查与任务完成仍由 root 收口 |

code-simplifier 收敛已移除域内嵌套价格三元式和重复 maxQuantity 表达式，并复跑本范围验证。跨层只读建议保留现有事务内重复读取的正确性；若后续测出实际成本，可只在同一事务内按完整 gift / variant / idol / locale 键复用同一证明，不引入跨请求缓存。

## 最终补充复审

- 0023 的 moderation 修复：ACCEPT。真实 PENDING 的 decision kind 按既有表约束必须为 NULL，旧 `<> 'AUTOMATED'` 在三值逻辑下不能提前返回。仅改为 `IS DISTINCT FROM 'AUTOMATED'`；AUTOMATED 的精确 evidence / revision / hash 条件保留。作者 `pg-moderation-red.log` 在真实安装触发器下重现 COMMIT 23514，`pg-moderation-green.log` 三项断言验证正常 PENDING 和无证据 AUTOMATED 拒绝；`migration-catalog-moderation.log` 为 23 migrations / 159 tables 的真实 roundtrip，本 agent 只读核对，没有重复 PG。
- 两种退库保护：ACCEPT。DYNAMIC 必须存在真实动态规则独占 intent；PENDING 必须存在真实显式资格的 pending intent 且 dynamic count 为 0，不能被先执行的动态守卫掩盖。二者均执行原 down SQL 与正常 migration runner，断言精确拒绝并比较六表 count / SHA。第七轮 `../p4-01-cart/http-2026-09-08T09-17-42.544Z/results.json` 实际 DYNAMIC 为 3 intents / 7 assertions，PENDING 为 3 intents / 8 assertions，两次 before / after 一致。未输出原始私密行。
- 第七轮真实 HTTP 作者证据为 6,029 assertions / 1,905 setup requests、29 个 cart 协议请求；真响应断连后重放、加密与空 wrapped-key 路径、三个不同正常日常发布后的首次加购均通过，三个用例 `publicPreReads: 0`。诊断在 add 后执行；`publishToAddMs` 仅从发布 fixture helper 返回计到调用 add，不是 DB COMMIT 延迟。第四轮 CONTENT_UNAVAILABLE 仍未定位，后来通过不是已证明修复。证据使用真实 PG / TLS S3 和实际 adapter 接 TEST-local KMS 边界，不是远程 AWS KMS / 生产验证。
- CI Quality 超时 20 → 30 分钟及 `check-ci.mjs` 精确策略同步：ACCEPT。只改变该 job 的预算，Security 保留 20，步骤 / 权限 / 固定 action / 完整检查命令不变；历史完整检查 1186–1207 秒尚未计入安装，预算调整有已有运行依据。本 agent 未运行远程 CI。
- P2-04 / P2-05 仅因新增合同 / 配置 / 依赖指纹过期，已由本 agent 按原 collector 串行真实刷新，见 `shared-ui-refresh-review.md`。P2-05 有三项既有 moderate heading-order violation，原阻断门只要求 critical / serious violation 为零；物理手机证据与 incomplete 仍不能冒称完成。

## 本 agent 冻结 SHA-256

```text
986e21b0fb1e346d42a53d963f89c38526fd0da82c6dd30f8c80ff459fbc504a  packages/contracts/src/cart-runtime.ts
6603655818a14a153973c62dea4d84bf9e53a4d77411373a33d79cb280c4ff0e  packages/contracts/src/cart-runtime.test.ts
de392673f036138eecd88ec7e0c6cb56a538f2358a4e80a0d8bc2442bbb88a99  packages/cart/src/cart-runtime.ts
900ece295662cdd43293415833911a101aa73f0bfe857fe493f5110bdf4aa104  packages/cart/src/cart-runtime.test.ts
```

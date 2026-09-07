# P3-05 公开礼物读取链路：作者证据

执行者：`/root/storefront_read`，P3-05 Lane B 子范围；不独立领取任务，不修改阶段状态。此文件记录后端和严格服务端读取器的作者检查；真实 HTTP/PG/S3/浏览器及全仓验收由 root 和 E2E 执行者另行记录。

## 最终实现边界

- 新增五个合同根（context command/response、gift command/response/internal context），旧 373 个根不由本执行者修改；root 负责导出、注册、生成及深比较。
- `GET /api/v1/storefront-context` 没有 query。市场/币种仅来自 ACTIVE 市场、精确当前 leaf 价格发布、相同 book/revision/market/currency、真实有效价格。政策仅返回经过原发布读取及投影证明的 key/kind，最多 500；坏政策省略。
- `GET /api/v1/storefront-gifts/:handle?locale=&market=&currency=&idol=` 保留原礼物内容与分类证明，逐可见变体附真实价格、库存策略/数量、可售状态和原因。market/currency 必填，idol 可不选；不推测地区，也不创建购物车或支付。
- Port → PostgreSQL manager 使用真实 SERIALIZABLE transaction。内容、current head、价格、库存和被选艺人的完整原发布证明共享快照；价格有效期使用 PG `transaction_timestamp()` 半开区间，保留微秒，不用 JavaScript 日期精度代替。
- TRACKED 数量为单一 ACTIVE location 的 `max(on_hand-reserved)`，不能把两个位置相加。其他策略不需要虚构 inventory item；若已有 item 仍校验状态和策略。非库存策略数量输入上限复用原 commerce 安全整数上限，绝不表示现货数。
- 未选艺人的每个变体最多选取一位 SQL current active/accepting 候选作为完整发布见证，最多 64 位并按艺人去重。SQL 真无候选才表示无合格艺人；有候选但发布/媒体证明失败则整次 CONTENT_UNAVAILABLE，不能宣称没有其他合格艺人。
- Application 和 Route 再次验证 handle、locale、scope、recipient 与输入匹配。服务端 reader 不传用户 Cookie、拒绝重定向、no-store、8 秒超时；响应状态与严格 envelope 必须一致。实际 PG/API 不返回 fallback。reader 只接受具有正确 requested locale 和明确 translationRevision 的合法 English fallback DTO，不会对通用 503 改用英语重试。
- Directory reader 严格核对全部条目 locale/scope/唯一身份和页面实际 cardinality：`max(0,min(pageSize,totalItems-(page-1)*pageSize))`。短页、末页多项和越界页多项均拒绝。

## RED → GREEN 与命令

所有 pnpm 命令使用 `mise exec node@24.20.0 -- corepack pnpm`。

| 范围                        | 可重复命令尾部                                                                                                                                                                                  | 最新结果/证据                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 新合同 + OpenAPI            | `--filter @fan-support/contracts test src/storefront-commerce.test.ts src/storefront-commerce-openapi.test.ts`                                                                                  | 5 PASS，`contract-green.log`；OpenAPI 模块缺失 RED 在 `openapi-red.log`                                          |
| 纯 offer 决策               | `--filter @fan-support/catalog test src/storefront-offers.test.ts`                                                                                                                              | 5 PASS，`offers-green.log`                                                                                       |
| Application                 | `--filter @fan-support/application test src/storefront-commerce.test.ts`                                                                                                                        | 3 PASS，`application-green.log`                                                                                  |
| PG data/repository/manager  | `--filter @fan-support/persistence-postgres test src/storefront-commerce-data.test.ts src/storefront-commerce-repository.test.ts src/postgres-persistence.test.ts`                              | 25 PASS，`pg-unit-green.log`；`pg-unit-red.log`、`pg-wiring-red.log` 保留缺模块/manager RED                      |
| API + prod/test composition | `--filter @fan-support/api test src/storefront-commerce-route.test.ts src/published-content-composition.test.ts src/publication-runtime-composition.test.ts src/production-application.test.ts` | 8 PASS，`api-green.log`；`api-red.log` 保留 RED                                                                  |
| 严格 HTTP reader            | `--filter @fan-support/storefront test src/server/public-commerce.test.ts`                                                                                                                      | 7 PASS，`http-reader-green.log`；缺模块 RED `http-reader-red.log`、真实短页逻辑 RED `reader-cardinality-red.log` |

受影响源码及测试 prettier/ESLint 通过，`backend-reader-lint.log`。PG、API、Next typecheck 通过（工具结果）；root 后端正式 build 另有日志。最初合同/offer/Application 缺模块 RED 在工具历史中，本文件不把不存在的落盘日志当作证据。

## 实际 PostgreSQL 联调发现与最小修复

E2E 首两轮新 `/storefront-context` 返回 503（`compiled-preview-first.log`、`compiled-preview-second.log`），第二轮安全 SQLSTATE 日志没有 SQL 执行失败。原 mock 直接提供数组，未覆盖 node-pg 对自定义 DOMAIN 数组的类型解析。

完整迁移后的临时真实 PostgreSQL 精确复现：`array_agg(currency)` 对 `public.currency_code` 生成 DOMAIN 数组，node-pg 返回 string，严格合同拒绝；同一查询改为 `array_agg(currency::text)` 后返回 string[]。只修改聚合元素输出类型，保留全部价格和发布业务谓词，不增加重试、不放宽合同。

可重复探针：`mise exec node@24.20.0 -- node output/checks/p3-05-gift-storefront/domain-array-probe.mjs`。`domain-array-probe.log` 与再次运行 `domain-array-probe-replay.log` 都记录 ORIGINAL array=false/type=string 与 TEXT_CAST array=true/type=object，并精确验证修复值。默认新公开 HTTP 协议的真实 context 读取将覆盖该 driver 回归。

## S.U.P.E.R 与范围说明

1–9 作者检查通过：合同、纯决策、Application、Port、SQL映射、发布聚合、HTTP Route、配置装配和服务器 reader 各自承担一个概念职责；依赖向内、无反向依赖；跨模块严格可序列化 Zod 合同；运行配置复用原 config；新增依赖为零；适配器和渲染可独立替换。第 10 项受影响测试通过，全仓 check 与真实浏览器验收由 root 汇总后才能判定整个任务完成。

这些是本地实现/测试证据，不构成 staging、生产发布、支付 sandbox 或真实小额交易验证。当前 scoped matrix 的真实夹具包含实际价格；无价/坏库存项等分支另有 Domain 单测，不能把全部分支称作已由真实 HTTP 穷尽。

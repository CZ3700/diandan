# P3-01 checkpoint 3A：管理内容 HTTP 验证

本地验证：2026-09-06。此目录覆盖 transport 与真实 PostgreSQL → Application → Nest/Fastify loopback HTTP；生产 OIDC 登录、管理页面、公开内容发布不在此证据范围。

- 8 个管理 POST 与 1 个只读 preview POST。管理 body 从冻结 command 合同去掉 `action` / `idempotencyKey`，路径和 header 注入相应值；服务端注入 request ID，身份取自固定 `__Host-fan-admin-session` cookie。
- 精确配置 Origin、JSON、独立 CSRF header；重复/无效 cookie/header、客户端身份/动作注入和任何 query 参数被拒绝。16 MiB 请求上限。
- 成功、授权失败、解析错误、413 和未知路径统一 `private, no-store`、`noindex, nofollow`、`no-referrer`；无反射 CORS。
- 每种管理 action 校验对应成功 kind；预览响应必须匹配请求的对象/revision/locale。原始 session/CSRF/preview token 不进入日志或 PostgreSQL 明文持久化。

## 最终结果

| 验证                             | 结果                                                 | 证据                                                              |
| -------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| Transport 失败测试               | 缺失路由、错误成功类型、未实现单语言审稿均按预期 RED | `routes-red.log`、`routes-binding-red.log`、`review-read-red.log` |
| Transport tests                  | 10 tests PASS                                        | `routes-green.log`                                                |
| 全部 API tests                   | 45 tests PASS                                        | `api-tests.log`                                                   |
| 真实 HTTP + PostgreSQL           | 434 assertions / 68 real requests PASS               | `preview-clock-rollback-green.log`                                |
| API 依赖构建                     | 18/18 PASS，1 cached                                 | `build.log`                                                       |
| API typecheck、目标 lint、format | exit 0                                               | `api-typecheck.log`、`transport-lint.log`、`transport-format.log` |

真实 HTTP 测试包含：过期/撤销/MFA 缺失/无权限会话、Origin 与 CSRF、幂等成功重放和冲突、别名独立审核、七语言礼物提交和独立审核、单语言审核人读取选定译文与真实英文源稿、预览 token 对象/语言绑定、撤销与真实约 3 秒会话到期、scope/session 撤销、仅保存带 pepper 且区分用途的摘要、没有新增发布历史。

故障注入用独立测试触发器仅在创建 audit 时抛出固定异常；真实 HTTP 返回安全 503，草稿/审核/audit/idempotency 均为 0 行。移除测试触发器后，同一个 Idempotency-Key 成功创建且只生成一次 audit。未禁用任何生产约束。

## 迭代证据与边界

- `routes-green-attempt1.log`：测试驱动器不接受值为 undefined 的 header；测试改为省略该键后复验。
- `routes-integration-stale-build.log`：并行集成时 Application dist 尚未包含新导出；依赖构建后全部 API 测试通过。
- `postgres-http-red.log`：初始 TEST composition 尚未构建。
- `postgres-http-attempt1.log`：共享 catalog fixture 需要两位艺人来绑定两种 variant，初版 count=1 在 seeding 失败；改为 count=2。
- `postgres-http-attempt2.log`：preview SQL 使用保留字 `current_time` 作为 CTE 名，实际 PostgreSQL 报 SQLSTATE 42601；改为 `preview_clock`。
- `postgres-http-attempt3.log`：原范围 375 assertions / 60 requests PASS；最终加单语言审稿及完整 HTTP 故障回滚证据后为 408 / 65。
- 首次全仓检查在 `/reviews/approve` 遇到一次 503，原日志保留于汇总目录 `output/checks/p3-01-admin-content/check-first.log`。独立原样复现一次及带诊断复现三次均 408 / 65 PASS（`postgres-http-regression-repro1.log` 至 `repro4.log`），随后数据库探针定位本机实际墙钟回拨，协调者修复授权时钟假设与审核因果时序。HTTP harness 保留仅在状态不符时输出的受限诊断：请求序号/动作/语言、合同错误码、事务内 port 阶段、两次授权时间与到期时间的数值差；不包含 ID、内容、token、hash 或 SQL 参数，也不增加重试或放宽断言。
- 另补两项确定性真实 HTTP 回拨回归：`preview-clock-rollback-red.log` 证明旧 revoke 在事件时刻早于已存 grant 时返回 503 / INTEGRITY_VIOLATION；`preview-issue-clock-rollback-red.log` 证明旧 issue 在墙钟早于正常创建的 session 时也返回相同错误。两项均使用正常签发的 grant/session 与全部正常约束；只在 TEST 实际 pg.Pool 中针对该事件时间 SELECT 模拟回拨 60 秒，不改变系统时钟、授权查询、触发器或其他 SQL。
- `preview-clock-rollback-green.log` 最终 434 / 68 PASS：revoke 使用已存签发时刻作为因果下限，issue 保持真实事务开始时刻并仅回拨墙钟；两个注入点各精确执行一次。数据库验证两者事件时刻分别不早于 grant/session 创建时刻，audit 时间精确相等；issue 剩余 TTL 缩短且不会超出 session 到期时刻。

测试身份只由显式 TEST composition 与合成数据库 fixture 提供；未新增公开登录或匿名 session 发行接口。只读 preview 是受限 JSON 内容接口，移动/桌面管理预览 UI 与正式身份供应商联调仍属于后续工作。没有新增真机、PSP、云、staging 或生产发布证据。

复验：`mise exec node@24.20.0 -- corepack pnpm exec turbo run build --filter=@fan-support/api... --output-logs=errors-only`，随后 `mise exec node@24.20.0 -- node apps/api/scripts/postgres-admin-content-http.mjs`。

S.U.P.E.R：文件/函数分别承担 transport、行为测试、真实 HTTP 验证；依赖方向 Route → Application，业务授权由 port/PG 负责；请求/响应使用共享 schema；无新运行依赖或循环依赖；Origin/数据库/pepper 由配置注入；所有本范围验证通过。未修改旧发布合同或恢复已删范围。

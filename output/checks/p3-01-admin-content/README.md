# P3-01 检查点 3A：受权内容审核与只读预览

本地实现日期：2026-09-06。范围为已存在 DRAFT 父 revision 的艺人别名与受控礼物详情。P3-01 保持 IN_PROGRESS，基础内容创建/复制接续 3B，完整发布/回退/outbox/purge 接续检查点 4。

## 已实现

- 8 个管理 POST、1 个只读预览 POST；创建、读取、单语言审稿、提交、独立审核、预览签发和撤销均走 Route → Application → Port → PostgreSQL。
- 平台 session、MFA、当前 RBAC 和语言分配与内容操作共享 SERIALIZABLE 事务。客户端不能提供有效的 actor、审核证据或服务器时间。HTTP 严格校验 Origin、Cookie、CSRF、JSON 与幂等 header。
- 单语言审核人读取选定译文与实际英语源稿；审核序列、内容 hash、英语 lineage 必须仍匹配；结构作者和译文作者均不能批准自己的内容。
- 写入、审核、精确审计与幂等结果引用原子提交。重放前仍需当前授权；失败不残留幂等占位，同一请求可安全重试。
- 256-bit 预览凭证只在签发时返回，数据库只保存带 pepper 且按用途隔离的摘要；绑定对象、revision、locale，最长 15 分钟且不超过会话有效期。读取时重验签发人会话/MFA/权限/语言，支持撤销；不进入 URL、日志或共享缓存。
- 0014 为新增授权/预览历史和审核约束，不覆盖旧内容历史。语言权限允许活跃管理员撤销停用管理员曾发放的权限，原授予人与原审计保留；有审计历史时拒绝降级删除。
- TEST composition 使用真实数据库 session 与合成身份，未开放生产 OIDC、登录发行或匿名管理访问。预览返回内容数据，管理页面和双端排版由 P3-02/03 接入。

## 验证记录

统一命令前缀：`mise exec node@24.20.0 --`。

| 验证                          | 命令或证据                                                                                                                                                                                    | 结果                                                             |
| :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| 失败测试                      | `contracts-red.log`、`transaction-red.log`、`preview-red.log`、`bootstrap-red.log`；Application/HTTP 子目录的 RED；`independent-revoker-red.log`                                              | 先复现缺失行为与边界问题，再实现                                 |
| 受影响测试                    | `corepack pnpm --filter @fan-support/contracts --filter @fan-support/application --filter @fan-support/persistence-postgres --filter @fan-support/api test`；`targeted-tests-clock-final.log` | 218 + 137 + 288 + 45 = 688 tests PASS                            |
| 合同生成/兼容                 | `corepack pnpm contracts:generate`、`corepack pnpm check:contracts`；`compatibility.json`                                                                                                     | 225 roots；旧 206 个定义逐项深比较不变；9 个新增 HTTP operations |
| 真实 PostgreSQL 内容权限/审核 | `node packages/persistence-postgres/scripts/postgres-admin-content.mjs`；`causal-review-time-green.log`                                                                                       | 108 assertions PASS                                              |
| 真实 PostgreSQL + HTTP        | `node apps/api/scripts/postgres-admin-content-http.mjs`；`../p3-01-admin-content-http/preview-clock-rollback-green.log`                                                                       | 434 assertions / 68 real requests PASS                           |
| 连续审核路径                  | `review-timing-after-causal.log`；可复现探针 `review-timing-probe.txt`                                                                                                                        | 100 组七语言内容、1800 次真实 Application + PostgreSQL 操作 PASS |
| 迁移及 catalog                | `node packages/persistence-postgres/scripts/postgres-integration.mjs --write-catalog`；`catalog-write.log`                                                                                    | 14 migrations / 124 tables PASS                                  |
| 格式与 lint                   | `corepack pnpm format:check`、`corepack pnpm lint`；`format-clock-final.log`、`lint-clock-final.log`                                                                                          | exit 0                                                           |
| 浏览器                        | `browser-composites.log`、`browser-motion.log`                                                                                                                                                | 两组 exit 0                                                      |
| 全仓                          | `corepack pnpm check`；`check.log`                                                                                                                                                            | exit 0；首次失败保留在 `check-first.log`，时钟修复后完整复验通过 |

## 关键验证范围

真实数据库覆盖无 MFA、过期/撤销会话、权限和语言撤销、撤权后重授、原授予者停用后的独立撤权、审核状态/hash/并发冲突、拒绝作者自审、授权与写入同事务锁、预览范围/到期/撤销和降级历史保护。

真实 HTTP 故障注入仅通过独立测试 audit trigger 抛出固定异常，未禁用生产约束。返回安全 503 后，草稿、审核、audit、idempotency 均为 0 行；移除测试 trigger，使用同一个 Idempotency-Key 成功且审计只生成一次。单语言审稿覆盖日语授权用户不能读完整七语言草稿，但可读日语译文及真实英语源稿。

结构作者约束在数据库中另以临时表附加同一生产 trigger 做隔离验证，传入真实 translation/document 关联，以证明另一译文作者不能让结构作者自审。0013 初始创建仍绑定同一编辑者；完整复制/转交作者流程尚属 3B，不以该隔离测试冒充已完成作者编辑流程。

## 修复与复核

- 实际 PostgreSQL 暴露 preview CTE 使用保留字的问题，改为 `preview_clock`；真实 HTTP 重跑通过。
- 初次处理正常时钟推进后，全仓运行又暴露墙钟回拨；最终方案如下。正常推进与回拨两类 RED/GREEN 均保留在 Application 子目录。
- 非作者复核发现撤权错误绑定原授权人，已补真实数据库 RED → 97 断言 GREEN；OpenAPI 的只读审核并发/幂等说明同步修正。
- 独立评审见 `independent-review.md`；Application 与 HTTP 分项证据见相邻 `p3-01-admin-content-application/README.md`、`p3-01-admin-content-http/README.md`。
- 会话与 CSRF 实现参考 [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) 和 [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)，本轮通过与否仍以仓库实际测试为依据。

### 全仓失败定位与时钟策略

`check-first.log` 在审核返回 503。四次独立 HTTP 重跑未复现，未据此宣布修复；随后真实 PostgreSQL 连续审核探针复现，`review-timing-detail2.log` 捕获同库严格顺序请求中约 180 ms 的墙钟回拨：已经保存的提交时间晚于新取得的批准时间。`clock_timestamp()` 表示实际墙钟，`transaction_timestamp()` 在事务内固定，依据见 [PostgreSQL 时间函数文档](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT)。本机具体回拨量来自上述实验日志，不推断操作系统同步服务的原因。

- 审核事件取数据库已锁定的编辑/前次审核时间与当前时钟的较大值，再向上取整毫秒；旧序列、独立性和 hash 检查保留。固定回拨、同毫秒、原始微秒下限分别有真实 PG RED/GREEN。
- Application 每次仍校验当前 canonical 身份/权限及过期状态，两次身份/会话/截止时间保持一致；不再把两次墙钟采样或授权与签发时间差当作可信的单调性证据。
- 预览签发/撤销采用事务时间与持久历史的因果下限，以 UTC 六位精度文本写入精确审计。签发截止时间同时不超过事务时刻 + TTL、当前墙钟 + TTL、会话到期，回拨不会延长期限。0014 上限只接受当前事务和已有会话/预览历史能证明的时刻。
- HTTP TEST 用真实 PostgreSQL pool 仅在指定事件时间 SELECT 注入回拨，系统时钟、授权查询和全部数据库约束保持；两份 RED 与最终 434/68 GREEN 均保留。没有增加自动重试、睡眠或容差绕过。

### S.U.P.E.R 10 项

| #   | 检查         | 结果                                                                                                    |
| :-- | :----------- | :------------------------------------------------------------------------------------------------------ |
| 1   | 文件单一职责 | PASS：合同、授权、审核、预览、幂等、transport 和组合各自分离                                            |
| 2   | 函数单一职责 | PASS：解析、授权、状态验证、持久写入与响应投影独立；code-simplifier 复核保留明确分支                    |
| 3   | 单向依赖     | PASS：Route → Application → Content/Port → PostgreSQL；业务规则不依赖 HTTP/SQL                          |
| 4   | 无循环依赖   | PASS：既有包边界与依赖构建通过，未新增包                                                                |
| 5   | Schema 边界  | PASS：19 个新 roots；旧 206 定义不变；HTTP 与 port 使用共享 schema                                      |
| 6   | 可序列化 I/O | PASS：严格 JSON 和规范摘要/时间；数据库连接不跨 port，session/CSRF 明文不进入响应，预览凭证仅签发时返回 |
| 7   | 无生产硬编码 | PASS：Origin/数据库/pepper 注入，实体来自 PostgreSQL，固定 locale 复用唯一 owner                        |
| 8   | 依赖显式     | PASS：Application 补同版本 Node types，workspace 锁一致；无新运行供应商依赖                             |
| 9   | 实现可替换   | PASS：Application 依赖事务 port；TEST 组合可注入实现，生命周期显式关闭                                  |
| 10  | 验证通过     | PASS：受影响 tests、全仓 check、真实数据库/HTTP/S3、浏览器、secrets/diffcheck 与独立复核全部通过        |

### 最终全仓与源码绑定

最终 `corepack pnpm check` exit 0：typecheck 56/56（25 cached）、test 56/56（27 cached）、build 35/35（28 cached），31 个 package exports 由 Node 导入验证。真实 PostgreSQL 的迁移、旧内容/目录、持久事件与媒体租约门禁通过；新内容授权/审核 108、HTTP 434/68 和媒体 worker + TLS S3 423 条联合断言均在本次完整运行内再次通过。格式、lint、生成合同、架构及构建产物检查通过。

P2-04 为 16 场景/18 PNG/10 axe，P2-05 为 8 场景/22 PNG/3 axe，critical/serious 均为 0；覆盖手机/桌面、七语言、键盘、reduced-motion、长文案和组合组件原生 200% zoom。后续时钟修复不涉及渲染输入，最终全仓检查再次验证两组截图与当前渲染指纹匹配。本轮没有新的真机验证。

`validation.json` 记录命令结果及边界；`implementation-source.json` 绑定 50 个实现和共享输入，SHA256 为 `ec012fd5fe0d76279e2b4da2dd9929b808a331c230a04f1abe9f44abe2cbae55`。该范围包含共享文件中的既有内容，不能把 50 个文件都算作本轮新增。文档和证据排除在实现哈希外，避免循环绑定；首次失败前的输入记录保存在 `implementation-source-before-clock-fix.json`。

## 剩余边界与下一入口

此结果是本地未提交工作区的内容子检查点。未新增管理 UI、生产身份服务商、真实运营内容、公开发布/回退、云 CDN、PSP、真机、远端 CI、staging 或生产发布证据。新扩展的 VALIDATED/PUBLISHED/ROLLBACK 拒绝门继续保留。下一入口为 `docs/plan/p3-01-content-runtime.md` 的 3B；完整 P3-01 验收后才解锁 P3-02/03/04。

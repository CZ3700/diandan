# P5-02 验证中发现的问题

保留失败结果，不把后续修复掩盖为首次通过。最终通过范围以 `final-verification.md` 为准。

| 检查 | 原因与处理 |
| --- | --- |
| 合同、应用、UI 和仓储的定向测试 | 按冻结合同先观察 RED，再实现。包含错误目标 DTO、独立备注 KMS 目的域、权限、BFF 429、审核状态文案及私密面板焦点。 |
| 首次实际订单 HTTP | 本地 OIDC 夹具使用了不匹配的 client ID；沿用原 TLS IdP 的配置并显式检查 302/Location，不改变生产身份验证。 |
| 实际留言审核 PostgreSQL | 同一参数推断同时落在 positive_version 域与 bigint 导致 `42P08`；显式 SQL 类型转换，新增全部 8 条参数语句的实际 PREPARE 检查。 |
| 第 3 轮浏览器 | TLS 测试域映射只在父进程 import，子进程缺少 DNS 映射；子进程显式加载自有测试域映射。没有更改系统 hosts 或禁用 TLS。异步路由失败曾输出合成测试凭证，日志按 `browser-3-redaction.json` 脱敏；仅清理已验证属于该轮的孤立 Next/PG，见 `browser-3-cleanup.json`。 |
| 第 4 轮浏览器 | 业务流程完成后，分页返回与页面导航之间存在响应观察竞态；请求结束后再 drain 正文观察，导航前完成旧页面读取。错误仍导致 FAIL。 |
| 第 5 轮浏览器 | 网络失败后重试只等搜索框存在，旧表单可能早于本次刷新完成而被操作。增加实际重试响应结束、非 busy、错误消失、搜索值和唯一目标结果的验证。改变查询仍要求匹配查询的实际 HTTP 200，诊断只含布尔值及状态码。 |
| 通知顺序及跨订单幂等 | 第 6 轮发现未过固定接受截止的 UNKNOWN 人工发送未阻止新自动状态；第 7 轮发现跨订单同键并发缺少明确冲突。修复后第 8、9 轮 6085 检查通过，未删除旧历史或扩大未知重试窗口。 |
| 独立授权复核 | 原 joint SELECT 可能锁 session→identity，与退出登录 identity→session 反向；实际 PG 复现 `40P01`。分开并统一锁序，当前/全部退出的实际并发回归均成功，等待授权返回 UNAUTHENTICATED。 |
| 额外旧 PostgreSQL 整体回归 | 原 rollback 夹具仍写死 head 0029，遇当前 0032 被保护断言拒绝；在保留真实数据及审计拒退条件下补齐新增空迁移前缀，原迁移 SQL 不改。完整命令在目录测试处 exit 1，后续采用明确的剩余原命令后缀复验（目录后还发现 content-draft/event-time helper 的同类常量并修复）；五个旧 commerce proof 也先实际 PG RED 再经五条完整 HTTP GREEN，不宣称原单条命令全绿。 |
| 最后质量检查的第一次 | 新增的两个独立验证证据 `.mjs` 分别使用 URL / performance 却未显式 import，ESLint no-undef；仅添加 `node:url` / `node:perf_hooks` import，定向 lint 通过，重新运行整体质量门。 |
| 依赖审计默认 registry | npmmirror 的 audit 端点不可用；明确指定官方 npm registry 的 high-level audit 成功，没有修改依赖或降低审计阈值。 |

浏览器脚本的异步异常清理/脱敏及搜索完成语义现有 4 项持久 Node 测试，串入 `test:browser:admin-orders`。新增退出锁回归串入 `test:postgres:admin-orders`。这些工具修复均未降低业务校验、数据库约束、隐私检查或生产门禁。

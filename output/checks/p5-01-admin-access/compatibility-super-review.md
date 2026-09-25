# P5-01 只读兼容性与 S.U.P.E.R 复核

基线 `270253c356286ce23782bd98f433b87caa01119f`。完整机器结果、SHA 与审阅时间见同名 JSON。本轮只读核对，未修改源码，未重跑 PG、浏览器或全仓检查。

| 保护项 | 实际结果 |
| --- | --- |
| 0001–0029 迁移 | 58/58 up/down SQL 逐字不变；旧 29 条 manifest 内容不变，仅追加 0030 |
| generated schema roots | 最终浏览器响应候选重核：606/606 旧 root 深度内容一致，0 删除、0 改写；新增 18 个 AdminAccess v1 root，总数 624；外层 metadata 不变 |
| OpenAPI | 与基线逐字一致，SHA256 `09f906d8652dc4eae1efaa9fd8a6a2d9e8ea8e2dda463914869bed5f59f42b34` |
| 初始未跟踪文件 | 首次核对于2026-09-17T17:56:13.992Z完成：snapshot 的 4,633 个唯一路径全部 SHA 一致；0 缺失、0 变化、0 读取期间变化；实际读取 4,388,133,180 bytes。本次schema增补未重哈这些文件，结果仍归属于首次时点 |

S.U.P.E.R 1–9 的静态复核通过：合同、用例、OIDC adapter、持久化、BFF 与 transport 各自承担独立职责；依赖经 port 向内；新边界使用可序列化 v1 合同；provider 网络操作在 SQL 事务外；生产配置不固定身份/密钥，新增依赖声明和 lock 一致；provider/storage 可通过既有接口替换。未发现新架构反向依赖，但本次不冒充全仓循环依赖扫描。

新增 `AdminAccessBeginBrowserResponse` 已读取源码并以已构建合同执行21个直接safeParse断言：成功仅允许 `schemaVersion/outcome/kind/authorizationUrl`，失败保持安全错误枚举；成功和失败均严格拒绝额外 `binding/browserToken/bindingDigest/sessionToken/csrfToken/clientSecret/tokenPepper/subjectPepper`；HTTP和javascript URL拒绝。内部带HttpOnly-cookie绑定凭据的begin合同仍独立有效。该复核只证明响应对象合同，不替代正在修复的同源fetch、HttpOnly Cookie及真实Chrome导航验收。旧623-root核对记录保留于JSON历史快照。

第 10 项保留为 **最终整合待闭合**：本 agent 已实际观察 40 scoped tests、最终 PG115、30 migrations/175 tables round-trip，以及 build/typecheck/format/lint/manifest 通过。已读取早期本地 TLS OIDC+PG+HTTP 的 159/159 检查；该记录早于最后约束修正，不能替代 root 的最终同候选 HTTP、七语言双视口浏览器及全仓结果。持久层由本 reviewer 编写，其非作者复核来自 `auth_persistence_audit`，不把自审写成独立复核。

按 `task-breakdown.md:137`，已授权的本地 OIDC、server session、RBAC、CSRF、MFA 强制校验及审计范围未发现额外未实现功能。六角色及平台数据库授权、动态撤权/挂起、未知身份拒绝、跨浏览器/重放/错误 CSRF、审计不可变均有实现与本地证据。还不能凭此报告标记 P5-01 DONE：最终 UI/整合验收仍须收齐。正式 IdP、真实 MFA 策略与账号恢复/紧急访问、管理 UAT 仍为生产前开放项；`LOCAL_OIDC` 只在 development 启用。ADR-015 不关闭 P3/P4、商户、性能、staging 或发布门。

另只读认可继承的 P3 测试夹具修正：`gift-directory-page-entry.test.tsx` 将完整 locale-keyed object 改为 `Map<SupportedLocale, typeof en>`，并用 `routeFor` 拒绝缺失 fixture；两组 `test.each(SUPPORTED_LOCALES)` 和七个实际 route import 保持。`scripts/check-contracts.mjs` 与基线逐字一致，没有放宽 checker。这属于既有验收门修正，不是 P5-01 产品功能；实际定向测试/gate 结果由 root 补入。

限制：字节保护结果是 JSON 记录时点的快照，仅覆盖最初清单内 4,633 个文件；新增 schema 的兼容增加不单独证明运行行为。本报告不等于生产身份接入、部署或正式 UAT 验收。

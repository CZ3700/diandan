# P3-01 checkpoint 4A 验证记录

状态：本地验收通过（2026-09-06）；最终全仓 check exit 0。P3-01 继续 IN_PROGRESS；本记录仅覆盖五类基础内容按语言审核与受控预览。

## 本轮交付

- 艺人、礼物、首页、政策、媒体元数据的七语言读稿、送审与独立批准。读稿保留目标译文和实际英语；STALE 可查看修订，新送审/批准必须核对当前源 hash、审核序列、正文 hash 与 ICU 变量。新稿的译文作者和结构作者均不能批准。
- 预览绑定 owner/revision/locale，256-bit 凭证仅签发时返回，按用途加 pepper 摘要落库；签发 TTL 为 60–900 秒，实际有效期不超过会话。当前会话、MFA、权限、语言授权撤销提交后的后续预览读取失效；签发者仍可在语言权限撤销后主动撤销自己的 grant。
- 五个受权管理 POST 和一个只读 preview POST；同源/CSRF、64 KiB 严格 JSON、拒绝 URL 凭证与 query、所有成功/错误响应 private/no-store/noindex/no-referrer。单语言 reviewer 不得到其他语言审核身份；关联引用不授予关联草稿或存储对象访问权。
- SERIALIZABLE 中处理授权、内容、审核、审计、幂等结果引用。0016 增加两张专属 FK 表及追加历史约束；新审核须有 3B 作者收据，历史稿先 COPY；合法原文审批继承仍由 0015 真实 FK 证明。保留已有历史时拒绝 down。
- 新增 13 个合同 roots，旧 233 定义逐项深比较不变，总计 246。数据库最新为 16 迁移、132 表。公开发布门保持既有约束。

## 可重复验证与结果

命令统一在仓库根目录执行，前缀 `mise exec node@24.20.0 --`。接口和使用步骤见 `docs/plan/p3-01-base-content-review.md`。

| 检查 | 结果 | 证据 |
|:--|:--|:--|
| 六个受影响包 test | 960 PASS：contracts 234/content 149/application 207/port 4/PostgreSQL 299/API 67 | `affected-tests-final.log`；最后仅测试 URL 构造调整另见 `composition-final.log` |
| 基础内容真实 PostgreSQL | 910 断言 PASS；五类七语言、正常触发器、历史/伪造/并发/故障原子性/微秒时间 | `postgres-green.log` |
| 基础内容真实 HTTP | 3847 断言 / 388 请求 PASS；真实 Nest/Fastify + PostgreSQL | `http-session-microseconds-green.log`、`HTTP-README.md` |
| 旧 3A/3B PostgreSQL | 110 / 211 断言 PASS | `postgres-3a-final-green.log`、`postgres-3b-green.log` |
| 旧作者 HTTP / 公开目录 PG | 909 断言 / 114 请求；307 断言 PASS | `legacy-authoring-http.log`、`catalog-regression.log` |
| 迁移 up/down/up 与生成目录 | 16 migrations / 132 tables PASS | `catalog-write.log` |
| P2-04 真实浏览器 | 16 场景 / 18 PNG / 10 axe；0 violations | `browser-composites.log`、`output/playwright/p2-04/browser-results.json` |
| P2-05 真实浏览器 | 8 场景 / 22 PNG / 3 axe；critical/serious 0，保留 3 条已知 heading-order moderate | `browser-motion.log`、`output/playwright/p2-05/browser-results.json` |
| 全仓 check | exit 0；typecheck 56/56（25 cached）、test 56/56（27 cached）、build 35/35（28 cached）；format/lint/架构/31 package exports PASS | `check.log` |
| secret scan / 最终实现指纹及旧合同 | PASS；863 输入指纹未变、旧 233 roots 无变化 | `secrets-final.log`、`source-final.log`、`compatibility.json` |
| 非作者交叉复核 | 三路 ACCEPT，无待修复项 | `independent-review.md` |

P2-04/05 均为生产构建的本地 Chrome 回归；覆盖 390×844 与 1440×900、七语言/伪语言、键盘、reduced-motion 和错误状态，P2-04 另含原生 Chrome 200% 缩放。root 实际查看越南语手机、日语桌面两张组合组件截图。没有新增后台业务 UI 或真机录屏；P2-05 的 `physicalDeviceEvidence=false` 与已有 moderate 记录均保留，不能将模拟触摸当作新手机证据。

最终全仓还重跑旧目录 HTTP 264 断言 / 43 请求、3A HTTP 434 / 68、媒体 PostgreSQL 152、真实图片字节与 TLS S3 的媒体 worker 423 联合断言；均 PASS。源码冻结后本次完整 check 一次 exit 0，未跳过失败或使用生产发布结论代替本地验证。

## 失败先行与修复

- 合同、纯规则、Application、事务组合、SQL 与 HTTP 各自保留 RED。预览审计 SQL 参数错位被真实数据库拒绝，改为具名对象参数并在集成中验证准确 action/grantId（`postgres-issue-red.log` → `postgres-green.log`）。
- 历史 COPY 快照可读不意味着新审核可绕过 ICU 检查；新写入依据真实英语与目标文案验证语法及变量（`application-domain-icu-red.log` → `application-domain-green.log`）。
- 精确会话/预览时间使用完整小数秒比较，1 微秒越界应拒绝；Application 单元测试证明 canonical 授权时仍剩 1 微秒，不因毫秒截断误判过期；授权 SQL 以 UTC 六位小数返回 now/expires_at，避免 pg Date/毫秒转换丢失精度。真实 HTTP 的会话上限 +789 微秒场景先失败后通过，并观察实际过期拒绝（`application-microsecond-red.log`、`postgres-auth-microseconds-red.log`、`http-session-microseconds-red.log` → 相应 GREEN）。没有扩大 TTL、增加时间容差或修改系统时钟。
- 旧 3A 的 350 ms 短预览凭证 fixture 因墙钟回拨出现 expires_at 早于 created_at；仅改测试用数据库事务时间和实际过期条件，以单调计时作等待上限，未改 0014 或生产规则。最终 110 PASS；`postgres-3a-green.log` 实为一次失败历史，只有 `postgres-3a-final-green.log` 是最终成功。
- 撤销 API 文档补明语言权限撤销后仍可主动撤销自己的 grant（`revoke-doc-red.log` → `revoke-doc-green.log`）。secret scanner 正确拦截测试中具有 Basic-auth 形态的合成 URL；改为 URL 属性构造并保留凭证拒绝断言，最终扫描与组合测试均 PASS（`secrets.log` → `secrets-final.log`）。

## 源码绑定

`implementation-source.json` 包含当前工作区实现、测试、脚本、迁移、生成物及此前未提交工作，共 863 个输入；不含文档/证据。算法 `sha256-json-path-content-list-v1`，SHA256 `818d5fb56b321cb2c304fd614aee03ed160abbd1a2b7ad176698901537b10981`，Git HEAD `674ef5b4a57a6bb9ada6be5bf63670df9105ced4`。浏览器另核对各自完整渲染输入与前后工作区文件清单，门禁未放宽。

## S.U.P.E.R 10 项

| # | 检查 | 结论及依据 |
|:--|:--|:--|
| 1 | 模块单一职责 | PASS：合同、投影/规则、时间、用例、SQL、路由、组合拆分 |
| 2 | 函数单一概念 | PASS：读取、提交/批准校验、签发/读取/撤销、审计写入分别实现；审计参数改为具名对象 |
| 3 | 向内单向依赖 | PASS：Route → Application → Content/Port → Adapter；领域测试不依赖服务 |
| 4 | 无循环依赖 | PASS：架构检查及包构建验证 |
| 5 | 接口有 schema | PASS：13 个新增 versioned roots、严格 owner union、OpenAPI 与持久化 ports |
| 6 | I/O 可序列化 | PASS：JSON 数据、ISO 时间与安全结果引用；时间精度内部处理，无 Date/BigInt 跨边界 |
| 7 | 无生产配置硬编码 | PASS：Origin/数据库/token pepper 由显式组合传入；仅 TEST fixtures 使用虚构数据 |
| 8 | 依赖声明完整 | PASS：复用既有声明，包 exports 与类型构建核对 |
| 9 | 实现可替换 | PASS：Application 注入 transaction manager/ports；PostgreSQL 与 HTTP 独立适配 |
| 10 | 变更后测试全过 | PASS：最终全仓 check、专项 tests、真实 PG/HTTP/TLS S3、媒体 worker 423 联合断言与浏览器均通过 |

## 剩余范围与接续入口

P3-01 继续 IN_PROGRESS；49 项任务保持 17 DONE / 1 IN_PROGRESS / 31 PENDING。下一步沿 `docs/plan/p3-01-content-runtime.md` 的“4A 后续必需工作”：完整 revision 验证、政策 owner 授权初始化、媒体签名上传/可信登记/版权/有审计重试，随后真实事务发布/回退、版本化公开扩展 DTO、manifest/head/别名投影、七语言 outbox 与精确 purge 完成状态、≤60 秒可见性。缺译不回退旧 description。

P3-02/03 须连同所需管理 API 实现，P3-04/05 再接真实目录与既定 UI，不提前解锁。当前仅本地真实数据库、TLS S3-compatible 与显式 TEST 身份组合；没有新正式登录、后台编辑页面、云 CDN、PSP、staging、远端 CI 或生产发布结论。

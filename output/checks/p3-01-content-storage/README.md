# P3-01 · 2B 内容存储与跨语言姓名搜索

本轮内容存储子检查点于 2026-09-06 本地验收通过，完整 pnpm check 最终 exit 0；P3-01 保持 IN_PROGRESS。最终状态与证据见 validation.json 及 phase 文件。

## 交付范围

- 0013 新增 10 张专属关系表：艺人别名集合、稳定别名及独立审核；礼物文档、固定类型块/条目、专属译文/块/条目及独立审核。
- 8 个内部 versioned roots；198 个旧定义深比较不变，公开 HTTP paths 不变。详情固定支持标题、段落、列表、规格及媒体，不接受任意 HTML/CSS/script。
- SERIALIZABLE 的独立草稿事务；创建时检查 ACTIVE actor 和 DRAFT parent，锁住父版本；服务端重算 hash、使用真实英语行、强制初始 DRAFT；完整结构及审计一起提交。
- 只有 header 在提交时检查完整内容，6 类 child 在同一父锁下按不可变数量限制插入；既有 payload 禁止 UPDATE/DELETE/TRUNCATE，防止提交后追加内容。
- 公开艺人搜索覆盖当前已发布的全部七语言姓名及 handle，先取每位艺人的最佳匹配再排序/分页；响应文案保持请求 locale，草稿名字及未审别名不会进入搜索。

## 本地验证

| 范围                   | 结果 / 证据                                                                                                                                                     |
| :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 受影响 7 包单元测试    | 658 tests；targeted-tests.log（locale 唯一权威窄修后的 content 102 tests 另见 content-tests-final.log）                                                         |
| 合同与纯规则           | contracts 212 / content 102 tests；../p3-01-content/；新 8 roots / 旧 198 不变，compatibility.json                                                              |
| 草稿真实 PostgreSQL    | 103 约束/并发/容量断言，../p3-01-content-drafts/postgres-capacity-final.log；repository 62 断言，postgres-repositories-final.log                                |
| 目录 PostgreSQL / HTTP | 120 位艺人 / 120 件礼物，307 PG / 264 HTTP 断言、43 请求；../p3-01-content/cross-language-postgres-final.log 与 cross-language-http-final.log                   |
| 迁移                   | 13 migrations / 122 tables，catalog-final.log；新扩展有历史时拒绝 down，无扩展旧库 up/down/up                                                                   |
| 最大详情载荷           | 32 块 × 24 条目 × 7 locale，共 5376 条译文 item；优化前总 19218 ms / COMMIT 17396 ms，优化后 2361 ms / 7 ms。本机单次量测，不是生产 SLA；后续全仓复验可能有波动 |
| 浏览器                 | P2-04 16 场景/18 PNG/10 axe，P2-05 8 场景/22 PNG/3 axe；两次最终 runner 与当前 gate exit0。无新真机证据                                                         |
| 独立复核               | directory_hydration / directory_api_audit 对 root repository/事务/0013 ACCEPT；优化后的 header/child 封闭性再次独立 ACCEPT                                      |

完整检查结果：typecheck 56/56（55 cached）、test 56/56（55 cached）、build 35/35（35 cached），31 包由 Node 实际 import；最终真实媒体联合验证 423 断言通过。最大详情最终全量复验 2280 ms / COMMIT 5 ms。

## 可重复命令

所有命令在仓库根目录运行，使用 `mise exec node@24.20.0 --` 前缀。

- `corepack pnpm --filter @fan-support/persistence-postgres test:postgres:content`：构建依赖，再运行真实约束及 repository 两套 PostgreSQL 验证。
- `corepack pnpm --filter @fan-support/persistence-postgres test:postgres:catalog` 与 `corepack pnpm --filter @fan-support/api test:postgres:catalog`：真实目录及 HTTP。
- `corepack pnpm check`：包含上述新内容验证、既有 PG/S3/媒体联合验证、format/lint/typecheck/tests/build。
- `corepack pnpm check:contracts`、`corepack pnpm security:secrets`、`git diff --check`。
- `node scripts/verify-ui-composites-browser.mjs`，完成后再 `node scripts/verify-ui-motion-browser.mjs`；运行期间冻结源码状态。

## 失败证据与修正

- 新模块/事务/artifact roots 的 RED：repository-red.log、transaction-red.log、artifact-red.log，以及 ../p3-01-content/{contracts-red,content-red}.log。
- 真实 SQL RED 与首次 PL/pgSQL CASE 字段绑定错误均保留在 ../p3-01-content-drafts/；修正 SQL 后重生成 migration manifest，未跳过 checksum 验证。
- contracts-check.log 记录测试重复声明七语言权威的问题；改为合同 SUPPORTED_LOCALES 与独立 fixture 记录后，contracts-check-final.log 通过。
- browser-motion.log 记录首次运行期间源码状态变化，证据拒收；browser-motion-final.log 为冻结后实际重跑。
- check-attempt1.log 中真实 PG/S3/媒体联合门均通过，最后被临时容量诊断脚本缺少显式 URL import 的 lint 阻断；修正后全量重跑，最终见 check.log。
- check-attempt2.log 记录既有媒体工作进程数据库恢复阶段的一次间歇性失败；单独复验 media-recovery-diagnostic.log 的 423 断言通过，暂未复现可归因源码缺陷。测试新增细分阶段与受限诊断字段，未改生产行为、重试预算或断言；最终全量结果见 check.log。
- 最大容量原版本超过 5 秒的 RED 在 ../p3-01-content-drafts/maximum-draft-red.log。通过消除重复完整性扫描修复，未放宽数量、外键、审核或发布约束。

## 当前边界与下一入口

本轮仅可信内部 persistence，不提供管理 HTTP 或完整 session/RBAC/CSRF。ACTIVE actor + audit 不能当作完整鉴权；也没有把稳定 ID 重复拒绝宣称为完整幂等结果重放。

新建文档必须有真实英语，可包含 1 至 7 个 locale，审核均为 DRAFT。别名不是七语言必译正文，有独立整集批准证据；新别名尚不接公开投影。含任一新扩展的 revision 暂时拒绝 VALIDATED、PUBLISHED 及 publication PUBLISH/ROLLBACK，直到后续审核/manifest/media/outbox 链路实现。旧无扩展 v1 路径保持。

下一入口是 docs/plan/p3-01-content-runtime.md 检查点 3：平台授权与 CSRF、内容复制/提交/独立审核、只读短时预览，然后检查点 4 的发布/回退/七语言 purge。详情审核必须同时检查文档结构作者，缺译不得静默退回旧 description。

实现输入见 implementation-source.json（32 文件）；本轮是未提交本地工作区，无新远端 CI、云部署、PSP 或生产发布证据。

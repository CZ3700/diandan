# P3-06 sitemap / SEO purge 路径扩展

作者 `/root/storefront_directory`。独占 7 文件，精确源码见 `seo-purge-source-snapshot.json`；本记录只覆盖路径生成、迁移定义和单元/静态检查，不代表 P3-06、真实 CDN 或生产发布已完成。

## 行为与迁移边界

`publicationPurgePaths` 在每一类内容/每个 locale 的原路径集合上增加 `/sitemap.xml*`、`/:locale/sitemap.xml*`、`/api/v1/storefront-seo/*`，继续保留原 `/:locale/sitemap.xml`。全语言发布本就创建七个 locale job，新增 API wildcard 覆盖互返语言 cluster；没有新增任意路径参数、前台数据或缓存业务真相。

原 0018 迁移不变。0021 仅 `CREATE OR REPLACE FUNCTION public.guard_content_purge_job()`：

- up 为滚动部署同时接受旧集合和扩展集合，均为**整个有序数组精确相等**；扩展集合显式 `COLLATE "C"` 排序，与 TypeScript 的 ASCII 路径排序一致。子集、超集、任意 wildcard 或乱序数组均不能通过精确比较。
- retry 还必须锁定 FAILED parent，匹配 publication/outbox/locale/generation/time，且 `NEW.paths IS NOT DISTINCT FROM parent.paths`；既有旧任务不会在重试时被静默升级，新任务也不能缩成旧路径。
- down 只恢复旧集合的 generation 1 新建，但保留当前数据库中已存在扩展任务的正常状态流转与精确 predecessor retry。应先回退/排空新 application writer，再执行 down；新 writer 在 down 后尝试扩展 root 会被拒绝。
- publication/event 证明、初始状态、不可变身份、版本、租约、绝对 deadline、失败上限、provider reference、完成证据等其余 guard 条件逐字保留。未删除历史 job、receipt 或 outbox。
- retry TypeScript 实现未修改；两项 characterization 直接执行其现有函数，确认 INSERT 参数复用旧/新 parent 的原始 paths。

root 冻结的新 SEO API / sitemap 策略为 `public,max-age=0,s-maxage=0,must-revalidate`，每次复核回源；HTML 使用 Next 原生 private，旧 API 仍 no-store。当前没有给尚未接入 purge 的 identity/rights 修改宣称 TTL 缓存安全，也没有把媒体已公开字节缓存当作可即时撤回。本子任务没有修改这些读取端策略。

## 检查记录

所有 pnpm 命令通过 `mise exec node@24.20.0 -- corepack pnpm`。

- `seo-purge-red.log`：新 35 个五内容类型 × 七语言路径用例在旧实现全部失败，缺失恰为三类新增路径。
- `seo-purge-migration-red.log`：同 35 个 RED，加上 0021 尚不存在导致四个迁移定义检查失败；缺文件不冒充数据库行为验证。
- `seo-purge-tests-first.log`：初步 93 tests 通过。
- `seo-purge-retry-characterization.log`：旧/新 predecessor 精确继承两项通过。
- `seo-purge-tests-final.log`：95 tests 通过，但当时 lint 的 unused 参数/regex 空格和 formatter 问题未通过；原失败日志保留。
- 最终 `seo-purge-tests-verified.log`：6 文件 / 95 tests 全通过，包括 35 路径、4 SQL guard 不变性、2 retry characterization 和原有 repository/manifest 回归。
- `seo-purge-lint-verified.log`、`seo-purge-format-verified.log`、`seo-purge-typecheck-verified.log`：最终 ESLint、scoped Prettier、persistence-postgres typecheck 退出 0。
- manifest 使用现有 `node packages/persistence-postgres/scripts/migration-manifest.mjs` 生成，再以 `--check` 验证；`seo-purge-manifest-check.log` 退出 0。旧条目/hash未变，只追加 0021 up/down。
- `seo-purge-diff-check.log` 退出 0。

没有启动完整 PG harness 或 Next/build。root 正使用真实 migrations:catalog 工作流检查 up/down 并刷新 expected-catalog 中该函数定义；这里没有手工伪造数据库快照。实际旧/新 root 接受/拒绝、FAILED parent retry、乱序/加路径拒绝、down 后新任务精确 retry 应由真实 PostgreSQL 联合集成验收。

发现且已通知 root：既有 `postgres-publication-runtime.mjs` 和 `postgres-admin-catalog.mjs` 对当前 head 0020 的固定假设需要在 0021 后先真实退 0021，再保留原 0020/0019/0018 降级保护断言；本子任务未更改这些 harness 或削弱断言。

## S.U.P.E.R 十项（独占子任务）

| 项 | 结论与依据 |
|---|---|
| 1 单一模块职责 | PASS：路径函数仅生成 purge paths；迁移只替换同一 guard；测试只验证对应边界。 |
| 2 单一函数概念 | PASS：未扩大 writePublicationRuntime 职责；新 SQL 仍仅验证 purge job 生命周期。 |
| 3 单向数据依赖 | PASS：既有 contracts → adapter 消费关系不变，没有前台/应用反向导入。 |
| 4 无依赖环 | PASS：只改既有函数数组，无新增实现 import；测试不进入运行依赖。 |
| 5 标准边界合同 | PASS：输入仍 PublicationPreflightTarget / SupportedLocale；fixtures 通过真实 schema.parse。 |
| 6 可序列化 I/O | PASS：输出仍 string[]；数据库原 text[] / schemaVersion job 合同不变。 |
| 7 环境无关 | PASS：新增的是冻结的应用路由协议模式，未写死域名、生产 locale、商户/艺人 ID 或环境配置；动态 locale 从合同输入派生。 |
| 8 显式依赖 | PASS：无新增第三方或服务依赖；现有 migration generator 与测试工具。 |
| 9 可替换边界 | PASS：路径生成/数据库约束仍在 PG adapter 边界；down 明确保留现存任务历史。 |
| 10 验证 | 本有界单元/静态要求 PASS（95 tests、format/lint/typecheck/manifest）；真实 PG/catalog/整仓及 CDN 为 root 联合验收，未在这里宣称通过。 |

## 后续真实集成验收（root 追加授权后）

前述“尚不跑 PG”是初步冻结时的边界，以下追加事实不覆盖原 RED 或静态阶段记录。root 随后授权独占调整三个必要历史 harness，直接使用 root 已构建的 dist；本代理未重新 build 或启动 Next。

- `seo-purge-runtime-pg-red.log`：旧 harness 在真实数据库 437 条断言后，确切因当前 head `0021 != 0020` 失败。
- `seo-purge-admin-pg-red.log`：旧管理 harness 在 252 条断言后，当前 head 固定假设失败。
- `postgres-publication-runtime.mjs`：先确认当前 head 0021，通过正常 worker repository claim → nonretryable provider failure 创建真实 FAILED expanded job；真实 down 0021 并比较所有 job 的 JSON 值逐项完全相等；三种 narrowed/broadened/reordered paths 以各自预期的精确 23514 guard 消息被拒绝；当前授权 Application/Repository retry 真实提交，子任务 paths / retry_of / generation 与 predecessor 精确一致。之后继续原 0020 → 0019 → 0018 顺序及 0018 实际 55000 历史保护，没有跳过或关闭 trigger。
- `seo-purge-runtime-pg-green.log`：完整发布 runtime 实际 PostgreSQL 最终 459 assertions PASS。
- `postgres-admin-catalog.mjs`：先实际 down 0021，确认所有管理、翻译、发布与礼物状态历史除 migration head 外完全相等，再执行原 0020 分类历史拒绝回滚断言。
- `seo-purge-admin-pg-green.log`：实际 PostgreSQL 260 assertions PASS。
- `publication-runtime-http.mjs`：原 locale namespace 断言仅额外允许两个精确 global 路径，且强制包含旧 locale sitemap、新 locale sitemap wildcard、global sitemap wildcard 与 SEO API wildcard；其他路径仍必须属于该 job locale。
- `seo-purge-runtime-http-green.log`：真实本地 API + PostgreSQL + TLS S3 + HTTP purge，11,374 assertions / 1,455 HTTP requests PASS。该 HTTP 用例未额外制造一次独立路径 RED；之前的路径函数 35 项 RED 已保留，不能将这次绿色 HTTP 伪称为该 HTTP 用例的红绿对照。
- 三文件 Prettier、ESLint 和 diff check 通过，日志 `seo-purge-harness-format-check.log` / `seo-purge-harness-lint.log` / `seo-purge-harness-diff-check.log`，源码另存 `seo-purge-harness-source-snapshot.json`。
- 非作者 `/root/storefront_read` 已复审七文件实现与三个 harness，接受其路径范围和历史保护；独立复审记录 `seo-purge-independent-review.md`，真实重型命令由作者执行，复审者明确引用来源。

S.U.P.E.R 第 10 项在本扩展授权范围已补齐上述真实集成验证；整仓/前台性能/生产 CDN/staging 与 P3-06 总验收仍由 root 负责。这些结果不证明尚未接入 publish outbox 的独立 rights/status 修改已触发 CDN purge；强制回源策略仍是本轮该边界的保证。

# 0021 migration harness head adaptation

2026-09-07，storefront_directory。结论：三个旧 PostgreSQL harness 已按当前 0021 迁移头最小适配；真实定向 PostgreSQL 验证全部通过。没有修改数据库迁移、执行器、业务源码或保护门。

## 失败先行与改动

- 目录脚本的 RED 来自 `check-attempt-2.log` 和 `check-attempt-2-result.json`：全量 up 已到 0021，旧脚本直接确认 down 0020，被执行器以 `down migration confirmation must match the applied head` 正确拒绝。保留原始全仓失败，不宣称该次全仓通过。
- `postgres-catalog-directory.mjs` 现在先 down 0021，并严格断言 `revertedVersions=["0021"]`、`currentVersion="0020"`；随后完整保留原 0020 至 0010 回退序列及重新 up、投影需重建、不可变翻译字节一致等断言。重新 up 后精确要求 21 个版本且 head 0021。
- 全仓脚本扫描另发现 `postgres-content-draft-repositories.mjs` 与 `postgres-publication-validation-time-cases.mjs` 在全量 up 后仍断言 head 0020。两者真实运行先失败，再仅将当前 head 期望改为 0021。历史 seed 所用 0017 及其既有严格断言不变。
- 发布时间入口把原断言错误包裹为通用 ephemeral 错误，因此另用临时 Node 包装 `assert.deepEqual`，仅对固定 schema-head 断言输出 actual/expected，然后调用原断言。诊断记录真实 `0021` 对 `0020` 后退出 1；没有替换查询、返回值或放宽断言，也没有保存凭证。

## 实际命令与结果

以下命令均从仓库根目录使用 `mise exec node@24.20.0 -- node` 执行现有 dist，未重建依赖或启动 Next。

| 实际入口（`packages/persistence-postgres/scripts/`） | 结果                                                                                      | 本目录证据                                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `postgres-catalog-directory.mjs`                     | exit 0；308 assertions，120 艺人、120 礼物、七语言，normal triggers                       | `seo-migration-directory-head-green.log`                                                                                |
| `postgres-content-draft-repositories.mjs`            | RED exit 1 → GREEN exit 0；64 assertions、七语言                                          | `seo-migration-draft-head-red.log`、`seo-migration-draft-head-green.log`                                                |
| `postgres-publication-event-time.mjs`                | RED exit 1 → GREEN exit 0；30 assertions，event/preflight/retry 与实际 expiry guards 保留 | `seo-migration-event-head-red.log`、`seo-migration-event-head-red-diagnostic.log`、`seo-migration-event-head-green.log` |

三个改动文件的 scoped Prettier、ESLint、`git diff --check` 均 exit 0；格式与 lint 日志为 `seo-migration-head-format.log`、`seo-migration-head-lint.log`。

## 扫描与边界

检查 `packages/persistence-postgres/scripts`、`apps/api/scripts`、`scripts` 下 `.mjs/.ts` 的所有 `0020` 引用：剩余 admin catalog 与 publication runtime 的 0020 down 均已有严格 0021 先回退；历史 price-sealing 的 0020 注释描述既定旧 schema，不应改成当前版本。未发现其他从全量 up 直接确认 down 0020，或以 0020 断言当前 head 的遗漏。

本次 3 项定向 PG 通过不能替代剩余全仓检查、前台性能或真实设备验收。三个脚本源码冻结，Git 与完整检查继续由 root 管理。

非作者 storefront_read 已只读复审三份 diff 并给出 ACCEPT：严格 0021 回退及原 0020 至 0010 顺序、历史 0017 seed、不可变数据与真实时钟因果回归谓词均保留。该复审没有重复执行 PostgreSQL，以上运行数据由 storefront_directory 实际执行。

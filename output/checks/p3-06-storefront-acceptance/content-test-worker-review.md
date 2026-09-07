# Content test worker limit review

2026-09-07，storefront_directory 非作者只读复审：**ACCEPT，范围为测试并行资源限制**。实际命令均由 root 执行；本复核没有另跑 CPU 密集测试、构建、PostgreSQL 或 Next。

`packages/content/package.json` 的唯一改动是在既有 test 命令末尾增加 `--maxWorkers=2`，与 contracts 包既有模式相同。build、typecheck、依赖和导出不变。相对 `implementation-source-before-final-browser.json`，`published-content.ts`、`storefront-seo.ts`、`storefront-seo-proof-reuse.test.ts` 和 `vitest.config.ts` 的 SHA 全部一致；没有删除测试、改变断言或放宽默认 5000ms 超时。

## 保留的实际失败与复测

| 运行条件                                                   | 证据                                                                           | 实际结果                                                                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原全仓 test 默认并行                                       | `preflight-test-final.log`                                                     | content 的七语完整视图等价测试超时 5000ms；346/347 tests，44/56 Turbo tasks 成功，整体失败。                                                                                                  |
| content 已限制两个 worker，全仓 `--force` 仍使用默认包并发 | `cold-workspace-tests-final.log`                                               | 既有 observability 的 `round-trips an exact serializable queue carrier without baggage` 超时 5000ms；40/41 tests，18/37 Turbo tasks 成功，整体失败。不能把未完成的 content 执行算作本次通过。 |
| 全部强制重跑，content 两个 worker，Turbo 包并发也限制为二  | `cold-workspace-tests-bounded.log`、`cold-workspace-tests-bounded-result.json` | exit 0；58/58 Turbo tasks 成功，0 cached。实际命令起止为 11:50:11.554134 至 11:52:47.547382 UTC，Turbo 报告 2m35.232s。                                                                       |

最终命令：

`mise exec node@24.20.0 -- corepack pnpm exec turbo run test --force --concurrency=2 --output-logs=errors-only`

`--maxWorkers=2` 限制 content 包内 Vitest worker 数；`--concurrency=2` 限制本次 Turbo 包任务并发，二者不是同一层。`--force` 的最终记录为 0 cached，因此这次成功来自重新执行；58 是 Turbo 任务数，不能称作 58 个测试用例或测试套件。

原失败都是实际超时，不是被修复或忽略的数据断言。孤立 content 验证曾通过，默认全仓冷并发在不同包出现超时，而限制资源并发后通过，这些观察与资源争用解释一致；没有独立 CPU trace，不能把具体超时唯一归因于某个进程或宣称永久消除波动。

本结论只证明**上述有界并发条件下的全仓冷测试通过**。不宣称默认冷并发已全部通过，也不替代单次完整 `pnpm check`、真实浏览器性能、发布可见性或生产验收。两次原失败日志保留。本文与源码冻结，后续调度由 root 负责。

# SEO publication proof reuse

2026-09-07，storefront_directory 实施；root 与 storefront_read 非作者复核 ACCEPT。范围仅 `packages/content/src/published-content.ts`、`storefront-seo.ts` 和新 `storefront-seo-proof-reuse.test.ts`。

## 问题与实现

原 SEO 投影对同一个已加载 context 调用七次 `projectPublishedContent`，每次重复 context 解析、当前 publication 核对、manifest SHA 以及完整 manifest／审核／媒体证明校验。真实调用计数 RED 记录 7 次，目标为 1 次，见 `seo-projection-proof-reuse-red.log`（2 FAIL、1 PASS）。

现在两个入口共享私有 `verifiedContext` 与私有 `projectVerifiedContext`。单语言入口仍执行原完整验证与投影；新 `projectPublishedContentLocales` 自行解析和验证输入，只接受默认源语言 context，然后对固定七语言分别创建新的媒体 resolver、执行原 project、complete 和 response schema 校验。SEO 仍检查所有语言的 publication、翻译版本和无 fallback，一项失败即拒绝整个实体。

没有可从外部传入的 trusted 标志、token 或跳过验证选项；没有跨调用缓存。既有 `content/index.ts` 的星号导出使新安全函数成为兼容新增导出，root 已明确接受。既有函数与合同 schema 保持，未修改 index、contracts、package、PostgreSQL、锁、事务隔离、查询窗口或缓存 TTL。

## 验证

- 新测试实际 spy 原 manifest 验证与 hash 函数，各调用 1 次；原媒体 resolver 仍按七语言顺序调用 7 次。
- 五种内容类型的七语言完整输出逐项等于原单语言入口；艺人／礼物包括扩展内容，输入序列化不变。任一语言缺正文或媒体译文、错误媒体 URL、权益撤销、错误当前 head／manifest hash、非源语言输入均拒绝。正常调用后变更输入再调用也重新验证。
- `seo-projection-proof-reuse-green.log`：38 tests、5 files PASS；最终整个 content 包 `seo-projection-content-tests.log`：347 tests、23 files PASS。
- scoped Prettier、ESLint、typecheck 和 `git diff --check` 均通过。首次 typecheck 仅测试 fixture 联合数组赋值错误，原失败日志 `seo-projection-typecheck.log` 保留；修为精确删除当前语言项后 `seo-projection-typecheck-green.log` PASS。
- storefront_read 独立 40 tests、6 files PASS，见 `seo-projection-independent-review.md` 与 `seo-projection-independent-tests-green.log`。其静态核对确认原 currentPublication、details、project 及 resolver→project→complete→responseSchema 内容保留。

## 固定样例纯投影观察

使用本目录 `seo-projection-benchmark.config.mjs` 和 `seo-projection-benchmark.test.ts`，从源码执行。每种类型固定一个 fixture、5 次预热、20 次独立投影计时；fixture 创建和断言在计时外。前后 Node v24.20.0、darwin arm64、七语言及各 fixture SHA 完全相同，记录全部样本，不设时间通过阈值。本机同时有其他任务，结果仅是共享开发机纯计算观察，没有 PostgreSQL、HTTP、浏览器或 CDN。

| 类型     | 修改前中位数 ms | 修改后中位数 ms | 修改前 P95 ms | 修改后 P95 ms |
| -------- | --------------: | --------------: | ------------: | ------------: |
| HOMEPAGE |          40.305 |           6.537 |        44.149 |         7.440 |
| IDOL     |          45.817 |           7.605 |        49.309 |         8.510 |
| GIFT     |          26.823 |           4.256 |        27.901 |         5.211 |
| POLICY   |          12.807 |           1.970 |        13.670 |         2.554 |

原始完整样本见 `seo-projection-benchmark-before.json`、`seo-projection-benchmark-after.json`，对应实际运行日志为 `seo-projection-benchmark-before-recorded.log`、`seo-projection-benchmark-after.log`。最初 before 日志仅保留测试结果，因 console 未输出样本而在改源码前重跑一次并直接保存 JSON；没有用修改后的代码冒充 baseline。

root 复核发现原统计取偶数样本的上中位点。已修正 benchmark 算法，按原 20 个样本中间两项均值重算 median；P95 保持 nearest-rank。没有重跑或修改原始样本，原字节保留在 `seo-projection-benchmark-{before,after}-original-statistics.raw.log`，纠正记录及奇偶示例校验见 `seo-projection-benchmark-statistics-correction.log`。上述表格使用纠正后的数值。

## 尚待真实验证

此次修改不能把先前 PUBLISH 可见性 84,923ms 的 FAIL 改写成 PASS，也不能据此宣称已达到 60s。需要 root/E2E 用新编译代码重新测实际 API、Chrome HTML、XML 及 rollback。

只读审计还确认 INDEX 的 20 实体串行加载中，共享媒体仍会重复读取 processing jobs/assets/variants/outputs、metadata snapshot／七语审核、复制源证明和媒体 publication 证明；`loadPreflightCopies` 的 sourceCache 目前仅覆盖一个 snapshot 内部。这是后备优化方向，当前没有实施。若后续需要，应仅在同一个 SERIALIZABLE transaction 内复用首次实际 SHARE 锁定的精确 owner／revision／media 证明，保持每次请求重新校验，不能缓存 evaluatedAt、价格时窗或跨请求 proof。

本子任务源码冻结。API／依赖重建、真实协议与完整项目检查由 root 调度。

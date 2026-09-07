# P3-05 最终测试维护非作者复核

审查者 `/root/storefront_read`。**ACCEPT：本次改动没有削弱原合同、路径或字节确定性断言。** 本次只读检查源码、差异及已存在的失败证据，未运行 Next、浏览器或重型测试；修复后的实际测试结果由 root 的最终执行证据确认。

## 真实失败与精确修复范围

`core-tail.log` 保留两项真实失败：

- deterministic 测试在测试内等待动态导入阶段触发默认 5000 ms 超时，报告耗时 7458 ms；本审查不把资源争用当作已证明原因。
- 精确路径列表实际 55 条、测试仍期望 53 条，差异恰为本任务新增的 `/api/v1/storefront-context` 与 `/api/v1/storefront-gifts/{handle}`。

`packages/contracts/src/artifact-documents.test.ts` 只做两类调整：把 renderer 和 registry 的 namespace imports 移至文件作用域，删除首测试内对应的动态 import Promise.all；在原严格期望数组中添加上述两条路径。

## 未削弱约束的证据

1. 以 Git 基准文件提取首个测试的完整正文，仅移除原动态 import 块后，与当前正文逐字一致。首测试仍有同样 31 处 `expect(`；没有删除循环断言、放宽 matcher、捕获后忽略错误或新增 skip。
2. `firstRender`、`secondRender` 仍分别调用 `renderContractArtifactDocuments()`。只读检查 renderer：每次 render 都独立调用 `createContractArtifactDocuments()`，重新从 registry 创建 definitions/components 并序列化；没有复用第一次结果、添加缓存或把两次调用变成一次。
3. 两次渲染结果 `toEqual`、两个末尾换行断言均保留。后续 committed-artifact 测试仍读真实生成文件，并分别用 `toBe(rendered.jsonSchema/openapi)` 做完整字节比较。
4. `vitest.config.ts` 未增加 timeout；首测试也没有第三参数预算或其他 timeout override。模块加载成为测试文件初始化，导入失败会在文件加载阶段失败；实际 create/render/全部断言仍在测试体内。此处接受的是初始化边界调整，不宣称已经测得或保证任何运行环境都低于五秒。
5. 路径过滤条件完全不变，仍对排序后的完整列表使用严格 `toEqual`；仅将 53 条期望补齐为 55 条，没有改成子集、数量下限或忽略新 route。旧 webhook security/body/raw-byte/headers/failure-code 等后续断言逐字保留。
6. 当前测试维护未修改合同 renderer、注册表、schema 或生成产物。与 `implementation-source-before-final-format.json` 中对应前台产品源码及非测试 contracts 文件的只读哈希比对没有发现变更。原 373 个历史根深比较门没有更改；本审查不以路径断言替代该兼容性门。

## 浏览器 harness 格式调整

`browser-format-diff.txt` 只有一个 prettier hunk，折叠 `page.getByRole("dialog").evaluate(...)` 的换行。独立逆向应用该 hunk 到当前文件，重建出的原始完整文件 SHA 与 `implementation-source-before-final-format.json` 的原 harness hash 匹配；移除空白后的完整内容也一致。该 diff 没有变动 focus oracle、sentinel 条件、循环次数、断言或等待行为。

这项结论只涵盖最后格式调整；更早的 focus-oracle 行为修复需要使用其自身已有 review/E2E 证据，不能被称作格式调整。

## 验收范围

保留 `core-tail.log` 的 RED。本 ACCEPT 不自行宣告 core tail 已 GREEN，不改用旧整体 source hash 代表新测试文件。root 应在最终记录中使用更新后的 source manifest，并关联本次只读审查与随后真实测试结果。

## 后续反证与 contracts 包并发上限复核

以上为导入及路径列表维护时的初次结论。随后 `core-tail-final.log` 记录了新的真实反证：路径列表测试已经通过，但 deterministic 测试仍为 7340 ms 并触发原 5000 ms 超时；52 个文件中 51 个通过、319 个测试中 318 个通过。因此，移出动态导入不足以解决该次全仓并行执行下的超时，不能把前述初始化边界调整描述为已修好超时。

root 随后仅将 `packages/contracts/package.json` 的 test 命令改为 `vitest run --config ../../vitest.config.ts --root . --maxWorkers=2`。本审查独立读取了当前安装的 Vitest 4.1.11 源码和类型：

- `dist/chunks/cac.uFydS1Z4.js:927` 明确注册 `maxWorkers` CLI 参数；`reporters.d.DtoKVV2s.d.ts:2848` 定义其为 worker 数量或百分比上限。
- `dist/chunks/coverage.DM_a_rWm.js:222` 解析该值；`cli-api.CnMVyzaz.js:3832` 的 `resolveMaxWorkers` 优先读取配置，否则普通 run 使用 `max(availableParallelism - 1, 1)`。本次只读命令测得当前 Node 的 `availableParallelism()` 为 10，默认计算为 9。
- `cli-api.CnMVyzaz.js:3475` 与 `3494` 将该值用于 pool 调度上限；超过上限的任务留在队列中，没有删除测试或跳过文件。此次修改没有更改 pool、isolation、fileParallelism、单个测试内的 concurrency 或测试选择规则。
- `coverage.DM_a_rWm.js:538` 保持 Node 测试的默认 5000 ms；仓库根 `vitest.config.ts` 和这次测试维护都没有新增 timeout override。上文两次独立生成、完整字节比较及全部断言仍然成立。

此处只限制 contracts 包这一层的并行 worker 数，未降低其他包或 Turbo 的并行度，也未修改共享 Vitest 配置。其作用范围与已暴露问题的包相符。单包默认可使用 9 个 worker 与外层多包并行会叠加这一调度事实，为该限制提供理由；本审查没有 CPU/内存/调度跟踪数据，因此不把资源争用写成此前所有超时的完整、唯一归因。

## 最终新鲜验证与源文件绑定

独立读取 root 执行的 `tests-concurrency-controlled.log`：完整 `turbo run test --force` 为 **58/58 tasks 成功、0 cached、36.735 秒**。同时读取对应 `packages/contracts/.turbo/turbo-test.log`：实际命令包含 `--maxWorkers=2`，Vitest 4.1.11，**52/52 files、319/319 tests 通过**；deterministic 测试 **693 ms**，该文件六个测试 **1584 ms**，contracts 包总时长 **13.81 秒**。这些是 root 执行、审查者独立读证的结果，不是审查者重新运行的测试。

`core-final-build.log` 还记录 prettier 通过、typecheck 58/58 tasks 成功、build 35/35 tasks 成功、adapter boundary 通过以及 31 个包导出由 Node 导入通过；保留其各自的缓存计数，不把这些阶段称为全部冷缓存。此复核没有额外启动测试、Next 或浏览器。

对 `implementation-source-before-worker-bound.json` 与 `implementation-source-final.json` 做独立完整清单比较，1428 项中的唯一变更为 `packages/contracts/package.json`。随后重新计算最终清单内全部 1428 个文件的 SHA256，均与当前磁盘文件一致：

- 并发上限前：`f60f20ff063beb8c4d1bb80e071ca424fe2978a32475c471f2a2a9eea5f5a9af`。
- 最终：`689ca8596cac257223c7b3f0445314aebd5c00a34ed48d7bfdad22a05e1a8122`。

**最终 ACCEPT：该测试维护与 contracts 包 worker 上限没有削弱合同、完整路径、确定性、生成物字节或五秒预算约束，且本次最终源码的全仓冷缓存测试已有实际通过证据。** 保留前两轮 RED；不承诺所有机器、负载或未来改动下永久没有时间波动。产品页面、真实 PostgreSQL/API/S3 和最终浏览器矩阵仍各自由本阶段对应证据验收，本结论不替代它们或代表生产发布。

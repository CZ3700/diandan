# P3-06 候选源码与开发检查独立核验

结论：**候选范围 ACCEPT**。候选确为 3 个既有 TEST 工具/脚本入口修改 + 3 个新增 TEST 工具/测试；未发现其它产品、合同或 SQL 变化。此结论不代表当前实际 fixture、完整 pnpm check 或 P3-06 性能验收完成。

核验时间：2026-09-16T09:57:48.776954+00:00。本人只读取清单、计算文件 SHA、读取 Git 对象和现有日志；未运行 build、Chrome、PG 或测试，未改源码。本报告是本次唯一写入文件。

## 源码清单与来源

| 核验项 | 实际结果 |
| --- | --- |
| baseline files | 2203 |
| baseline aggregate SHA256 | `78f4b75ccb4d5e0a9fb30057fa81587aece51562f8023a5f36d1f87bfbc206ab` |
| candidate files | 2206 |
| candidate aggregate SHA256 | `88601233cbe1fe16abfb5c8776627e5a7dd3a3f23289f21febe0f765494d4b1d` |
| 既有文件变化 | 3 |
| 新增 | 3 |
| 删除 | 0 |
| 原文件逐字节不变 | 2200 |
| candidate 对当前磁盘 SHA 不一致 | 0 / 2206 |
| baseline 对当前 HEAD Git对象不一致 | 0 / 2203 |

两份 manifest 均按自身声明的 `sha256(compact UTF-8 JSON files array, ensure_ascii=false)` 独立复算，均与记录相等；14 个 scopes 完全相同。candidate capturedAt 为 `2026-09-16T09:52:08.382236+00:00`，baseCommit 为 `995d1c5b8ca2285f2064820c772a0fb6345cab80`。

**来源细节：** baseline-source.json 沿用上轮快照，元数据 baseCommit 仍是 `7d1a5391a70c655da2d0a654d47c79c11e37b04d`、capturedAt 为 `2026-09-16T09:08:37.072807+00:00`。没有改写这份历史记录。为避免误把旧元数据当本轮 HEAD，本人另用 `git cat-file --batch` 实际读取当前 HEAD 的全部2203对应对象并逐一 SHA核对，全部匹配；因此本轮比较的字节基线确与当前 HEAD995d1c5一致，而不是仅相信元数据。

## 精确差分

既有修改：

- `apps/api/package.json`：既有 `test:postgres:storefront-acceptance` 在原 acceptance/operations测试后追加两个新 Node test入口；原 build依赖、实际PG入口及其它scripts保持。
- `apps/api/scripts/gift-storefront-next.mjs`：TEST网关响应移除逐跳头；新增默认关闭的 `readDiagnostics`，只给 owned TEST start进程配置诊断 import，原build环境不注入。
- `apps/api/scripts/storefront-acceptance-runtime.mjs`：调用 Next harness 时新增 `readDiagnostics: Boolean(diagnostics)`。

新增：

- `apps/api/scripts/gift-storefront-gateway.test.mjs`
- `apps/api/scripts/storefront-test-fetch-diagnostics.mjs`
- `apps/api/scripts/storefront-test-fetch-diagnostics.test.mjs`

所有变动均在 `apps/api` 的 TEST脚本或其执行入口；`apps/*/src`、Storefront产品组件/SSR/proxy、packages业务实现、公开contracts、依赖lockfile、database/schema/migrations SQL均与baseline一致。此“不变”以两份受控source manifest的范围及逐文件SHA为依据，**不包括本轮新增docs/output证据文件**；输出目录变化也不是产品源码漂移。

源码质量与定向行为复核详见本轮 `gateway-independent-review.md`、`fetch-diagnostics-independent-review.md`；PG二次分类只读发现保留在 `read-chain-review.md`，此次未修生产代码。

## 现有检查的实际范围

### 54 个定向 Node tests

已读取 `targeted-tests-result.json` 的准确命令及 `targeted-tests.log` 末尾。命令显式列出7个acceptance、4个operations、1个gateway及1个fetch-diagnostics测试文件。结果 exit0，**54/54 PASS，0 fail/skip/cancel**；进程wall time **0.475秒**，Node duration **439.452167ms**。这是 root实际执行结果，本人本子任务没有重复运行。

其中包括真实本地HTTP/原生fetch子进程的小型测试；不能把名字含acceptance／operations的Node测试解读为已运行完整PG/S3/Chrome/人工操作验收。

### check:dev

`check-dev-result.json` 实际命令为 `mise exec node@24.20.0 -- corepack pnpm check:dev`；09:54:59.417890–09:55:29.539113 UTC，**30.121秒，exit0**。

`check-dev.log` 明确为 **all workspaces / consumers all-workspaces**，不是精确包筛选模式。工作区、依赖边界、格式、lint都执行，验证4apps/32packages/36units、无循环；格式与lint通过。Turbo远程缓存关闭，但本地缓存被正常复用：

| 阶段 | 成功/总任务 | 缓存任务 | 日志耗时 |
| --- | --- | --- | --- |
| typecheck | 62/62 | 61 | 2.238s |
| test | 62/62 | 61 | 9.783s |
| build | 36/36 | 35 | 3.182s |

36package scope含依赖任务，因此typecheck/test总数62不等于62包，也不代表每个任务都重新执行。日志只给聚合缓存计数，不能由此断言具体某个包本次全新运行。开头和末尾都明确：这是development检查，**没有运行PG/S3/browser/formal acceptance**，不能替代原 `pnpm check` 和任务验收。

## 仍未证明的事项

- root正在执行候选真实fixture，其结果尚不在本次审查输入中；本报告不提前宣布成功。
- 旧gateway基线的63次内容正常只描述基线观察，不能充作这次header修复证明。原两次间歇错误依旧未完成根因归属。
- 新诊断真实HTTP测试证明可捕获主动断连/abort；是否在compiled Next真实链路输出、长龄/UI历史后是否未TRUNCATED，需要root实际核对。
- 全仓check、正式性能预算、真人/真机门仍按原任务记录执行；P3-06与阶段计数不因此改变。

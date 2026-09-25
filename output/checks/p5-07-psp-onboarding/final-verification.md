# P5-07 最终验收

2026-09-22；基线 `e818577617078fc70436d87a5e70f183d8aecd7c`，分支 `codex/p5-07-psp-onboarding`。本 Task 的原范围为新增 PSP 接入手册、商户资格门及 fake conformance/灰度演练；不要求实际增加多余渠道。最终总入口全部四步 exit 0，真实本地演练和独立规格、代码质量审查通过；最终保护与秘密扫描结果另见 `final-gates.json`。

## 实现及复跑

新增五个测试工具源码和一个根命令，未修改生产应用、UI、合同或历史迁移。接入说明及逐级证据模板位于 `docs/runbooks/psp-onboarding.md`、`psp-onboarding-evidence-template.md`；操作顺序覆盖代码部署、共同认证、商业 sandbox、批准的小额支付/退款、逐级灰度、停止和回退。商户资格、独立验签、UNKNOWN 原账户恢复、USDT 专属实现及正式七语文案均有明确验收边界。

在仓库根目录运行：

```sh
mise exec node@24.20.0 -- corepack pnpm verify:psp-onboarding --plan
PSP_ONBOARDING_TEST_POSTGRES_BIN='/Users/mario/Desktop/下单/output/checks/p5-03-refund-operations/native-runtime/dist/postgresql@18/18.6/bin' mise exec node@24.20.0 -- corepack pnpm verify:psp-onboarding --output output/checks/p5-07-psp-onboarding/drill-final
```

上列是本机实际命令；`drill-final` 已存在，再执行须选择新的输出目录，禁止覆盖原证据。其他机器可不设 native bin，复用临时 Docker PG。入口不接收现有业务数据库或 LIVE 选择器，按 build→完整 fake conformance→fake/gateway 单测→真实 HTTP 分级演练顺序执行；任何失败保留退出码并停止后续，只有四项全部成功才 PASS。

## 最终权威演练

`drill-final/result.json` 从 `2026-09-22T10:05:51.989Z` 至 `10:07:21.282Z` 四步成功。关联真实环境为 `integration-2026-09-22T10-05-55.604Z/`：PostgreSQL 18.6、TLS S3、本地 OIDC、独立持久 TEST PSP、两独立 API 进程。`run-result.json` 为 **35259 assertions = 5764 setup + 29495 scenario**；`outer-result.json` 在 PG/S3 外层 harness 返回后才 PASS，内层资源逐一清理的证据见 `cleanup.json`。

24 个实际服务端 checkout 在七语言、两个 API、无国家/有实际国家两种请求下共 **4704 能力 GET**，每个决策与 PG/domain 对照一致。七阶段实际准入数为：

| 阶段 | 账户/规则 basis points | 准入/24 | 双 API 观察到发布代次的耗时 ms |
| --- | --- | --- | --- |
| 初始关闭 | 0/10000 | 0 | 576.5 |
| 隔离内部 TEST | 10000/10000 | 24 | 675.0 |
| 5% | 10000/500 | 2 | 1034.6 |
| 25% | 10000/2500 | 5 | 623.3 |
| 100% | 10000/10000 | 24 | 878.4 |
| 紧急关闭 | 0/10000 | 0 | 728.0 |
| 回退原 100% 修订 | 10000/10000 | 24 | 774.3 |

中间比例是有限样本，不宣称人数精确达到设定比例。耗时只计算发布请求至双 API 观察到代次，不包含后续整个能力矩阵；TEST 轮询为 1 秒，生产默认 10 秒。隔离阶段实际账户是 ACTIVE/TEST、API loopback，不等于验证了 LIVE 员工鉴权。另从 636 个纯 domain 候选中选出四个双 500 AND 象限，与 PG 做四次对照；不借用历史 4099 向量数量。

真实创建覆盖内部新渠道及旧 UNKNOWN 付款；5%/25% 验证能力矩阵与 PG/domain，未逐级创建付款。紧急 0 版本在两个 API 拒绝新建、cohort 无新增 attempt、PSP 记录无增加；旧版本新键另得 STALE_CONFIGURATION。旧 UNKNOWN 使用原正文/键跨节点重放，并在停止后由原账户认证核实；原 PSP 记录 **1→1**，永久回执恰一行、订单快照摘要不变。106 行不可变历史、七次审计及回退新代次/旧规则 UUID 保持均通过。

## 验证命令与结果

以下命令均由 Node 24.20.0 / pnpm 11.25.0 执行，exit 0；原输出在同目录：

| 命令（省略共同的 `mise exec node@24.20.0 --` 前缀） | 结果 | 证据 |
| --- | --- | --- |
| `node --test scripts/verify-psp-onboarding.test.mjs` | 8/8；包括真实子进程 exit 23 保留和后继阻断 | `runner-green.txt` |
| `corepack pnpm verify:psp-onboarding --output …/drill-final` | 四步骤全通过 | `drill-final/result.json` |
| 总入口内 shared fake conformance | 完整 15 case | `drill-final/fake-conformance.txt` |
| 总入口内 fake/gateway test | fake 20 + gateway 106 = 126；覆盖独立 verifier | `drill-final/adapter-tests.txt` |
| `corepack pnpm check:dev` | format/lint；types 64/64、tests 64/64、build 36/36；缓存 63/63/35 | `check-dev.txt` |
| `corepack pnpm check:contracts` | 两份生成件新鲜，locale 归属正确 | `contracts-green.txt` |
| `node scripts/check-adapter-boundaries.mjs` | 依赖与独立验签边界通过 | `adapter-boundaries-green.txt` |
| `node scripts/check-build-artifacts.mjs` | 32 package exports 可导入 | `artifacts-green.txt` |
| `node scripts/check-ci.mjs` | CI 合同通过 | `ci-green.txt` |
| `node scripts/check-runtime.mjs` | 四应用及运行环境合同通过 | `runtime-green.txt` |
| `node scripts/check-observability.mjs` | 日志/trace/错误/部署声明合同通过 | `observability-green.txt` |
| `corepack pnpm security:secrets` | 首轮通过；最后归档后再扫描的退出码见 final-gates | `secrets.txt`、`secrets-final.txt` |

Turbo 的 64/64/36 是任务图数量，不是断言数。没有运行整条 `pnpm check`、重跑全部历史 PG/S3 矩阵或新增浏览器/手机测试。本轮没有 UI 改动，浏览器不属于本 Task 变更验收；受测环境不是商业 PSP sandbox、真实资金、云 staging 或生产。

## 失败记录与修正

- `runner-red.txt`：先新增行为测试，初始入口模块不存在而失败；仅证明缺实现，不伪称生产行为 RED。
- `http-first-run.txt`：新测试脚本把非 API 直接依赖当包导入失败；改用仓库既有的构建产物相对导入模式，未加生产依赖。
- `http-second-run.txt` 与首个 integration 目录：PG bigint 返回字符串、公共合同使用 number 导致测试比较失败；只调整只读查询 `::int`。同时在执行到该语句前修正 attempt→order→checkout 的只读关联、补永久回执恰一行，后两项不冒充已观测失败。
- `http-third-run.txt` 为首次完整 HTTP PASS；最终统一入口的样本与计时以本页 final 目录为准，不能混用上一轮的 1/6 准入样本。
- 审查中曾提出 LIVE→INTERNAL 账户状态变化假设；完整 DDL 核查确认旧 identity trigger 冻结 status/environment，0036 发布也拒 INTERNAL+LIVE，已撤回未成立的缺陷假设。没有修改生产 SQL 或引入新阻断项。

## 源码、保护与独立复核

`candidate-source.json` 含 2587 源输入；文件映射 SHA-256 为 `5ef8f24b41c3f6f765b6af951ea1f4c64fae8742de80d097be8675197c0cef6f`。相对基线 2582 源文件，已有源码仅 `package.json` 增加命令，其余五项都是新工具。原 74 SQL、37 迁移、700 roots / 127 OpenAPI paths / 204 components 全部保持；5993 个原未跟踪文件逐 SHA 不变、不暂存，见 `compatibility-verification.json` 与最终复查。

`spec-review.md`、`spec-review-source.json` 为非作者规格/运行证据审查；`quality-review.md` 为另一名非代码作者的质量与小范围简化检查。被审 11 个输入与最终源保持一致；不以文档作者自审代替 runbook 独立规格审查。P5-08 原七直接依赖和前六项 963 条选择记录见 `next-stage-readiness.md`、`next-stage-source-compare.json`。

归档只删除 `check-dev.txt` 中 Turbo 输出的行末水平空白，以及 `drill-final/build.txt` 末尾多余空行；完整原字节保存在对应本地忽略的 `.raw.log`，前后摘要和转换规则见 `transcript-normalization.json`。首次暂存差异检查发现构建输出的 EOF 空行后完成规范化，正文/退出结果不变。其他演练原件不变；`.log` 按仓库秘密扫描边界不加入 Git。

## S.U.P.E.R 十项

| # | 结论 | 依据 |
| --- | --- | --- |
| 1 单一文件职责 | PASS | 入口、认证、资源 harness、协议与入口测试各司其职 |
| 2 单一函数职责 | PASS | 计划、顺序执行、阶段观察及只读核实分离；质量审查无必要重构 |
| 3 单向依赖 | PASS | 外层测试消费既有 domain/port/adapter，未改内部依赖 |
| 4 无循环 | PASS | 无业务模块新增导出或反向依赖；adapter/build gates 通过 |
| 5 合同先行 | PASS | 复用既有版本化 schema、正式七操作 conformance，入口行为先测 |
| 6 可序列化 | PASS | 工具报告使用 schemaVersion 与 JSON 安全字段，未输出运行时对象 |
| 7 环境可配置 | PASS | PG bin 可配置、默认临时 Docker、无既有 DB/LIVE selector；固定合成样本仅在 TEST 工具中 |
| 8 依赖声明 | PASS | 无新增依赖；跨包测试使用现有构建产物与显式前置 build |
| 9 可替换 | PASS | 业务 adapter 仍经同一 port/conformance；工具不改变业务 API |
| 10 实际验证 | PASS | 当前变更相关 tests、统一真实演练、质量与兼容门通过；不把未执行的正式门计通过 |

## 后续边界

P5-07 完成后仅将 P5-08 有限本地范围 READY：原 OpenTofu 离线模块/部署工具，并明确承接持久本地体验，领取前仍需登记。Phase 6/7 保持 LOCKED；P3-06/P4-04/P5-03/04/05 原人工、商户、正式配置门保持 IN_PROGRESS。P5-08 云 apply/smoke/re-apply 不能用离线检查代替。

完整本地体验当前未交付，条件见 `docs/runbooks/local-experience-readiness.md`。下一项须组合持久 PG/媒体、真实上传、本地身份、前后台与持续 Worker、TEST 托管支付、安全查单、订单处理和退款，并实测重启保留数据后再告知用户准备服务器。本轮仅本地提交，不 push/merge/部署或进行真实收付款。

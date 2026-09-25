# P3-06 读取稳定性切片最终独立复核

结论：**本轮 TEST 网关修复、诊断及配置兼容切片 ACCEPT。最终候选真实协议与 UI 回归成立；P3-06 性能、旧故障根因及人工门仍未完成。** 不把旧基线63次正常内容当成候选修复对比。

## 复核方式与范围

本人只读取原结果、运行日志、摘要、现有源码与清单，重新聚合已保存JSON、核对磁盘文件SHA／数量；未启动测试、构建、数据库、浏览器或被测服务，未修改源码。没有对88PNG重新人工目检。此前独立源码／真实HTTP单测审查分别见 `gateway-independent-review.md`、`fetch-diagnostics-independent-review.md`、`integration-config-review.md`。

## 最终源码

实际使用的最终清单文件为 **`candidate-source-final.json`**：2206输入，baseCommit995d1c5，capturedAt2026-09-16T10:06:32.952424+00:00；aggregate SHA256：

`692608036c21db82ec3a874843c275443dbb3700d38f5584202ee5d09060bae0`

独立按声明编码复算aggregate一致，2206文件当前磁盘SHA均匹配。与baseline-source.json相比仍仅3个既有文件改变（API package入口、gift-storefront-next、acceptance-runtime）及3个新增文件（gateway test、fetch observer/test），没有删除；其余2200字节不变。生产业务src、contracts、58份SQL、lockfile未改。docs/output证据不是此source清单范围，不混称所有工作区文件静止。

最终源已经采用 `STOREFRONT_TEST_FETCH_DIAGNOSTICS*` 私有前缀，生产config白名单不变。此前候选fixture健康500及真实config RED、旧ACCEPT遗漏均原样保留；本次实际Next回归才补足该集成边界。

## 最终候选真实运行

原目录：`output/checks/p3-06-storefront-acceptance/run-2026-09-16T10-06-50-383Z`。

已直接读取protocol-results.json、browser-attempt-1/results.json、browser-results.json、publication-visibility.json及fixture日志，与candidate-ui-summary逐项对应：

| 项目 | 原结果核验 |
| --- | --- |
| protocol | PASS；32,461断言；6,090 setup API请求 |
| 外部组件 | actualPostgres / actualTlsS3 / actualImageWorker均true |
| 实际compiled Next UI | PASS；22,705断言；88场景 |
| 图片证据 | screenshots数组88；实际PNG文件88 |
| axe | 85次，0违规；**30项incomplete保留** |
| pageErrors | 0 |
| HTML metadata | 84页 |
| 发布可见性 | PUBLISH15,636ms、ROLLBACK12,263ms，均低于60,000ms |
| 性能callback | 原results.performance为null，未执行 |

candidate-fixture-final-result.json记录原命令 `pnpm --filter @fan-support/api preview:storefront-acceptance --ui`，10:06:47.826294–10:18:59.737883 UTC，731.923秒，exit0。日志同时保留协议PASS、实际UI callback PASS及等待控制信号状态；root完成owned cleanup后进程正常结束。本人没有另做端口/全机进程探测，因此不扩大成全机服务关闭证明。

protocol结果自身的browserEvidence=false是协议阶段范围，后续独立browser callback才提供UI证据；不改写旧阶段结果。fixture素材仍为TEST合成且formalAssetApproval、humanOperations、physicalDevice、voiceOver与productionRelease均未获得。

## 最终 Next 原生诊断

直接解析原 `next-runtime-1.log` 的受控前缀JSON，而不是只读取摘要：

- 201条，67个独立requestSequence；每组严格CREATE→HEADERS→COMPLETE，0缺失/乱序组。
- HOMEPAGE18请求、IDOL49请求；60个HTTP200、7个HTTP404。
- 0 ERROR、0 TRUNCATED，未触及256请求/768记录上限。
- 记录窗口10:12:07.101–10:17:31.660 UTC。
- 实际字段仅自产版本/时间/序号、target/stage、durationMs/status；未记录URL、handle、query、body、headers或错误原文。
- 原next-build-1.log包含诊断前缀记录 **0条**；证明本轮build未启用observer输出，实际compiled Next的TEST start观察路径已运行。

7个404与未修改的 `storefront-acceptance-matrix.mjs:590–598` 一致：七语言分别访问缺失艺人handle；gift缺失页不在新observer的目标集合。它们是预设404语义，不是旧CONTENT_UNAVAILABLE。

**也没有把所有旧diagnostics的failures数组说成空：** API本阶段确有21条（IDOL404×7、SEO404×14）；persistence/gateway有85条，其中1次GIFT_DIRECTORY故障注入503（matrix564–574），其余为这些缺失页在LOAD/WORK/TX/gateway各层的NOT_FOUND。数组名failures含预设错误测试，具体类别已核对；无由这些条目支持的自然传输失败。Next的COMPLETE仅证明传输完成，仍要联合UI/JSON语义，而非独立声明内容正确。

## 最终定向与开发检查

最终targeted-tests-final-result.json/log：exit0，**55/55 PASS**，0fail/skip/cancel，wall0.425秒，Node394.855667ms。比第一次54增加了真实config兼容用例；不混用旧计数。

最终check-dev-final-result.json/log：**27.609秒exit0**，全36workspaces/全部consumers；workspace/边界/format/lint通过。Turbo typecheck62/62（61缓存，2.012s）、test62/62（61缓存，7.465s）、build36/36（35缓存，1.955s）。这属于原check:dev，非新的完整pnpm check；日志明确它本身不跑PG/S3/browser/formal。上述实际fixture是另行取得的证据，不能把两个入口名称混为同一命令。

## 旧基线性能必须单独保留

基线原目录：`run-2026-09-16T09-33-37-503Z/browser-attempt-3/performance`。该轮使用**已加载的旧gateway，API/PG/gateway诊断ON**，发生于原UI历史之后。独立读取21份aggregate，逐一核对summary中的score/LCP/CLS/通过布尔，全部一致；实际mobile JSON63份，逐份storefront-content audit的score均为1。

结果仍是 **5/21组三次中位数预算通过，整体预算FAIL**；84资源页全部超JS建议线，图片建议线满足，没有真实用户CWV证据。serve进程exit0只说明控制与cleanup成功，不覆盖performance AssertionError。diagnostics ON还有观察成本，不作为严格最终性能验收。

**最终候选本轮未再执行63次性能矩阵。** 因此不能说修复改善了LCP、达成性能目标或旧间歇故障已消失，也不能将旧基线和新UI拼接成前后性能比较。当前只证实网关协议声明修正、诊断配置/实际Next接线闭合，以及本次UI样本没有自然传输错误。

## S.U.P.E.R 与剩余门

1–2：逐跳头过滤和TEST原生观察各为单一职责。3–4：测试接线向内，无业务反向或循环依赖。5–6：既有业务合同不变，诊断为固定schemaVersion JSON。7：目标来自owned配置并严格loopback，私有测试键与业务配置分离。8：无新增外部依赖，只有既有Node内置能力。9：移除TEST接线即可替换观察器，不动业务。10：本切片定向/开发门及实际PG/S3/worker/Next/UI结果如上接受；**未宣称本轮重新执行完整pnpm check、最终性能或人工门**。

保留事项：旧中文首页／日文艺人偶发不可用根因尚未最终确定；PG canonical错误二次分类问题只读发现未修改；原手机、读屏、运营计时、关键译审、PSP商户及发布门仍独立。P3-06继续IN_PROGRESS，Phase5不因此解锁。

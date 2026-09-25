# Next TEST fetch 诊断独立复核

结论：**本次 TEST 诊断切片 ACCEPT，无阻塞发现。** 本人独立定向运行 24/24 tests PASS。它补齐 Next 子进程内原生请求传输的观察面，不替换业务 fetch，也不证明旧间歇内容不可用已经归因或消失。

## 复核范围

读取新 `storefront-test-fetch-diagnostics.mjs`／test、`gift-storefront-next.mjs` 的 start-only 接线、`storefront-acceptance-runtime.mjs` 的 Boolean 接线，及原 Storefront `src/instrumentation.ts`／test 和既有诊断测试。未改实现，未启动数据库、Chrome、Next build 或真实 storefront fixture。本报告是唯一新增文件。

## 安全字段与默认关闭

- 模块只在 `FAN_SUPPORT_TEST_FETCH_DIAGNOSTICS === "1"` 且 `FAN_SUPPORT_DEPLOYMENT_ENV === "test"` 时订阅；缺省、production、无效 origin 均不安装订阅。
- 只接受带端口的 `http://127.0.0.1`／`http://localhost` origin，不接受认证信息、路径、query、fragment。请求还需 exact origin、GET 和首页或单艺人 endpoint；其它源、gift、嵌套 private route、POST 由真实 HTTP 测试证明不输出。
- 输出字段局限 `schemaVersion`、自产 ISO `observedAt`、自产 sequence／requestSequence、固定 target／stage、计时数字、100–599 status、允许的 errorName／transportCode。没有 URL、origin、handle、locale、query、headers、body、message、stack、socket 地址、SQL 或业务对象。
- 原错误 name 采用预先捕获的 DOMException getter品牌检查，普通 Error 的 name 用深度上限3的 own data descriptor／prototype 读取；code／cause 同样限制深度并用固定白名单。不会读取输入 name／code getter。原始错误不交给 JSON.stringify 或 stdout。
- Request 只作为 WeakMap key；state 仅保留序号、目标枚举和开始计时。完成／失败即删除，stop退订，不建立永久强引用列表。
- 最多256匹配请求、768正常记录；到边界只输出一次 TRUNCATED 并退订，输出量有界。sink 抛错和 listener 内部错误均被观察层捕获，不能冒泡进 Undici。
- 受控前缀 JSON 直接 stdout 输出，避开生产 instrumentation 的 safe console.error 边界；继承原 harness 的按 Next generation 分文件日志，不写浏览器存储或业务数据库。

## 接线与兼容性

`gift-storefront-next.mjs` 默认 `readDiagnostics=false`。只有 `readDiagnostics && deployment=test` 才创建包含新 env 和 `--import` 的 startEnvironment；`spawn(... build ...)` 继续使用原 environment 且 deployment=preview，不带这次新增 import。dev runtime deployment=development 也不启用。`storefront-acceptance-runtime.mjs` 只传 `Boolean(diagnostics)`，原全局默认关闭开关仍是入口控制。

这里原参数 `production: true` 指编译版 **TEST fixture** 的 build/start 流程，并不意味着 deployment=production；不能因变量命名把本观察器描述为正式站运行功能。Storefront 的生产 instrumentation／public-catalog 均未修改，也没有新增生产模块 import。模块顶层自安装同样受双开关约束，固定 Node 24.20.0 运行时具备所用 Node API。

实现不重写 `globalThis.fetch`、dispatcher、DNS或请求参数，不读取／消费 response body，不改 header/status/timeout/retry/abort。原既有 TEST DNS preload 保持原接线。新 observer 只订阅 `undici:request:create/headers/trailers/error`；错误分类失败最多丢失该条诊断，不改变原请求异常。

## 独立实际验证

```sh
mise exec node@24.20.0 -- node --test apps/api/scripts/storefront-test-fetch-diagnostics.test.mjs apps/api/scripts/gift-storefront-gateway.test.mjs apps/api/scripts/storefront-acceptance-diagnostics.test.mjs
```

exit 0，24/24 PASS，Node duration **458.8465 ms**：新7个诊断测试 + 原3个网关／14个诊断回归。包括真实 Node HTTP 成功与正文/header保留、真实主动 socket断开得到原生 TypeError且安全记录UND_ERR_SOCKET、调用方 AbortError且upstream恰1次请求、真实 `node --import` child 默认静默／显式TEST输出，以及错误 getter 0次、canary不输出、记录截断和sink故障隔离。

真实断开测试主动关闭的是自有 TEST upstream socket，证明诊断能观察预期异常；它**不是旧自然页面故障的复现**。默认关闭、non-TEST、非法源还用 channel 发事件反例验证。真实 --import child 测试没有启动编译 Next；实际 Next内置／补丁 fetch 的这条接线仍须 root fixture 观测确认。作者报告格式/lint通过，本人不将它称为独立重跑；未回滚共享文件重造作者 RED。

## 验收时必须保留的解释边界

1. `HEADERS`／`COMPLETE` 代表原生 HTTP 阶段，不能证明 JSON解析、schema、locale/status映射、PG proof或页面主内容成功。若完整传输后仍不可用，需联合现有上层诊断。
2. 观察器不记录locale／handle／request-id，`observedAt + target + requestSequence + generation文件`只帮助时间关联，不能在并发同类请求中充当端到端严格 trace ID。不要仅凭相邻日志强行归属。
3. 每个 Next 进程达到256匹配请求或768记录后会 TRUNCATED并退订。长龄／UI历史／批量探针后须先确认记录未截断；**截断后的“零错误”不是稳定性证据**。不为了留诊断无上限记录。
4. 受控同步 channel listener、JSON序列化及 stdout 输出仍有观察成本；启用诊断采样不得直接替代未启用的最终性能预算验收。
5. 本切片未修复已记录的 PG canonical 二次分类问题，也未扩大生产日志面、泛化全部 TEST gateway 或关闭 P3-06／人工门。

## S.U.P.E.R

1–2 单独观察器职责明确；3–4 TEST harness向观察器接线，无业务反向依赖或循环；5–6 固定 versioned JSON字面量与枚举/数值输出，无业务合同改变；7 owned origin 来自配置且严格loopback验证，无新正式配置或秘密；8 仅 Node 内置诊断channel，无新依赖；9 去掉start import即可替换本观察器，不牵动业务；10 本次24定向测试PASS，真实Next整合／全仓／formal性能门不由此报告冒称完成。

## 本次复核输入 SHA256

```json
{
  "apps/api/scripts/storefront-test-fetch-diagnostics.mjs": "5fd2db9a45ea748555c09ff51f92380a65357ad732d3db54298d7bbb65ead8b3",
  "apps/api/scripts/storefront-test-fetch-diagnostics.test.mjs": "b00e9d6f2fd4d24951d5fb7818172c8587d4f64582d13e2f64b59a91f0ab94ca",
  "apps/api/scripts/gift-storefront-next.mjs": "91936d960614e5d2da4f6c5f196fb202133077e2c5bc3716f720ece8f3393cba",
  "apps/api/scripts/storefront-acceptance-runtime.mjs": "19727f31c743e038d28512624acdfecaceb159ed1b26e3f0121661bd34f869bd"
}
```

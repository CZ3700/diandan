# P3-06 TEST 公开读取诊断：独立只读审查

审查者：`/root/order_bff`。仅审查源码、diff 与作者执行日志；未运行测试、build、数据库或 Chrome，未修改源代码。范围为 `storefront-acceptance-diagnostics.mjs`/test、`storefront-acceptance-runtime.mjs`、`gift-storefront-next.mjs`、`storefront-acceptance-http.mjs`。

**最终源码结论：ACCEPT，无剩余阻塞。** 首轮发现的诊断归属问题已按下述最小范围修复并独立复核；原失败与修复 RED 均保留。最终实际日志为 14 PASS / 0 FAIL；本 reviewer 未重复执行。

## F1 / P2（已解决）：迟到 API 和 gateway 响应的 phase 语义

首轮位置：`storefront-acceptance-diagnostics.mjs:367–368`、`:421–422`，以及 `gift-storefront-next.mjs` 响应结束后调用 observer 的接线。以下保留原发现，行号对应首轮版本。

事务 wrapper 在开始时捕获 `state = active`，后续 LOAD/WORK/TX 正确写回旧 phase；但是 gateway/API 观察器在完成回调才读取 `active`。如果旧轮的一个响应尚未结束，root 已调用 `beginPhase('browser-attempt-2')`，该旧请求的 gateway/API 完成记录便写入第二轮，即使对应 TX 仍写在第一轮。现有 late transaction 测试只检查第一种路径，不能证明 HTTP 归属正确。

建议两种可接受处理任选其一：

- 在 gateway 请求入口捕获 phase closure；API 在 request 开始时以合法 requestId 绑定 phase，完成时使用同一绑定并清理。增加“请求开始 → beginPhase → 结束”的两条回归断言。
- 如当前只需粗粒度完成观测，则字段/报告明确为 `COMPLETION_PHASE`，并停止将 API/gateway phase 当作请求起始轮次；保留事务起始 phase 的既有语义。不能仅加免责声明后仍把此数据用于精确跨层请求关联。

编号 phase 文件本身不会互相覆盖；问题是写入了错误的 phase 文件，不能由独立文件名解决。此发现已即时发给 root/作者，未自行修改。

**最终修复复核：** gateway 在 request handler 入口调用 `captureObserver`，`captureGatewayObserver` 闭包固定当时的 state；成功、注入故障和 transport error 都经同一 captured callback 记录。延迟响应更新旧 numbered phase，不更新新 active alias。新增真实 HTTP 测试先等待 upstream 已接收，再 beginPhase，最后放行原 503，覆盖原错误归属。API 无新增 start hook，明确记录 `phaseAssociation: 'COMPLETION_ONLY'`；其 phase 仅表示观察完成时的阶段，不再承诺请求起始阶段。该边界同时在 result.json 说明，符合 root 选择的最小方案。

`late-gateway-red.log` 的目标断言真实失败为新 active phase 仍有 1 条记录、期望 0；最终同一测试通过。没有通过删掉断言或移除旧轮证据来解决。

## 已接受的源码边界

- **默认关闭与范围。** root 仅在 `FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS === '1'` 时创建 diagnostics；其余值不包装 persistence，logger 仍丢弃，gateway 无 observer。新增实现均在 TEST scripts；未改产品 contracts、Application、SQL、重试或性能阈值。静态导入 helper 本身不创建文件/观察器；运行需要的 contracts/observability/persistence-port 均在 API 既有构建依赖闭包。既有 acceptance `*.test.mjs` glob 将覆盖新测试。
- **正确的实际 pool。** 接线使用 `createTestPublicationRuntimeComposition` 已有第二参数 factory，包住实际 published-content/homepage/SEO managers，而不是误包 fixture 的另一个 public-read pool。
- **输出为明确投影。** target/phase/error kind/public error/schema issue code 使用固定集合；issue path 只保留已知字段，未知键替 `UNKNOWN_FIELD`，数字一律 `ARRAY_ITEM`，并限制条数、深度和路径长度。schema 的 `input/value/message`、完整 query/URL、名字/描述、SQL/values、原 error/stack/cause 都没有写出路径。gateway 的 body 仅 transient 解析，未持久化。
- **安全标识。** API requestId 必须通过项目 canonical 校验，traceId 必须符合非零十六进制规范；记录允许的 route 枚举而非 handle/path 原值。locale 只取七语言集合；status/duration 有界。仅接受既有 API completed/failed 日志。
- **transportCode 新增范围。** 仅 gateway transport error 分支输出九项固定网络码之一；读取 error/cause 最多三个对象的 own data descriptor，不执行 code/cause getter，不输出未知 code、原 message 或 cause。遇到反射异常仍被原观察边界隔离。新增测试覆盖真实 TypeError 的 `UND_ERR_SOCKET` cause、getter 零调用、未知私密值和过深 cause 不输出，以及相同异常实例重新抛出；`transport-red.log` 保留缺少目标码的有效 RED。
- **业务返回和异常。** wrapper 调用原方法一次，参数和 receiver 保留；返回原 loaded/worked/value 对象，catch 重新 `throw error` 同一实例，不自行恢复/重试。缺失 repo 方法不补造，其他 persistence 属性/close 原样转交。schema 额外校验只用于观察，不替换业务返回。observer 自身同步异常由观察边界吞下并计数；持久化写失败也被捕获，不改变产品成功/失败。
- **gateway 转发。** 原一次 `arrayBuffer()` 的 bytes 仍原样 `response.end`；status/headers/异常后的既有 503 分支不改变。观察发生在原响应动作之后；实际诊断 observer 同步且内部包含异常。定向真实 HTTP 测试验证 status/header/body 未变、upstream 仅调用一次，抛错 observer 不改成功传输。
- **文件与容量。** phase 标签白名单阻止路径注入；递增编号保留重复 protocol 各轮；两个无前缀文件明确是 active convenience snapshot。旧事务完成不会更新新 active alias。失败 ring 有容量，覆盖旧条目时留下 truncated/droppedFailures；并非完整逐事件审计，应读取这些标记再使用证据。

## 已读取的测试证据

首轮 `green-final-12.log` 为 12 PASS / 0 FAIL、184.237 ms，逐项包含对象/异常身份、仅调用一次、私密 canary 与未知 schema path、并发 operationId、真实网关 bytes/header/status、迟到事务、homepage/SEO receiver、API 投影、坏 JSON/schema/transport、observer 抛错、无补造方法、合法 SEO INDEX/CATALOG 负例纠正。

最终 `read-diagnostics/result.json` 指向 `green-final-14.log`，实际 **14 PASS / 0 FAIL、164.990 ms**；增加 transport code 白名单与迟到 HTTP phase 测试。已读取最终 format 日志的 matched files PASS；lint 无诊断，成功由作者 result.json 指向对应执行日志。保留 12-test 结果为历史，不冒充最终。

已阅读测试源码与绿色日志；本 reviewer 未独立运行。作者记录的有效行为 RED 与 setup/import 失败分别保留；本报告不将 setup 失败作为功能 RED。format/lint 成功由 result.json 指向其独立日志，最终综合静态门仍由 root 负责。

## 不可越界的诊断限制

1. 此 wrapper 只能区分 LOAD/WORK/TX 和 gateway/API 边界，并未捕获所有投影内部拒绝原因或原 SQLSTATE。旧 PG 多层错误归类可能已丢失信息；`UNEXPECTED_ADAPTER_FAILURE` 不能反推为某个 SQLSTATE，`TRANSACTION_ABORTED` 也不能单独区分死锁与 serialization。
2. operationId 仅为本进程观察序号，不是全链路共享 request ID。API 成功事件只计数，失败才保留细节；没有同请求绑定时，不应从相邻“API 成功”和“gateway 失败”直接推出精确因果。
3. 额外 safeParse 和同步全文件写入会增加耗时，甚至可能改变竞争时序。开启诊断的结果可用于定位，不能与关闭诊断的 formal 性能样本当作完全相同的测量条件。根因修复后需关闭开关再采正式完整集合。
4. 针对当前具体 plain-object repo/result 与同步诊断 callback，身份与异常不变成立；本次未把 helper 扩展成任意插件/不受信任对象的通用观测系统。

F1 已重新只读确认并关闭；root 的 TEST 诊断可以继续。原 attempt-3/4 内容失败不因诊断工具测试绿色而关闭，最终产品及正式性能验收仍待 root 后续证据。

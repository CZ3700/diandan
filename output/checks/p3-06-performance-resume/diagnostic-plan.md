# TEST-only 公共内容失败诊断计划

状态：只读方案，尚未实施。原 attempt-3 中文首页失败和 attempt-4 日文艺人第二样本失败均保留有效；后者 Document HTTP 200 约 142.593 ms 完成。二者不能用 8 秒请求超时或时钟猜测解释。暂停重复正式性能采样，先用新真实 fixture 找到同请求的失败边界。

## 目前为什么定位不了

| 边界 | 当前收敛行为 |
| --- | --- |
| Storefront `server/public-catalog.ts:99–147` | fetch 异常、JSON 解析失败、schema 拒绝、状态不对应、locale 不匹配、配置异常都变成 CONTENT_UNAVAILABLE，无分类日志。 |
| API `published-content-route.ts` / `storefront-homepage-route.ts` | 无效结果、locale/locator 不匹配及捕获异常都安全返回 503；成功 DTO 仍受原 schema 检查。 |
| Application `published-content.ts:66–106` / `storefront-homepage.ts:22–51` | repository 结果 schema、locale/locator、纯投影、事务完成及输出 schema 任一失败都可能收敛为同一 code。 |
| Persistence `published-content-repository.ts` / `storefront-homepage-repository.ts` | 发布 head/manifest/receipt、媒体证明或必需 HERO 引用不符可正常返回 FAILURE；SQL/schema 异常还可能经 resource/base-content 包装成 PersistenceTransactionFailureError。 |
| Transaction runner | acquire、BEGIN、读取/回调、scope drain、ROLLBACK、COMMIT 均可抛受控事务错误。40001/40P01 都映射为 TRANSACTION_ABORTED；不能仅凭该 code 判定死锁。 |
| 现有日志 | fixture 的 logger `write:()=>undefined`；`onInfrastructureFailure` 仅监听 pool error，不观察每次查询/事务失败。Next 启动日志为空不能反证上述路径正常。 |

首页/艺人内容读取发生在新增异步 Shell 的 Cookie presence hint 之前。hint 不调用 homepage/idol fetch、不改公共 DTO，未发现直接返回本次内容失败的路径；不排除时序改变暴露原有瞬态条件。

## 最小第一层：原 TEST composition 的工厂包装

`apps/api/src/publication-runtime-composition.ts:37–43` 已提供 `createPersistence` 工厂。新 fixture 脚本在调用 `createTestPublicationRuntimeComposition` 时注入包装器；**生产 composition、contracts、SQL、catch 和重试策略均不改**。包装真实 persistence 上的 `publishedContentTransactionManager`、`storefrontHomepageTransactionManager` 与 `storefrontSeoTransactionManager`；其他属性/close 原样转交。fixture 自有的目录读取 persistence 若一起观测，单独标为 DIRECTORY。

每次 transaction 调用创建非敏感 operation UUID。把原 `work` 传给原 manager 的薄包装：

1. 包装该次 repositories 中实际的 `load`（SEO 用其原方法名），记录目标枚举、locale 和 `LOAD_START`。
2. 原样 await 原读取；记录 `LOAD_RETURN` 的 outcome/code/schemaVersion，使用原 contracts schema 额外 safeParse，仅保存 issues 的 code/path。若抛出，记录 `LOAD_THROW` 后抛回**同一 error**。
3. 原样执行调用方 work；记录 `WORK_RETURN` 的 outcome/code，或 `WORK_THROW` 的允许异常分类。不得把 FAILURE 改 SUCCESS、把异常吞掉或自行重试。
4. await 原 manager 完成，记录 `TX_RETURN` 或 `TX_THROW`。`WORK_RETURN=SUCCESS` 后 `TX_THROW` 能直接区别 COMMIT/drain 边界失败与投影拒绝；事务错误通过已有 `parsePersistenceTransactionFailure` 提取 code/recovery，不序列化 error 本身。

只在内存保留本次 load 返回的 context，直到原事务调用结束；然后清引用。若原 `WORK_RETURN=FAILURE` 而 load 成功，可在事务结束后使用**同一份内存快照**调用现有 `projectPublishedContent` / `projectStorefrontHomepage`，并对 legacy context 记录 `verifyPublicationManifest` 与 manifest hash 比较的 boolean、context schema 是否通过。首页按 HOME/HERO_IDOL/FEATURED_IDOL/FEATURED_GIFT 和顺序号分类，避免误把可选 slot 不可用等同于整页失败。

这些只读辅助结果分别标 `PROJECTION_REJECTED`、`MANIFEST_VERIFICATION_FALSE`、`CONTEXT_SCHEMA_REJECTED` 等，不伪称捕捉到了私有 `currentPublication` 或 media resolver 内部具体分支。若现有公开投影只给 FAILURE，先保留此准确粒度；不要为诊断复制生产投影实现，或换用不同语义的“发布许可”校验器。

## 第二层：同请求的 HTTP / Next 消费证据

在 TEST-only helper 中记录两条已有公共读取路径 HOME 与 IDOL，并为 DIRECTORY/SEO 标明旁路：

- 包装提供给 API 的只读 useCases.execute，记录输入 schema 是否通过与最终 outcome/code/响应 schema。Fastify 的窄化只读观察 hook 在路由注册前安装，记录实际 HTTP status 和同一操作的关联 ID；使用正确的 request async context，不用共享的全局“当前请求”变量。
- TEST fault gateway 只观测真实 upstream status、body 字节数、JSON/schema/locale 分类及转发结果；记录当前 fault 是否命中。缓冲与转发使用原一次读取的 bytes，不额外发业务请求或改响应。网关为受观测请求生成 UUID 型 `x-request-id`，API 按既有 request-id 规则关联；禁止转发来访 Cookie/Authorization。不要写完整 URL、query、headers、body。
- 如果 API/gateway 同请求都成功而 SSR 仍错误，追加仅用于 Next TEST runtime 的 preload 观察器：仅匹配内部 API origin 和固定只读路径，包裹原 fetch 及其 Response.json，保持原 request 参数、abort、异常和解析结果不变；记录 FETCH_THROW、JSON_THROW、原 schema safeParse 结果与原 locale/status 规则对应的分类。JSON 仅使用应用原本那一次解析结果，不 clone/持久化 body；观察器本身失败只记 DIAGNOSTIC_OBSERVER_FAILED，不改变业务返回。不要在正式性能取样中开启该观察器。

若已能在第一层捕获真实内部失败，先据该证据定位，不必扩大 Next 观察器范围。API/gateway/Next 事件以 UUID、目标枚举、locale、进程内顺序号和 monotonic elapsed 关联；跨进程不可直接相减各自 monotonic 时钟。响应本身不新增私密字段。

## 安全日志合同与判别

建议 append-only JSONL：`schemaVersion, runId, operationId, requestId?, sequence, layer, target, locale?, phase, elapsedMs, status?, outcome?, code?, errorKind?, issues?, flags?`。所有字段先用 TEST schema 校验再写；target/phase/errorKind/code 为白名单。issue path 只保留已知 contract 字段名和有界数组下标，未知动态键替为 `UNKNOWN_FIELD`；不写 Zod message/input、exception message/stack/cause、SQL/绑定值、context、名称/描述、私密留言、凭据或环境变量。单事件和事件总数设明确上限，超限留下 `DIAGNOSTIC_TRUNCATED` 并使诊断不完整，不能静默丢失失败。

| 同请求观测 | 可支持的定位 |
| --- | --- |
| LOAD_THROW / TX_THROW | 读取或事务边界；保存受控事务分类。若需区分 40001/40P01，再在独立 TEST pool/query 适配包装处捕获原 SQLSTATE，不能从已归一 code 反推。原 SQLSTATE 仅允许五位合法枚举；不记录 PostgreSQL message/detail/query。 |
| LOAD_RETURN=FAILURE | persistence 的业务证明读取拒绝；不是传输失败。 |
| LOAD_SUCCESS + WORK_FAILURE | 应用 locale/locator 或投影拒绝；同一 context 的现有 proof/projection boolean 可继续收窄。 |
| WORK_SUCCESS + TX_THROW | drain/提交等 transaction completion 失败，不能把前面的成功误报成整个请求成功。 |
| API 成功 + gateway失败 | TEST 代理或转发边界。 |
| gateway成功 + Next JSON/schema/locale拒绝 | Next 消费校验边界；按实际分类修复，不降低 schema。 |
| 所有观测成功但 PageState | 关联/观察器覆盖不足或尚未捕获真正失败请求，仍然未知，不能宣布已定位。 |

## 可重复诊断与退出条件

先用窄化 helper 测试证明能捕获：返回 FAILURE、schema错误、locale错误、LOAD_THROW、WORK_THROW、work成功后TX_THROW、JSON/transport异常，以及两个并发请求的关联隔离。使用内容/邮箱/token canary 验证输出不包含输入值，确认包装返回相同对象/同一异常、原操作仅调用一次。该测试证明观察器，不替代产品证据。

新 fixture 保持真实 PG/API/媒体与现有 seed。先运行已有 `runConcurrentReadRounds` 的首页/目录/SEO 三请求及变换顺序，无重试，每轮全部保留；另加入艺人正文与其 SEO 的同页并行读取和实际 SSR。先检查正常调用的事件链完整，再在固定有界轮数内捕获失败；没有失败只报告未复现。原 `concurrent-public-reads` 的成功是历史观测，不代表此次无失败。

时间只在有失败快照证据后分析：legacy evaluatedAt 有既有历史下界，DAILY 为另一条路径。先记录实际 proofVersion 与允许的时间先后比较 boolean；不能据壁钟猜测放松时间校验。失败能稳定绑定具体枚举/阶段后，再设计最小生产 RED→GREEN；修复完成且撤去诊断观察器、冻结源码，才恢复独立完整 63 样本。两轮旧失败永不被新集合覆盖。

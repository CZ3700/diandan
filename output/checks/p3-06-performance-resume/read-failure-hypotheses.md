# P3-06 间歇公开内容失败：PG / schema / time 只读假说

结论：**现有材料不能确定根因。先捕获同次失败的层级与允许的分类，再决定是否需要修改产品代码。** 未发现稳定 proof_v2 数据仅因正常时间推进或 SQL 行返回顺序就偶发失效的成立路径。源码 SHA 不变也不证明当时数据库、连接或 HTTP 响应流未发生变化。

本轮仅阅读源码与已有 `content-failure-review.md`，未运行数据库、Chrome、测试或构建；未修改源文件。本报告中的 attempt-3/4 和后续 160 次 API/gateway、80 次 SSR 结果来自 root 当轮观测，并非本人重跑。原两轮 formal 失败必须保留，不用后续成功替代。

## 确定的链路与错误归并

1. 首页 `readStorefrontHomepage(locale)`、艺人 `readStorefrontIdol(locale,handle)` 使用 React request cache；读取 `public-catalog.ts` 的内部 HTTP GET。该请求 `no-store`、无 cookie、`redirect:error`、8 秒 timeout。fetch / body JSON / 响应 schema / HTTP-status 对应 / locale 一致性 / 配置异常都会变成同一个 `CONTENT_UNAVAILABLE`（`apps/storefront/src/server/public-catalog.ts:99–147`）。这不是仅用于 PG 错误的码。
2. 首页仓库读取主 homepage 和必要 `HERO_IDOL`；主首页投影失败或 hero 读取/投影失败会令整页不可用。非 hero 的 featured 内容业务失败可降级，但其查询抛异常仍可使整条事务失败。艺人页主读取失败也直接渲染 PageState。错误 UI 本身可正常返回 Document 200；因此 Document 200 不等于内部 API 200。
3. `createPublishedContentUseCases`、`createStorefrontHomepageUseCases` 的 catch 均收敛为 `CONTENT_UNAVAILABLE`。repo 的 schema 抛错、纯投影返回 FAILURE、锁/连接/COMMIT 抛错从外部表现相同。API 的 route 再核对 schema/locale，失败用 503 输出；route 自己的 catch 也没有细分类。
4. 实际 fixture 还有 `gift-storefront-next.mjs:10–27` 的 HTTP 转发层：upstream fetch/body 任一异常会输出空 503；`failurePath` 也输出空 503。Next 对空 body 的 JSON 解析失败最终是同一内容不可用。该转发层不记录异常；`setFailure(null)` 只说明清除故障开关，不排除真实网络失败。

## 优先、可证伪的假说

### H1：HTTP 链路快速失败，而非 PG 内容证明不合法

**成立条件：** Next→gateway 或 gateway→API 的连接/响应体异常；或者某次实际 API 响应与其 schema/locale/status 不匹配。已有不足 1 秒和约 143 ms 的 Document 时长更符合快速失败或快速拒绝，不能直接支持 8 秒超时。后续批量探针全成功不排除早先单次连接故障。

**最小观测：** 同一实际 navigation 保留 gateway upstream 状态、收到 header/body 的阶段、是否完成 body、响应体长度/摘要、允许的 schema issue code/path、下游状态，以及 Next 分支枚举 `FETCH_REJECTED / BODY_INVALID / SCHEMA_INVALID / STATUS_MISMATCH / LOCALE_MISMATCH / UPSTREAM_FAILURE`。不得输出 body、完整 URL/query、错误原文或对象。

**判别：** API 对对应读取明确记录 200 且完整响应，而 gateway 或 Next 报错误，PG 内容校验不是这次失败层；API 明确 503 且 body 为合法 `CONTENT_UNAVAILABLE` 才转查 H2/H3。若 Next 单次实测 elapsed 明显不足 8 秒且不是提前 abort，则其 8 秒 timeout 可排除。

**边界：** 当前代码未观察到真实网络错误类别，不能把 socket reuse/ECONNRESET 等具体原因当结论；也不建议未定位就添加重试掩盖失败。

### H2：PG 连接 / 查询 / 提交瞬态异常被统一失败

**成立条件：** 连接获取失败、连接断开、数据库取消查询、锁等待失败、serialization/deadlock 或提交异常。`publishedContentTransactionManager` 与 `storefrontHomepageTransactionManager` 均为 SERIALIZABLE；主 owner/metadata/review 等使用共享锁。两个相同的纯读取事务之间不应仅因共享锁就死锁/serialization；要成立应找到并发写、后台变化或外部连接/查询中断。

**源码依据：** `transaction-runner.ts:405–525` 在 BEGIN、工作、drain、COMMIT 失败后抛事务失败；Application 不重试而直接 unavailable。`errors.ts` 把 40001/40P01 分类 `TRANSACTION_ABORTED`，08xxx/55P03/57P01–03 分类 `TEMPORARY_UNAVAILABLE`；57014（取消查询）没有专门分支，落 `UNEXPECTED_ADAPTER_FAILURE`。因此仅见后者不能排除查询超时。

**最小观测：** 通过现有 TEST composition factory 包装连接/query，在实际失败处记录固定阶段 `ACQUIRE / BEGIN / READ / COMMIT`、该次 query 的序号/内部静态名称、耗时和允许 SQLSTATE（或安全分类）。不要记录 SQL、参数、PG message/detail/constraint。连接是否新建、pool waiting/idle 数值可作为纯计数补充。

**判别：** 同次 40001/40P01 必须再定位写方或锁竞争；纯静态 read phase 未有这些 SQLSTATE 时不应强改隔离级别。全部 SQL/COMMIT 成功且 repo 返回数据时排除本次 H2，转 H3。若 query cancel，核对该实际 pool 的 statement/query timeout 和是否手动取消，不根据项目中另一测试 pool 的 timeout 推断。

**分类观测陷阱：** preflight `baseContentRun` 已把原 SQL 异常转为 `PersistenceTransactionFailureError`，外层 `createPublishedContentRepository` catch 再调用 `persistenceTransactionFailureFromPostgres`。其 classifier 只认 own `code/cause` 且 SQLSTATE 是 5 位；事务错误的 `code` 是 prototype getter，原分类可能二次变为 `UNEXPECTED_ADAPTER_FAILURE`。这是观测精度风险，尚不是内容失败的根因。应优先在 SQL 最近边界采集，或利用已存在 `parsePersistenceTransactionFailure` 读取安全结构；不要依赖 outer error message。

### H3：当时 canonical 数据发生变化或证明/schema 精确拒绝

**成立条件：** publication/head/receipt 不一致、manifest canonical/hash 不一致、metadata 发布证明缺失、rights/readiness/provenance 状态改变，或当时读取结果不符合 schema。`loadPublishedContentContext` 的明确拒绝点包括 rows 数量、proof_version、manifest/record、headVersion、preflight、metadata proof、可用 variant、最终 context schema。随后 `projectPublishedContent` 再检查 current publication、manifest 与 canonical、全部七语言审核、扩展、rights 和来源。

**为什么普通源码冻结不排除此项：** rights/variant/current owner status 是数据库当前事实；后台或测试生命周期写入并不改变源码 SHA。反之，如果同一 schema 输入、head/manifest ID 与相关状态完全一致，该纯投影应确定性成功或失败，不能泛称偶发 schema 验证。

**最小观测：** 对本次读以静态 stage 标出 repo 与 projection 哪一层返回 FAILURE；只记 proof_version、数量、内部 stage 枚举、schema issue code/path、manifest/head 相等布尔值及允许的 blocker code。必要时在内存对相同输入执行二次纯投影并比较结果，不放宽任何证明；不要把整份 snapshot/manifest/body 写日志。

**判别：** 相同 canonical 输入摘要同纯投影异结果才值得调查隐藏状态；摘要/状态变化先找实际 DB 写方。首页需要额外区分主 homepage 与必要 hero，否则某个艺人证明失败会被误归因于首页查询本身。

## 时间与排序专项：当前不支持的解释

- **proof_v2 裸 now 回拨：不成立为一般解释。** `publication-preflight-repository.ts:106–117` 使用 GREATEST(clock_timestamp、transaction_timestamp、全部 snapshot 创建/生命周期/翻译审核、head.updated_at、extension edited/reviewedAt)。主 publication 时间由 published 生命周期或 head 下界覆盖。`comparePreflightTime` 保留微秒，canonical serializer 将时区/分数规范化，旧 draft 扩展时间也在 `preflightSnapshot` 中补回 PG 精度。除非捕获某个未进入下界的具体时间与拒绝路径，不应修改时钟或移除时间保护。
- **proof_v3 是另一条有条件路径。** `daily-publication-read.ts:43` 使用裸 clock_timestamp，`daily-publication.ts:138` 拒绝 publication.publishedAt > evaluatedAt。只有失败对象确为 proof_version 3 且捕获该时间倒序才能支持这条假说。此 acceptance seed 调用原 author/approve/publish 流程，不能直接把 DAILY 理论路径当作本次事实。
- **查询顺序随机→manifest hash 偶发变：目前不支持。** `publication-manifest-canonical.ts:42–59` 将 translations/audits/mediaRevisions/approvals/copies/extensionApprovals/assets/variants/lineage/processing/media/aliases 等按集合规范化；不能因 extension approvals 某 SELECT 没有 ORDER BY 就推断 hash 会随机变化。结构 block/item 顺序另有明确语义，本次未发现这种顺序在两个失败对象上无约束变化。
- **正常时间前进导致 rights 到期：无对应自动 TTL。** 此处 rights gate 检查 APPROVED，media readiness 检查 READY，未发现随读取 clock 自行到期的 rights 条件。政策 effectiveAt 是另一特定条件；应先证明本次有效政策边界未满足，不能迁移成全部内容的时间猜测。
- **字体/cart hint 直接产生该码：未发现调用路径。** 新 hint 读取 cookie 存在布尔值，不介入 canonical/public fetch；字体 CSS 也不写内容。调度差异可能暴露旧瞬态失败，但源码审查不能据此确定因果。

## 可直接复用的安全日志 hook 与正确接线

1. `registerFastifyObservability` 已在 `createApiApplication` 安装，`onResponse` 输出固定 route、状态、耗时、request/trace ID；503 会产生 `http.request.failed`。**本 fixture 在 `storefront-acceptance-runtime.mjs:98–101` 把 logger.write 设为 `() => undefined`，所以这些证据实际被丢弃。** 将该 TEST logger 的既有安全 JSON 行保留到输出目录即可先得到分层事实。
2. `logging.ts` 采用严格字段与 event/errorCode 白名单。随意传 `reason`、`stage`、`sqlState` 会被过滤，随意 event 会变 `observability.invalid_event`。若补 fixture 专属诊断，应另用固定 schema/枚举与受控 sink，不误以为往原 logger 塞额外字段就已经记录。不得转为原 error/console dump。
3. `onInfrastructureFailure` 只监听 pool 的后台 error，并不覆盖每条 active query、纯校验返回或 Application catch；只能补充 H2，不是完整观测。
4. **准确 pool：** home/idol/seo 来自 `createTestPublicationRuntimeComposition` 的独立 persistence（`apps/api/src/publication-runtime-composition.ts:83–113`），其第二参数已有 `factories.createPersistence`。`storefront-acceptance-runtime.mjs:106` 名为 public read persistence 的另一个 pool 直接供 directory/publishedGiftCommerce；只观测它会漏掉本次失败主链。优先通过前者的现有 TEST factory 注入只读 query 观察，无需先改生产仓库。
5. Next 现 public-catalog 不传播请求 ID；gateway 将 API header 透传，但未记录且 Next 未读取 ID。可用返回的合法 `x-request-id` 加同一次导航的本地序号/时间关联，不应假定现有 tracing 已自动贯通全部三跳。

## 建议下一次失败时的最短决策

保留 formal 原失败与同请求分层证据 → 看 API 主数据 route 是否 503 → 若不是，查 gateway/Next 明确阶段 → 若是，看近 SQL 是否失败 → SQL 成功则定位 repo/projection/schema 固定拒绝点。仅在有捕获依据后写针对性 RED 和修复。现阶段不支持放松 proof、rights、隔离级别、内容 audit 或性能采样标准。

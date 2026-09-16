# TEST 读取诊断只读评审

结论：现有仪器适合先复现并粗分 LOAD / WORK / TX / 网关失败，但**不足以保证把每个前台错误页准确归属到相同请求，更不能把“API/网关未记录失败”推导为SSR错误已定位**。以下是诊断覆盖限制，不是已确认的产品根因。本次未改源、启动fixture/Chrome/build或重跑测试。

## 优先补齐的最小项

1. **保留少量逐次成功事件及真正的关联ID。** `storefront-acceptance-diagnostics.mjs:287–309` 成功只累计counts，逐次operationId/时刻不落盘；321–325事务自行编号，402–404网关又分配另一个ID。并发SSR、SEO和目录读时，单凭邻近时间不能确定是哪次请求成功或失败，也无法证明某个TX_THROW之前WORK_RETURN成功。建议增加独立有界 `recentEvents` 环形（固定上限、drop计数），保留安全成功/失败字段、开始/结束时间和duration；原failures仍独立保留。事务入口用现成 `@fan-support/observability/node.currentRequestContext()` 取合法requestId，缺失时明确无关联，不能生成假对应。gateway只读实际upstream响应的既有 `x-request-id`（由Fastify产生），校验UUID后记录，连接API logger。无需添加或修改请求头。

2. **观测gateway请求是否已经失去下游，而非把upstream200等同于SSR收到。** `public-catalog.ts:110–132` 的SSR fetch为8秒，`gift-storefront-next.mjs:35–47` 对API fetch为30秒，且gateway事件只在读取完整body并调用response.end后记录。SSR可能已超时/断开，而gateway后来正常200；当前会留下成功计数且无失败记录。应在request入口捕获开始时间、phase、request序号；监听自身response的finish/close，仅记录 `downstreamFinished` / `closedBeforeFinish` / elapsed枚举或数值，保持原fetch、abort预算、body与响应行为不变。正常close也会发生，不能把所有close都标失败。保留有界成功事件后，才能区分“上游成功但下游已取消”与普通成功。

3. **明确真实礼物/目录观察范围，补固定错误码。** 当前allowlist只有 `/api/v1/gifts/:handle`，实际礼物首屏 `gift-detail-page-reads.ts` → `public-commerce.ts` 使用 `/api/v1/gift-content/:handle` 与 `/api/v1/storefront-gifts/:handle`，并有 `/api/v1/storefront-context`；三者被 `routeFor()`直接忽略。runtime还只有publication composition的三个manager被包装，directory和publishedGiftCommerce是另一个未包装pool（runtime:108–110、153–163），storefrontCommerce manager也未包装。若本轮只追旧首页/艺人失败，可明确暂不扩；若声称包含礼物读取稳定性，应先加这三个准确的schema/route和对应manager。`publicCodes`还缺合同合法的 `INVALID_CURSOR`、`ANCHOR_NOT_FOUND`、`CATALOG_UNAVAILABLE`；这些目前schema VALID/outcome FAILURE却丢code（计为NONE）。从相关既有合同导出明确有限枚举即可，不能放开任意error.code。

## 已有诊断可以与不可以得出的结论

| 观测 | 可得结论 | 仍不能断言 |
| --- | --- | --- |
| 同一事务LOAD返回FAILURE | 失败已在持久层repository加载边界出现 | 是哪个SQL、head、receipt、media或内部投影判断失败 |
| LOAD成功，WORK返回FAILURE/抛错 | 用例回调/投影/合同匹配边界失败 | 具体投影规则；domain内部异常已统一转换 |
| WORK成功而TX抛错 | manager结束阶段失败 | 没有更细事件时，不能只凭TX_THROW称一定是COMMIT |
| gateway transportCode/JSON/schema拒绝 | 该观测到的网关阶段确实失败 | 不关联requestId则不能唯一对应某个SSR导航 |
| gateway/API均成功，DOM安全错误页 | 下游或不同请求仍需调查 | 不能直接确定是SSR合同/locale校验，也不能排除8秒fetch先取消 |

另有两种固有信息折叠：

- `storefront-homepage-repository.ts` 的load内部已包含首页projectPublishedContent及slot hydration，所以 `LOAD_RETURN FAILURE` 并不等价于“数据库报错”。旧首页/艺人共享publication读路径可以比较，但不要误标层次。
- `base-content-data.ts:32` / `published-content-repository.ts:225–236` 可把错误再次送入Postgres分类，既有canonical错误可能被折叠为UNEXPECTED_ADAPTER_FAILURE；helper只看转换后的错误无法还原SQLSTATE。如果真实复现落在这里，第二步才用已有TEST `createPostgresPersistenceWithPoolFactory`注入wrapper，在原query异常转换前记录**固定SQLSTATE白名单、QUERY/BEGIN/COMMIT/ROLLBACK枚举、合法requestId**并原样重抛。参考`management-center-diagnostics.mjs`，但禁止沿用或输出原SQL/message/parameters；无需先改生产分类。

当前schema VALID还不代表SSR最终接受：`public-catalog.ts:122–129` 另比HTTP状态与locale/fallback语义；`public-commerce.ts`另比handle/market/currency/recipient。gateway只做schema校验。若最小增强后仍出现“API及gateway成功且下游正常完成，但实际DOM错误”，再单独登记最小TEST-only Next端观测（真实SSR fetch接收/JSON/schema/status/locale判定阶段枚举）；仅在api/gateway已有证据后开展，不先改生产catch或假定一个global fetch hook必定覆盖Next patched fetch。

## 建议本轮执行顺序

1. 先为上述1/2和合同错误码补最小default-off helper测试：并发两请求不串ID、迟到事件留原phase、8秒下游取消而晚到上游200、正常finish不报断开、成功环形有界、所有canary/getter均不出日志；保持原14个测试和原字节/异常身份断言。未获实现授权前仅保留此建议。
2. 同一新fixture使用 `FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS=1`，保留protocol预期失败阶段；完整UI后新phase，再按固定清单执行首页/艺人公开API→gateway→实际SSR导航。必要时另做固定并发序列；不在失败上自动retry，不偷偷绕过UI mutation或重建数据库。
3. 每次探测记录运行内probe序号、固定locale/目标枚举、开始/结束时刻、HTTP状态、准确DOM content/error/loading布尔；不持久化响应body、原URL、token、cookie、私密内容。首次失败立即落证据并停止该批，保留先前成功窗口。
4. 先按真正requestId/阶段进行归因；没有关联证据则写“UNKNOWN”，不把后续健康读取当根因已修复。按需要复现旧44–57分钟存活及UI请求/暂停历史，但年龄本身不是根因结论。

诊断增加schema和同步文件开销，只用于定位；正式性能采样须默认关闭。beginPhase归档、gateway/事务开始阶段捕获、API的COMPLETION_ONLY标识、原异常/响应不变约束仍应保留。若 `observationErrors`、`writeFailed`、drop计数非零，先注明证据缺口，不声称完整观测。


## 后续范围收敛与 Next 观察接法（未实施）

父任务将本轮目标限定旧home/artist错误，故不扩礼物观察范围。最小Next→gateway探针优先使用Node自带 `node:diagnostics_channel`，由独立TEST `--import` 模块订阅实际 `undici:request:create` / `undici:request:headers` / `undici:request:trailers` / `undici:request:error`，用WeakMap保存同一个request对象的本地序号与起止时间。当前Node24.20内置undici源码确有这些channel；仍需真实子进程fetch测试验证Next采用的fetch路径被捕获，不能仅以模块可加载当覆盖证明。

通过现有 `gift-storefront-next.mjs` start子进程的 `NODE_OPTIONS` 追加观察模块，build子进程不注入；显式TEST开关与固定已拥有的gateway origin双重过滤，仅主页和艺人公开GET。记录固定阶段/route枚举、合法locale、HTTPstatus、同一安全transportCode白名单、elapsed、原API requestId（仅合法UUID）；永不写origin原值、path/query、headers/body、stack/message或私密凭据。不替换global fetch、不clone/消费Response body、不改变AbortSignal/headers/retry。headers成功后仍应等待trailers/error，因为取response body也会失败。此探针可捕获SSR真实网络错误和8秒abort，不能声称看到了应用的schema/locale判断；若网络完成仍错误，再考虑更内层的独立受保护观测。

已独立发现并获授权修复的网关逐跳头问题另见 `gateway-headers-result.json`：旧header实际宣称72秒，原默认socket实际约6003ms关闭；41次自然边界fetch无失败，因此只确认协议缺陷，未认定它是旧两次错误根因。新增真实HTTP测试先RED（2失败/1通过），最小响应头过滤后与原诊断共17测试GREEN；未加retry或延长任何超时。

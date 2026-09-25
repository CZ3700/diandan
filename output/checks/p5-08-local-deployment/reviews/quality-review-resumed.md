# P5-08 本地入口恢复质量复核

当前状态：`ACCEPT_LOCAL_SCOPE`（最终结论见文末）。以下保留按时间记录的审查、失败与修正过程；早期 OPEN 状态已被最终 fresh 验收关闭。本报告不批准云部署或 P5-08 整体 DONE。

审查者：Codex `/root/p508_quality_finish`。依据当前 P5-08 计划、本地完整体验 readiness、前次 `reviews/spec-review.md`、项目规范与技能规则。完整读取本轮 `scripts/local-experience*.mjs`、`scripts/verify-local-experience.mjs`，并针对所依赖的 supervisor、lifecycle、control、PostgreSQL、S3、TLS、web 启动器与浏览器报告边界进行检查。

## 作者范围与独立性

起初为只读审查。发现下述陈旧锁并发缺陷后，root 明确授权仅修改 `scripts/local-experience-lock.mjs` 与对应 `.test.mjs`；因此这两个文件**不由本报告获得非作者批准**。root 已另行逐行审阅选择阶段/排序/回收/释放协议，且将自行执行测试。其余启动、状态、reset、stop、验收和浏览器启动器均非本审查者作者范围。

没有启停、reset、修改 `test-p508` 或其他真实持久实例，没有执行云 API、apply、真实支付或邮件。新增锁测试只操作唯一临时目录和自己创建的子进程；测试后清理。

## 已确认缺陷与修复

### P1：并发回收陈旧 checkout 锁可能让两个调用者同时取得所有权

旧代码在读取旧记录、确认死 PID 后，执行 compare → rm → 重新 wx 写入。A/B 两个回收者均可比较成功，然后 A 删除旧锁并创建新锁，B 再删除 A 的新锁并创建自己的锁。结果是两个启动器或启动/reset 同时越过 checkout 排他保护。

实际 RED 证据：

- 独立临时目录初次探测：85 轮内 `bothAcquired=1, releaseConflicts=1`。
- 新回归 `concurrent stale-lock recovery never gives two callers checkout ownership`：旧代码第 118 轮产生 `2 !== 1`。
- 确定性选择阶段 barrier：先放置 live choosing 记录，再启动两个竞争者；旧代码二者均在 barrier 释放前完成，`2 !== 0`。这不是仅靠随机压力判断。

修复协议：每次短临界区申请使用不可重用 UUID claim，先原子发布 `ticket:null` 的 choosing 状态，再读取最大 ticket、原子发布号码。其他申请先等存活 choosing 结束，再按 `(ticket, UUID)` 顺序进入；主 `workspace.lock` 的创建、陈旧回收和释放都处于同一仲裁。退出/崩溃进程的唯一 claim 可以凭死 PID 删除，因为该路径永不分配给另一个新 owner；不会将原有共享路径的 compare/unlink 竞态转移到另一层共享 gate。权限为目录0700/记录0600，无新依赖、端口或后台服务。

GREEN：锁文件专项 **5/5 PASS**，包括 128 轮×8 同进程竞争、确定性选择 barrier、8 个独立 Node 进程在同一 barrier 后竞争且恰好一个成功，以及实际退出进程留下的 choosing 记录恢复。存活旧 owner 仍拒绝第二实例。不能靠 force 删除锁或误判运行进程来恢复。

## 其他复核结果

- **首次未 build checkout**：普通 `local:start` 在加载依赖 workspace `dist` exports 的状态/config 模块前先构建 API/Worker 及两前端依赖；顶层 browser launcher 仅依赖 Node 内置模块。`--skip-build` 由已构建的验收入口使用。`verify:local-experience` 的顶层 PostgreSQL helper 不依赖 workspace dist，入口构建完成后才动态加载状态与浏览器。此处是导入顺序静态复核，未删除现有 dist 冒险伪造干净 checkout。
- **停止结果**：控制端口不可达不足以宣布停止成功。CLI 验证同 instance/run 的成功清理记录；supervisor 先写结果再关闭控制服务，仅零清理失败才删实例锁。正在启动时停止会等待资源归属确定并逆序关闭。
- **reset 与旧数据**：完整 instanceId 确认、同 checkout 排他归属、实例锁/postmaster 检查、精确已停止容器及 bind mount 校验后才删除目标实例。存储删除失败保留实例目录；没有强制移除运行容器。原数据保护回归在本次组合单测中继续通过。
- **用户 local:open**：邮件地址改为 `/#token=...`，与真实收件箱片段解析一致。无 token query；只给本实例 SPKI 豁免，保留精确域名到127.0.0.1映射；不改系统 hosts/CA，也不关闭全局 TLS。headless 验收和用户浏览器使用相同证书/域名策略，用户额外使用专属持久 profile。正确 fragment 已有独立 unit；用户有界浏览器交互仍应随最终完整验收核对。
- **局部报告**：此前模糊 PASS 已修。浏览器报告显式 FULL/RESTART/COMMERCE/POSTER/OPERATIONS 等 mode；仅 FULL/RESTART 可写 PASS，其余为 PARTIAL_PASS。完整和重启要求本实例 artist/gift/poster、已退款订单、已取消订单、最终支付配置 facts，旧缺字段 facts 不再可冒充完整复验。统一 wrapper 固定执行完整路径后重启读回。
- **完整验收仍缺**：截至本报告查看的最新安全浏览器结果，存在 OPERATIONS/PARTIAL_PASS 与 GUEST_CHECKOUT/FAIL；尚未见完整 FULL/PASS 加同实例 RESTART/PASS。健康检查、局部成功、源码存在与测试工具不能替代统一上传→购物→签名入账→安全邮件查单→审核/送达/退款、取消、配置审核/回退及真实重启比对。

## IaC 证据及云端边界

独立读取 `iac/final-verification.md` 与 `iac/offline-results.json`，并重新计算当前 21 个输入 SHA256，**全部匹配、0差异**。报告记录14条固定命令全部 exit0，包括三根 backend-disabled init/validate 与显式 mock test，状态 PASS 且 `cloudEvidence=false`。本次审查没有重新执行 OpenTofu，也不把前次真实本地工具结果说成本次云调用。

README、manifest 和 `docs/runbooks/infrastructure-offline.md` 明确生产业务 composition 尚未验收；不能把 LOCAL_OIDC、TEST PSP/通知和健康容器冒充正式服务。实际 staging plan/apply/smoke/re-apply、真实 IAM/KMS/存储/CDN/WAF/预算/配额、批准身份/商户/邮件、恢复与发布门均保留。P5-08 应继续 IN_PROGRESS；Phase 6/7 激活仍按 ADR-016 逐项核验。

## 本次实际验证

- `mise exec node@24.20.0 -- node --test scripts/local-experience*.test.mjs apps/api/scripts/local-experience*.test.mjs`：**53 tests /53 pass /0 fail**，退出0；含独立 HTTP/TLS/OIDC 和临时目录/进程测试，没有操作持久业务实例。
- `mise exec node@24.20.0 -- corepack pnpm exec prettier --check scripts/local-experience-lock.mjs scripts/local-experience-lock.test.mjs`：通过。
- `mise exec node@24.20.0 -- corepack pnpm exec eslint scripts/local-experience-lock.mjs scripts/local-experience-lock.test.mjs --max-warnings=0`：通过。
- 当前 IaC 输入与已执行 offline report 的 SHA256：21/21 匹配，命令非零数0，cloudEvidence=false。

全仓 format/lint/typecheck/build、用户旧文件逐字节保护与最终真实浏览器/重启证据由 root 汇总。该报告的当前结论是：已发现的新增并发归属缺陷已按测试先行修复并提交 root 非作者复核；其余所审入口没有新增确定阻断，**完整交付仍等待端到端验收，不能标 ACCEPT。**

## 复核快照

记录 UTC：2026-09-23T08:15:51.723048+00:00。以下仅为所审 root 脚本的源文件散列，不包含任何实例密钥、业务数据或个人信息。

| 文件 | SHA256 |
| --- | --- |
| `scripts/local-experience-acceptance.mjs` | `1ab004676bc508d7887aba163e62c8bd2403da8c4ce8a166517345a2bcc241e9` |
| `scripts/local-experience-acceptance.test.mjs` | `99d3517b33ef951ebea49f274706cc5bbf0247c727e72a8e56a65c0304c0d68a` |
| `scripts/local-experience-browser-launcher.mjs` | `6c040c507d6063fc0e7362ea09af166e27ce83f349e2cdba8353d3289227a7c9` |
| `scripts/local-experience-browser-launcher.test.mjs` | `71c2deb36562ca281523c8adcc11192f9722adff59faaa6772ac676a0692e2d2` |
| `scripts/local-experience-lock.mjs` | `1b92966c101c75dc66a8b255e051463d483c6a3c515796d405bab5fbf95957c1` |
| `scripts/local-experience-lock.test.mjs` | `0754b6d5692f840f95f9c464aa5f70e9e9f6fe1e13aba063a580adf5bc1af6a4` |
| `scripts/local-experience-reset.mjs` | `aeaabee6d78a153313890c14c8cb513cef8c6213f8aa73c3f08c11ddbecb9490` |
| `scripts/local-experience-reset.test.mjs` | `77e14299706c23dfef1d17995d43c716e4f13c0d5a6a222141fd84bb44254b6f` |
| `scripts/local-experience-state.mjs` | `1c3c930bb06096275831818a02d7517c57a0c930b4b136b642706f168e061ec0` |
| `scripts/local-experience-state.test.mjs` | `107f595a98f82a9d9a0f0a95fbb53003d410672edb16fd544a7b8b172dd8b400` |
| `scripts/local-experience-stop-result.mjs` | `724f76aa8ad914afb66a70f4e9912eca4b8b53bc2db4cde152d47279c092040b` |
| `scripts/local-experience-stop-result.test.mjs` | `c6e3e9e5f1b81028403cb7f2b266c9096503d6dc9472b4247a1e3bb7525365a2` |
| `scripts/local-experience.mjs` | `43af871cc3b588cdb36c9cf3cf66cf95b8834819b2814b88a9772160e33cb729` |
| `scripts/verify-local-experience.mjs` | `46aae75309c077d884b7ebb1760d7fabcdbf99665b40b71dbf0ccbc615d56ae5` |

## 追加：PSP 回跳等待可信证据的小修非作者复核

记录 UTC：2026-09-23T08:21:08.178182+00:00。本次仅阅读和比较 `checkout-client.tsx`、`payment-polling.ts`、`payment-polling.test.ts` 三文件；未实施代码、未改其他业务路径。

**结论：未发现新增缺陷，当前源代码与专项单测可接受；真实回跳 fixture 仍须纳入完整浏览器验收。**

- 原条件只轮询 CREATED/PROCESSING/UNKNOWN 或 EVIDENCE_PENDING。托管 PSP 已结束，但签名入账尚未到达时，实际首个只读返回仍可能为 REQUIRES_ACTION；单靠这个返回不轮询会使页面停留。新条件仅在 `!invalid && sessionId && attemptId` 的有效回跳上下文中将 REQUIRES_ACTION 纳入查询，其余路径不变。
- 新函数只返回是否查询，不赋值 SUCCEEDED/PAID。effect 仍仅把 `controller.refresh` 交给原只读轮询器，未调用 `start`、`confirm` 或 `continuePayment`，没有新增 payment command 或根据浏览器回跳创造成功状态。
- uncertain/null 仍不轮询；SUCCEEDED/FAILED/CANCELED/EXPIRED 且 recovery=NONE 停止；EVIDENCE_PENDING 恢复不被终态文案误挡。依赖项仍由 attempt identity、shouldPoll 和 WAIT interval 决定，状态变为不再需要查询时 React 清理原计时器。
- 轮询生命周期实现无改动：最多12次、延迟受限、逐次等只读请求完成、隐藏暂停、pagehide/cleanup 停止；不是循环重发付款。现有两个生命周期用例继续覆盖不重叠、隐藏和立即 pagehide 清理。
- 新的两个谓词用例覆盖回跳/非回跳差异、uncertain/null、四种终态和已成功但证据待确认情况。独立执行 `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/storefront exec vitest run src/storefront/payment-polling.test.ts`：**1 file /4 tests PASS**，退出0。

页面级补充证据应来自真实 fixture：回跳首读明确得到 REQUIRES_ACTION；延迟可信签名事件入账后，不点击刷新即自动变为 PAID/订单结果；期间 create/confirm/start 命令计数不增加、payment attempt保持同一个；普通非回跳页仍不因该状态新增轮询。单测不能单独证明 React locator 接线、真实网络和可信入账整条路径；这也是本报告仍不宣布完整本地 ACCEPT 的原因。

| 本次三文件 | SHA256 |
| --- | --- |
| `apps/storefront/src/storefront/checkout-client.tsx` | `f56a66b0cd599ee2a2a60bc076b8c7ffb922138cf02c8a99dbb5b2cc07871525` |
| `apps/storefront/src/storefront/payment-polling.ts` | `e1b8de10cc8ba0ce178f7dea8513a7aff708ac8dff860eb4732273cbfd967f82` |
| `apps/storefront/src/storefront/payment-polling.test.ts` | `ee50154ca850a66c0ff07a96b266063b9966b630427e95037ea26fc102a1f95e` |

## 追加：完整验收拒绝局部结果、可信 webhook 与六文件浏览器入口复核

记录 UTC：2026-09-23T08:29:19.594994+00:00。范围为 root 的 `local-experience-acceptance.mjs` 与测试、runtime/Worker telemetry 装配与 shutdown、webhook 实际证据，以及六个 `local-experience-browser*.mjs` 文件。状态：**SOURCE_REVIEWED，最终统一 FULL/RESTART 报告待提交；非最终 ACCEPT**。本次未改实施源码，未启停实例。

### 独立确认

- **局部结果 fail closed**：`requireCompleteBrowser` 拒绝非 PASS 或缺 factsPath；两次调用（首次完整流程和重启读回）都经过检查。任一返回 PARTIAL_PASS 都进入 stop 保留数据，不 reset，不返回统一 PASS。独立执行 `mise exec node@24.20.0 -- node --test scripts/local-experience-acceptance.test.mjs`，**7/7 PASS**，退出0；含首轮/重启各一条 PARTIAL_PASS 回归。具体浏览器实现只有 FULL/RESTART 能返回 PASS。
- **telemetry 初始化和清理**：API/Worker 验证本地配置后、创建任何业务 composition 前调用仓库 `startNodeTelemetry`；立即作为最早资源登记 own。逆序清理先停止 API/独立 Worker、业务循环、队列与连接，再清 TEST KMS，最后 shutdown telemetry。Worker在独立进程创建自己的 provider，不混用API service identity。仓库底层是显式 NodeTracerProvider/context，spanProcessors=[]，没有因本地启动新增 exporter 或云遥测调用；不存在要求早于HTTP模块导入的自动instrumentation。
- **不放宽 webhook 门**：修正给原请求 hook 提供有效 trace/span，未生成伪 propagation，也未降低验签、endpoint、TEST、KMS/inbox/幂等检查。集成脚本只接受明确的已捕获 TEST attempt，provider命令 transport 被拒绝，再签现有 event 经真实 HTTP 两次投递。
- **实际 webhook 证据**：读取 `runtime/webhook-acceptance.md`、`runtime/webhook-http.txt` 并逐项对应脚本。日志是两次202与canonical request trace；最终报告6断言 PASS、realPostgres/realHttp=true、单inbox、newCaptures=0、duplicateLedgerTransactions=0。当前审查未再次运行脚本；记录证明接收及幂等范围，不代替最终长驻Worker整条业务验收。
- **浏览器真实交易路径**：新水合检测只操作可逆匿名/具名选择，待 React 条件字段可见后再填写私密表单；没有绕过真实提交。支付 observer仅保存canonical订单/attempt标识和状态，不保存请求体、token或授权URL；首轮实际支付断言整个journey只有一次 create POST，回跳读取保持同checkout/attempt，没有人工点击refresh来伪造自动恢复。
- **FULL/RESTART 完整性**：完整facts强制艺人/礼物/海报标识、三个当前publication/media快照SHA、准确退款snapshot、取消结果、最终支付配置head、单次支付创建及自动回跳read证据。RESTART通过真实manager UI重新读取退款identity/currency/金额、当前内容与图片引用、取消与配置head并精确比较；私有配置/证书/key/媒体字节的重启比较由统一wrapper负责。诊断refunded-order读回、已有付款订单、仅交易/海报/配置模式都有显式mode且只PARTIAL_PASS。
- **准备/送达/退款/配置审核**：均通过现有UI控制和canonical响应合同，退款helper只点refresh读取受信最终结果并比较全额原捕获金额；取消通过新游客checkout后管理取消；支付配置使用第二个独立OIDC identity，检查本人不能审本人译文，实际七语复核、两次发布与回退。

### 最终证据仍需核对

真实fresh FULL应展示首次返回状态、自动到PAID、同attempt且仅一次create；若首次直接SUCCEEDED，则可证明正常回跳成功，但不能单独宣称强制延迟REQUIRES_ACTION场景已覆盖。此前谓词/生命周期单测独立有效。完整seven-locale/双视口、上传、业务流、stop/start保留字节与RESTART报告必须最终全过；原诊断17assertions退款读回保持PARTIAL性质。

已通知root一个证据范围缺口：main admin/customer及reviewer有安全pageerror监听，但临时mailbox和cancel context page目前未登记，末尾“No browser application errors”实际未覆盖那两页。最终应统一登记这些页，或明确报告的观测范围，不能据此声称全部页面0错误。此为测试证据口径问题，没有据此断言已发生业务页面错误。

以下是本次读取源码快照；后续改动需按差异复核。

| 文件 | SHA256 |
| --- | --- |
| `scripts/local-experience-acceptance.mjs` | `0935d902212f89118fddf0db11a3945c8826018efb0daf19cfcc9e11bb9276a7` |
| `scripts/local-experience-acceptance.test.mjs` | `d095b500d3cee86da1b993e99b71ec7f04388a15cd1fc6dad02bb53625475928` |
| `apps/api/scripts/local-experience-runtime.mjs` | `8b8a0e5fb225d887bcf3cdd5c15528ef8d85c9933b2e46df3ba81a187c4c552a` |
| `apps/api/scripts/local-experience-worker.mjs` | `d9f8a5756d0362a8cea9c0471f8c4fa959a1cbaa8a8d12f0879477622d35be72` |
| `apps/api/scripts/local-experience-worker-process.mjs` | `9a49892c83f59b9d441d3edc20b7fcdf64da7163cd3e61fd7c0f44d9433b7e13` |
| `apps/api/scripts/local-experience-runtime-webhook-integration.mjs` | `c6863644fb595ffc9919d5a6928bb5fc0bc9eff693c2af08f37368be3aae6c9b` |
| `apps/api/scripts/local-experience-browser-cancel.mjs` | `11d368e2badef000d7162306475abe62cfdb0ce34a00057bf8ae3e585ce0726f` |
| `apps/api/scripts/local-experience-browser-checkout.mjs` | `e8593368c0bb3c8b28ed623fe211be6d79a85fcb1731f41e0b50cf2ec70bbe1c` |
| `apps/api/scripts/local-experience-browser-operations.mjs` | `11e1a459325a77f618ba71ea31b9cb0ea9ed11d707db4c08a177edc4c764f025` |
| `apps/api/scripts/local-experience-browser-payment-observer.mjs` | `fc8d3ce9df2409b6a1d876587492c8c077543083de9e3cebc2d681413955f86f` |
| `apps/api/scripts/local-experience-browser-refund.mjs` | `9b25f360bd1b5460b0e875e8b607dd3c193e6349480e1704693feefb85d49409` |
| `apps/api/scripts/local-experience-browser.mjs` | `2722a51ce7c1a9b7db0019649b455c50489edb390b75738ccd889521bd494708` |

## 追加：真实页面就绪、第二单返回列表与全 context 错误观察

记录 UTC：2026-09-23T08:37:06.604674+00:00。本次只读复核上述两脚本的最新增量，没有修改实施源码或操作任何实例。结论仍为 **SOURCE_REVIEWED，待 fresh FULL/RESTART 实际结果**；未发现需要中断正在进行验收的功能或安全阻断。

- **截图就绪防止空集合假通过**：首页在截图前必须取得非空可见 hero 标题、可见 hero 图及正确已上传艺人 handle 的链接，预期 artistId 的目录卡片图片与 `data-loading=false`，并拒绝状态壳、图片 fallback、busy 主内容。礼物页必须包含预期 giftId 和 recipient artistId、真实购买入口、市场/币种控件、完整 policyKind 合同数量的政策链接，且无待加载上下文。随后每个必需图片 selector 必须匹配至少一个图并全部 complete/naturalWidth>0；原先只有“遍历当前所有img”的零集合成功路径不再足以通过。
- **真实图片和报告事实接线**：新增检查使用本次发布的 facts 身份，不靠任意文字或通用占位图。RESTART 分支在执行 gift/homepage截图之前已把 validated facts 设置到report，能执行同样身份检查；不会因新增截图检查而错误缺少其预期对象。
- **连续订单操作**：`selectOrder` 打开订单工作区后检查并点击实际 `data-orders-back`，回到列表再等待搜索输入与空闲状态，按完整publicOrderId选择唯一行。第二个未付款订单取消和重启时切换到已取消订单均复用该路径；没有改后台状态或绕过界面动作。
- **全 owned context 的 pageerror 覆盖已闭合**：统一observeContext在创建任何page之前注册。admin/customer/reviewer/cancellation四个context全部接入；mailbox属于customer context，因此新开的收件箱与安全查单页面也被覆盖。仅记录surface/stage/PAGE_ERROR，不输出可能包含个人信息的原错误。此前报告的“两页未监听”缺口已由这次源码修正关闭，最终零错误仍须以新运行报告为据。

实际执行 `mise exec node@24.20.0 -- node --check apps/api/scripts/local-experience-browser.mjs` 与对应 `local-experience-browser-cancel.mjs`：均退出0。没有把syntax检查当浏览器通过，也未复用上一轮422断言失败报告声称完整验收。root已保留上一轮失败与恢复历史，将继续 fresh wrapper 后再作最终证据复核。

| 本次两文件 | SHA256 |
| --- | --- |
| `apps/api/scripts/local-experience-browser.mjs` | `7acb03a556f3c6388c0dc105d6115998c4aad44526ea226161617ed03f5fd15c` |
| `apps/api/scripts/local-experience-browser-cancel.mjs` | `1c1bada91550991b3114af7c64ec069dce8ebd4eec085a900910c482da368cb2` |

## 追加：订单列表请求同步及 FINAL_OPERATIONS 诊断

记录 UTC：2026-09-23T08:50:25.621189+00:00。只读复核最新 browser 主入口、cancel helper 与定向实际报告，没有改源码或操作运行实例。

`selectOrder` 内 `listAfter` 在点击前注册 orders-list POST 响应等待，通过 canonical `adminOrdersResponseSchema` 验证HTTP200/SUCCESS/LIST，读取该请求的实际query。应用搜索时必须等于目标publicOrderId，且返回items确实包含该目标；列表响应与aria-busy=false完成后才填下一次查询/选择行。详情返回列表和管理区切换都等待真实列表读回，解决尚未结束的返回请求覆盖后续输入造成的验收竞态；不绕过实际UI。

读取 `output/playwright/p5-08-local-experience/acceptance-90a4fd436ea943abbdb9-1790153276500/report.json`：**FINAL_OPERATIONS / PARTIAL_PASS /215 assertions**，pageErrors=[]、observations=[]；4条orders-list均成功，旧已付款单与新的未付取消单均有精确query，后者确在对应canonical列表结果中。最终facts的canceledOrder=CANCELED，含ARTISTS/GIFTS/POSTERS快照与generation4的支付配置head，cases记录独立七语审核、两次发布与回退。

局部报告口径正确：`cancelOrder` 显式选择 FINAL_OPERATIONS；该路径可以补齐complete facts，但最终只对FULL/RESTART返回PASS，因此仍为PARTIAL_PASS。统一wrapper的完整性门会拒绝直接拿该报告当首轮完整验收。后续使用这些facts的RESTART最多证明真实重启后的读回，不会补造之前失败的fresh FULL；原失败报告需保留，仍须新的统一fresh链路通过。

实际执行两个脚本 `node --check` 均退出0。当前无新增确定阻断；整体验收继续等待最终fresh FULL+RESTART和wrapper成功报告。

| 本次源码 | SHA256 |
| --- | --- |
| `apps/api/scripts/local-experience-browser.mjs` | `e37e04b4d105e147830ef5d607ca46fae086f8d525fdf31ba0ad7858750f8250` |
| `apps/api/scripts/local-experience-browser-cancel.mjs` | `7cc51532a4b288f47f0c38de1055b3e778c9f2b018954733217bf6ca96b4c3b9` |

## 追加：原交易上下文保留与只读补证

记录 UTC：2026-09-23T08:54:13.316389+00:00。只读复核最新commerceContext/CONTEXT_READBACK增量，未改代码/启停环境。

FULL从canonical管理GIFTS LIST按精确giftId读取price，保存 `commerceContext={schemaVersion:1,market,currency}`；字段用contracts的marketSchema/currencySchema验证，完整facts强制存在。RESTART沿原market/currency加idol构造gift URL，与locale独立，没有修改生产的上下文规则、默认币种或fallback。管理读回helper通过真实管理UI和分页寻找精确giftId，使用原response observer的canonical验证结果，不直接读数据库或手工填写币种。

CONTEXT_READBACK明确仅用于同实例的旧facts补证：要求contentFacts和instanceId匹配，读取正确礼物的实际price，再在本次输出保存更新facts；其mode优先为CONTEXT_READBACK，最终只PARTIAL_PASS。不会把补字段步骤包装为新一次完整上传/交易。

独立读取实际报告：

- `acceptance-90a4fd436ea943abbdb9-1790153516003/report.json`：CONTEXT_READBACK/PARTIAL_PASS，31断言，commerceContext为真实local TEST GLOBAL/USD，0 pageErrors/observations。
- `acceptance-90a4fd436ea943abbdb9-1790153536311/report.json`：RESTART/PASS，109断言，保留同commerceContext，0 pageErrors/observations。

报告位于 `output/playwright/p5-08-local-experience/`。定向RESTART证明该旧实例的读回已过；不能补造此前失败的FULL，也不能替代新的统一fresh wrapper。源码 `node --check` 退出0。当前范围未发现阻断，最终ACCEPT和S.U.P.E.R组合结论仍等待最后fresh证据。

当前 `apps/api/scripts/local-experience-browser.mjs` SHA256：`df5446e5afe1c0556a7e0fa80e8688e2521d10c73520b297efd1fde31310278c`。

## 最终非作者复核：ACCEPT_LOCAL_SCOPE

记录 UTC：2026-09-23T08:58:44.532054+00:00。

**接受本轮已审的 P5-08 持久本地体验与离线基础设施证据范围。此前完整端到端与重启欠项已由下面这次全新统一验收关闭。** 这不是 P5-08 整体 DONE，不是云部署/生产发布批准；Phase6/7不因此自动解锁。

### 独立核对的最终证据

权威wrapper：`output/checks/p5-08-local-deployment/acceptance/acceptance-e143d720dd1a4357a3c3/report.json`。审查者实际读取其9条子命令与对应安全记录，全部code0/signal=null；统一status与acceptance.status均PASS，retained=true，最终正常stop保留数据。

1. FULL：`output/playwright/p5-08-local-experience/acceptance-e143d720dd1a4357a3c3-1790153667799/report.json`，NEW_BROWSER_UPLOADS，799断言、18cases、52PNG与52axe。全部七语言×390/1440内容矩阵、实际上传艺人/礼物/海报、游客支付、邮件安全查单、留言审核、准备/送达、全额退款、另一未付单取消、双人七语配置审核/两次发布/回退均走完整路径。axe violations/incomplete均0；所有owned context的pageErrors和observations均空。
2. RESTART：`output/playwright/p5-08-local-experience/acceptance-e143d720dd1a4357a3c3-1790153747494/report.json`，109断言、1case、3PNG与3axe，violations/incomplete/pageErrors/observations均0。源码中的wrapper在重启前后逐文件比较持久config、TLS/OIDC keys与media字节指纹；任何差异会抛错并阻止此PASS。实际UI随后比对refund、取消、三类内容/media及配置head。
3. 独立读取两方facts并比较：完全一致，同instanceId、artist/gift/poster、market/currency、refund identity/金额、取消单与payment configuration publication/hash保留。退款原捕获与已退均2400 minor USD，SUCCEEDED；另单CANCELED。所有55张PNG路径实际存在。
4. 特别核对支付小修：FULL paymentReads首次回跳实际REQUIRES_ACTION，随后同checkout/attempt自动读取SUCCEEDED；整个journey恰好1次payment-create POST。脚本没有手动刷新付款状态。这关闭此前“只读谓词单测不足以证明真实延迟回跳”的证据欠项，且不靠浏览器回跳创建支付成功。
5. 统一入口最新57/57单测通过，包含本报告发现的锁回收5项；实际PostgreSQL中断首次初始化/重启4断言、服务TLS/PG重启（仅TEST capture/refund、加密mail、2签名事件恢复）、业务bootstrap26断言也全部通过。锁协议两文件由本审查者作者实施，最终非作者源码审查由root完成；本报告不对自身实现冒领独立批准。
6. `root/check-dev-accepted.txt`实际显示format/lint、64/64 typecheck tasks、64/64 test tasks、36/36 build tasks成功；其中缓存分别63/63/35，未声称全部重跑或远程CI。contracts与adapter边界记录通过。root/protection.json记录2587旧源仅package.json及已审3个storefront TS发生允许变更，5993初始untracked零变化、零未知源变更；root仍负责最终精确暂存和秘密/工件门收尾。

审查者另目视最终中文390首页和英文1440礼物页：均显示真实艺人/礼物、正文与购买界面，不再是loading壳；图片加载且没有截图中的私密留言/邮箱输入。原图采用真实上传的TEST图片和测试文案，不作为正式品牌、译审或实体手机验收。

### S.U.P.E.R 最终检查（本地已审范围）

| # | 项目 | 结论与依据 |
| --- | --- | --- |
| 1 | 模块单一职责 | PASS：状态、归属、stop/reset、服务、runtime/Worker、媒体、浏览器验收分别成模块。 |
| 2 | 函数职责集中 | PASS：主入口组合步骤，状态/归属判定、查询观察、页面动作及快照验证独立；没有把交易规则复制进CLI。 |
| 3 | 单向依赖 | PASS：外围本地composition复用应用/port/adapter；生产三TS小修只改变只读查询条件。 |
| 4 | 无循环依赖 | PASS：最终workspace gate确认4 apps/32 packages/36 units无依赖环。 |
| 5 | 标准合同 | PASS：持久配置、业务bootstrap、管理/支付/财务响应使用现有schema；market/currency/locale沿canonical合同。 |
| 6 | 可序列化I/O | PASS：私有配置/IPC和安全facts均为结构化值；句柄仅用于同进程lifecycle，不进入业务/持久合同。 |
| 7 | 环境与配置分离 | PASS：端口、密钥、身份按隔离实例固定；明确LOCAL_TEST例外不成为生产默认；真实商户/身份/cloud配置门保留。 |
| 8 | 依赖显式 | PASS：复用仓库已有包；离线OpenTofu/provider版本及checksum/lock固定；锁修复无新增依赖。 |
| 9 | 可替换边界 | PASS：本地OIDC/PSP/mail/KMS/S3通过既有合同装配，保持业务层不依赖本地实现；AWS模块证据保持独立云边界。 |
| 10 | 受影响及统一验证 | PASS：最终fresh FULL+RESTART、57单测、实际PG/TLS恢复及check:dev通过；失败历史与局部报告保留且未冒用。 |

### 保留边界

本地TEST不是PSP sandbox/真实资金，不代替正式OIDC/MFA/KMS、正式政策及译审、真实对象存储/CDN/WAF、云预算/配额、staging plan/apply/smoke/re-apply、PITR/恢复/灰度/生产发布。当前生产composition仍须按原门验证；P5-08维持IN_PROGRESS，Phase6/7逐项依赖核验和本地激活登记仍保持。没有推送、云执行或真实资金授权被本次ACCEPT隐含扩大。

以下记录最终验收入口/变更源码与证据的SHA256；不包含任何实例秘密字节或其散列。

| 文件 | SHA256 |
| --- | --- |
| `scripts/local-experience-acceptance.mjs` | `0935d902212f89118fddf0db11a3945c8826018efb0daf19cfcc9e11bb9276a7` |
| `scripts/verify-local-experience.mjs` | `46aae75309c077d884b7ebb1760d7fabcdbf99665b40b71dbf0ccbc615d56ae5` |
| `scripts/local-experience-lock.mjs` | `1b92966c101c75dc66a8b255e051463d483c6a3c515796d405bab5fbf95957c1` |
| `apps/api/scripts/local-experience-runtime.mjs` | `8b8a0e5fb225d887bcf3cdd5c15528ef8d85c9933b2e46df3ba81a187c4c552a` |
| `apps/api/scripts/local-experience-worker.mjs` | `d9f8a5756d0362a8cea9c0471f8c4fa959a1cbaa8a8d12f0879477622d35be72` |
| `apps/api/scripts/local-experience-browser-cancel.mjs` | `7cc51532a4b288f47f0c38de1055b3e778c9f2b018954733217bf6ca96b4c3b9` |
| `apps/api/scripts/local-experience-browser-checkout.mjs` | `e8593368c0bb3c8b28ed623fe211be6d79a85fcb1731f41e0b50cf2ec70bbe1c` |
| `apps/api/scripts/local-experience-browser-operations.mjs` | `11e1a459325a77f618ba71ea31b9cb0ea9ed11d707db4c08a177edc4c764f025` |
| `apps/api/scripts/local-experience-browser-payment-observer.mjs` | `fc8d3ce9df2409b6a1d876587492c8c077543083de9e3cebc2d681413955f86f` |
| `apps/api/scripts/local-experience-browser-refund.mjs` | `9b25f360bd1b5460b0e875e8b607dd3c193e6349480e1704693feefb85d49409` |
| `apps/api/scripts/local-experience-browser.mjs` | `df5446e5afe1c0556a7e0fa80e8688e2521d10c73520b297efd1fde31310278c` |
| `apps/storefront/src/storefront/checkout-client.tsx` | `f56a66b0cd599ee2a2a60bc076b8c7ffb922138cf02c8a99dbb5b2cc07871525` |
| `apps/storefront/src/storefront/payment-polling.ts` | `e1b8de10cc8ba0ce178f7dea8513a7aff708ac8dff860eb4732273cbfd967f82` |
| `apps/storefront/src/storefront/payment-polling.test.ts` | `ee50154ca850a66c0ff07a96b266063b9966b630427e95037ea26fc102a1f95e` |
| `output/checks/p5-08-local-deployment/acceptance/acceptance-e143d720dd1a4357a3c3/report.json` | `aeadd16f424bae95e2868843e4e4d8dabbaa438e4e85dbe11f47274e26857c9d` |
| `output/playwright/p5-08-local-experience/acceptance-e143d720dd1a4357a3c3-1790153667799/report.json` | `95d0b941101f2b233eb41b4b01542ffc40fc52315cb3dce09257bc25c34d58db` |
| `output/playwright/p5-08-local-experience/acceptance-e143d720dd1a4357a3c3-1790153747494/report.json` | `2bab9613554195298ac48056c8f189cf90c90126593a0347c460258e37fd8a38` |


## 收尾：文档一致性与开发模式控制台边界

记录 UTC：2026-09-23T09:10:52.251149+00:00。仅复核当前文档与既有证据，未改实施源码、未启停或操作实例。

当前 `docs/progress/MASTER.md`、`docs/progress/phase-5-operations-payments.md` 与 `docs/runbooks/local-experience-readiness.md` 一致：P5-08 有限本地范围 ACCEPT，原云/staging/生产装配门保留且任务整体 IN_PROGRESS；Lane D 已释放，Phase6/7 仍 LOCKED；31 DONE / 6 IN_PROGRESS / 0 READY / 12 PENDING = 49。`docs/runbooks/local-experience.md` 的已验收实例命令精确指向 `acceptance-e143d720dd1a4357a3c3`，说明后续命令须保留同一 instance、无参数为独立 default、单仓库互斥、stop 保留数据以及密钥/媒体备份边界。未发现文档阻断。

**0 pageerror 不表示 0 console error/warning，也不表示所有网络请求均成功。** 独立重读 accepted FULL 与 RESTART 的两个 `report.json`：各自 `consoleErrors` 都实际保存一条 admin 的 `Failed to load resource ... 401 (Unauthorized)`；各自网络记录的唯一401均为 `surface=admin, stage=LOGIN, path=/api/admin/session, state=response`，随后同会话接口返回200，OIDC登录及业务UI流程通过。报告还如实保存了导航期间的 `net::ERR_ABORTED` 记录。上述记录没有被删掉或称作零控制台/零网络错误；它们与最终 `pageErrors=[]`、`observations=[]` 的含义不同。

另读 `output/checks/p5-08-local-deployment/root/development-csp-note.md` 并独立核对私密页 `apps/storefront/src/proxy.ts` 及本地 Next 所用 React Flight development/production 文件：已接受订单截图的 Next 开发「1 Issue」经只读诊断定位为 development 中 `checkEvalAvailabilityOnceDev` 尝试 eval，被页面不含 unsafe-eval 的 CSP 拒绝，catch 后输出 `console.error`。这是本地开发调试堆栈探测的显示限制；没有因此放宽 CSP，也没有隐藏徽标。对应 production 文件没有该 helper/消息，但本轮**未运行 production 浏览器环境**，不能据此声称生产运行已验收。runbook 已向实际体验者说明该限制。

诊断边界按原件保留：首次有效邮件链接确实读回原订单；后续再次使用已消费的一次性链接未成功，单独记为不完整；最终无访问会话直接打开订单URL仅用于隔离 CSP，额外网络错误的HTTP状态未记录，因此不猜测其状态、不作为授权查单证据。该诊断汇总的 NEEDS_REVIEW 不能冒充另一份完整成功验收，也不改写原 FULL799 + RESTART109 的真实结果。

上述诚实限定已纳入本地范围结论：**ACCEPT_LOCAL_SCOPE 保持，S.U.P.E.R 1–10 的本地已审范围结论保持；不新增生产、云或真实商户验收声明。** 最终提交范围、秘密扫描/保护清单与总验证文档仍由 root 统一收尾。

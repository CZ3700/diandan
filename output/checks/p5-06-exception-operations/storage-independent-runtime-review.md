# P5-06 非作者应用、API 与 Worker 复核

Reviewer：`/root/exception_storage`；日期：2026-09-22。本人是本轮 PostgreSQL 与存储验收作者，本报告**不把本人复看存储实现算作独立验收**。独立覆盖 application、API、Worker 接线、恢复协议与真实 HTTP 夹具；未修改这些 owner 文件。

## 当前结论

最终独立复核 ACCEPT，未发现未解决的产品阻断项。已核对最终真实组合 PASS、53 文件冻结源码不变性、root 的完整 check:dev 与兼容/原文件保护证据；P5-06 原任务本地完成条件成立。以下保留中间发现和修复过程，最终证据以文末为准。

已独立实际运行：application `admin-exceptions.test.ts` 8 tests、API `admin-exceptions-route.test.ts` 7 tests、Worker `reliable-events-runtime/composition.test.ts` 11 tests，全通过。命令均为 `mise exec node@24.20.0 -- corepack pnpm --filter <package> test <上述文件>`。没有声称重新执行全仓所有历史 PG/HTTP/S3 门。

## 复核要点

1. 七个 API 路径固定映射 action，mutation 的幂等键仅来自唯一 header。body 自造 actor/session/token/request/action/key 拒绝；来源、CSRF、cookie 与 body 大小沿用私有管理端边界。所有返回为 private/no-store/noindex/no-referrer，详情也不返回 provider 原文。
2. application 在 Zod canonical command 上计算有域分隔的 HMAC 请求身份；session/CSRF 只以原 purpose-separated digest 进入仓储，requestId 不改变同一业务请求 hash。输入、仓储返回和 operation/target 对应关系均验证；未知存储错误只返回 TEMPORARY_UNAVAILABLE。HTTP 接受只记录事务授权，不直接产生资金/通知副作用。
3. 恢复只接受 WEBHOOK/DLQ。claim 合同把 action、target、原 inbox/outbox ID 与 consumerKey 绑定；应用进一步核对新 lease digest。只有固定 `order-notifications-v1` 可以进入 outbox 恢复，使用原 handler、原 consumer/effect 幂等身份和原持久去重。delivery 的 6/6 表示本次人工恢复的一个终次尝试，失败保持 dead-letter，不增加后台无限重试预算。
4. 原业务处理完成后再 settle，settle 响应还须匹配 operationId；STALE 不算成功。原处理器与数据库保存成功凭据，崩溃后重复原 source 不重复 effect；应用并不将 handler 返回或 UI 回跳直接当作资金成功。claim/settle 失败只计失败/安全 notice，lease 允许之后重启恢复。
5. Worker maintenance 串行去重运行；exception、finance evidence、notification/expiry 各自失败不会跳过后续清理，也不记录 supplier 原文。exception 调用包在原 observed queue context 中。stop 等待 maintenance，再 graceful stop 队列，再关闭持久层。
6. PAYMENT/NOTIFICATION 永久 wrapper receipt 返回原 finance operation / manual resend ID，依赖既有 runtime 消费；没有原订单/付款/退款状态直写，没有改 provider/effectKey/consumerKey，没有重置原 notification delivery。
7. PAYMENT 的 expectedVersion 只跟踪 attempt/order 业务状态，当前 UNKNOWN 与 finance busy 在锁后独立核验；已经完成的只读 reconcile 历史不强制成为新业务版本。原 finance 永久幂等负责委托身份。此边界已由 root 明确接受，并在存储 command 的注释中写明。

## 真实夹具复核与剩余执行项

- 已阅读协议的真实签名 webhook、pg-boss 六次有限失败、独立持久 TEST PSP/邮件、原 handler 十次调用、重复键、丢响应恢复、原账户 reconcile 及业务完成后 settle 前进程重启检查。`runtime-browser-green.log` 中共享 SQL guard 两条 `23514` 是预期拒绝；不是功能失败。
- 已发现第二批 UI source 的队列饥饿风险：第一轮正常 maintenance relay 的非目标 backlog 被第二轮 fault worker 一并故障，目标 outbox 一直 created。建议故障仅注入本批两个目标，其他 job 继续原正常 handler；runtime owner 已接受该窄修。该建议不删除 job、不重写队列/业务状态、不伪造六次失败。
- 共享存储检查曾错误调用 `query` 路径导致 404，现改为正式 `list`；native 投影真实 RED→GREEN 已独立覆盖 OPEN/ALL 语义，最终真实 HTTP 对应断言仍由最终组合 run 证明。
- 早期原生约束测试含隔离历史种子和事务内 guard injection；实际 HTTP 四来源由正常入口创建。两者范围必须分开报告，不把 seed/约束注入称为普通 HTTP 生命周期证明。

## 精确源码

53 个应用/合同/API/Worker/UI/BFF/runner 文件逐 SHA 清单：`storage-independent-runtime-source.json`。当前增量复核指纹：`96263ec948c42e943018a54b322ae789a3d41551c9608f0bf918755f2fdca6c3`；算法为排序后的 `path + NUL + SHA256 + LF` 再 SHA256。快照保留前次 19 文件指纹及三个 runner 的变更清单。最终 browser 结束后只需核对源码不变性和实际报告，不能把这个选择性审阅指纹当成全仓源码指纹。

## Admin/BFF/pending 与 browser 断言增量只读复核

本人未编写 UI/BFF，现独立阅读 management-exceptions 的 workspace、api、pending-store/state、detail/list/filter、labels/CSS/review-manifest、共享 AdminClient/BFF operation mapping，以及完整 `admin-exceptions-browser.mjs`。未改 UI/runner，未重复运行另一轮浏览器；最后执行结果仍以 runtime owner 的真实 run 为准。目前未发现新增阻断项。

- BFF 只有固定 operation→API action/path，mutation 要求正式 schema 的 target/version/reason/confirmed 与 header key；Api client 对 command/response 的目标和操作再次匹配，不能以路由名或body任意提升权限。
- sessionStorage 按 actor 和当前 tab 保存一个严格 schema 的完整待恢复命令及 key；不保存 cookie/CSRF/私密留言/邮箱/provider原文。先写入并重读一致性后才发请求，存储不可用时禁止新 mutation；有 pending 或 active 时不会创建第二个 key。
- 网络/无效响应/临时不可用保留原命令；刷新恢复复用原 key/body。访问拒绝时清掉详情和可操作权限，却保留不确定命令，防止把“当前失权”误当成“旧命令未提交”。detail 版本改变会重置原因/确认组件，避免沿用旧确认直接操作新事实。
- UI 只使用 allowedAction 决定入口，固定枚举原因并要求显式勾选；不展示敏感原文面板。列表/分页由服务端结果驱动，UNKNOWN/SENT/只读的阻断提示来自安全 DTO。小屏改为单列，长 UUID 换行，标准 label/button/select 和 focus-visible 保留；无新增动画或外部UI服务。
- browser 通过真实 UI→BFF→API，不伪造成功响应。七语×两视口捕获列表和四来源详情；另逐语只读、无权菜单、UNKNOWN禁发、网络错误、键盘焦点、reduced-motion、分页、实时失权。丢响应测试先 `route.fetch` 让真实请求提交，再中止浏览器响应；另一层由 API 接受后模拟响应丢失，随后刷新并核对每次 body/key 相同和 permanent replay 回执。
- browser 最后直接执行 UNKNOWN reconcile 与失败通知重试，调用原 Worker/finance 恢复并核对经济操作/履约计数；协议套件另外覆盖通知数量/投递去重与原历史不变。所有截图做 axe、无横向溢出、导航文字边界与无私密面板检查。分页/真实空列表是条件场景，只有结果 `cases` 明确出现时才能声称本轮执行了该场景。
- 文案 review-manifest 明确七语均 DRAFT；viewport 是模拟手机，浏览器忽略 TEST TLS 证书不是生产安全结论。最终报告应保留这些边界，不把自动 axe/键盘一个流程当真人读屏或实体设备。

## 最终执行前增量复核

- 已核对 `managementSectionUnavailable`：全局 discovery 失败信息仍保存；只有当前 workspace 无可用 context 时才显示重试横幅。access 回归用例同时断言健康 EXCEPTIONS 不受 content 临时失败影响、实际不可用 ARTISTS 仍显示错误、初始未加载不误报。此修复不借用其他 workspace 权限。
- runner 从 detail 返回列表时等待真实 LIST 响应后再填筛选，且验证返回每条来源类别；`Promise.all` 同时接住 click 与 response 等待失败，不再有未处理 rejection 跳过安全报告。该修复与此前截图只有 list/webhook、后续错误分页的观察一致，没有增加任意 sleep 或伪造 API 成功。
- fault queue 只让本批目标 WEBHOOK/DLQ 走缺 handler/consumer 的真实有限失败，其他 job 继续原正确 handler。前轮日志已见第二批 108 个非目标 outbox 正常 completed、两个目标各五次 retryable 加一次 dead letter；仍需本轮最终组合 PASS。
- browser 后端每次恢复检查经济 PSP 调用计数不变、至多一个原退款、履约事件不增、通知/人工 resend/接收量受原合法来源上限约束，以及四目标各最多一个永久 wrapper receipt；协议另有精确退款/原 handler 十次去重和通知历史保留断言。这些上限检查不能单独证明每项一定完成，必须与真实详情/回执和协议精确断言一起读。
- lease 场景明确是业务事务提交后省略 settle 的模拟中断，真实等待数据库租约过期并重建 Worker 实例；没有杀 OS 进程。`scope.json` 的 `workerProcessKilled:false` 和 `SIMULATED_POST_COMMIT_INTERRUPTION` 已准确记录，报告不将它扩称为实际进程 kill 验收。
- 本次只读增量接受，无新阻断项；root 已报告第二次完整 `check:dev` 通过，最终实际 browser 仍运行。本 reviewer 没有重复同一浏览器或把 root 报告当成本人运行。

- 最后一条权限恢复的初次组合结果为 FAIL：真实 context/detail 已 200 且浏览器无异步错误，但同步 DOM count 先于 React commit。已只读复核最后窄修：refresh/open/recover 等待对应实际响应，恢复详情再等待 visible 并验证原目标；没有删掉断言或伪造数据。先前七语矩阵、分页/真实空页和四动作均已实际执行，仍需最终完整 run PASS。浏览器 runner 为本次 53 文件快照唯一新增差异。


## 最终证据核对 — ACCEPT

最终组合目录：`integration-2026-09-22T08-16-42.172Z/`。本 reviewer 读取实际 `run-result.json`、`scope.json`、`protocol.json`、`storage-cases.json` 与 `browser-exceptions/report.json`，没有重复启动另一轮浏览器。

- 组合 PASS 共 **7143** assertions：原 fixture 5763、异常协议 369、共享实际四来源存储 27、browser 包含后端 hook 的 809、额外 fixture 175。浏览器自身 report 的 UI assertions 为 **708**；两者计数口径不同，不混写。
- browser **11 cases / 89 PNG / 89 axe scans**；所有 assertions 通过、errors 为空。明确实际执行了七语双端四来源、七语 webhook 只读、无权入口、未知通知禁发、键盘/reduced-motion/网络恢复、服务端分页、真实空付款列表、两层丢响应原键恢复、原账户付款核实与受控通知重试、实时撤权与恢复。
- 独立目视抽看最终泰语 390 列表、中文 390 通知详情、葡语 1440 webhook、英语 390 access-restored：原因/确认入口可读，UUID 换行，未见横向截断、无关 discovery 横幅或敏感原文。最后恢复截图展示原 webhook Complete 和保留的原操作历史。
- 协议最终事实：PSP payment/create/refund/cancel 经济计数均未因恢复再增；新 reconcile 仅一条可信观察；本地原退款入账由 0→1，履约事件 5→5、delivered 0→0。原 webhook/outbox handler 各重放十次，通知原历史保留，UNKNOWN 未重发。共享 SQL guard/审计和 OPEN/ALL 检查 **27** 全通过。
- 最终 **53/53** 审阅文件逐 SHA 未变；指纹 `96263ec948c42e943018a54b322ae789a3d41551c9608f0bf918755f2fdca6c3`。逐文件及实际结果文件 SHA 在 `storage-independent-runtime-source.json`，不会把本 reviewer 编写的 PG 代码计为非作者审查。
- 另读取 root 的 `check-dev-status-copy-green.log` 末尾完整通过、`compatibility-verification.json` PASS：5993 原文件、72 旧 SQL、36 旧迁移条目保留，旧 contract/openapi 定义均零改动。本人局部应用/API/Worker 测试仍为 8/7/11；不声称重新跑了 root 全仓命令。

局限保持：本地实际 PG 18.6/TLS OIDC/TLS S3/pg-boss/Worker + 独立持久 TEST PSP/邮件；没有商业 PSP sandbox、真实资金/邮件或生产发布。lease 场景为真实数据库租约与新 Worker 实例上的模拟 post-commit interruption，未杀 OS 进程。存储约束 injection 单独标注，不当普通 HTTP 生命周期；七语关键译审 DRAFT、手机为浏览器模拟。

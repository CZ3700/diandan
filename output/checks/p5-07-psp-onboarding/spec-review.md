# P5-07 独立规格审查

Reviewer：`/root/exception_storage`；2026-09-22；本人未编写本轮产品/runner源码或两份接入手册。只读实现、规范与证据；root统一执行测试，本人不重复重型构建/集成。精确输入SHA见 `spec-review-source.json`。

## 最终独立验收：P5-07 ACCEPT

2026-09-22，按原 Task/SPEC 与 ADR-016，**P5-07 原定本地手册、完整 fake conformance/分级演练及商户决策门全部满足，独立验收 ACCEPT，无未解决阻断**。本轮不增加多余渠道；商业PSP sandbox、真实小额及生产灰度是手册中的后续准入门，没有被宣称通过，也不是额外添加给本Task的完成条件。

本 reviewer 实读最终原件并重新计算当前文件SHA，未重复启动重型suite。权威结果为：

- `drill-final/result.json`：固定 build/fake-conformance/adapter-tests/staged-rollout 四步全部退出0，completedSteps=4、notRun=[]。正式fake 15/15全部通过，adapter测试fake 20、gateway 106全部通过。构建28/28、28缓存，如实记录。
- **最终权威 HTTP** `integration-2026-09-22T10-05-55.604Z/`：35259总断言=5764 setup+29495 scenario，4704能力GET，独立PID40931/40933；七stage样本 **[0,24,2,5,24,0,24]**，publication generation 2→8，两进程传播 **576.5–1034.6ms**。两级比例、四个PG/Domain双500象限、106不可变历史行、7精确publication审计成立；旧UNKNOWN原PSP付款对象从1保持1。内层7个配置资源closed，run/outer/cleanup全部PASS。
- `check-dev.txt` 完整通过workspace/domain/format/lint/typecheck64/64/test64/64/build36/36（分别63/63/35缓存）；不是零缓存或实际PG验收声明。contracts、adapter boundaries、32导出artifact imports、CI/runtime/observability静态门均有通过输出；secrets原记录无诊断且root确认退出0，最终文件写完后的重复扫描由root收尾。
- `runner-red.txt` 保留实现缺失的失败；`runner-green.txt` **8/8**通过，包含新增launcher抛异常仍FAIL且不泄露canary。独立质量review由手册作者仅审非本人编写的6代码/manifest输入，代码质量PASS；其自写手册的独立规格由本人承担。
- `compatibility-verification.json` PASS：旧74 SQL、全部合同及700roots/127paths/204schemas保持；仅已有package.json增加入口、5个新脚本。本人对 **2587候选文件逐SHA全部匹配**，候选集合指纹 `5ef8f24b41c3f6f765b6af951ea1f4c64fae8742de80d097be8675197c0cef6f`；对 **5993原未跟踪逐SHA重新核对全部保留**；11项审查输入与六组963条原依赖选择记录均零漂移。

最终规格输入集合指纹仍为 `c910ef47222e7496448ef16092ae72b636c1e940ba67ac88bf4da731c359e78a`。精确文件、最终报告和质量门hash见 `spec-review-source.json`。先前三轮诊断与单独场景仍保留，但最终结论只以上述完整入口对应的10:05:55权威运行作为交付成绩，不混用10:02:53的样本/时延。

5%/25%证明范围仍为24个真实checkout的实际能力资格/PG桶，不声称各阶段实际扣款、精确人口比例或生产员工过滤；真实资金/浏览器/生产未执行。这些范围与原P5-07一致，无本轮UI产品变化无需另跑前台浏览器。P5-08的原依赖已满足可消费的本地完整范围，有限离线IaC与持久本地部署体验工具的 **READY技术条件成立**，详见 `next-stage-readiness.md`。本人未改进度/Git、未领取P5-08。

以下保留各次审查与失败修正的历史记录，早期“待执行”不再代表最终状态。

## 第一次部分结论

**PASS：根入口3脚本、package命令、两份runbook。当前这部分无阻断发现。** 新HTTP演练尚未落盘/执行，此结论允许开始已就绪部分的独立代码质量审查，不代表整轮演练或P5-07验收完成。

- 原需求覆盖：Task P5-07是代码→sandbox→真实小额→灰度手册与fake完整conformance/灰度，列明商户决策门且不接多余渠道。手册和模板区分本地TEST、商业sandbox、真实资金与生产，未把外部未执行伪称通过，也没有人为追加真实新渠道作为本Task最低完成门。
- 入口固定依次build、完整fake suite、fake/gateway tests、staged rollout；build使用API/Worker及testing依赖闭包，payment-fake是API的workspace devDependency。使用shell=false；help/plan无文件/子进程；参数与重复选项拒绝；已有证据目录拒绝覆盖；首个非零/信号/spawn错误停止后继并保留FAIL/未执行列表。7个tests包含真实子进程23退出码及日志验证，未仅以stub证明整个演练。
- fake入口调用真实共享 `runPaymentProviderConformance`，同时要求passed与15cases。gateway单测同套件经CA验证TLS，并含五个语义错误负例。正式七操作与endpoint-scoped verifier清楚分开；legacy parser未被当成真实webhook入口或第八正式操作。新adapter必须自己实例化同套件，旧fake通过不认证未来adapter。
- 两份手册的原账户、金额冻结、永久幂等、UNKNOWN退款占用、可信webhook/reconcile、只读回跳、旧连接保留与停止新create语义和现有源一致。明确先持久ACK，原文加密/TTL，不清空effect/receipt；没有引入原文下载、SQL强改或重复扣款试探路径。
- 双桶AND采用严格小于边界；0/10000语义、账户5%×规则5%=约0.25%、新ruleUUID重分组写清。当前手册主方案为provider10000×rule500/2500/10000，须与最终脚本报告核对；不同合法方案可以说明差异，不能把同checkout跨新rule误称cohort稳定。
- internal明确是隔离TEST演练，当前账户状态须实际记录；没有员工白名单/INTERNAL灰度API声明。正常配置拒绝INTERNAL+LIVE，账户identity trigger冻结status/environment，已撤回先前不成立的ACTIVE/LIVE转态假设。真实LIVE内部观察先验收访问隔离，不能向公众直接全开。
- 商户门列明主体/KYC/产品承保/MCC/市场币种方式/退款拒付费用/政策/授权/托管责任/七语审核/运维负责人与证据；未知或缺证为NO-GO。USDT已有helper不冒充已接通，专属quote绑定/入款/恢复缺口明确。
- 停止、回退、DB不可用和代码回退互相区分：发布失败不能声明已停用，入口停止需另证；管理rollback创建新publication；代码digest兼容与15分钟原门未被TEST传播成绩代替。模板每项均待填/未执行，数量和源hash不等于批准。

已核对手册引用的port/contract/registry/client/verifier/stablecoin/domain/application/PG/config-runtime源码路径及关键语义。外部官方资料由手册作者本轮查询；本复核未另作法律/商户资格结论。当前无UI产品变化，不以未重跑浏览器矩阵作为这部分脚本/文档的缺口；未来真实UI/托管变化仍须受影响浏览器验收。

## 后续整体验收待核对

等待新HTTP文件和真实报告后，补核 disabled/internal/5/25/100/stop/rollback的正常命令、两独立API、实际PG比例/资格、传播≤60秒、七语稳定和原UNKNOWN恢复/副作用计数；ROOT完整质量门及原源码/5993原未跟踪保护另须通过。只有这些都成立，才对完整原Task给最终规格结论与源指纹。

## 第二次：完整新 HTTP 演练的规格读审

已完整读取 `apps/api/scripts/psp-onboarding-http.mjs` 与 `psp-onboarding-protocol.mjs`，并追踪复用的配置fixture/双进程OBSERVE及order-payment client。**完整源码范围规格 PASS，实际本轮执行与最终质量门仍待。** 不以读审代替root统一执行。

- 所有新配置写入走已有真实OIDC session的管理命令，首次未批准七语文案明确拒绝；逐语由独立reviewer批准，相同内容的继承遵从服务端。七阶段disabled/internal/5/25/100/stop/rollback均读实际PG head/rule/provider比例，并绑定返回receipt。
- 双进程由旧fixture创建实际不同PID及独立pool/registry；OBSERVE读取进程内configuration.generation，不是简单重查同一PG head。每次publish起计至两进程generation观测≤60秒。完整七语capability核验随后执行；`propagationMs`不包含遍历整组HTTP请求耗时，不应声明为完整浏览器操作计时。
- 主梯度最终与手册统一为provider10000、rule500/2500/10000；24个正常服务端checkout在每stage、每locale和两实例读取，实际PG函数与Domain桶一致，country资格/route UUID/version与API一致，原金额/币种/market不变；0%全排除，100%全准入。每新revision允许新routeUUID重新分组；rollback重用原100% revision，严格比较原route和全cohort。
- 证据范围明确：5%/25%不要求24人小样本概率命中，不证明人口精确占比，也未在这两阶段分别做真实create；实际新create发生于隔离internal阶段，另有切换前旧PSP真实受理后丢响应UNKNOWN。此范围符合本Task fake分级演练且本轮不改支付生产实现；已有P5-04实际PG准入/receipt guard反证继续作为原依赖证据，不能把它说成本轮又跑过。
- 独立四象限双500向量同时查真实PG/Domain，证明AND；明确是确定性算法向量，不是伪造HTTP session。没有把provider5%与rule5%交集当5%。
- stop后先要求旧attempt仍UNKNOWN，原create key/body在两个API重放同一个attempt，真实到期lease后恢复；核对旧账户、旧receipt/原订单hash和旧/新PSP付款对象数不增加。另用停止前capability+新key创建新attempt得到STALE_CONFIGURATION。这里证明的是未捕获UNKNOWN找回为REQUIRES_ACTION，不是新增完成退款/履约/通知的综合验收；后者由原P5-06证据承接。
- 七stage都要求成功publication audit、rollback新generation；已有publication/provider/rule/translation/audit行以逐行hash保留。原receipt基线建议显式要求恰好一行，避免未来缺失时空集合hash产生虚假稳定；已反馈作者，最终指纹前复核。
- HTTP只构造新临时PG/S3，nativebin复用原严格校验，无用户现有数据库选择器。finally保留safe failure/run-result/cleanup；父层仅在child与PG/S3 harness全部返回后写outer PASS，且scope不声称LIVE/商业sandbox/browser。没有token/原文/merchant secret进入报告；canary与runtime隐私检查保留。

新增source具体断言足以覆盖本Task原定本地范围，未发现业务范围扩大或当前正常流程权限绕过。最终实际结果、完整入口退出码、源码不变和root质量/保护门仍须核实，才可给最终任务验收与P5-08 READY结论。

## 增量候选复核

作者已补原receipt查询 `rows.length === 1`，原空集合hash建议闭合。实际PG返回bigint字符串与HTTP数值对照导致的首次夹具失败，以查询明确cast int修复；本轮有限generation远小于int上限，不改产品schema或SQL。新增当前0%版本的双API负向create，要求CAPABILITY_UNAVAILABLE、24个cohort对应真实order无attempt、两PSP完整counts不变；随后另测旧版本拒绝，避免只靠STALE证明0%停用。已逐段读审，scope新增paymentCreateScope准确区分低比例只做capability、internal做真实create和两种停止拒绝。增量未发现阻断；第三轮实际运行仍待。

## 实际场景证据独立核对

已实读 `integration-2026-09-22T10-02-53.342Z/{run-result,outer-result,cleanup,scope,protocol,stages}.json`，未重复执行。run/outer均PASS；35259总断言=5764 setup+29495 scenario，4704能力GET；两个不同PID39607/39609。七阶段准入样本依次0/24/1/6/24/0/24，全部实际PG比例/双进程/七语核验通过；每阶段publish到generation观测523.1–931.7ms（TEST轮询1秒，不外推生产）。四个双500 PG/Domain象限、106条不可变历史、7个精确publication audit成立；原PSP付款对象仍1，旧UNKNOWN原key跨节点恢复保持receipt/orderhash。所有7个配置资源closed，外层PG/S3 cleanupVerified=true。

此次真实场景与审查的11输入SHA全部一致，HTTP/source hash已归档JSON；该运行没有商业PSP/真实资金/浏览器/生产结论。根固定4步完整入口复跑、完整质量门与保护检查仍由root完成，不能以本次单独HTTP通过替代它们。

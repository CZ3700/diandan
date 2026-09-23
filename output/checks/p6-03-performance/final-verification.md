# P6-03 性能与 RUM 本地验收

状态：**本地完整范围 ACCEPT**。非作者最终 `final-local-acceptance.json` / `final-aggregate-independent-review.md` 已接受；P6-03仍IN_PROGRESS并保留真实用户/正式环境原门。基线 `b7df3400`，分支 `codex/p6-03-performance`。

## 交付范围

新增默认关闭的 Web Vitals 采集、严格同源入口、可替换 stdout sink、有界日志聚合与完全离线看板。真实 `web-vitals 6.2.2` 提供 LCP/INP/CLS；不使用 TBT 替代 INP，不把自动化或本地 p75 当真实用户结果。遥测不带 URL、query、fragment、Cookie、用户/订单/商品身份、DOM、留言或姓名。管理中心没有新增日常操作步骤，原黑金视觉和交易业务保持。

采集合同是兼容新增：原 704 JSON Schema definitions、206 OpenAPI component schemas、128 paths 逐值不变。配置 `disabled/local/field` 与抽样明确分离；敏感 order-access 路径禁采，0 抽样等同不传输。服务器限制 2 KiB、2 秒读 body、16 个 active/未决写、600 次/分钟/进程；超时或失败不假报 204。聚合严格拒绝身份和 revision 冲突，保留 receipt window 与样本量，local/automated 永远标记 LOCAL_ONLY。

测量工具固定七语、六视口、原 Lighthouse 13.4.1 mobile simulated slow 4G/CPU 和每组三次中位数。保留 84 原资源导航、63 原 Lighthouse、21 分组，再补 294 个资源/实际内容/布局单元；score ≥0.90、LCP <2500ms、CLS <0.1 原门不变。额外无市场礼物目录纳入，字体按实际响应 SHA 核对，消息以语义指纹检查，禁止第三方脚本，未强制图片 eager。

## 源码与完整质量

此前 candidate-2 执行输入 `acc7cc8514f123c5221d78e299185bd8a8da90e0176697685a12981e955c496c`，2910 个源码/文档文件，独立源码副本内使用 Node 24.20.0 / pnpm 11.25.0。用户 `.env`、数据库、对象、订单及旧证据不复制到测试副本。

最终 candidate-5 执行输入 `ea5371aa693c4c2d46c238ac393036b11770c15e267d69e90460c829fe26baab`，2915个输入文件、2829个执行输入。candidate-2→3补严格RUM工具与204响应消费，candidate-3→4只补测试navigationId及runbook，candidate-4→5只修看板工具定位与新增定向回归入口，产品字节不变。最新完整质量、真实Next RUM和正式性能均已PASS；candidate-2结果只对应历史编译。

- `candidate-2-check-dev.txt`：format/lint、64/64 typecheck（0 缓存）、64/64 test tasks（28 缓存）、36/36 build（28 缓存）通过。此命令不包含下面独立执行的实际 PG/S3/浏览器验收。
- `candidate-2-contracts.txt`、`candidate-2-adapter-boundaries.txt`、`candidate-2-artifacts.txt`：合同新鲜度/locale、依赖边界、32 公共包入口通过。
- `candidate-2-tools.txt`：28 工具测试；`candidate-2-design-foundations.txt`：57 设计基础测试及静态门通过。
- 最新 `candidate-5-check-dev.txt`：完整format/lint、64 typecheck（0缓存）、64 test tasks（28缓存）、36 build（28缓存）全部通过，outer exit0（`candidate-5-quality-exits.json`）。新的contracts、adapter-boundaries、32exports、36工具测试及57设计测试与原门全部通过。candidate-4历史质量也PASS。
- 非作者 `candidate-5-source-independent.json` 独立枚举root和候选真实Git路径，各2915输入/2829执行输入；路径增删、SHA、mode和symlink差异均0，两树执行hash与candidate-5一致。
- 真实数据库、浏览器、完整归档与最新用户环境保护均已在后文完成；质量门不替代这些实际验收。

## 原失败与审查闭环

原始失败全部保留，不以通过报告覆盖：

1. 部分初始聚合/intake RED 命令使用错误 Vitest root/config，另有语法启动错误；不能宣称这些部分满足测试先行。作者保留日志并做了 9 个实现后的隔离 stub 反例。合同/配置确有先红后绿，独立审查发现的实际缺陷均有真正的失败回归。
2. malformed RUM JSON 原先被忽略；完整 JSON 无 EOF 在超时取消 reader 时可能被误接收；新 revision 到达后冲突旧 revision 被漏检。三个缺陷均已 RED→GREEN，并经独立测试关闭。
3. `candidate-1-check-dev.txt` 的精确 API 路径断言未登记新增入口而失败。只补 `/api/storefront/rum` 一项期待，不过滤或放宽断言；7 条定向用例和非作者核对通过，建立新的 candidate-2 完整质量运行。
4. `candidate-2-rum.txt` 首次完整RUM运行在en/390的指标回执门失败，outer exit1；实际Next日志已有三种指标，但没有完成回执/看板验证，不能称PASS。7份原始失败文件、源码和退出回执保存在 `rum-run-1-failed-archive.json`，第二次无行为变化的owned诊断 `rum-diagnostic-2-archive.json` 证实菜单/搜索全部通过、原搜索200 SUCCESS且6项；实际停止在原10秒三指标回执门，只观察到LCP，服务端有全部三项。诊断不是接受，最小真实Chrome实验复现旧文档卸载keepalive的Playwright观察缺口（page/context只见LCP，服务端收到三项），实际headers/校验无错。普通冻结/切tab/最小化未触发真实hidden的失败也保留。最终用独立Chrome和 `connectOverCDP({noDefaults:true})` 避免Playwright会话内默认焦点仿真，原生切tab产生真实hidden；受控probe三指标/204/隐私/schema转绿，但它是自建204接收器，不能替代当时等待的Next整链重跑（最终由candidate-5完整闭合）。未删指标/隐私/成功回执要求。 后续严格finished门发现另一个独立问题：实际Chrome中原文档始终可见且清理前，丢弃fetch成功空204响应会出现net::ERR_ABORTED；仅查看status仍失败，消费空body才正常finished。多组原始对照见 `rum-transport-void-probe.json` 与 `rum-transport-consume-probe.json`。产品先补行为RED（2失败/1通过），再仅在status204消费arrayBuffer；不消费非204、无重试、隐私与keepalive不变。13相关测试GREEN，当时计划以candidate-3重跑真实Next整链与新正式性能，后因测试夹具与看板工具修正，最终由candidate-5完整闭合；此前candidate2报告只对应此前源码。
5. candidate-3完整质量门在typecheck拒绝新增传输测试的缺失navigationId字段，38成功/46任务、后续test/build未跑。原失败日志与退出保留 `candidate-3-quality-exit.json`；只补齐锁定web-vitals6.2.2实际类型要求，不转为unknown断言绕过。最终使用新的candidate-4重跑，candidate-3不接受。
6. candidate-4真实Next RUM运行14个七语双端场景全部完成三指标/完整204、真实hidden和敏感0POST；42个浏览器回执与42个server记录及CLI一致。之后离线看板首次locale选择TimeoutError，整命令exit1，不能接受；14个原件与PNG已逐SHA保留 `rum-run-4-failed-archive.json`，真实Chrome双尺寸复现：可访问性树中combobox名称准确，旧getByLabel exact匹配0、新getByRole exact匹配1，旧label原始文本包含options。仅修正工具的7处精确角色定位并导出原看板验收函数；实际原CLI HTML两尺寸每屏23个筛选组合、空窗口与无外网请求定向PASS，原超时/行内容断言与产品不改。最终仍从新冻结candidate-5完成整链。
7. 已跟踪历史 `.log` 被原秘密检查正确拒绝（`secrets-final.txt`）。4个历史日志原字节与HEAD/index完全一致；原件保留、旧报告不改，仅改为跟踪逐字节相同且原扫描可见的 `.log.txt` 镜像。规则未放宽，第二次完整扫描exit0（`secrets-final-2.txt`）；恢复旧路径的方法与SHA见 `historical-log-tracking-repair.json`，非作者审查接受该处理。
8. 目录测量第一次引用不存在的导出，在创建数据前失败；改用应用公开 use case 后完整重跑。期间 pnpm 隐式解析附带更新了无关传递依赖，已恢复其原版本；最终 lockfile 只新增 web-vitals 6.2.2，离线 frozen install 通过。

非作者源码审查：`rum-independent-review.md` 的 25 个独立测试及边界通过；`performance-tools-independent-review.md` 对性能与目录工具及 26 测试接受，后者轻量测试使用 Node 26.3.0，和 root 的固定 Node24完整门区分。浏览器证据与最终源码/归档须由最终独立接受另外核对。

## 已完成的诊断与目录观察

基线副本执行源 `34e9e6c36b8a286501a1ae4de55b54e39ce07786b307c52ef957c03ef5a5df1c`；只叠加 10 个观测工具文件、产品保持。`baseline-browser-1/` 保存中文3资源/9 Lighthouse **DIAGNOSTIC_COLLECTED**，它不是正式完整矩阵，不同预热次数不能作时序因果 A/B。各三次中位 LCP home 2108ms / artist 2107ms / gift 2264ms；单次慢值 home3469ms / gift4260ms 也保留。

真实 native PostgreSQL18.6、TLS S3 和正常管理发布目录测量：旧120、旧1200、现代120新增 V3（连同25原夹具共145可见），每组七语×12/48条×前两页×3次，共252样本。现代实际前96项均V3；120张上传共享同一获准 TEST 图片的 master，明确是共享来源授权链压力情形，不冒称120张独特生产摄影。

现代12条全部42个样本耗时381–460ms/162 SQL，48条全部42个样本1077–1596ms/630 SQL；各42样本合并中位分别为419.025ms与1332.308ms；每次读取的 row JSON 约6.0–6.4MB及17.1–23.3MB。大头是发布 manifest/document 和媒体处理/产物证明；观测序列化本身也计入端到端耗时，不能把 SQL 之外差值全称业务 CPU。旧目录1200全部样本范围87–150ms，12/48条各42样本合并中位分别93.790ms与123.420ms。`catalog-audit.md`、`catalog-baseline-summary.json` 与 statement bytes 保存完整条件、84×3样本及cleanup。没有为提高跑分删减完整证明、缓存权利状态、改变 SERIALIZABLE 或重写数据层。

基线首页/艺人/礼物初始 gzip JS 为152393/150744/154012B，超过原150000B SHOULD建议；运行时框架成本占主体，局部图片拆包涉及首图和客户端分页，尚无被验证的低风险收益。本轮不把测量和RUM接线描述为已做未经证明的速度提升；最终默认/启用模式资源差与实际预算另列。

## 历史 candidate-2 正式实验室结果

`candidate-2-performance.txt` 对应完整父命令 exit0（session37654 / completion a1fa70），包括正常 PG 与最外层 S3 收尾。`formal-performance-exit.json` 保留实际回执来源，不能只看子 callback 的 PASS。`formal-performance-archive.json` 将完整158份原件、111046667字节逐SHA封存，原 .log 字节以 .log.txt 保存。

Chrome153.0.8010.53，原84资源页/63 LHR/21组及新增294格全部PASS；页面错误、资源失败、外部脚本、错字体和错语言消息均0，63个同导航实际内容审计全通过。21组中位 score **0.98–1**、LCP **1353.79–2264.42ms**、CLS **0**；全部63单样本 score **0.92–1**、LCP **1204.76–3057.72ms**。最大单次超过2500ms仍保留，按事先锁定的三次中位数门判断，不挑最佳样本。

原84资源导航 gzip JS **151753–157046B**，84/84超过150000B SHOULD；图片建议门通过。字节为实际script response body重压gzip，区别于线上wire大小。六视口补充指标是无节流、instrumented lab数据，不是field或独立INP；使用合规TEST图片，正式摄影仍须重新验收。完整分组与原始样本见 `formal-performance-summary.json` 和原始LHR，预算未提高。

正式disabled同页面相较基线多1009B gzip，7/8个script完全相同，唯一共享chunk 3661→4670B，其中包含collector包装与惰性loader；独立web-vitals实现没有在正式导航请求。因此默认关闭也有已记录的编译成本，不能宣传零开销。该差值仅是固定编译的资源字节比较，不代表受控速度A/B。

## 最终 candidate-5 真实 RUM 整链

`candidate-5-rum.txt` 完整父命令exit0（session11276 / completion af5346），包括所有浏览器、Next、PG与外层S3清理。32,461原协议断言通过，七语×390×844/1440×900共14采集场景及14个独立敏感页面场景完整PASS；真实可信hidden事件且原文档、URL、timeOrigin保持，LCP/INP/CLS全部经真实库回调、严格隐私校验及requestfinished后204完成。没有注入metric callback或跳过失败请求。

42个浏览器回执与Next日志全部42记录逐measurementKey/revision及内容一致；JSONL和实际CLI报告一致，42组均LOCAL_ONLY。七语筛选和mobile/desktop组合在两个实际视口各23组逐行九列对照；空窗口明确INSUFFICIENT，零pageerror/外网请求，6张PNG。root实看最终390空窗口和1440筛选截图，内容和状态明确；窄屏表格允许内部横向滚动。它是内部离线工程报告，不增加日常管理中心操作。

19份原件/2,034,202字节完整SHA归档见 `rum-final-5-archive.json`、`rum-final-5/`。旧run-1、诊断和run-4整体FAIL均保留，不能与新轮拼接冒称原失败已通过。仅本地TEST/正常CPU网络/自动化输入，不作为真实用户p75或正式Lighthouse数字。

## 最终 candidate-5 正式性能

`candidate-5-performance.txt` 完整父命令exit0（session64818 / completion9c0cb4），包括viewer、Next、PG与最外层S3收尾。158份原件/111,096,183字节全部逐SHA归档于 `formal-performance-5/`，对应 `formal-performance-5-archive.json`，不是复用旧编译的数字。

锁定Chrome153.0.8010.53/Lighthouse13.4.1，63原LHR/21组三次中位数、84原资源导航与294六视口单元全部通过。分组中位score **0.98–1**、LCP **1654.4774–2254.2416ms**、CLS **0**；全部63单次score **0.98–1**、LCP **1204.8162–2261.9336ms**、CLS **0**，本轮没有超过2500ms单样本；旧candidate-2的慢样本仍原样保留，不能跨轮挑选。实际字体、语言消息和同导航内容门均通过，完整原始数值见 `formal-performance-5-summary.json` 与非作者复核。

原84导航初始JS **151786–157079B gzip**，84/84仍超过150000B SHOULD；图片建议门通过。原预算不提高。非作者 `rum-final-5-bundle-cost.json` 核对2352/2352个关闭模式脚本响应与实际产物SHA/raw/gzip一致：共享包装294/294格下载、独立web-vitals为0/294，最终相较baseline三页均多 **1042 B gzip**（共享chunk3661→4703B、raw多2336B），不能宣称关闭零开销。启用模式14个首页实际均 **156684B**，对应关闭 **153435B**，恰多独立vitals的 **3249B**；其余8个脚本SHA不变，126个启用script响应均匹配实际产物。不是将HTTP启用测量与H2关闭测量作速度因果A/B。

传输声明有明确边界：84/294资源采样没有resource failure，63保存的LHR network表均200且finished；viewer完整生命周期另保留20条 `CLIENT_ABORTED`，都是 `/_next/image`，发生于4个LHR的fetchTime后约4999–5039ms，而各保存network表最后结束约743.6–754.5ms。viewer在客户端取消且未发headers时记502（16条），已发headers时保留200/incomplete（4条），不能把它们称作源站502。现有证据可确定在保存的网络采样之外，无法证实具体由截图还是清理触发，query未保存也不能识别每张图片。因此不宣称所有HTTP传输均成功；原trace和限制保留，采样预算PASS不等于整生命周期零取消。

## S.U.P.E.R 自查

| 项 | 本地范围判断与依据 |
| --- | --- |
| 1 模块单一职责 | 合同、配置、collector、intake、sink/聚合、CLI及观测工具分别负责各自边界；独立源码审查通过。 |
| 2 函数单一概念 | handler/runner只编排其入口，格式/采样/校验分离；未在业务use case夹入观测规则。 |
| 3 数据方向 | 浏览器→BFF→严格观测sink；目录成本工具经公开application入口到adapter，无反向业务依赖。 |
| 4 无循环 | 原依赖边界检查、36包的64 typecheck/test tasks及36 build tasks及非作者review通过。 |
| 5 schema接口 | 三个versioned RUM根及OpenAPI，旧704/206/128逐值兼容。 |
| 6 可序列化I/O | 观测、聚合和报告是严格JSON；不跨界传DOM、库entry或数据库driver类型。 |
| 7 环境配置 | 源站和模式来自声明配置；固定路由/指标限额是合同，观测fixture仅TEST，无新增生产密钥或品牌常量。 |
| 8 显式依赖 | 唯一新增运行依赖web-vitals6.2.2；frozen lockfile通过，未附带升级其他依赖。 |
| 9 可替换 | 标准库适配、RumSink、离线聚合与看板可分别替换，不成为商业真相源。 |
| 10 验证 | 最新完整quality、真实RUM整链和正式性能PASS；旧8457原件/私有配置和原实例保护PASS，最终暂存后秘密扫描exit0（54176/5bcec2）、原规则未变；整体非作者ACCEPT；本地十项闭合，外部门另列。 |

## 原体验环境保护

`protection-final-5.json`：原8457个未跟踪文件逐SHA不变，私有配置SHA不变；原instance/runId/PID相同、四服务ready，无restart/reset。`user-storefront-final-5.json` 是使用原TEST CA并保持证书校验的实际GET200，艺人和首页直接礼物区存在，未创建cart cookie，writeActions=0。最初临时GET探针误主动destroy自身请求而报ECONNRESET，记录在 `user-storefront-probe-first-failure.json`；它不是应用失败证据，完整CA验证探针随后exit0。不记录私有配置内容，不覆盖历史保护记录。

最终秘密扫描 `secrets-final-5.txt` / `secrets-final-5-exit.json` 完整exit0（session18052 / completion464854），原扫描策略未改；历史4日志镜像也在扫描范围。暂存预检另找到本轮baseline归档的2个未跟踪原始.log：原件/原manifest保持，新增逐字节相同.log.txt镜像与恢复映射 `baseline-log-mirrors.json`；最终暂存后原完整扫描 `secrets-final-6-staged.txt` exit0（session54176 / completion5bcec2），这2份新可见字节也已扫描。源码/docs范围的暂存 `git diff --check`通过；包含原始产物的全范围检查保留393条output内空白警告（`diff-check-scope.json`/原始输出），来自生成HTML和控制台日志，不改原始字节也不宣称全部产物无格式警告。所有实际source/协议/性能/RUM/保护都对应本轮记录，不把本地成功替代外部验收。

## 保留门与下一步

本地、自动化、Lighthouse和模拟网络不能代替真实用户 p75 LCP<2.5s/INP<200ms/CLS<0.1、实际样本窗口和分布、真机、生产代理/容量、真实内容、云 staging 或上线门。P6-03 仍 IN_PROGRESS 直到原完整要求完成，不增加 DONE。P6-04 条件就绪核对在 `p6-04-readiness.md`；完整本地接受后已释放Lane D，当前原P5-06依赖69输入再核通过，仅P6-04有限本地READY、尚未领取（`p6-04-readiness-final-5.md`）。31 DONE/9 IN_PROGRESS/1 READY/8 PENDING=49，P6-05/06与Phase7不解锁。仅本地提交，不 push/部署/真实资金。

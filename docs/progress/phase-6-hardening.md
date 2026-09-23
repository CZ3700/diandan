# Phase 6 — 质量、安全与韧性加固

> 状态：ACTIVE（ADR-016，P6-01/02 本地已 ACCEPT；P6-03 有限本地 READY）
> 任务：6  
> 正常解锁条件：Phase 5 退出门禁通过；按 ADR-016 逐项登记本地范围；P6-01/02 本地已验收但保留原外部门，现仅 P6-03 READY，P6-04 至 P6-06 仍 PENDING。

## 目标

系统化证明产品在可访问性、性能、安全、事件故障与恢复方面达到发布门槛。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P6-01 | IN_PROGRESS | —（本地 ACCEPT，Lane D 已释放） | P4-06、P5-07 | 5组/17命令/14路径本地通过；实际远端 CI 待补 |
| P6-02 | IN_PROGRESS | —（本地 ACCEPT，Lane D 已释放） | P3-06、P4-06、P5-02 | 七语28单元/196核心页通过；真人读屏与人工语言原门保留 |
| P6-03 | READY | —（尚未领取） | P3-06、P4-06 | 本地七语六视口性能、字体/消息/图片/目录负载；真实 RUM 原门保留 |
| P6-04 | PENDING | — | P5-06 | Scoped security checks |
| P6-05 | PENDING | — | P1-06、P4-06、P5-06 | Fault injection |
| P6-06 | PENDING | — | P0-05、P1-04、P5-05、P5-08、P6-05 | Recovery/rollback drill |

## 必须证明

- High/Critical 安全问题为 0，axe critical/serious 为 0。
- 核心流程在故障注入下无丢单、重复扣款或重复履约。
- 性能预算由 Lighthouse CI 与 RUM 同时支持。
- PITR、部署回退、配置回退和 webhook 重放有带时间戳实操证据。
- 七语言消息目录、核心路径、SEO 互返、cache 隔离、PSP locale fallback 与历史订单/邮件语言均有自动和人工证据。

## Phase 退出证据

P6-01 完整本地回归和 P6-02 本地自动验收已 ACCEPT，分别保留远端 CI、真人读屏/人工语言原门；P6-03 仅有限本地 READY。Phase 完整退出仍待全部原门。

## P6-01 本地激活与执行登记（2026-09-23）

- 原 P4-06、P5-07 均 DONE，完整本地验收及非作者复核由 `/root/regression_readiness` 再次独立确认：P4-06 选定 62/62 输入一致；P5-07 11 个输入仅根 package 新增 P5-08 命令，原演练命令不变。P5-08 本地完整体验与最新 P3-06 UI 已 ACCEPT，Lane D 无 executor。先登记有限 ACTIVE/P6-01 READY，随后本条由 root 领取；P6-02 至 P6-06 仍 PENDING，Phase 7 仍 LOCKED。
- Owner：Codex `/root`；开始 `2026-09-23T10:42:19.345643+00:00`；基线 `7ad8be93`；分支 `codex/p6-01-regression`。只领取 P6-01；R-01/R-03/R-17。
- 范围：汇总并补齐 SPEC §18.1/18.2 的完整本地 unit/i18n/property/schema/adapter/真实PG与TLS S3/七语连续购买查单/SEO-cache 回归；建立可重复的隔离执行和覆盖门禁，接入 CI 配置。不新增业务范围，公共合同与迁移保持；包含严格事故英文恢复与既有后台 token 缺陷的最小修复。
- 验证计划：工具失败测试→实现→受影响测试；单条完整质量门、真实隔离数据库/对象存储及七语双端浏览器矩阵；失败 seed、源码指纹与缺失/失败阻断；format/lint/typecheck/build、秘密扫描、非作者 review 与 S.U.P.E.R 10 项。测试数据和证据与用户持久实例隔离，原未跟踪文件逐 SHA 保护。
- 原门：实际远端 CI 未运行不计通过；真实 PSP/商户、人工读屏/译审、RUM、云 staging/恢复与上线证据保持。只本地提交、不 push/云 apply/真实资金；本地完整接受后若远端 CI 未补齐则保持 IN_PROGRESS 并释放 Lane D。

### P6-01 全量门缺陷闭环（进行中）

- 第一轮全套 `final-1` 在设计基础硬门停止，原 FAIL 保留。后台支付配置的固定尺寸改为既有 token 等值组合，异常页使用已声明的 48rem 边界；补齐设计检查器对双向 `<`/`<=` 媒体范围的识别，失败测试后通过，不放宽 token 门。
- 非作者复核发现原 P2-04/P2-05 浏览器证据在历次字体/渲染更新后陈旧，且独立源码副本没有历史 output 或有效 HEAD。质量组现先真实生成两套浏览器证据，再运行原 `pnpm check`；仅副本创建无 hooks/GPG 的初始提交，CI 使用真实 Chrome 与 Xvfb，不修改历史证据哈希。
- 生产编译的 TEST 前台对照修复测试环境选择：同内容、同快速导航，开发流式 Suspense 取消产生恢复错误，正式编译连续七次无错误。新增编译模式仅允许自有 TEST 实例；中途 stop 的取消屏障经失败测试及独立复核修复，普通本地体验和管理中心身份限制不变。
- `final-2` 原 P2-04 页面预览启动失败：外层原生 PostgreSQL 工具变量被传入严格页面配置。套件入口现在移除环境中的业务 `FAN_SUPPORT_*`，仅 journey 显式保留原生 PG 目录；真实子进程及独立配置解析反例通过，不放宽应用解析器。
- 实际支付跳转后读取旧 response body 的 CDP 竞态已复现。先前暂停 PSP 导航等待观察排空的方案虽在单 case 通过，却被完整七语切换流程的真实等待环推翻，已撤销该方案的静态接受并保留原失败。改为在稳定页面显式读取完整 canonical current 合同、返回阶段读取可信成功，所有匹配 attempt GET 及主动 CURRENT 的 HTTP 状态仍必须成功；默认原体验观察范围不放宽。独立邮件浏览器也要求零 pageerror。
- `final-3` 组件门通过，动效首场景 rAF max=100ms / p95=16.8ms / long task=0，未达到原门；当时有并行自有浏览器诊断。原失败保留，需停止并行负载后单独复测，不能预设根因或放宽帧率阈值。完整五组尚未验收。所有失败保留在 `output/checks/p6-01-regression/`，不以诊断单项 PASS 覆盖整组状态。
- 最终支付观察范围经 22 项轻量测试与非作者复核；定向实际购买执行 10 步、checkout/order 共 14 次语言切换、一次创建、可信回跳和独立邮件查单通过。它不是完整十四场景矩阵结果。自有诊断服务已停止后，`final-4` 独占重跑组件和动效均通过原门，后续运行合同检查发现副本缺 `.dockerignore` 而停止。现以失败复制用例补齐该公开运行文件，未扩大私有配置复制范围；开始新 `final-5`，原 FAIL 保留。
- `final-5` 组件/动效再次通过，真实 PG 旧回滚辅助工具仅认识到 0036，而当前迁移头为 0037。以真实新库定位后，显式支持 0037 并在任何 down 前检查异常操作/回执/审计均为空；未知 0038 与所有历史仍拒绝。51 项（含真实 PG）通过并独立复核，原迁移和业务不改。同步该修复后原购物车 5924 协议断言及浏览器诊断通过，确认共用断点。
- 全仓质量后缀发现九处旧缓存用例仍拒绝合法 V1 英文事故回退；保留旧 V2 与错语负例，增加恢复响应、304 前重读、译文恢复新 ETag 和五类非法 provenance 的九组覆盖，33/33 通过并独立复核。类型/单测/构建 64/64/36 通过；原全量 PG、S3、catalog/commerce/operations 分组预检继续，完整五组最终验收仍待执行。
- 原 PG 登录锁等待测试再次真实失败。独立新库诊断证明 host delay 结束时 PG 仍剩 41.453ms，合法 claim 早于到期 38.179ms；测试前提未满足。两处等待改为只读 PG 时钟实际越过原期限加 30ms 后再放锁，60s monotonic 上限，TTL、锁竞争和拒绝断言保持，产品逻辑与期限数据不改。原完整脚本 115 checks 通过并独立复核。Docker 财务浏览器预检另有 23514 审计 receipt 拒绝，原失败保留；采用计划中的原生 PG18 对照已通过财务与配置，不据此推断 Docker 失败原因。
- 全新持久实例在上架礼物阶段实际 FAILED；只读诊断保留原失败，后续新实例分别捕获发布语句及 COMMIT 的 `40001`（后者为 `assert_daily_publication`）。发布事务仅对 port 明确标记已回滚且可重试的错误进行最多三次总尝试；每次重新读取租约/权限，媒体准备不重做，未知提交仍不重放。失败测试、受影响 36 项、独立应用 33 项及 port 59 项通过。补充真实 PG 唯一发布效果检查，覆盖 head/价格/回执/精确媒体 checkpoint/七语 outbox 与 purge；其轻量 14 项和只读旧夹具通过不代表新重试实证。最新 fresh 另在媒体准备事务捕获 `40001`，完整旅程仍未开始，继续修复该内部边界后再全套验收。
- 原 PG/API 后续诊断 32 步全部通过，包括通知、登录、订单、财务、配置及异常；真实 TLS S3/媒体 423 检查、catalog 四组和 commerce/operations 分组也分别通过，均明确是诊断而非完整五组接受。独立复核用两个临时仓库复现继承 `GIT_DIR/GIT_WORK_TREE` 可使副本准备写错仓库，未触及用户 Git；现所有源枚举/HEAD/准备/套件入口移除 `GIT_*`，真实 HEAD/索引/用户未提交字节保护的三条失败测试转绿，20 工具测试通过，等待独立复核及最终全套。
- 媒体三个内部数据库 callback 沿用同一闭集、有界的重试 helper，每次重新解析持久 claim，回滚前生成的 asset/job/metadata 标识不复用；inspector 在重试循环外，未知提交/权限/租约/来源变化仍拒绝。媒体 11 条失败测试转绿，发布与媒体共 54 项及格式/lint/类型/构建通过，非作者独立 54 项与最终源码 ACCEPT。Git 隔离也获独立 10 项 ACCEPT，完整门保持待验；新冷启动已越过实际上传发布，继续真实七语矩阵。
- 修复后新实例完整 14 场×10步、28 次真实语言菜单切换、失败/取消恢复2、非法 locale 404、零 pageerror 均 PASS，单发布效果检查通过；本轮自然 `40001` 为0。另一次 owned 实验在完整发布写入后、COMMIT 调用前由同连接真实 PG 抛一次 `40001`，原 runner 回滚并自动恢复为唯一最终发布；同时观测到价格 SELECT 自然 `40001`，仍准确标 `SYNTHETIC_SERVER_ABORT`。成功实例均 stop/reset，原失败数据保留，产品和 harness 与 final-6 输入一致并获非作者实证核对；详见 `journey-final-evidence-index.md` 和 `journey-real-evidence-independent-review.md`。
- `final-6` 工具/组件/动效再次 PASS，完整质量门运行至财务存储，在首次退款 reconcile 写 provider event 时被 `provider_events_time_check` 拒绝（23514，5831 checks），原 FAIL 保留。该 storage 旧入口固定 Docker，没有消费 HTTP/browser 已有的显式原生选择器；不能将本次描述为原生财务失败或 DETAIL 读取失败。一次同连接/同事务仅输出安全毫秒差的原 Docker 诊断 6023 PASS，四次事件均早于数据库事务时间约28ms，未复现原差值，原失败的时钟机制仍未确定。现补齐 storage 对既有原生 TEST 选择的接入，与 HTTP/browser 共用选择器并记录实际环境；事件时间、SQL 约束、权限和断言不变，显式原生失败不降级。轻量12项通过，真实原生财务定向及独立复核继续，完整五组仍未接受。

- 财务选择器定向真实原生 storage 6023、HTTP 6164 PASS，12 项轻量测试及非作者 ACCEPT；`final-7` 工具/组件/动效与前置 PG 再次通过，后在订单支付“过期后可信收款”发生 `provider_events_time_check`，完整门仍 FAIL。本路径 PSP 事件和 normalized 时间均来自同一 PG 服务器，后者显式绑定且 PSP I/O 在事务外，不能将此前财务事务时间机制套用于本次。原失败保留，进行一次仅输出安全时间差的观察。测试基础设施将统一提供可选原生 PG18 runtime，保留默认 Docker、原生产时间约束、无降级与严格资源归属；先失败测试，独立复核后重新完整运行。

- `final-7` 原 Docker 精确数值观察一次 PASS 6847，16 组 `occurred_at <= normalized_at`，未复现；实际前者3位小数、后者6位小数，否定 normalized 被 JS 截断的假设，根因仍 UNKNOWN，原 FAIL 不覆盖。统一 TEST runtime 的 native 入口完成，37 个真实迁移/200 表往返、实际订单支付 6847、native 外层工具84项通过；完整回归的旧选择器先归一化且冲突拒绝，3处结果消费者改为报告实际 metadata，旧 helper 仅兼容转导出。独立测试发现宿主 native 变量污染 runner 夹具，已用明确最小环境修复并保留 RED；等待独立复核后冻结新全量轮次。

- 全量前置收尾发现应用层测试直接引用 content 私有 fixture 的既有新增越包违规；保留真实 adapter 门 RED，将该新增集成测试移至外层 API 单测，使用 application 公开入口，6 个非英文恢复成功与6个错语拒绝仍覆盖。基础应用单测保留，两包类型/3测试/格式/lint及原 adapter 门通过，规则、生产代码、依赖和 fixture 导出均不变。统一 native 入口及 runner 已分别获非作者 ACCEPT；84个明确源/文档归属与原6144未跟踪文件无交集。准备冻结 `final-8`，原完整门与所有未运行外部门仍保留。

- `final-8`（source `642a55a818680d763f41ce5d87b5386092591ea5341c92ce4e88c8248bcb8b72`）完整质量、catalog、commerce 三组全部 PASS并获分组独立核对，operations 登录859与订单7113 PASS；财务浏览器在全部七语/双端/角色及退款丢响应的同key/payload和唯一refund断言通过后，`capture` 等待语义读请求集合归零失败（原 expect.poll 默认5s），290断言均真、page errors空。该失败不同于之前SQL时间约束；整轮仍FAIL，剩余配置/异常/journey未运行。原失败、源码指纹和归档均保留，开始一次只记录安全路径/方法/生命周期/年龄的旁路观察；不延长门、不清空请求集合、不预判前端或observer原因。


- 财务原门观察复跑 6742 checks /330浏览器断言 PASS，278个语义POST读全部有终态、58次capture通过；受控Chrome最后route移除的10对实验也均通过，未复现，故根因仍UNKNOWN，不修改产品/unroute/5s阈值。独立规范复核确认并无“17命令必须同一次invocation”的硬门，CI本身也是五个独立job；保留final-8整体FAIL，在执行源码完全不变（`642a55a8…`）的新副本完整复验operations五条，再运行fresh journey一条。仅当新两组完整通过、三轮实际可执行清单/版本/参数一致并经非作者核对，才另建明确跨运行的本地覆盖索引；原报告与失败不改写，诊断PASS不代替验收，实际远端CI仍保留。


## P6-01 本地完整验收与交接（2026-09-23）

- 本地 ACCEPT：执行输入 `642a55a818680d763f41ce5d87b5386092591ea5341c92ce4e88c8248bcb8b72`，同源码跨运行5组17条原命令/14条核心路径齐全。final-8的quality/catalog/commerce、final-operations-9的完整运营5项、final-journey-9的fresh旅程全部PASS并分别获非作者核对；原final-8整体FAIL与8轮失败历史不改写，不称单次全套命令全绿。
- 原完整质量门通过：37迁移/200表、真实PG/TLS S3/API/worker、原format/lint、64类型/64测试/36构建、Domain分支95.26%；catalog/commerce七语双端、10次签名webhook唯一效果及双端海报60秒通过。运营859/7113/6748/6664/7146，278PNG/axe/reflow通过；fresh旅程14场×10里程碑、28实际语言切换、14创建、可信回跳/独立邮件查单、失败/取消恢复2、非法locale404、发布单效果与stop/reset均通过。
- 根与3个实际快照的2740执行文件（路径/字节/mode/新增删除）、49报告/日志引用、1121归档与原output逐SHA经独立复算；完整源一致，实际工具选择统一，journey未单列记录Chrome/PG补丁版本的粒度保留。原6144未跟踪文件无变化、无归属交集，秘密扫描通过，S.U.P.E.R 1–9与完整矩阵第10项本地范围通过；非作者原始记录及最后汇总见 `output/checks/p6-01-regression/final-verification.md`。
- 原Docker时间约束与财务5s读集合间歇失败原因仍UNKNOWN，受控/正式重跑PASS不等于证明修复；所有原失败与范围见最终验收记录。保留axe incomplete、预登录401与人工/真机边界。实际远端CI仍未运行，P6-01保持IN_PROGRESS，不增加DONE；正式PSP/商户、身份/邮件、译审、RUM、云staging/恢复/灰度原门均保留。
- 已正常重开原持久实例 `acceptance-e143d720dd1a4357a3c3` 并打开前台、管理中心与测试收件箱，4服务ready；未reset、私有配置字节不变，生成文件恢复后执行源仍相同。仅本地提交，不push/云apply/真实资金。Lane D释放。

## P6-02 有限本地激活与 READY（尚未领取）

原P3-06/P4-06/P5-02适用本地完整验收与非作者证据已独立核对，选定输入18/18、62/62、67/67以及共享UI/BFF49/49保持；新增发布/媒体重试、native TEST runtime等跨模块变化由最新独立源码审查及上述完整五组实际回归覆盖，不能用旧输入不变冒称共享模块全未改。见 `p6-02-readiness.md`、`p6-02-readiness-source-final8-preparation.json` 及最终五组/聚合review。

按用户已批准ADR-016，仅将P6-02有限本地ACTIVE/READY，范围为axe、键盘、320px/200%缩放、reduced-motion及七语断行/布局自动验收；真人VoiceOver/NVDA/语言核心路径等原门继续保留。Owner尚未分配，无executor；P6-03至P6-06仍PENDING、Phase7仍LOCKED。计数31DONE/7IN_PROGRESS/1READY/10PENDING=49。

## P6-02 执行登记（2026-09-24）

- Owner：Codex `/root`，Lane D 唯一 executor；开始 `2026-09-23T17:19:01.612505+00:00`；基线 `40854787`；分支 `codex/p6-02-accessibility`。原依赖与 P6-01 完整本地独立验收已核对，领取原 READY 项。
- 范围：七语言 axe、键盘焦点/错误、320 CSS px、真实 200% 浏览器缩放、断行与 reduced-motion 自动验收和必要修复；同时按本轮用户明确要求，优先让首页艺人下方直接展示真实礼物，取消看礼物之前的浏览/地区选择阻碍。保持已批准视觉和独立 locale/market/currency，不改变购物车或支付事实。
- 验证计划：先失败用例，最小实现；受影响单元/协议、七语双端与窄屏/缩放/键盘/reduce 浏览器，format/lint/typecheck/build、非作者复核和 S.U.P.E.R 十项。原未跟踪文件保护清单见 `output/checks/p6-02-accessibility/protected-untracked-baseline.json`。保护原持久体验，不 reset。
- 保留门：VoiceOver/NVDA 与人工语言检查不由自动测试代签；正式商户、真机、RUM、云/上线门保持。当前 31 DONE / 8 IN_PROGRESS / 0 READY / 10 PENDING = 49；后继不提前解锁，仅本地提交、不 push。

### P6-02 实施与验收记录

- 按用户追加需求及 ADR-017 新增无地区/币种的只读礼物浏览合同、应用服务、PG 仓储、HTTP/BFF 与首页真实目录。首页艺人后直接展示图片、名称和介绍，复用分类与分页；无上下文 `/gifts` 同样可以直接看内容，价格和加购仍由明确的交易上下文决定。首页海报读取返回失败时仍保留礼物区域。旧 700 个 JSON Schema 定义、204 个 OpenAPI schema、127 个既有路径逐值不变。
- 存储单独入口已接入常规 PG 门；作者 49 单测、真实 PG 803 目录检查与 69 严格发布/事故检查通过。事故范围明确为实际 PG 正常发布后，在 TEST SQL 结果叶子模拟缺译，不修改不可变已发布行。只有完整 proof 校验确认的英文内容和媒体才允许回退；原旧目录默认路径不启用该选项。
- 第一轮隔离浏览器 `run-1` 保留 FAIL：真实上架、首页直接浏览/分类/越界恢复、键盘详情/加购/结账及签名 TEST 支付通过，首个邮件环节停止。独立定位为收件箱授权后的自动刷新与测试立即 reload 竞争，真实投递/订单事实正常；补受控失败用例并修复测试等待，不能把该轮称为完整通过。
- 独立工具审查发现连续清理中首个 close 失败会跳过其他资源及临时 profile 删除，要求各资源独立收尾、任何清理失败阻断验收，并补真实高度核对。所有原失败保留；最终 28 单元浏览器和本地验收结论尚待补齐。
- 全仓 `check:dev` 已通过原 format/lint 与 64 typecheck /64 test /36 build，合同新鲜度、设计基础 57 项、adapter 边界和 32 包产物入口通过。用户原实例正常停启且 4 服务 ready，未 reset、私有配置 SHA 不变；原 8017 未跟踪文件逐 SHA 不变。后续工具修改仍需最终相关验证。
- `run-2` 原 FAIL 保留：49 项实际 daily 发布七语投影通过；邮件授权成功后，exchange 页短暂渲染 PAID，再异步跳转到规范订单路径。工具只等 PAID 就采样 URL 并再次导航，可能抢在 replace 前重载缺 fragment 的 exchange 页。真实 Chrome 延迟 replace 夹具先红后绿，现等待配置来源、原订单 locale、publicOrderId 对应的最终规范路径及空 hash，再做布局/语言切换。产品授权和支付不改，14 工具测试及相关格式/lint通过，完整接受仍待 fresh `run-3`。
- 两路非作者审查已通过前台和 PG，独立 PG 原目录 315、新目录 803、strict 69 检查均通过；harness 清理阻塞已关闭。旧 8017 未跟踪文件保护、原用户配置 hash 和四服务状态通过；另以有效 TEST CA 验证原持久实例中文首页 HTTP 200、艺人与礼物区域及已上架卡片存在，未创建 cart cookie。仅 GET，不更改用户数据。
- `run-3` 原 FAIL 保留：首 8 个单元完整通过，真实支付、独立邮件授权及审核/准备/送达完成；Thai 320 后台搜索发现两个问题。工具未等待本次结果，且产品在 query 改变时卸载带焦点的表单，却只在页码变化时将焦点移到稳定标题。真实延迟响应 RED 记录 pending/complete 焦点均掉到 BODY；最小产品修复将现有标题焦点 effect 依赖改为 `[selected, filters]`，不跟随输入 draft 或 loading/list 重复抢焦点。真实同场景 GREEN 验证加载前后标题和后续键盘进入订单；工具同时验证本次真实响应、合同、唯一订单、busy 和焦点，17 项工具测试通过。诊断副本的一行刷新单独登记，不混作原 run-3 冻结源。
- 产品修复后 `check:dev` 再次通过 64/64/36（缓存60/62/34）；后台单独 219 测试通过。原用户实例再次正常停启且 4 服务 ready，私有配置 SHA 不变。正确失败诊断实例已 stop 并保留；误建的空 TEST 实例在确认归属后已正常清理。完整新轮 `run-4` 仍在进行中。


### P6-02 本地最终接受与交接（2026-09-24）

- fresh `run-4` 全部 PASS，冻结执行源 `c7b2e52ba36558e104d10fead2a1e0c7f69cca65e3319ea8310231438a2b2903`。七语×手机/桌面/320px/原生200%共28单元、196核心页，额外越界页1、199张PNG；506键盘目标、8对话框、28实际延迟搜索焦点均通过，axe violations/incomplete、pageErrors、cleanupFailures均0。多页浏览器下一页未执行（只有一个已发布礼物），分页的多数据验证来自真实PG，不扩大声明。
- 原生200%在同物理窗体1710×929下，CSS1710×842→855×421、DPR2→4，两张物理PNG均3420×1684。实际daily上架七语49项通过；一笔独立TEST PSP签名支付、清cookie后独立邮件授权及审核/准备/送达完整通过，其余27单元不计为独立支付/邮件兑换。前台生产编译、后台本地开发模式，真实Chrome153/原生PG18.6/Node24.20.0。
- 最新全仓check:dev 64类型/64测试任务/36构建、后台219测试、工具17、合同新鲜度、设计基础57、边界与32公共导出通过；非作者实际PG旧目录315/新目录803/strict69及49单测通过。旧700定义/204schema/127路径原值保持。原run-1/2/3均FAIL保留，run-3焦点缺陷真实RED→GREEN及每格回归关闭，不用诊断拼接验收。
- 非作者最终 `final-independent-acceptance.md` ACCEPT：2782执行输入一致，2866冻结文件、249归档原件逐SHA核对；相关实现独立审查均通过。S.U.P.E.R十项本地通过，详细命令、范围、剩余风险见 `output/checks/p6-02-accessibility/final-verification.md` 与 `verification-index.json`。
- 原8017未跟踪文件和私有用户配置SHA不变；原持久实例 `acceptance-e143d720dd1a4357a3c3` 四服务ready，中文首页实际GET200、直接礼物卡片且不创建cart cookie。用户数据未reset；run-4自有实例正常stop/reset、临时浏览器profile删除，失败诊断实例停止但保留原数据。仅本地提交、不push。
- P6-02本地自动范围接受并释放Lane D，状态仍IN_PROGRESS；真人VoiceOver/NVDA、七语人工理解/读屏、真机与正式内容等原门未代签，不增加DONE。

## P6-03 有限本地激活与 READY（尚未领取）

按ADR-016与非作者 `output/checks/p6-02-accessibility/p6-03-readiness.md`，原P3-06/P4-06的适用完整本地成果、最新P6-01整合验收及本轮P6-02当前共享源完整验收均可消费。Lane D已释放，仅P6-03置READY，无owner/executor；全局31 DONE/8 IN_PROGRESS/1 READY/9 PENDING=49。P6-04至P6-06仍PENDING、Phase7仍LOCKED。

范围与验证计划：独立TEST服务、冻结生产编译；七语×SPEC六基准视口的Lighthouse/资源与按locale字体/消息包；首页新礼物区12/48条及大目录真实PG响应成本；图片/缓存/第三方脚本与核心交互；RUM采集、查询/仪表板的可测试接线。固定原样本、网络/CPU、缓存和版本，性能采样串行独占负载，保留全部慢值/失败及前后对照；先失败用例、受影响测试、原质量门、非作者复核与S.U.P.E.R。不得用旧首页性能报告、TBT或合成事件替代当前性能/真实用户INP与p75；真实RUM窗口/样本、云staging、真机/真实网络等原门仍须后续取得证据。领取前仍需执行代理完整读取当前入口并登记开始时间。

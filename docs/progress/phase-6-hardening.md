# Phase 6 — 质量、安全与韧性加固

> 状态：ACTIVE（ADR-016，P6-01 本地已 ACCEPT；仅新增 P6-02 本地范围 READY）
> 任务：6  
> 正常解锁条件：Phase 5 退出门禁通过；按 ADR-016 逐项登记本地范围；P6-01 本地已验收，现仅 P6-02 READY，P6-03 至 P6-06 仍 PENDING。

## 目标

系统化证明产品在可访问性、性能、安全、事件故障与恢复方面达到发布门槛。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P6-01 | IN_PROGRESS | —（本地 ACCEPT，Lane D 已释放） | P4-06、P5-07 | 5组/17命令/14路径本地通过；实际远端 CI 待补 |
| P6-02 | READY | —（尚未领取） | P3-06、P4-06、P5-02 | 原依赖本地完整成果已独立复核；仅激活七语可访问性本地范围 |
| P6-03 | PENDING | — | P3-06、P4-06 | 分 locale 字体/消息 bundle/Performance/RUM |
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

P6-01 完整本地回归已 ACCEPT，保留远端 CI；仅新增 P6-02 本地范围 READY。Phase 完整退出仍待全部原门。

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

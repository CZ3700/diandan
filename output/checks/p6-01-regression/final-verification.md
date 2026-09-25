# P6-01 完整本地回归 — LOCAL ACCEPT

执行者 `/root`，分支 `codex/p6-01-regression`，基线 `7ad8be93871c2aefa600ad4e299f85454f27c168`。执行输入 `642a55a818680d763f41ce5d87b5386092591ea5341c92ce4e88c8248bcb8b72`，Node 24.20.0 / pnpm 11.25.0；统一选择原生 PostgreSQL 18.6 工具目录，TLS S3 使用 Docker。各有版本字段的真实服务记录为PG18.6/Chrome153.0.8010.53；journey验证PG18且沿用同工具选择，但未单独保存Chrome/PG补丁版本，不从其它组借证。完整五组与聚合已分别获非作者限定接受；完整本地范围ACCEPT，实际远端CI保留。

## 实现范围

- 固定五组、17条命令和 SPEC §18.2 的14条核心路径；隔离源码副本、冻结离线安装、失败即停、源码指纹与证据归档；CI 分五个 job，任何失败/取消/跳过阻断汇总。
- 补齐七语言游客购买、托管 TEST 支付、可信结果、语言切换、独立邮件查单；10次真实签名 webhook 的唯一业务效果；双端海报发布/恢复60秒门。
- 严格英文事故恢复：绑定既有批准 manifest 与翻译恢复证明，七语 SEO alternate/sitemap 精确处理；政策正文继续 fail-closed，未扩大日常内容发布规则。
- 管理中心媒体及发布事务只对明确已回滚、可重试的 port 错误做最多3次总尝试；每次重读权限/租约/checkpoint，外部图片检查不重复，未知提交不重放。
- 统一可选原生 TEST PostgreSQL 18，保留默认 Docker；环境选择冲突/非法值立即拒绝、无静默降级，严格限定资源归属与清理。
- 修复回归检查器的双向媒体范围识别、0037旧回滚工具、真实PG登录期限测试前提、Git环境变量隔离、英文恢复缓存用例及测试层依赖归属。公共合同、数据库迁移与依赖锁文件不变。

## 当前结果与同源码分组方法

| 分组 | 原始运行 | 状态 | 关键证据 |
| --- | --- | --- | --- |
| quality | final-8 | PASS | 原完整 pnpm check、37迁移/200表、真实PG/API/TLS S3、format/lint、64类型/64测试/36构建；Domain branch 95.26% |
| catalog | final-8 | PASS | SEO恢复19085、浏览32461、礼物21898、管理7377；海报双端发布/替换/恢复均小于60秒 |
| commerce | final-8 | PASS | 购物车5924、支付7077、安全订单7429；7语双端、可信支付和金额/上下文保持 |
| operations | final-operations-9 | PASS / 独立 ACCEPT | 登录859、订单7113、财务6748、配置6664、异常7146；278截图/axe/reflow通过 |
| journey | final-journey-9 | PASS / 独立 ACCEPT | 七语×双端14场×10里程碑、28次实际语言切换、14次创建、可信回跳、独立邮件查单、失败/取消恢复2、非法locale404、唯一发布效果 |

这是同源码、跨运行的完整分组验收方法，不是单次默认命令全绿。`final-8`原整体FAIL和各部分报告不改写；最终索引已验证根目录与三份实际快照各2740个执行文件路径/字节/mode/新增删除、同源码/原参数/明确工具选择、唯一5组17命令与14路径，并由非作者独立复算接受。实际版本粒度见 `final-tool-version-scope.json`，不冒称journey单独记录所有补丁版本。方法审查见 `cross-run-method-review.md`，生成器审查见 `evidence-assembler-review.md`。归档器不是内容脱敏器，另有文本/截图隐私复核。

## 已保留的失败与边界

- final-1至final-8原FAIL全部保留，不被旁路单项PASS覆盖。产品/工具的已证实缺陷及RED/GREEN、独立审查见 phase6 执行卡和各专项报告。
- 原Docker财务/订单时间约束失败观察未复现，机制仍UNKNOWN；不能称原生模式修复了它们。
- final-8财务浏览器读取归零5秒失败，原源码旁路6742及10对路由移除受控实验均未复现；正式operations新轮财务6748通过。根因仍UNKNOWN，不称修复，不清空读取集合或增加超时。
- 真实远端GitHub CI未运行；人工VoiceOver/NVDA/译审、物理手机、真实商户/PSP sandbox与小额支付退款、USDT专属接入、正式身份/邮件/KMS、RUM、云staging/恢复/灰度及上线证据均未代替。
- axe incomplete与既有moderate记录保留。浏览器尺寸模拟不是物理手机，当前实验室证据不等于真实RUM或全部人工可访问性验收。

## 复现与交付

完整入口：`mise exec node@24.20.0 -- corepack pnpm verify:regression --output <新的证据目录>`；设置 `POSTGRES_TEST_BIN` 为绝对 PostgreSQL 18 工具目录。本轮使用 `output/checks/p5-03-refund-operations/native-runtime/dist/postgresql@18/18.6/bin` 的绝对路径。分组复验分别追加 `--suite operations` 与 `--suite journey`，原阈值与场景不变。详见 `docs/testing/full-regression.md`。

当前原6144个未跟踪文件SHA无变化、归属无交集；84个明确源/文档路径中83个实际修改或新增，1个基础测试已恢复原样。同执行源码与交付证据追加秘密扫描均exit0；最终提交仅选定源码与公开证据，不包含用户数据、私有配置、媒体数据库或历史未跟踪资料。S.U.P.E.R 1–9当前源码通过，第10的五组实际执行均通过且聚合独立接受；仅声明本地范围10项PASS。原持久实例 `acceptance-e143d720dd1a4357a3c3` 已正常start/open，四应用ready；未reset、私有配置字节不变、生成的next-env已恢复，执行源码仍完全相同。


## 最终独立证据入口

- `final-evidence-index.json`：同源码跨运行五组、17命令、14核心路径；全部49引用/日志绑定，不删除8轮原FAIL。
- `final-artifact-integrity.json`：723+304+94共1121份归档逐SHA匹配原始output；不是内容脱敏证明。
- `final8-{quality,catalog,commerce}-independent-review.*`、`final-operations-independent-review.*`、`final-journey-independent-review.*`：五组底层断言与范围。
- `final-aggregate-independent-review.*`：独立重算5唯一组/17命令/14覆盖、四份执行树2740文件、日志引用及归档；保留原失败与版本限制。
- `privacy-final8.*`、`privacy-operations.*`、`privacy-journey.*`：全部公开文本精确私密标记/字段检查及11张截图抽查；其余图片不冒称逐张人工审查。`visual-inspection.md`有额外实际布局查看。
- `owned-source-verification-final.json`：原6144未跟踪文件无变化、归属无交集，恢复体验后2740执行输入仍一致。
- `user-experience-restored.json`：正常恢复原实例与4服务健康；未使用reset。

连续旅程零pageerror；内容准备的预登录阶段保留一条401控制台记录，不称全程零console。原FAIL只说明当时结果；新的完整分组PASS也不证明历史UNKNOWN根因已修复。


P6-01因实际远端CI未跑仍IN_PROGRESS，Lane D已释放。P6-02原依赖本地成果与新增共享模块独立证据均已核对，仅新增该项有限本地READY、尚未领取；31DONE/7IN_PROGRESS/1READY/10PENDING=49。Phase7保持LOCKED，无Git push/云apply/真实资金操作。

取证时的一次性诊断脚本已按原字节归档为`.mjs.txt`（映射见`execution-script-archive.json`），避免输出目录被当作应用源码扫描；规则不变，归档后的根工作区原`eslint . --max-warnings=0`也exit0，`git diff --check`通过。完整原件和未入Git的大量截图保留本地证据目录；本地提交包含选定公开索引、文本/JSON日志和4张已查看截图。

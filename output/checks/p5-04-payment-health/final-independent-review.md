# P5-04 最终本地整合验收复核

日期：2026-09-22（Asia/Bangkok）。Reviewer：`/root/health_runtime`。本轮只读源码、日志、JSON 证据并实际比较文件内容/SHA；没有重新运行测试、构建、数据库或浏览器，也没有修改产品源码、任务状态或暂存区。

## 结论

**ACCEPT：当前冻结候选的 P5-04 本地可交付范围已完整实现并通过验收，没有发现剩余阻断缺陷。可以按 ADR-016 承接 P5-03，并作为 P5-05 的完整本地输入。** 这取代此前 `next-stage-readiness.md` 中等待最终全局门、浏览器和候选核对的条件，不把该报告较早的待验状态误当作现在的阻断。

协调者已完成最终秘密扫描和暂存差异检查，后续本地提交、交付记录和状态登记由协调者执行。P5-04 的真实 PSP、商户及原外部验收继续保留，任务应保持 IN_PROGRESS 并释放 executor，不能为了满足后继依赖而改成完整 DONE。按协调者当前排期，只将 P5-03 登记 READY；P5-05 已有完整本地技术输入，但须在后续共享合同和文件归属冻结、Lane C 登记后再就绪。本报告不领取两项，也不声称它们已实现。

## 独立性与覆盖来源

本人是本轮应用健康接线、API 生命周期和组合的一部分、gateway 空能力修正及灰度 HTTP runner 的作者，**不将本人再次阅读这些实现视为它们的独立代码验收**。其非作者覆盖来自：

- `application-independent-review.md`：`health_storage` 对 application/API 的独立 ACCEPT，包括原结果不被健康持久化覆盖、能力封闭、原账户恢复，以及后来补齐的单轮最多初始化一个账户。
- `rollout-independent-review.md`：`health_storage` 对合同/Domain/0034/PG 准入和灰度 HTTP 证明的独立 ACCEPT。本人编写的 runner 也由该报告核对，不能只援引本人运行成功。
- `persistence-independent-review.md`：本人对非本人编写的 PG 健康状态/0033 的独立复核；partial rollout 和 INTERNAL+LIVE 问题已经修正并通过真实 PG/HTTP 补证。

本次新增的直接非作者审查覆盖：新 gateway shared conformance 测试、root 的健康合同与 artifact registry/配置键边界、现存 connector registry 的不变边界，以及后补的 `payment-health-client.ts`、对应测试和独立健康事务接线。最终源码与证据的一致性也由本次实际比较确认。各模块作者自己的 RED/GREEN 和说明用于证明执行结果，不被改称为独立设计结论。

## 新共享认证与合同边界

1. `packages/payment-gateway/src/conformance.test.ts` 直接构造真实 gateway，调用原 `runPaymentProviderConformance` 的全部 15 个场景；没有将 fake provider 包装成 gateway，也没有复制或改松共享 suite。TEST 上游通过真实 `node:https`、独立 CA、精确 SAN 和 `rejectUnauthorized: true` 通信，保存支付、取消和退款状态。正例核对 15 次真实请求覆盖全部七操作，并验证路径、认证、merchant/protocol、幂等请求头和 instrument；最终退款计数和金额证明重放没有重复累计。
2. 五个负例分别破坏关联、退款回放、幂等冲突、退款上限及新审计对账事件 ID，要求原共享 suite 在对应场景返回失败。它们是成功的拒绝性验证，不被宣传成曾观察到五个产品缺陷。上游 fixture 和套件只能证明本仓库通用端口语义，不能证明某商业 PSP 的官方接口、3DS 或真实退款。
3. 最后修正是用 `PAYMENT_PROVIDER_OPERATIONS.some` 和类型守卫限制七操作；不是扩大允许范围。`structural-final.log` 中真实 legacy 引用失败仍保留；现在不支持的操作仍被拒绝。实际与基线逐字比较确认：原 adapter checker、共享 conformance suite 和 connector registry 都未改变。
4. 新健康合同严格限定 schemaVersion、账户/环境、整数阈值/期限、四种分类及其有限 code 对应关系。观测不接受原始 provider payload；probe context 只能是同账户、同环境的 GET_CAPABILITIES，且固定真实 route/config/rule 身份、市场/国家/币种/金额/locale/action。claim 最多 100 个去重账户，lease 固定 probe ID、generation、expiry 和完整 context。跨模块入口和返回均为可序列化 Zod/port 对象。
5. 12 个健康 root 和 2 个灰度 root 在 artifact registry 中均标为 internal。没有给公开 HTTP 增加 seed、健康编辑或任意代码接口；原公开 OpenAPI 内容未变。两个灰度比例和有界桶是内部诊断，资金资格仍由应用、repository 与数据库各自验证。
6. 新 `FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON` 只进入服务器配置键白名单；测试保留未知拼写拒绝和环境优先级。生产账户必须对应完整策略集合的组合行为已有非作者复核及实际测试。PG 是已初始化策略和状态的权威；同版本漂移拒绝，不靠环境值静默替换旧政策。现有 connector registry 仍只接受已部署工厂和可信已发布投影，历史账户连接不能改写或删除，它不是运营发布服务。
7. 后补健康 I/O wrapper 对连接获取、SQL 和 COMMIT 使用一个单调时钟总 budget，并在 BEGIN 后设置剩余 PostgreSQL LOCAL lock/statement/transaction 期限；超期销毁连接，迟到连接只能释放，普通 release 幂等。25P04 等服务端超时归一到有限错误；COMMIT 丢失保留 UNKNOWN。实际接线只用于健康事务，普通财务事务没有被套用新的超时策略。已读取覆盖迟到获取、永不结束 query、累计期限、COMMIT UNKNOWN 和 25P04 的测试及真实 PG 锁阻塞记录；没有发现新的阻断问题。

## 同候选与保护的实际核对

- 对 `candidate-source.json` 与 `candidate-source-final.json` 的全部 **2380** 个路径比较：无增删，唯一变化为 `packages/payment-gateway/src/conformance.test.ts`。对后者清单逐文件重算 SHA，**2380/2380 与当前文件一致**；产品源码没有在最终集成之后漂移。
- 最终候选指纹为 `e866fd6218c2f6b655e5fca37201f12e7a96dadcd60e1fb0af27e63b5b3b34a5`。较早实际 HTTP/浏览器执行可承接产品源码；最后测试白名单修正由 `gateway-final.log`、`structural-final-2.log` 和 `check-dev-accepted.log` 重新覆盖，不将最后一轮的缓存说成全新无缓存构建。
- 对最初保护清单实际重算：**5717 个原未跟踪文件均未改变**。只读比较基线 `40a57b47fee8de1e9babc7d0a66637b3251cb227`：**64 个旧 SQL 文件逐字不变**。
- 实际解析基线及当前 `contracts.schema.json`：**645 个旧 root 定义全部相同，当前共 659 个**；原 OpenAPI 逐字相同。`compatibility-final.json` 另外记录原 32 条迁移 manifest 内容不变；最终 manifest 检查在结构门通过。
- 收尾补报：协调者实际执行 `secret-final.log` 对应扫描 exit0、`staged-diff-check-2.log` 对应检查 exit0，本人读取记录但未重复执行。本人另行只读核对当时暂存359个自有文件，与原5717个保护路径的交集为0。首次 staged diff check 因终端日志文本末尾空白失败；仅 Git 文本副本规范化行尾/尾随空白/末尾空行，原 `.log` 保持。对 `log-transcripts.json` 的145组原件/副本逐一验证双SHA及规范化内容，全部一致，失败结果没有被删除。本文新增后协调者仍需把最终报告纳入本地交付，不能将这一暂存快照宣称为已经提交或推送。

## 已核实的最终执行证据

本表为实际读取协调者最终日志/结构化产物后的复核，不声称本人再次执行。

| 门                 | 最终记录与结果                                                                                                                                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全局开发检查       | `check-dev-accepted.log` 明确 workspace/domain-boundaries/format/lint 通过；typecheck 63/63、test 63/63、build 36/36。缓存分别62/62/35。开发门自身明确不包含 PG/S3/browser，以下证据另行补齐。                                                                                                            |
| 网关与结构         | `gateway-final.log`：9 文件106 tests PASS。`structural-final-2.log`：原 adapter、artifact imports、CI、runtime、observability、manifest 等全部通过；没有修改 checker。初次 structural 失败保留。                                                                                                          |
| 合同               | `contracts-final.log`：构建和生成 freshness 检查通过；`compatibility-final.json` 与本次独立内容比较一致。                                                                                                                                                                                                 |
| 健康 PostgreSQL    | `persistence-final.log`：真实本地 PG 85 checks PASS，含有界锁阻塞及既有健康约束。                                                                                                                                                                                                                         |
| 灰度 PostgreSQL    | `rollout-postgres-final.log`：8224 assertions、4099 个输入的 TS/PG 逐值一致，含精确阈值与隔离 DDL 往返。不是实际部署降级演练。                                                                                                                                                                            |
| 健康 HTTP          | `http-2026-09-21T18-31-56.177Z`：5869=5761 准备+108 场景，真实 PG/HTTP/TLS TEST PSP，双实例单恢复 probe，原 UNKNOWN 恢复及策略漂移封闭。                                                                                                                                                                  |
| 灰度 HTTP          | `rollout-http-2026-09-21T18-34-08.341Z`：6071=5761 准备+310 场景，合法 checkout 两组、七语/双实例稳定、两层 PG 准入独立防绕过、partial 健康恢复、正常新0%版本后拒绝新创建且原 UNKNOWN 原路恢复。最终支付/create/reconcile均1，captures为0。                                                               |
| 原支付与浏览器回归 | `payment-browser-final.log` 及 `output/checks/p4-04-payment-runtime/run-2026-09-21T18-34-09.039Z`：整体7077 assertions PASS；浏览器31 cases、71张PNG、57条axe记录，实际统计 violations/incomplete均0、pageErrors=0，所有PNG存在，浏览器已关闭。七语言覆盖390/1440、键盘、reduced motion及冻结locale回跳。 |

灰度 HTTP 的较早343场景与本轮310场景不同，来自为取得两组随机服务端 checkout 所需的真实创建次数不同；固定行为验证仍在，循环上限30不变。不能把准备断言全算作新增业务断言，也不把最终310与较早343相加夸大覆盖。此前 runner 导入及 TEST publication 顺序/head版本的错误保留在 `rollout-http-review.md`，修正没有放宽产品约束。

## 本地交付与后继范围

结合上述非作者模块报告、当前候选及最终质量/真实集成证据，S.U.P.E.R 十项在本地交付范围均满足：职责/单向依赖和循环由源码及结构门核对；跨模块 schema/序列化明确；正式配置外置且无支付代码动态加载；新 testing devDependency 明确；可替换 provider 通过原 shared suite 实测；最终测试和构建通过。TEST 常量、模拟上游状态、测试直连 SQL 都没有进入正式支付运营流程。

P5-03 可以消费已验收的 P5-01/P4-05 与 P4-04 本地七操作、原账户恢复和可信入账边界；P5-04→P5-03 是既定排期顺序，不新增业务依赖。P5-05 可以消费本轮完整能力/规则/灰度/健康基础，仍须自己实现管理中心 draft/validate/publish/rollback、七语言关键文案、差异/确认/审计、≤60秒传播和≤1分钟回退；尤其须协调健康政策版本、初始bootstrap与新增账户目录传播。合成 SQL 发布 fixture 不能替代这些未开发功能。

两 API 实例是同 Node 进程内独立组合/连接池/lifecycle，TEST PSP 为独立进程；这些证据不是部署级多节点、真实 PSP sandbox、正式商户/USDT mapper、卡网络、3DS、真实小额付款退款或真实渐进灰度。政策/Secret/商户批准、staging/云apply、实际恢复演练、真人读屏/真机和生产发布仍按原门保留。不能在新版 beginCreate 仍运行时单独回退删除0034 bucket helper。Phase6/7不因本结论自动解锁，Git push/真实资金/生产发布也未获本地排期授权。

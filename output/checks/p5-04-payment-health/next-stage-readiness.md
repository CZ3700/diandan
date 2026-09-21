# P5-03 / P5-05 本地接续就绪审查

审查时间：2026-09-22（Asia/Bangkok）。Reviewer：`/root/remaining_task_audit`。只读规范、当前状态、相关源码、已保存验收和非作者复核；只新增本报告，没有领取 Task、运行测试/服务或修改主进度。本人是 P5-04 灰度/认证测试作者，本报告不是本人实现的独立验收；对应非作者报告另列。

**结论：两项均是有条件可接续，当前仍 PENDING，不能据本报告直接视为 READY。** P5-04 的统一全局检查、浏览器回归、最终同候选保护/非作者验收仍由 root 收口；只有这些 PASS、完整本地交付有最终记录、Lane 和合同条件成立后，协调者才能逐项 READY 并登记 owner。不是要求 P4-04 真实商户或整个 P5-04 全任务先 DONE，也不是再次申请排期授权。

## 原直接依赖与精确范围

| Task  | 原直接依赖 / Lane           | 本地必须交付与最低验收                                                                                                                                                                                                   | 不能据此消除的外部门                                                                                                            |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| P5-03 | P5-01、P4-04、P4-05；Lane A | 同一管理中心内受权取消、全额/部分退款、拒付和统一对账视图；完整命令/PG/可信证据/PSP端口闭环；并发金额上限、退款行分配、重复命令、乱序/早到/迟到证据与 UNKNOWN 恢复；合成 TEST 支付、真实 PG/HTTP/worker/浏览器及独立复核 | 原最低验收中的真实 PSP sandbox refund、实际事件映射与恢复；批准商户/协议、资金与经营主体退款/争议政策，不以本仓库 TEST 服务替代 |
| P5-05 | P5-01、P5-04；Lane C        | 同一管理中心的支付配置 draft/validate/publish/rollback；七语言渠道名称/提示、差异预览、二次确认、不可变审计；非法/空路由和关键译文缺失拒绝；发布≤60秒、回退≤1分钟；多实例传播、失败重试/旧版本恢复及旧 attempt 不换路    | 正式账户能力、获批关键译文、真实 Secret/部署环境与商户资格；本地受控配置与模拟审核不能代表实际生产批准                          |

依据：`docs/plan/task-breakdown.md:141-143`；Lane 来自同文件52-54行。ADR-016:29-37明确 P5-04→P5-03/P5-05 的次序；其中 P5-04→P5-03 是减少支付合同变动的排期顺序，不是新增原直接业务依赖。现态为 MASTER:5-8、phase-5:17-19：P5-04仍由root占Lane A，P5-03/P5-05未领取。

## 逐项依赖证据及当前源码复核

| 依赖              | 已验收本地输入与可消费范围                                                                                                                                                                                                                                                                      | 已有非作者结论 / 保留项                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5-01（两项共同） | `output/checks/p5-01-admin-access/final-verification.md:7-11,25-31`：OIDC/平台角色、可撤销session、CSRF/MFA、每次动态授权和append-only审计；PG115、真实登录七语双端859、原管理7345、最终check:dev通过。当前选取admin-access/OIDC源码与0030共23文件，对`source-fingerprint.json`逐SHA为23/23相同 | 同报告30、48-57行明确非作者各模块ACCEPT及S.U.P.E.R10项。`compatibility-super-review.md:16-18`是历史待整合快照，已由final-verification:59明确闭合，不能当作未解决阻断。正式IdP/MFA/恢复与UAT仍外部待验收                                                                                                                                                                         |
| P4-04（P5-03）    | `payment-runtime/final-verification.md:7-10,15-20`：PG两事务、永久receipt、固定account/attempt、托管动作与UNKNOWN原账户reconcile；`payment-connectors/final-verification.md:7-10,16-19`：七操作端口、静态已部署工厂/版本投影、真实受控HTTPS。目录均位于`output/checks/p4-04-*`                  | runtime的`final-independent-review.md:3,9-18,24-32`接受精确本地TEST范围；connectors的同名报告3-8行接受模块与最终证据，保留分段check和真实商户未完成。ADR-016:19-23,30明确允许后继消费这些接口；不得要求其全任务DONE后才本地开工                                                                                                                                                 |
| P4-05（P5-03）    | `output/checks/p4-05-order-storefront/final-verification.md:7-25,35-37`将付款证据应用、安全查单、七语历史UI三段合并验收；原完整check exit0，订单入账6827、安全查单6860、订单浏览器7373。复用canonical capture/order/ledger、已认证事件关联与库存/历史保护，不把UI状态当金融证据                 | `final-independent-review.md:3-5,9-17,36-44`最终ACCEPT且无阻断；前两段review由该最终任务验收覆盖。当前选取order-payment/order-access/0027/0028共39文件：对原P4-05指纹35相同、4个order-access文件后续改变；对已验收P5-02 `source-final-before.json`为39/39相同。P5-02 `final-verification.md:33-37,45`记录最终源不变、原付款/订单完整回归与非作者接受，未把老SHA错误套用到新源码 |
| P5-04（P5-05）    | 本轮已具备能力/规则、确定性部分灰度、PG健康熔断/有界恢复、gateway shared suite。`rollout-http-review.md:7-17`：真实PG/HTTP/TLS TEST，343业务+5761准备，双实例七语、双准入防绕过、单probe及正常新0比例publication后旧UNKNOWN恢复；最终payments/create/reconcile=1/1/1                            | `application-independent-review.md:7,20-27`、`persistence-independent-review.md:29-35`、`rollout-independent-review.md:7,11-31`均接受各自非作者范围，旧P1已闭合。root最终统一全局/浏览器/候选保护与完整复核仍未由本报告确认，当前不能直接消费为完整依赖                                                                                                                         |

SHA复核是本次实际只读文件比较，范围按表内选择，不宣称把全部旧项目重新验收。P4-04 connector所选7个非测试源码对旧source-final是6同/1变，变更为本轮`packages/payment-gateway/src/client.ts`；当前runtime/application也在P5-04范围内更新。这些变化必须由root本轮最终门承接，不能只援引旧connector截图或旧全仓结果。新增conformance的作者记录不是它自身的非作者复核。

## P5-03 领取后的实现边界

- 先复用现有 `packages/domain/src/refund-capacity.ts:56-115`、`refund-state-machine.ts`、`dispute-state-machine.ts`，以及 `packages/payment-port/src/index.ts:63-95` 的 cancel/refund/reconcileRefund 七操作合同。现有函数和PG表是基础，不等于管理退款编排/界面已经交付；领取后先核对调用链再补缺口，避免重写。
- 锁订单/原capture与完整退款集合后判额度：币种固定原capture，successful+pending（含UNKNOWN）≤captured；`refund_items`准确分配行金额。成功attempt不能因退款/拒付离开SUCCEEDED。只有可信失败证据释放UNKNOWN占款，普通超时不能再次退款或取消原UNKNOWN付款（SPEC:910,980-985,1005）。
- 写操作须明确Manager对应授权、二次确认、原因/幂等/版本及审计，不能复用Daily Operator发布权，也不创造“Finance”新角色（SPEC:634-645,1200）。取消、退款和争议分别按已有正交状态机；统一对账展示事实与恢复动作，不提前合并P5-06通用webhook重放/DLQ运营范围。
- 可用真实本地TLS/PG TEST证明端到端和并发/故障行为；仍须记录真实sandbox refund欠项，不把接口mock或通用gateway conformance计作实际商户退款。

## P5-05 领取后的实现边界

- 现有 `packages/payment-gateway/src/registry.ts:115-183` 仅接收已发布投影，历史account绑定禁止改写/删除；P5-04的`payment-rollout-publish-fixture.mjs`是直接SQL的合成TEST夹具。两者都不是管理中心配置author/validate/publish服务，不能因为测试成功就跳过权限、差异预览、确认、审计、传播和回退实现。
- 明确承接本轮尚属构造期的health policy：`packages/application/src/payment-runtime-health.ts:73-101`及`payment-health-repository.ts:76-118`只bootstrap固定版本，漂移返回POLICY_CONFLICT；新account缺对应policy会封闭准入。配置发布必须协调policy版本/激活、已部署directory与传播，不能让新渠道“发布成功但所有节点不可用”；这是`application-independent-review.md:25`明确的后继边界。
- 合法配置版本发布/回退均保持不可变历史；新rule UUID意味着新群组，不承诺跨新rule保留原桶。旧attempt/UNKNOWN按原receipt恢复，渠道停售不重新挑账户。原0034代码还在运行时不可先删除其SQL helper（`rollout-independent-review.md:31`）。
- 支付关键名称/提示仍需真实七语言批准，缺失/过期/自审拒绝。它不改变§9.0/ADR-012艺人、礼物、海报的一图短表单、真实原文直接发布与海报历史恢复；日常操作不增加导入文件/七语审核前置步骤。

## READY 的最后交接条件

1. root完成P5-04冻结候选的全局检查、实际浏览器回归、兼容/旧迁移/原文件保护、S.U.P.E.R与覆盖全部改动的非作者结论；写明真实商户缺项。局部HTTP PASS不替代这一步。
2. 对P5-03记录已验收P5-01/P4-05与P4-04精确本地接口；对P5-05记录最终P5-04本地完整验收。仍待外部的任务保持IN_PROGRESS并释放executor；不要把P4-04/P5-04改DONE来强行满足依赖。
3. 冻结共享支付/权限/配置合同与独占文件表后，P5-03占Lane A、P5-05占Lane C可由不同executor并行；同一代理只领取一个Task。先在phase登记owner、开始时间、范围和验证计划，后改代码。若共享合同未冻结，先按顺序推进，不能在同一文件双写。
4. 本次授权已经由ADR-016接受，无须再询问。真实资金、云apply、正式内容发布、Git push/生产上线、正式PSP/市场/主体/政策选择未获本地排期授权；Phase6/7仍LOCKED。所有任务原最低验收和外部门保持。

本报告仅准备接续，不修改READY、owner、计数或Phase状态；后续最终结果变化时以root的实际同候选收口记录为准。

补记（本报告写入后root通知并只读核实）：`structural-final.log` 的原 adapter 门确因新 conformance 测试直接引用仅旧兼容目录允许的 legacy webhook 操作而失败。当前测试已改用 `PAYMENT_PROVIDER_OPERATIONS.some` 白名单和类型守卫，不支持操作仍拒绝；原 checker 未被要求放宽。该窄改只在测试源码，受影响gateway测试与最终结构/全局门由root复验；结果尚未由本报告确认，**仍不具备直接READY结论**。本报告不覆盖或改写这次实际失败。

协调者最终收口（2026-09-22）：上述等待条件已由`final-independent-review.md`的ACCEPT、`final-gates.json`实际门和`final-integrity.json`同源保护闭合。仅P5-03置READY且尚无owner；P5-05确认本地输入完整，等待下一轮共享合同/文件归属冻结后才登记Lane C就绪。原直接依赖和所有外部验收保持，无新增审批。

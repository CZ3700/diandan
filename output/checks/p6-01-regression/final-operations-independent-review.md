# P6-01 运营五项完整本地证据独立复核

2026-09-23；reviewer `/root/regression_readiness`。**ACCEPT_OPERATIONS_ONLY_JOURNEY_PENDING**。root实际执行的`final-operations-9`已PASS；本review只读原报告、日志、冻结源码及归档，没有运行数据库、服务、浏览器、测试或构建。整体仍待最后journey及同源组合证据终验，不把此单组PASS当成完整回归。

## 本次执行绑定

runId `479c6a33-16d3-4344-b173-5ebf50d278e3`；源 `642a55a818680d763f41ce5d87b5386092591ea5341c92ce4e88c8248bcb8b72`。五条原命令按计划顺序执行，全部exit0、无signal/launch failure；report.execution与steps一致。2740个执行输入清单与final-8逐项相同，并对当前root和实际运行snapshot的每一文件SHA及mode重新验证一致。

本轮是完整operations组的一次标准执行，不是各运营子项诊断拼接。运行报告正确保留`coverage.complete=false`，其他组在本轮不算执行。旧final-8仍FAIL，未改写。

## 五个原入口

| 命令 | 总checks | browser assertions / cases | PNG / axe / reflow |
| --- | ---: | ---: | ---: |
| `verify:admin-access:browser` | 859 | 537 / 21 | 34 / 34 / 34 |
| `verify:admin-orders:browser` | 7113 | 419 / 8复合cases | 32 / 32 / 32 |
| `verify:admin-finance:browser` | 6748 | 330 / 9复合cases | 58 / 58 / 58 |
| `verify:admin-payment-configuration:browser` | 6664 | 466 / 8复合cases | 65 / 65 / 65 |
| `verify:admin-exceptions:browser` | 7146 | 708 / 11复合cases | 89 / 89 / 89 |

所有browser assertion均passed，全部278个PNG存在，278次axe为0violations/0incomplete，错误数组为空。278条重排证据包含登录的实际document/body宽度记录及其余每次capture的无水平溢出断言。五项分别验证七语×390×844/1440×900的14个唯一矩阵格，登录/工作区、订单列表/详情、财务核对/全额/部分退款、配置设置/阻断/编辑、异常列表/四种来源所需截图全部齐全。复合case数不误报为实际只有8或9个浏览器页面。

35条原报告/日志SHA已记录于`final-operations-independent-review.json`；其中26个消费的底层JSON在最终archive中也逐字hash相同。归档报告共304文件，不将JSON对比冒称重新视觉审查所有图片。

## 实际环境与证据粒度

五项实际Chrome版本均为 **153.0.8010.53**。财务、配置、异常scope/runtime metadata直接记录 **NATIVE_ISOLATED_TEST / POSTGRES_TEST_BIN / PostgreSQL18.6**。登录与订单确实走同一显式common native18入口，且入口版本约束已独立review；它们旧报告没有单独持久化serverVersion，因此本review不冒称分别取得了数据库版本观测。

真实PG、TLS OIDC、自有TLS S3及持久TEST PSP由各原harness执行；订单UI通知transport明确为TEST in-process，持久HTTPS resend另由原独立通知门承担。配置实际两个API进程，异常实际pg-boss/worker、持久TEST邮件服务。所有scope均非真实商户或资金，公开结果不包含原始身份、支付、邮件私密正文。

## 场景与负例核对

**登录与权限：** 七语双端登录→工作区→退出全覆盖；HTTP验证六种工作人员角色的数据库权限，未知身份不能自行注册，callback重放/跨浏览器/并发会话、CSRF不符、无MFA/错误签名/上游断连均受拒绝或受控恢复。浏览器另有no-mfa、wrong-signature、disconnect的显式重试、SESSION_UNAVAILABLE、真实PG撤权和退出网络失败重试。29条键盘检查均到达目标且可见焦点。私密callback canary的上层日志缺失检查实际通过；859 validation全部true，6条自有资源cleanup全部true。OIDC仍是自有fixture，未验收真实身份服务/MFA恢复运营流程。

**订单：** 分页、七语双端、键盘/reduced-motion/读取错误恢复、私密面板关闭后迟到响应不重新泄露、人工审核→准备→逐项送达、原key幂等重试、加密工作备注显式读取和清空、最新通知审计重发、manager hold/resume均在本次复合cases中PASS。协议保持未审核不能准备、普通operator不能经理暂停、当前权限和原历史保留。safeFacts为notificationsAccepted30、notes2、reviews8、fulfilled8；自动操作用时约0.374s只属脚本观测，不作为真人操作效率验收。

**财务：** 七语双端及七语只读角色边界，全额/逐项部分退款、同艺人/不同艺人独立分配标识、取消未付款及尚无provider attempt取消、拒付限制、UNKNOWN保留额度与认证reconcile全部PASS。399条协议断言覆盖并发重复命令只一持久退款、同key不同payload拒绝、待退款阻断准备/送达、不超原capture额度/币种、签名改动拒绝、真实inbox/worker退款、部分后补余恰全额、webhook/reconcile双证据不重复经济效果、可信失败才释放额度、原PSP重启恢复及终态先到的拒付乱序。

本次浏览器明确比较丢响应后的相同key及payload，重试只有一个refund记录；原`expect.poll(() => outstandingReads.size).toBe(0)`仍未改、完整58次capture通过。**这只是同源标准新轮成功，不能证明final-8间歇读集合等待失败已修复或原因已知。** 原失败保留，原因UNKNOWN；此前Docker时间约束失败同样不能被本次原生PASS覆盖。

**支付配置：** 七语编辑/校验/只读权限、包含英文的独立七语审批、发布与回滚丢响应后刷新并复用原key/payload、返回导航重新读取、仅routing修改复用真实已有审批均通过。原协议同时检查停渠道阻止新付款、旧UNKNOWN仍向冻结原provider认证查询、stale config拒绝、真实gateway托管、角色边界与新版本回滚。两个不同API进程的协议传播三次约672/876/919ms；浏览器发布/回滚约103/308ms，两节点每次generation一致。受控刷新故障约10695ms，仍按原有界失败策略断言，不把它当正常传播或云/CDN延迟。回滚生成新策略版本，不覆盖历史配置。

**异常与重放：** 七语双端四种来源（webhook/dead letter/payment/notification）、七语webhook只读角色、无权限、不可确定通知禁止重发、网络/键盘/reduced-motion恢复、分页、浏览器及上游丢响应复用原请求、真实空列表与运行中撤权均PASS。369条协议、27条storage检查分别覆盖十次并发同key同一永久operation、十次真实webhook handler和十次原outbox consumer无重复效果、原通知历史保留、UNKNOWN通知不再发、原支付账户只reconcile不create/cancel/refund、旧版本/改请求/撤权时原回执不能越权，以及真实审计与delegated receipt绑定。

异常scope精确为`SIMULATED_POST_COMMIT_INTERRUPTION`：实际pg-boss六次失败、业务提交后受控中断、真实数据库lease到期、新worker恢复和唯一经济效果。`workerProcessKilled=false`，不能称为真的杀死worker进程。新reconcile观察1次，unknownNotificationResent=false；恢复不自动送达礼物。

## 后续与外部门

此组与已核对同源quality证据可共同支持SPEC E2E-07/08/09的本地自动场景；完整五组/17命令/14要求仍等最后journey和证据索引终验。五项未报告axe违规或incomplete不等于已完真人读屏、关键译审或WCAG人工签署。管理源译文仍DRAFT；手机为桌面Chrome模拟，非物理设备。真实身份服务/MFA流程、商户sandbox/退款/小额资金、正式邮件、RUM、远端CI、云staging/恢复/灰度等原门仍保留。

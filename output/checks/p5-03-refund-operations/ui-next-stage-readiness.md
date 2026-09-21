# P5-05 本地依赖独立核对

Reviewer：`/root/refund_admin_audit`，2026-09-22。只读核对；未领取或实施P5-05、未修改MASTER。

## 结论

P5-05的原直接依赖P5-01和P5-04在本地范围已有完整验收及非作者复核。P5-03最终候选完整验收现已闭合：`output/checks/p5-03-finance/integration-2026-09-21T21-48-01.614Z/`，HTTP399、浏览器9cases/330断言/58图，axe violations/incomplete及页面错误均0，root统一check:dev通过。**支持root按ADR-016登记P5-05本地READY并协调共享文件owner**；实际任务领取、进度更改和范围登记由root执行。本结论不解除外部支付或发布门。

## 现有输入与源码差分

按P5-04 `candidate-source-final.json`重新逐SHA比较104个选定输入：身份19项中17项相同；付款能力/选路/健康/gateway/port/0033–0034等85/85相同，详见 `ui-next-stage-source-compare-final.json`。此前19/19与18/19是测试hook及声明加入前的历史快照，不再作为当前结论。

身份两处差分仅 `packages/identity-oidc/src/test-support/https-idp.mjs` 和 `.d.mts`：可选的NORMAL token回复前测试hook及类型声明。默认未传hook行为不变，未修改生产OIDC adapter、身份合同、会话、MFA/CSRF、Cookie或provider校验。本人复读diff并执行原identity-oidc 2文件/75测试PASS（`ui-oidc-input-tests.log`）；root另独立复验并最终check:dev覆盖声明。root独立确认659个旧合同根不变。

P5-01的服务端角色授权、可撤销会话、MFA/CSRF和append-only审计可复用；配置发布授权仍须服务端判定，不能由浏览器角色名推断。本次finance只新增固定BFF命令和订单内资金面板。最终UI31/31文件与root冻结源SHA相同。

P5-04的final-verification/final-independent-review已闭合能力/确定性选路、版本与灰度、PG/HTTP/有界恢复、原付款七语双端及全仓门；实际源比对与health/runtime/gateway复读支持继续消费此本地输入。

## 认证环境问题如何闭合

保留历史整轮失败和 `ui-next-stage-readiness-before-acceptance.md`。原认证异常定位到Docker guest实际墙钟回退：session created_at临时领先当前时间，以及callback完成早于claimed触发原约束。生产保护未削弱。42次角色×语言真实认证压力检查完成；最终整轮改用隔离原生PG18.6，保留同一完整浏览器矩阵和Next dev + TLS OIDC/TEST PSP流程，最终失败callback为0。生产build是独立门。原生夹具生命周期和时钟证据由runtime/PG独立报告承接，不声称本地环境已验证真实生产身份部署。

## P5-05需独立实现的边界

1. 独立config Zod/schemaVersion和固定BFF operations实现draft/validate/publish/rollback；不扩写finance command，不将TEST SQL publication当管理功能。
2. 继续一个简单管理中心。先协调center/hub/shell、server/admin-operations.ts及API bootstrap归属，再接配置分区，避免同文件并行编辑。
3. gateway只接受可信已发布投影，保留历史账户绑定，拒绝旧revision/同revision漂移。旧attempt及UNKNOWN付款/退款恢复始终原账户，不因新配置换路。
4. 当前health policy仍在runtime构造期bootstrap；POLICY_CONFLICT和缺policy封闭准入须保留。新增发布需协调policy激活、已部署adapter目录和多实例传播，不能仅替换JSON；不上传或执行支付代码。
5. 七语关键文案、差异预览、确认/原因/version/idempotency和不可变审计；非法/空路由、关键译文未审批的处理；发布≤60秒、回退≤1分钟及传播失败恢复均需新本地证据。

新增finance不占用配置发布状态机，不新增config publish阻断。真实商户/PSP sandbox、小额支付、正式Secret与身份配置、关键译文人工审批、多实例/staging、真机/读屏和发布验收仍保留；本地排期已获授权，无需重复请求开发许可。

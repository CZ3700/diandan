# P5-03 最终本地验收

状态：**本地完整实现与验收通过，非作者复核ACCEPT；正式商户等外部条件保留。**

基线 `17b7230195879bbb480fa343975574759b84d789`；分支 `codex/p5-03-refund-operations`。冻结2462个源输入，清单SHA256 `502f627cc26f86474afed91d04ed14cfb2faf0f549c73cba292e46db5c5d1420`，最终浏览器退出后逐文件及集合核对不变。证据 `candidate-source-final.json`、`protection-final.json`。

## 已交付

原管理中心订单内的全额/逐项部分退款、未付款取消、拒付查看和分页对账。资金操作需要平台权限、MFA、版本、原因、确认与永久幂等收据；UNKNOWN保持金额占用，通过原账户可信查询/webhook恢复，不盲目再退款。支付已成功事实保持，退款/拒付独立投影；存在未结退款或OPEN/LOST拒付时，后台和数据库共同阻止继续履约。

七语言界面清楚显示已收款、已退款、处理中和可退额度；刷新/断线保留本标签页原请求及幂等键，无法持久保存恢复键时拒绝新的资金操作。没有增加另一个后台，私密粉丝内容不进入资金响应、日志、浏览器恢复记录或截图。

## 实际验证

运行时为Node24.20.0、pnpm11.25.0。以下结果分别记录，不把任务图数量当单测数量。

| 检查 | 结果与证据 |
| --- | --- |
| `pnpm check:dev` | format/lint、typecheck63、test63、build36全部通过，缓存60/61/35；`check-dev-native-final.log` |
| 合同/架构/产物 | 新鲜度与locale唯一归属；33 adapter checker tests、层边界、32公开包导出通过；`*-native-final.log` |
| 合同/领域/Admin | contracts87文件504tests；domain196tests、branch94.88%；Admin191tests，真实事件生命周期RED→GREEN；后续统一门承接同源 |
| 实际金融PostgreSQL | `pnpm --filter @fan-support/persistence-postgres test:postgres:admin-finance`，6023=5763准备+259专项+1源一致性；`storage/run-2026-09-21T20-36-06.340Z/` |
| 迁移/回退 | 35迁移、193表up/down/up；rollback-prefix40tests；原constraints通过 |
| 原订单回归 | 5960订单管理、6827付款入账；额外真实8秒过期迟到付款通过；首轮未分类断言失败仍保留 |
| TEST PSP | 原支付与新增退款/拒付20tests；独立持久化派发计数、响应丢失、重启、乱序与去重 |
| 最终完整HTTP/UI | `integration-2026-09-21T21-48-01.614Z` exit0，6742=5763准备+979场景；其中HTTP399、浏览器9cases/330assertions/58PNG/58axe，全通过，0违规/0incomplete/0页面错误 |
| 身份/环境/测试生命周期 | 原OIDC75tests；42登录stress通过；最终fixture16tests；原生PG三种真实生命周期/失败清理通过，3860万时间样本0回退 |
| 源与旧数据保护 | 2462输入不变；659旧定义/108旧路径与旧OpenAPI组件不变；68旧SQL/34manifest/5719原未跟踪不变 |
| 秘密扫描/暂存差异 | 两轮`pnpm security:secrets`均exit0，最终`secrets-delivery-final.log`覆盖收尾文档/证据；`git diff --cached --check`通过 |

完整浏览器使用原生临时PostgreSQL18.6、真实本地TLS OIDC/S3、独立持久TEST PSP和Next dev/LOCAL_OIDC。生产build为独立质量门；390×844是浏览器模拟。全部七语言/双视口、键盘/reduced-motion、错误恢复、只读权限、连续部分金额输入、退款/取消/拒付均保留原断言。root查阅最终中文手机全额与英文桌面部分退款截图；原件SHA见 `accepted-browser-artifacts.json`。

没有声称运行并通过整条 `pnpm check`、所有历史PG/S3脚本或远端CI。历史失败和各范围复验保留在 `failure-history.md` 与原轮次目录。

## 时钟问题与复核

Docker/Colima guest墙钟同SQL内曾倒退约0.2秒，固定CPU0的65秒长测仍失败；独立guest realtime回退而monotonic/raw不退，Mac主机未观察回退。登录guard正确拒绝，生产认证/TTL/SQL保护均未改。42次登录通过不能覆盖后来完整轮次失败，因此最后在同版本原生PG上保持原浏览器矩阵完整验收；不是增加重试或放宽认证。具体guest校时进程仍未归因，staging时钟验收保留。

TEST精确因果等待、route清理、可选原生临时PG入口均有失败回归和独立复核；原生集群每次新建、随机密码、loopback/SCRAM，按归属关闭清理。最终owned临时cluster/process为0，Next声明恢复，源码不变。工具准备见 `native-postgres-tooling.md`，独立review见 `storage-auth-clock-review.md`；金融/应用/UI交叉复核见三份 `*-review.md`。新增译文保留DRAFT，不冒充人工批准。

## S.U.P.E.R 十项

1. 单职责：合同、业务决策、命令、读取、恢复、证据、各类金融投影、UI和TEST上游分离。
2. 函数职责：退款验证/写入分离，各类证据应用从锁协调器拆分；原16条SQL保持。
3. 单向依赖：BFF/route→application→domain/ports→adapter；Browser不直连数据库。
4. 无循环：workspace/domain/adapter检查通过。
5. Schema边界：请求、永久收据、claim/settle/evidence使用Zod与schemaVersion。
6. 可序列化：持久/端口数据为JSON兼容值，连接/回调仅在组合或适配层内部。
7. 配置外置：provider/account/密钥注入；固定标识和本机原生工具选项仅在TEST。
8. 显式依赖：无新增外部包或lockfile改动；本机临时数据库工具单独留证。
9. 可替换：PostgreSQL与PSP通过独立端口，界面不掌握金融真相。
10. 完整验证：受影响测试、实际数据库/HTTP/浏览器、整仓开发门、秘密扫描与暂存差异通过；十项全部PASS。

## 剩余条件与接续

真实商户/批准PSP的sandbox refund和事件映射、消费者政策、真实小额资金、七语关键人工译审、正式身份/密钥、实体手机、staging/灰度/生产发布仍需对应证据。P5-03按ADR-016保持IN_PROGRESS、释放executor；P5-05原直接依赖已独立核对，共享文件归属冻结后登记READY，下一步是简单管理中心内的支付配置草稿、校验、发布、回退。Phase6/7保持LOCKED。本轮仅本地提交，不push/merge/部署。

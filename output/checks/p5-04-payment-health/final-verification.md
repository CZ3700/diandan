# P5-04 支付能力、健康恢复与稳定灰度本地验收

日期：2026-09-22（Asia/Bangkok）；基线 `40a57b47fee8de1e9babc7d0a66637b3251cb227`；分支 `codex/p5-04-payment-health`。本报告覆盖 P5-04 全部可本地验收的范围；正式 PSP、资金与后继配置管理不被冒充为已完成。最终独立复核 ACCEPT、暂存秘密扫描与差异检查已通过，结果见 `final-gates.json`。P5-03 READY；P5-05 等共享合同/文件归属冻结后登记，未领取后继。

## 最终交付

- 复用既有 PaymentCapability、确定性选路、版本与永久付款回执，增加内部 v1 健康/灰度合同；645 个旧合同根与 OpenAPI 不改。PG 保存不可变健康策略、幂等观测、失败窗口、版本和恢复租约；技术失败暂时隔离新付款，普通成功/业务拒绝不擦除失败证据。
- 两个 API 实例共享 PG 状态，恢复循环在没有待恢复订单时仍可领取一个安全 GET_CAPABILITIES 探测。探测带代际/到期/账户/策略/上下文栅栏；失败退避、迟到结果不恢复渠道，成功证据与健康事件关联。只有真实结账产生、当前发布规则允许的上下文可探测，不制造金额/国家、不执行资金操作。
- 健康 PG 连接领取至提交默认共享 3 秒预算；超时销毁连接，真实 PG 阻塞超时后无迟到写入。COMMIT 中断仍不确定，不改写已发出的资金结果。首次配置按轮次最多初始化一个账户，失败轮转，避免账户数乘以超时阻塞原付款恢复。
- 部分比例使用 checkout/account/rule 的 v1 稳定双桶；0 关、10000 开、两个阈值同时满足才准入。Application、PG beginCreate、deferred receipt guard 三层计算；客户端不能自定种子或绕过资格。语言、同实例/跨实例与重试不重抽；新 rule UUID 可改变新付款分组，旧回执和 UNKNOWN 不重算。
- 通用 gateway 使用共用 15 场景 conformance 经独立 CA 校验 TLS TEST 上游验证七操作；五种故意不合规上游被拒绝。没有新增 PSP、托管商城、卡数据入口或动态代码上传。管理中心的日常操作方式不变。

## 实际验证

所有 Node 命令使用 `mise exec node@24.20.0 --`，pnpm 11.25.0。精确命令、退出码、结果和日志 SHA 见 `final-gates.json`。

| 范围                  | 最终结果                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全仓 `check:dev`      | format/lint、typecheck 63/63、test 63/63、build 36/36；最后缓存62/62/35。这些是任务图数量，不是单测数                                                                     |
| 受影响完整 package    | contracts 85 files/497 tests；domain 25/183，分支覆盖94.67%；gateway 9/106                                                                                                |
| 健康真实 PG           | 85 checks；包括幂等/冲突、跨事务及同事务并发、固定窗口、旧探测/迟到结果、上下文、策略漂移、实际锁超时/无迟到写入                                                          |
| 灰度真实 PG           | 8224 assertions，4099组TS/PG逐值一致，边界/大小写/非法输入/原guard完整保留/隔离DDL往返                                                                                    |
| 健康实际 HTTP/TLS     | 5869=5761准备+108专项；两实例、API重启、单安全probe、旧UNKNOWN固定恢复、无重复create、无私密字段落日志                                                                    |
| 灰度实际 HTTP/TLS     | 最终6071=5761准备+310专项；合法checkout两组、七语言、两层PG反绕过、部分比例健康、合法新0比例发布后旧UNKNOWN原键恢复。先前6104轮多生成一个合法checkout，计数不同不丢场景   |
| 原支付生产构建/浏览器 | 7077=5761准备+1316协议与浏览器；31 cases、71 PNG、57 axe；七语390×844/1440×900，键盘、错误/空状态、reduced motion、语言切换与原attempt冻结。0违规、0incomplete、0页面错误 |
| 原支付合同/参数/配置  | 12 fixture tests；39 SQL PREPARE/46 assertions；10 action guard；正常trigger下七语配置publication/reviews/outbox与不可变规则                                              |
| 迁移与结构            | 34 migrations/189 tables真实PG往返；旧rollback-prefix 33tests含新健康历史拒退；合同新鲜度、adapter/构建产物32exports、CI/runtime/observability/manifest门通过             |
| 依赖                  | frozen install通过；恢复安装时意外解析的无关transitive版本，锁文件只增加workspace testing声明；官方registry audit无已知漏洞                                               |

浏览器使用既有完整支付回归夹具；新健康/灰度由各自真实HTTP专项验证。两API实例位于同一Node进程、不同pool/lifecycle；PSP是独立进程和持久PG TEST上游。这不是部署级多进程/真实商户、真实Visa/Mastercard网络、USDT专属映射、实体手机或人工读屏验收。浏览器已关闭，拥有的fixture清理函数返回，运行进程exit0；报告仅按实际输出记录cleanup attempted，未额外声称云资源检查。

没有宣称执行完整 `pnpm check`、全仓所有PG/S3脚本或生产验收。真实PG/TLS S3/TEST PSP/KMS adapter均由本轮集成使用；未调用真实AWS KMS或收付款。

## 兼容与源文件保护

- `compatibility-final.json`：645旧根不变，新增14根，总659；OpenAPI字节不变；64旧SQL与32旧manifest条目不变。
- `candidate-source-final.json`：2380源输入 SHA `e866fd6218c2f6b655e5fca37201f12e7a96dadcd60e1fb0af27e63b5b3b34a5`。相较首次最终候选，仅新conformance测试改为七操作白名单；所有产品源不变，边界和gateway测试及全仓质量门已重跑。
- `preexisting-protection-final.json`：5717原未跟踪文件逐一SHA不变；暂存检查确认没有误加入。旧失败、截图、用户文件不删除或改写。
- root已实际查看中文手机与英文桌面ready截图，布局/按钮/语言说明完整；自动矩阵覆盖全部七语。不是修改既有视觉基线。

## 失败与修复记录

保留原始失败，不覆盖为绿：合同/领域/应用先RED后实现；同事务并发窗口丢计数、5000比例探测错误拒绝、数据库等待无总截止和PG18的25P04映射均先复现后修复。增量bootstrap的两项测试先RED后GREEN。

整合阶段修复fixture的非法正则、构建类型/直接依赖引用、旧domain导出清单，以及灰度发布夹具先新PUBLISHED触发23505、head漏version+1触发23514；保持原唯一性/版本约束。最后adapter检查拒绝新测试引用旧兼容webhook符号，改用七操作正向白名单，原checker未放宽，`structural-final-2.log`与最后全仓门通过。新共用conformance最初直接GREEN是新增验证，不虚构它曾失败。

## S.U.P.E.R 10项

| #   | 结果及依据                                                                                         |
| --- | -------------------------------------------------------------------------------------------------- |
| 1   | PASS：合同、健康窗口、分桶、观察编排、PG上下文/记录/租约/限时和API生命周期各有单一职责             |
| 2   | PASS：有界数据读取/状态判定/探测调用/完成证据分离；复杂部分按职责拆文件                            |
| 3   | PASS：Route→Application→Domain/Port→Adapter；PG只在adapter，远程调用在事务外                       |
| 4   | PASS：全仓依赖图及adapter门未新增环或反向依赖                                                      |
| 5   | PASS：内部对象独立Zod/schemaVersion 1；旧合同根不改                                                |
| 6   | PASS：跨模块command/result纯可序列化字段，密钥与transport不进入业务对象                            |
| 7   | PASS：账户/环境/阈值/能力由配置与PG事实提供；算法常数和限时缺省有明确版本/配置边界                 |
| 8   | PASS：唯一新增依赖为gateway的workspace testing devDependency；lock一致                             |
| 9   | PASS：健康持久化port可替换；gateway接受同一共用suite，不改变Domain/UI合同                          |
| 10  | PASS：受影响、全仓质量、真实PG/HTTP/浏览器及结构门的最终结果均通过；整仓pnpm check未运行范围已明确 |

## 复核与后继

应用、持久层和灰度分别见 `application-independent-review.md`、`persistence-independent-review.md`、`rollout-independent-review.md`。最后整合结论见 `final-independent-review.md`，暂存扫描见 `final-gates.json`。每份作者交接与非作者结论明确区分。

后继只消费本地完整验收：P5-03退款/取消/拒付/对账（Lane A），P5-05管理配置/七语关键文案/传播回退（Lane C）；只读依赖审查 `next-stage-readiness.md`。固定健康策略目前仅构造期bootstrap，P5-05必须协调版本激活和新账户directory，不能把TEST发布夹具当运营发布功能。共享合同与owner须领取时登记，不能在同文件并行写。

正式商户/PSP批准、sandbox/真实小额、USDT专属adapter、生产Secret/多进程/staging、政策与关键译审、P3人工/真机/品牌资料和后续云/发布门全部保留。P5-04本地验收闭合后仍IN_PROGRESS、释放executor，不把外部门标DONE；不push/merge/部署。本地复验入口 `docs/runbooks/payment-health-local.md`。

最终收口：独立报告`final-independent-review.md`接受完整本地范围；源输入/任务计数复查见`final-integrity.json`。原staged diff check只发现新日志Git副本的终端行尾空白；仅规范化副本行尾/多余尾空行后复查通过，原日志与双SHA保持。仅本地提交，正式外部门保持。

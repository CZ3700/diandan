# P4-05 付款证据原子应用检查点

状态：**本地检查点验收通过（2026-09-15恢复收口）**。P4-05保持IN_PROGRESS；安全查单、成功页与时间线是后续顺序检查点。P4-04实际商户与PSP验收不解除。

## 实际交付

- 只接受内部持久证据ID，重新读取账户、环境、金额、币种、订单与当前支付尝试；浏览器回跳不能确认付款。
- 同一PG事务应用订单、支付、库存、购物车、私密意图、历史、审计与Outbox；永久回执使重放不重复业务效果。
- 回调和认证查询保留各自证据，同一capture只有一笔交易账本；过早回调保持可恢复，默认Worker与持久扫描继续处理。
- 按单准备与预售不伪造库存；限量礼物处理真实预占。明确失败/取消释放预占；UNKNOWN到期后迟到收款保留已付款事实，履约ON_HOLD。
- 保留原公开API和历史合同。尚未新增查单API、成功UI、商户配置表单或实际邮件发送。

## 可重复验证与结果

| 检查 | 实际结果与证据 |
|:--|:--|
| 新合同 | 15测试通过；555根，550旧根不变，5个新增内部根。 |
| Application / inbox | 21测试通过，application-final-targeted.log。 |
| Worker / composition | 8测试通过，worker-final-targeted.log。 |
| 精确库存时间 | 27单元通过；实际PG expiry另证明±1µs拒绝、等价时区成功，inventory-microsecond-green-final.log与protocol-results。 |
| 新PG/HTTP协议 | 两轮真实PASS，run-2026-09-09T19-07-38.723Z及19-10-51.808Z；每轮5763准备+1064协议=6827断言，18case，96checkout+74payment请求。 |
| 迁移/旧集成 | 27迁移/170表往返、全部原PG/API链通过；新0027拒退8项，35表计数/哈希不变。 |
| 对象存储/媒体 | 原TLS S3及真实图片Worker联合423断言通过，check-full.log。 |
| 最终质量后缀 | 原7项逐字命令exit0，41.952秒；types61/61（61cache），tests61/61（60cache），build36/36（29cache），32实际Node出口；resume-quality-suffix-2.json/log。 |
| 共享浏览器门 | 原P2-04 16场景/18PNG、P2-05 8场景/22PNG原collector通过；browser-summary.json。无新增订单页面或真机证据。 |
| 兼容/文件保护 | 550旧合同、公开OpenAPI、52旧SQL字节不变；2371原未跟踪文件逐SHA不变，resume-compatibility.json。 |
| Secret / 依赖 | 本次恢复secret scan exit0，resume-secrets.log；同lockfile的原官方registry high audit通过，audit-high.log。 |

原单条 `mise exec node@24.20.0 -- corepack pnpm check` **exit1/1653.618秒**：全部PG、API、订单协议和S3已通过，最后旧PG composition测试遗漏扩展manager的orderPaymentApplication键。恢复时原测试先复现1FAIL/19PASS，仅添加这一精确预期键；原legacy三键断言不变，随后20PASS。

第一次恢复质量后缀47.446秒失败在旧artifact-documents的5000ms限时；保留失败，不改源码/时限。相同源码定向6PASS（2.84秒），随后原7项后缀exit0。**39个展开检查项均有通过证据，但不是单次完整check exit0**；见gate-coverage.json。历史间歇时钟/权限与本次超时不能据此声称已根治。

## 真实协议的范围

- 七语言订单PAID且历史快照保持；PREORDER无伪库存；同单两艺人共享有限余额按连续版本消耗2+3。
- 原签名raw HTTP篡改400/未知endpoint404/合法202；默认Worker推进订单，重复及旧事件无二次效果。
- 三种回调/查询顺序均保留首次真实40001，随后默认Worker收敛两来源receipt/一capture/一订单确认；使用按单礼物，不冒称并发争抢同一限量余额。
- 未匹配事件保持PENDING；limit2、三个前置unmatched与后置有效事件的两批扫描证明公平恢复。
- FAILED/CANCELED从真实REQUIRES_ACTION+ACTIVE限量预占直接回调，经默认Worker释放一次。
- CREATE丢响应→UNKNOWN→真实到期→PSP实际capture→认证reconcile→PAID_REVIEW；旧NULL外部引用由可信MATCHED证据恢复，过期库存不重扣。
- COMMIT前回滚与COMMIT后结果未知均使用真实PG事务、应用边界故障注入；actualNetworkDisconnect=false，且该注入case为按单礼物。
- 后续PREPARING/DELIVERED或退款后的alias重放本轮仅静态复核，留给对应履约/退款阶段真实验收。

## 失败与修复保留

合同补上attempt/order成对绑定；handler使用原大写effect key；扫描返回合同在事务提交前验证；库存适配不再截掉微秒。失败回调改为同事务先终结attempt再释放；MATCHED持久证据支持恢复尚未绑定的external reference。均有有效RED/GREEN及非作者复核，详细见independent-review.md和resume-independent-review.md。

前五轮协议失败未删除：队列夹具漏PROVISION、TEST查询旧字段、endpoint/telemetry准备、签名事件时间与收件时刻因果准备、并发第一次事务被SERIALIZABLE中止。短探针精确证明其自身原因，不能追溯冒称所有旧失败同因。仅TEST等待实际Node/PG时刻达到原已签名时间，不改原始字节/签名、业务守卫或产品超时。

首次P2-04 collector因并行工作区编辑中止，冻结后原命令通过；P2-05保留既有moderate/incomplete/真机门。Next生成文件曾仅自动改两条dev类型引用，已归档并精确恢复；不称全过程零漂移。

## 来源一致性与审查

最终2031项实现输入，source-final.json，SHA256：`388a14d506e6e3423cb2ea6e0b528b158254b3307da2a47a917644915ef950e5`。原fullcheck期间只有三个新协议TEST文件及一个新增短TEST发生变化，均在其实际新协议执行前完成；source-during-check-delta.json保留。恢复后只有postgres-persistence.test.ts一行预期更改，resume-source-delta.json保留；生产/PG/HTTP源码与原最终协议相同。

非作者checkpoint_review接受当前付款应用、原两P1修正、库存桥与实际证据范围。S.U.P.E.R：单一模块/操作职责、单向依赖、无环、schema、可序列化、环境配置、显式依赖、可替换端口和相关测试共10项通过。code-simplifier复核保留清晰金融事务顺序，不为形式减少行数而拆散原子提交。

## 下一入口与边界

完整大纲见docs/progress/current-overview.md。下一顺序检查点为安全查单；需新增兼容读模型支持0025 DAILY v2实际原文，不能复用只支持v1/英文fallback的旧mapper。访问凭证/会话、轮换与过期、丢响应和限流先冻结合同，再做PG/Application/API与七语言界面。

本地TEST PSP、临时PG/S3和测试密钥不是商户sandbox/小额、云KMS、真人或生产证据。P3未完验收、P4-04真实商户、P4-06邮件与正式清理、Phase5门均保留。25 DONE /3 IN_PROGRESS /21 PENDING =49，仅本地提交，不push/PR/merge/部署。复验与恢复入口：docs/operations/order-payments.md。

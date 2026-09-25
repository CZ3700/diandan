# P4-05 安全查单服务端检查点

2026-09-15，本地技术验收通过；P4-05 整项仍 IN_PROGRESS，成功页/订单界面留在下一顺序检查点。基线 `ab0b137`，root 独占 Lane A；仅本地 Git 交付，不推送或部署。

## 交付行为

- 四个 API：一次性凭证交换、原已付款 checkout 授权、订单范围历史读取、授权撤销。内部签发不开放公网；摘要持久化、短期 Secure/HttpOnly 会话、独立 CSRF、严格 Origin、重复头拒绝和持久限流。
- 原子消费、会话轮换、撤销、访问审计；跨订单、已消费/过期凭证与未付款 bootstrap 拒绝。限流独立提交，授权失败不抹掉计数；实际 TCP 对端身份不信任 X-Forwarded-For。
- 历史文字/金额/规格/语言来自不可变订单快照；v1 规格缺失为 null，DAILY 保留真实原文。图片绑定原资产和校验和，仅提供 READY 公开衍生图，不暴露私有 SOURCE 原图，不跟随今天的商品换图。
- 修复验收中发现的旧 webhook 保留期错误：仅一个 PG INSERT 表达式，存储期限不晚于调用方授权到期与数据库原七天上限。原 0005、验签、事件时间和收据原子性保持。

## 验证结果与来源

| 范围 | 实际结果 | 证据 |
|:--|:--|:--|
| 新查单完整协议 | 两轮各 6860 = 5763准备 +1097协议；9cases、七语言与中文DAILY，8份历史DTO和实际S3图片在正常目录变更后不变 | 第六开发轮与 `run-2026-09-15T14-12-44.540Z/`、`remaining-32.log` |
| 新协议短测试 | 7 PASS，真实重复HTTP头、断开响应、双TLS origin等 | `remaining-32.log` |
| 原付款入账 | 原4短测试与6827长链断言通过；实际0027有数据拒退继续有效 | `remaining-31.log`、`../p4-05-order-completion/run-2026-09-15T14-10-50.281Z/` |
| 原整个PG门 | 再次376.188秒exit0；28迁移/172表、可靠事件与全部既有PG回归 | `remaining-14.log` |
| 新PG行为 | 17参数PREPARE/21限流断言；10迁移约束与数据拒退；仓储17单测 | PG定向日志与最终原PG门 |
| Webhook保留期 | 实际生产SQL 5cases/13断言RED→GREEN，原仓储9tests，原失败HTTP测试同源码返回202 | `webhook-retention-fix.md`、`webhook-original-fixed-green.log` |
| S3与媒体 | 真实TLS S3及媒体423断言，真实lease、恢复与shutdown通过 | `remaining-33.log` |
| 最终原质量后缀 | 37.550秒exit0；format/lint、types61/61（58cache）、tests61/61（58cache）、build36/36（36cache）、adapter边界、32Node出口 | `remaining-34.log`至`remaining-40.log` |
| 浏览器基线 | 原P2-04采集器passed/18PNG；P2-05 passed-with-physical-device-gate/22PNG；346/718渲染输入与当前字节一致 | `browser-input-protection.json`、`../../playwright/p2-04/`与`p2-05/` |
| 秘密与依赖 | 最终secret scan exit0；官方registry high audit报告无已知漏洞，lockfile未改 | `security-after-check-result.json`、`dependency-audit-final-result.json` |

**原展开的40项门按差分分段覆盖，不是单条完整check通过，也不是全部40项在同一冻结源上一次运行。** 精确命令、来源与重跑/复用关系见 `gate-coverage.json`。第二原完整check的1–30项已通过；保留期修正后重新执行完整PG、原订单付款入口、新查单入口、S3和全部质量后缀。生产受改SQL仅由已验签webhook收据写入调用；未变化的其他HTTP行为按原通过证据复用，非作者已核对调用路径与差分范围。源码/架构前缀13项在最终候选上17.106秒复验通过；合计24项最终候选重跑、16项未受影响HTTP证据复用，详见 `prefix-gates-result.json`。

## 原失败与最小修正

- 合同4项、Application6项、新API与PG缺模块均有有效RED，后续应用7tests与新API定向30tests通过。bootstrap锁后/返回前的cart真实时效检查有2项RED；私有SOURCE原图与公开衍生图隔离另有2项RED。
- 第一真实长链5822断言处暴露私有原图URL错误，修复生产历史图片映射。第二6367处为raw HTTP测试缺Host，保持重复头测试语义仅修framing。
- 第三/四长链因正常去重复用Rose原资产后旧详情metadata变成SUPERSEDED而拒绝发布；helper通过正常authoring同步PRIMARY及全部语言详情MEDIA引用，再审核发布，不放宽guard。第五6834处因第二TLS origin复用证书目录触发wx/EEXIST，仅改为独占TEST证书目录。第六6860通过，全部失败保留。
- 原合同artifact精确列表遗漏新增4路径/2认证方案，保留失败并只补列表；原6tests通过，不改阈值。首浏览器采集因开发期间Git状态变化正确拒绝，冻结后重跑原采集器通过。
- 首原完整check161.330秒exit1：旧迁移测试从0027回退而实际head0028。10个旧PG/回滚脚本仅补空0028降级、最终head及新增断言，原旧拒退/历史校验全部保留，未改54个旧SQL。
- 第二原完整check1416.464秒exit1：旧webhook短测503而非202。同源复验仍失败，只读SQL观察精确定位原webhook_payloads_retention_check；这不是已证明的OS时钟回退或未来provider事件。修复仅缩短存储保留期，未放宽七天规则。新探针最初observer误把当前text key version比integer的失败也保留，clean RED只有20ms领先案例失败。
- 两个output-only诊断helper的缺失URL导入/观测字段问题均独立修正、lint通过，不混作生产失败。Next自动将后台next-env两项引用改向dev，原生成字节与临时manifest已归档，确认与base/第二候选一致后恢复原内容。源差分assert曾因此失败而shell继续启动不依赖admin的PG门，此wrapper事实见 `admin-next-env-restoration.json`；最终质量门均在恢复后运行。

## 源码与兼容保护

最终 `source-third.json` / `source-after-check.json` 为2070输入，集合与字节完全一致，SHA `9603ad3c5123470fda4b5e30440eef836a3c049698190b1aa2c772ea693b6dd4`。第二候选到最终候选仅改变原payload表达式、新SQL回归探针和PG注册，见 `source-third-delta.json`。首候选、十个旧迁移测试修正差分及Next临时声明都保留，不覆盖旧证据。

原555合同根、92 API路径、171公共组件、54历史SQL与2412原未跟踪文件全部保持；现573合同根/96路径。`compatibility-and-protection.json`及`verify-candidate.py`提供逐字复验。当前检查点不新增依赖、不改变领域状态机、私密数据合同或正式支付规则。

## 复核与限制

非作者范围分开：`independent-review.md`审合同/Application/PG/协议与窄修，`api-independent-review.md`审API；API独立62files/245tests与故障探针20requests/125assertions通过。S.U.P.E.R 1–9覆盖单责、单向、显式可序列化合同、配置与替换；第10项以上述实际差分门和非作者终验为依据。code-simplifier复核保留职责分离及明确操作顺序，未做额外金融逻辑重构。

- Cookie已收到但JSON丢失的恢复仍需已知publicOrderId；没有仅Cookie发现订单的接口。真实socket断开已验证，数据库故障是callback提交前注入并真实回滚，不是数据库COMMIT网络结果未知。
- 实际PG/HTTP/TLS S3/独立持久TEST PSP不代表商户sandbox、真实小额支付、云KMS、邮件、staging或生产验收。
- UI/fragment清除/成功页/时间线尚未接通；原组件回归不是新查单页面或新手机实测。P2既有人工/physical-device及P3未完验收继续保留。
- v1兼容与pepper轮换来自单测；跨实例重启的限流长链证明具体为EXCHANGE。经BFF代理时API按TCP对端共享预算，真实访客限流仍需可信入口配置。

续作：[查单运行手册](../../../docs/operations/order-access.md)、[P4-05界面检查点计划](../../../docs/plan/p4-05-order-completion.md)、[完整项目概览](../../../docs/progress/current-overview.md)。P4-05保持IN_PROGRESS，P4-06邮件/清理待后续，Phase5不提前解锁；25 DONE /3 IN_PROGRESS /21 PENDING =49。

# P5-08 原依赖与本地范围独立审计

Reviewer：`/root/exception_storage`；2026-09-22。基线 `e818577617078fc70436d87a5e70f183d8aecd7c`。只读规范、原任务、ADR-007/016、已验收证据与当前源码；未运行重型构建/集成，未改进度或领取任务。逐文件 SHA、原证据与 P5-06 accepted/current 比较见 `next-stage-source-compare.json`。

## 最终结论：P5-08 READY，限本地离线与体验工具

**READY技术条件已成立。** P5-08原依赖仍是P0-05/P1-05/P3-06/P4-06/P5-05/P5-06/P5-07；前六项完整适用本地成果已有原验收和非作者结论，六组963条选定源码本轮无漂移。P5-07最终统一入口、真实场景、完整质量/保护门与两阶段非作者复核均通过，原Task独立结论为 **ACCEPT**，可以标DONE。root释放Lane D并登记后可将P5-08有限范围置READY；本次没有领取P5-08，本人没有改进度或Git。

本地范围明确包含 **离线OpenTofu模块/校验、部署工具与完整持久本地体验**。`docs/runbooks/local-experience-readiness.md` 已由root明确将该交付归到P5-08，须与IaC本地部分并列验收，不再只是没有归属的后续检查表。当前完整本地体验仍未交付，必须真实组合并跨重启验证后才告知用户可体验、准备服务器做线上测试。

P5-08原Task的clean staging apply/smoke/re-apply等云端验收保持；离线与本地体验通过后仍应保持IN_PROGRESS、列清云端欠项并释放executor，不能标完整DONE。不含AWS apply、生产发布或真实资金，Phase6/7不自动解锁；商户/人工/真实供应商和原发布门保持原状态。

### 最终条件核对

已独立实读 `drill-final/result.json` 四步退出0；最终权威 `integration-2026-09-22T10-05-55.604Z` 为35259总断言、29495场景、七级样本[0,24,2,5,24,0,24]、4704能力GET、两独立API传播576.5–1034.6ms，outer/cleanup PASS。fake共用15case、fake20/gateway106 tests通过，root完整check:dev及contracts/adapter/artifacts/CI/runtime/observability/secret与兼容检查通过。早期失败保留且修后完整入口承接；具体缓存和低比例范围见 `spec-review.md`，不将TEST成绩外推为生产或真实商户验收。

本人重新核对2587候选源码逐SHA全部匹配，集合指纹 `5ef8f24b41c3f6f765b6af951ea1f4c64fae8742de80d097be8675197c0cef6f`；11项独立规格输入、六组963条上游选定记录零漂移；5993原未跟踪逐SHA无变化。旧74SQL与全部冻结合同保持，P5-07无业务实现变化。原先conditional条件现在已闭合，支持JSON更新为最终ACCEPT/READY；root仍负责最终文件归档后的重复secret扫描、状态登记与本地提交。

## 原依赖逐项依据与源码漂移

下表的“当前”是本次读取时；选择范围详列 JSON，不声称全仓或一切共享代码未变。

| 原依赖 | 适用本地成果与验收依据 | 原验收至当前的选定源码 | 对 P5-08 的结论 |
| --- | --- | --- | --- |
| P0-05 DONE | `phase-0-baseline.md` 执行卡：request/trace关联、日志字段allowlist/隐私、OTel lifecycle、错误边界、OCI/clean-clone/独立ACCEPT | 31文件：19相同、12历次变化；本轮相对P5-06 31/31相同。历史变化为业务安全错误/可靠事件观测、私有媒体代理及OCI构建等，不能沿用原提交假称全未变 | 观测接口与本地OCI可消费；AWS告警实际触达/部署端trace仍由本任务与P7完成 |
| P1-05 DONE | `phase-1-contracts.md`：端口、adapter与conformance，原真实PG/S3及clean-clone/独立ACCEPT；后续OIDC/邮件/KMS/支付边界由相应P4/P5实际本地验收承接 | 131文件：54相同、26变化、51新增；本轮131/131无新漂移。含后来新增真实TLS/OIDC/邮件及细化端口，不把原233d11b认证扩大为所有未来实现 | 可复用成熟端口及TEST runtime；AWS IAM/KMS/Secrets/S3/CDN具体部署仍必须逐项验证 |
| P3-06 IN_PROGRESS | `p3-06-h2-matrix/final-verification.json`、`matrix-tools-review.md`及技术复核：完整七语HTTP/2本地矩阵、自动可访问性/键盘/资源与性能证据，严格为LOCAL_LAB/技术ACCEPT | 617选定storefront/ui/design/catalog/content/matrix源均与原H2快照相同，且相对P5-06无漂移 | ADR-016明确允许消费这一完整自动本地范围；真实读屏/真机/人工运营与关键译审/正式素材未被替代 |
| P4-06 DONE | `p4-06-notifications/final-verification.md`及独立审查：实际PG/TLS/Worker通知6814、过期6105、动作5843；模板44场景842断言；最终门有历史5秒timeout后不改源码重跑说明 | 62文件：51相同、4通知PG变化、7受控manual-resend新增；本轮62/62无新漂移。后续P5-02/P5-06真实重发/异常/UNKNOWN与幂等验证承接，当前未改业务原文/模板 | 能接持久Worker与TEST通知。正式邮件域名、SPF/DKIM/DMARC、收件箱/投诉与实际KMS/供应商条件仍保留 |
| P5-05 IN_PROGRESS | `p5-05-payment-configuration/final-verification.md`及独立结论：配置编辑/七语独立审核/发布回退、双独立API进程及传播、HTTP/浏览器6660；原生PG151 | 70文件：68相同、1后来新增runbook、1旧0036 PG runner兼容0037变化；本轮70/70无新漂移。旧SQL未变，变更后151实际PG checks已通过 | 可以配置启动及回退部署工具；正式商户能力/关键文案/实际配置批准仍归原任务 |
| P5-06 DONE | `p5-06-exception-operations/final-verification.md`及两方独立复核：7143总断言、实际PG53、真实HTTP/Worker四来源、89截图/11场景；check:dev及兼容保护通过 | 52选定异常/0037源码均与accepted快照相同；本轮52/52无漂移 | 可消费异常恢复与原幂等；不改业务身份，不把停止新支付误作停止旧webhook/reconcile/退款 |
| P5-07 最终ACCEPT | 原Task手册、fake完整conformance/分级灰度与商户资格门已全部验收；完整入口/实际PG双进程及独立review通过 | 11项规格输入指纹与最终候选一致，详见 `spec-review.md`；业务源/旧SQL不变 | 原最低验收满足，可DONE并释放Lane D；真实商户后续门没有被冒称通过 |

P3-06的性能记录包含保留的慢单次值与不完整历史采样，不能把本地中位数与技术复核改写成RUM/真机通过。所有上游本地成果只在报告明确的范围内用于依赖满足，原Task的外部欠项继续保留。

## P5-08 必须保留的原验收与分层

ADR-007确定的是美洲单云origin架构选择：AWS us-east-1、ECS Fargate、RDS PostgreSQL Multi-AZ、S3、CloudFront/WAF、Route53/ACM、KMS/Secrets及预算配额；不是已经创建基础设施的证据。P5-08应保留以下原要求，不把本地替身或 `tofu validate` 当云证明：

- state/locking、VPC、ECR、ECS/ALB、RDS、S3/CDN/WAF、DNS/证书、KMS/Secrets引用、预算/配额/告警以及四镜像不可变digest的模块与部署清单。
- 离线可重复 `tofu fmt -check/validate`、可在受控输入下执行的plan与static/checklist；没有账户、权限、backend及供应商连接时，plan实际覆盖范围应如实记录，不虚构线上plan。
- clean staging apply/smoke/re-apply、private origin/data、pg-boss、S3上传/presign/checksum、no-store与purge、WAF/KMS/IAM、预算告警和回退前置的真实证据仍待云授权与环境；production apply另受Phase7门控制。

## 完整持久本地体验的明确承接建议

`docs/runbooks/local-experience-readiness.md` 已准确说“尚未交付统一入口”，但仅一份无任务归属的检查表不足以保证用户能体验。建议 root 在领取 P5-08 时，把它登记为**本Task本地部署工具的一个明确交付项**，同时保留上述IaC原范围；这是将已实现应用组合为可用环境的工具工作，不新增商务功能、不进行云apply，也不另领取Task。

这个交付项应直接复用原四应用和现有真实端口组合，至少验收：同一个持久本地PG与媒体；实际本地OIDC；管理上传后前台可见可购且TEST履约资料显式初始化；独立持续Worker；托管TEST支付与真实签名事件；安全查单、留言审核、准备/送达、取消退款；配置审核发布回退与原账户UNKNOWN恢复；默认停止保留数据、显式重置才删除自有数据。必须验证跨进程重启后内容/媒体/订单/配置仍在，并用真实浏览器完成“上传→选购→TEST付款→查单→后台处理→退款”。

当前 `preview:management-center` 与清理型订单/PSP集成夹具只证明有界测试，不能直接当可交给用户长期使用的环境；不应要求用户改测试脚本、反复跑全量suite或购买服务器来弥补组合缺口。该交付项未通过就保留“完整本地体验未交付”，不因其余离线模块通过而移除说明；如果实现发现业务组合的真实缺口，列出具体缺口并在本Task scope内协商最小修复，不能以修改测试状态或绕过履约/支付预检让演示成功。

完成并独立验收后，应一次性交付本地地址、启动/停止/再打开/显式重置命令、TEST身份安全使用方法和简短体验步骤，明确告知用户已可完整本地体验、可以准备服务器做线上测试。该通知不意味着已批准商户、正式内容、真实资金或云执行。线上验收继续沿原P5/P6/P7门推进。

## 审计边界

本报告为非作者依赖/范围和最终证据审计，未重复运行新的集成、未修改源代码/SQL/进度；P5-07 ACCEPT以实读最终原件及当前逐SHA复核为依据。支持JSON记录最终核对SHA；后续若源码变化，按实际影响补独立复核，不能无条件沿用本结论。

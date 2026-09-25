# P6-03 原依赖与有限本地就绪复核

复核者：`/root/seven_locale_journey`；2026-09-24。只读核对权威排期、已保存验收、当前选定输入和新礼物发现范围；未领取任务、未修改产品或进度、未运行测试、数据库、构建或浏览器。本报告是后继依赖就绪审查；复核者参与过 P6-01 journey 和本轮 PostgreSQL 礼物发现实现，**不以本报告替代这两部分的非作者实现评审**，其独立报告另列如下。

## 结论

**ACCEPT_CONDITIONAL_LOCAL_READINESS。** P6-03 原直接依赖仍为 **P3-06、P4-06**；两者可消费的完整本地成果及非作者验收有据可查，最新 P6-01 完整本地回归提供了后续共享修改的整合证据。ADR-016 允许按原条件开展下一波本地性能工作，不需要重复申请相同排期授权。

**现在不能直接登记 READY 或领取。** 当前 MASTER / phase-6 仍是 P6-02 IN_PROGRESS、root 独占 Lane D，P6-03 PENDING。需先由 root 完成本轮当前代码的完整适用本地验收和独立复核、固定交接源码并释放 Lane D，再在 MASTER / phase-6 登记仅 P6-03 的有限本地 ACTIVE 范围、未覆盖项与验证计划，才可将这一项置 READY。这里没有把 P6-02 增加为 P6-03 的原任务依赖；它是 ADR-016 的串行 Lane 条件及本轮共享前台改动的可消费证据条件。

当前未通过的 28 单元浏览器矩阵不计为 PASS。本次直接读取的 `run-1/report.json` 和其 pages/report.json 都为 FAIL；后者停在 `en-mobile:mail-order`，payment=true、mailAccess=false、fulfillment=false。已完成的局部首页/支付检查不能替代完整矩阵，后续新运行需用自己的完整证据接受，原 FAIL 保留。

## 原依赖与可核对证据

| 输入 | 已有适用本地成果 | 限界与核对路径 |
| --- | --- | --- |
| P3-06 H2 / 性能技术验收 | 84 次资源导航、63 份 Lighthouse、七语三类页面的 21 组三次中位聚合通过原门；score 中位 0.98–1、LCP 中位 1805.2408–2255.7256 ms、CLS 中位 0。原件、153 项 SHA 和非作者技术/进度复核俱在。 | `output/checks/p3-06-h2-matrix/README.md`、`final-verification.json`、`matrix-summary-final.json`、`matrix-tools-review.md`、`progress-final-review.md`；原件 `output/checks/p3-06-storefront-acceptance/run-2026-09-21T16-34-50-464Z/`。这是旧源码的本地实验室证据，不是当前新增首页目录的性能结果或真实用户 p75。 |
| P3-06 后续 UI 校正 | 本地七语 581 检查 / 61 场景、61 PNG、56 axe，以及真实 PG/TLS S3 礼物回归 21898；已记录非作者 ACCEPT 和 Lane 释放。 | `output/checks/p3-06-ui-alignment/final-verification.json`、`final-review.md`、`final-source.json`。现存 no-JavaScript streaming 限制、人工读屏/当前真机、正式图片与语言批准保留。 |
| P4-06 通知与到期清理 | 真实 PG/TLS/pg-boss/Worker/邮件 CTA 6814、expiry 6105 / action 5843；七语三事件双端 44 场景 / 842 断言 / 44 axe；版本与订单 locale、幂等/UNKNOWN 恢复、清理和 webhook 竞争均覆盖。原任务 DONE。 | `output/checks/p4-06-notifications/final-verification.md`、`final-independent-review.md`、`source-final-frozen-2.json`；`output/checks/p4-06-commerce-expiry/`。原整条 check 曾在未改阈值的动态 import 测试超时，后同源完整质量后缀通过；保留分段验收事实，不能说当时单条 check 或远端 CI 全绿。 |
| 最新 P6-01 整合验收 | final-evidence-index.status=PASS，五个唯一组 quality/catalog/commerce/operations/journey，steps 为 4+4+3+5+1=17；14 条覆盖 complete=true。同执行源 `642a55a818680d763f41ce5d87b5386092591ea5341c92ce4e88c8248bcb8b72`，跨运行完整本地验收与非作者复核。 | `output/checks/p6-01-regression/final-verification.md`、`final-evidence-index.json`、`final-aggregate-independent-review.md`、各分组 `final*-independent-review.*`。原 final-8 总 FAIL 及八轮失败仍保留，不是单次默认 invocation 全绿；实际远端 CI 未运行。 |

P3-06 继续 IN_PROGRESS 的原因是人工/真机/正式内容等原外部门未完成，不是本地性能技术证据不存在。ADR-016 明确允许消费经非作者验收的完整适用本地范围，但不允许把这点改写为 P3-06 DONE。

## 当前输入与新增目录的影响

本次只读重新计算了 `output/checks/p6-01-regression/p6-02-readiness-source-final8-preparation.json` 中与这两个直接依赖有关的选定文件：

- P4-06 的 **62/62** 选定输入字节仍与该独立记录相同。
- P3-06 最新 UI 的 **15/18** 选定输入相同；三项当前变化为 `apps/storefront/src/storefront/gift-directory.css`、`home-content.tsx`、`page-factory.test.tsx`。这不是未说明漂移：它们属于本轮 ADR-017 首页礼物浏览改动，但必须由本轮最终验收承接，不能继续称 18/18 不变。
- 此比较只是选定直接输入，不声称全仓或所有共享模块未变。新合同、应用、HTTP/BFF、查询和组件也须纳入最终交接快照。

这三项本次读到的 SHA-256 分别为：

| 当前文件 | SHA-256 |
| --- | --- |
| `apps/storefront/src/storefront/gift-directory.css` | `9e0e8023973df45eb69787b74e585d210ba3e5739ae2eef55f4f293f5328cfda` |
| `apps/storefront/src/storefront/home-content.tsx` | `155a1d9e65545548c8d6e2d8b7a3ff271adfe84101d54edb5e8f5a40bfd5b232` |
| `apps/storefront/src/storefront/page-factory.test.tsx` | `5ec2004f82e2cd8d9b349a6e6540438308824ebf706b8934d19a10d14c7f4bff` |

ADR-017 明确新增独立只读礼物发现：首页艺人后直接显示实际发布的礼物，无市场/币种前置、不返回 offer、不改变交易状态。新目录先在 PG 分页再加载当页发布证据，默认 12 / 最大 48；gift/publication/translation/recipient/media 元数据参与 catalogVersion，价格和库存不参与新目录查询版本。它新增了首页内容请求、图片与发布证明读取成本；**有界分页不等于已经证明大目录读取足够快**。

已具备的存储作者证据为 `output/checks/p6-02-gift-browse/author-report.json`（13 文件 SHA、49 单测、803 目录检查、69 严格发布/读取事故检查）。真正的非作者确认是 `output/checks/p6-02-accessibility/storage-independent-review.md`：独立核对 13/13 SHA 并重跑 49 单测、旧目录实际 PG 315、新 PG 803、严格 PG 69 全部通过。它明确尚未测大规模吞吐；ALL_ACTIVE_ARTISTS 的完整状态变换与实际 daily 原文发布由本轮整合验收补证，不能从静态 SQL 复核推定所有端到端状态已过。

`frontend-independent-review.md` 接受前台实现和 95 项受影响测试的有限源码范围，同时明确不代替完整浏览器矩阵。首页虽已并行启动礼物请求，整体组合仍等待首页内容响应；不能据此声称首页慢响应对首屏无影响。

## P6-03 可登记的有限本地范围

按 `task-breakdown.md` 的 P6-03、SPEC §16.2 和六个基准视口，下一阶段可在独立 TEST 数据/服务和冻结生产编译页面上完成：

1. 以最终交接源码建立新的七语言页面、按 locale 字体/消息 bundle、首屏/路由 JS gzip、图片与第三方脚本清单；覆盖 360×800、390×844、768×1024、1024×768、1440×900、1920×1080。不要拿旧双端导航数当六视口性能证明。
2. 对首页新增礼物区、独立 `/gifts`、艺人/礼物详情与核心购物流程测量 LCP/CLS 和可重复的交互延迟；对 12/48 条分页和足够大的真实发布目录测量服务端响应、compact version 聚合和完整 proof hydration 成本。保留正确 locale / publication / 媒体权利检查，不能以缓存旧事实换速度。
3. 继续处理旧首屏 JS **150027–155368 B** 略超 150000 B 建议预算，核对按路由加载、关键图片固定尺寸/srcset/现代格式/优先级；首页不得加载支付 SDK、后台包或所有礼物数据。优化必须有同源配置、原样本和前后对照，不预设每项都会更快。
4. 覆盖真实可配置的本地指标采集、RUM dashboard 接线/查询与告警的可测试部分，并明确 TEST/合成事件来源；不把仪表板存在、Lighthouse TBT 或模拟交互值标成真实用户 INP/p75 已达标。
5. 以孤立负载串行测量性能：不与构建、其他浏览器、数据库压力测试并跑；固定 fixture、网络/CPU 参数、版本、视口、缓存/预热规则，保留慢单次、失败和全部原始样本。只能按预先定义门聚合，不能为取得更好分数选择性重复。

## 不得越过的门及下一次登记条件

- SPEC §16.2 的真实用户 p75 仍是 **LCP <2.5s、INP <200ms、CLS <0.1**；移动 Lighthouse ≥90 是实验室目标，不能代替 RUM。原 H2 单次最慢 4357.5634ms、五个慢样本、一次测量网络记录外 CLIENT_ABORTED 和 JS 建议超标全部保留。旧报告证明当时的实验室门，不证明新首页性能。
- 原性能验收的 H2 viewer 是本地入口，上游 HTTP、TEST TLS 例外；不是已部署 CDN/系统信任 TLS/跨地区用户体验。真实 RUM 时间窗口/样本、观测供应商与域名、云 staging/CloudFront/WAF、正式内容、真机及真实网络要在各自环境中取得证据。
- P6-01 远端 CI、Docker 时间约束和财务读取归零间歇失败的 UNKNOWN 原因仍保持。其正式重跑通过不能称历史根因已修复。`final-tool-version-scope.json` 明确 journey 没有独立保存 Chrome/PG 补丁版本，不从旁组借证。
- 人工 VoiceOver/NVDA、语言断行与关键文案批准、真人运营 3/5/8 分钟、真实邮件/身份/KMS、PSP 商户/sandbox/小额收退款、云恢复、灰度与发布门保持。本审查没有授权 push、云 apply、真实资金或正式内容发布。
- READY 前由 root 写明：P6-02 最终本地验收/非作者结果及未完人工门，完整 28 单元新运行结果（目前不通过）、实际 daily 礼物/API/购买邮件与履约范围，最终源清单，Lane D 释放；随后仅激活 P6-03。若相关本地验收仍有未闭环失败，保持 P6-03 PENDING；不以本报告替它通过。

本地性能工作完成而真实 RUM/外部门未具备时，P6-03 仍应 IN_PROGRESS、列明欠项并释放 executor，而非标完整 DONE。后继仍逐项核对，Phase 7 不由本报告解锁。

## 最终条件关闭追加记录（2026-09-24 01:31 +07:00）

结论：**ACCEPT — P6-03 的有限本地 READY 条件已满足，无剩余本地就绪阻塞。** 本条仅关闭上述条件，不改写原审查时的 PENDING/失败事实；不是 P6-03 性能验收，也不代签 P6-02 的人工或外部环境门。复核者仍为 `/root/seven_locale_journey`，只读取现有证据和状态登记，未运行测试、浏览器或服务，未改产品；本人的礼物存储实现独立性由非作者 `storage-independent-review.md` 提供，不以本条作者自验替代。

- **最终源码及完整验收已绑定。** `run-4/report.json` 为 PASS，运行 ID `eb449603-544a-43cd-b1fe-a568304769ba`，五步骤全部通过，完成于 `2026-09-23T18:23:02.741Z`。冻结执行源为 `c7b2e52ba36558e104d10fead2a1e0c7f69cca65e3319ea8310231438a2b2903`；`final-independent-acceptance.md` 已独立确认 2,782 执行输入、2,866 冻结文件和 249 归档文件的完整性并给出 ACCEPT。详细质量门与范围见 `final-verification.md`。原 run-1/2/3 FAIL 继续保留。
- **完整 28 格已实际通过。** 直接读取 `run-4/artifacts/checks/p6-02-accessibility/browser/test-regression-b643408543a946c4/pages/report.json`，七语言与 mobile/desktop/narrow/native-zoom 的组合恰好 28 个、不重复，覆盖 196 核心页；内层状态 PASS，pageErrors、observations、cleanupFailures 均为空。独立验收进一步确认真实原生 200% 缩放、199 张 PNG、506 键盘记录、8 个对话框和 28 次搜索焦点恢复；axe violations/incomplete 均为零。原报告“目前不通过”仅描述此前审查时间，现由本次完整新运行关闭。
- **新增 daily 浏览及交易衔接已补证。** 同一完整运行的 `actualDailyBrowse` 为 PASS，七语言、49 项，源语言 en；实际已发布礼物经 PG 目录/投影读取。`paymentCreates` 数量为 1，payment、mailAccess、fulfillment 三项均为 true；独立验收确认一笔 TEST PSP 付款、清 cookie 后独立邮件授权，以及审核/准备/送达。其余 27 格不计作独立付款或邮件兑换。浏览器只有一个已发布礼物，未宣称其完成多页下一页；多数据分页证据仍来自已独立通过的真实 PG 检查。
- **依赖和登记条件已闭合。** 原 P3-06/P4-06 适用本地成果及最新 P6-01 同源码跨运行验收仍按上文范围消费，本次不重写其历史风险。已读到 `docs/progress/MASTER.md` 和 `docs/progress/phase-6-hardening.md` 的正式登记：P6-02 保持 IN_PROGRESS、本地 ACCEPT 并释放 Lane D；仅 P6-03 READY，尚无 owner/executor；总计 31 DONE / 8 IN_PROGRESS / 1 READY / 9 PENDING。P6-04 至 P6-06 仍 PENDING，Phase 7 仍 LOCKED。
- **外部门与性能待测范围不变。** 实际运行前台为生产编译 Next，后台为本地开发 Next，付款为独立 TEST PSP；`humanScreenReaderVerified=false`、`physicalPhoneVerified=false`。人工读屏/语言、真实 RUM、云 staging/CDN、真实网络、商户及真实资金、远端 CI 等仍未由本轮证明；P6-01 间歇失败 UNKNOWN 与版本记录粒度限制也不因本次 PASS 消失。新首页和 12/48 条及大目录性能仍须由 P6-03 新鲜测量，不能借用旧首页 Lighthouse 或本轮无障碍矩阵判定达标。

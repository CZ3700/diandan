# Phase 4 — 加购、结账与订单闭环

> 状态：ACTIVE
> 任务：6  
> 解锁条件：通常须 Phase 3 退出；2026-09-08 按用户继续下一阶段与 ADR-013 启用本地开发例外，P3 未完验收保留

## 2026-09-18 排期接续

按已确认ADR-015，P4-04继续IN_PROGRESS、商户验收待续且无executor；本地P5-01→P5-02可先行，不把P4-04标DONE，不将ADR-014的依赖例外推广到退款/路由等支付任务。

## 目标

形成选择偶像、礼物、私密留言、测试付款、canonical 订单及查询读模型、安全查单与通知的真实纵切片。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P4-01 | DONE | Codex `/root` | P1-03/04/05、P3-05 | 匿名 cart + presentation/fan-message locale + cart_item/support_intent 原子事务 |
| P4-02 | DONE | Codex `/root` | P2-03/04、P4-01 | 七语真实加购/抽屉/页、数量/删除/私密编辑、冲突与同键恢复 |
| P4-03 | DONE | Codex `/root` | P4-01、P4-02 | Preflight/quote+amount + order presentation locale + per-object TranslationSnapshotRef + policy revision |
| P4-04 | IN_PROGRESS | 无 executor，商户验收待续 | P1-06、P4-03 | TEST/通用接口本地检查点通过；真实 PSP 等门保留 |
| P4-05 | DONE | Codex `/root`（已释放 Lane A） | P4-04 本地检查点（ADR-014） | 可信入账、安全查单、七语言订单结果与历史状态进度完成本地验收 |
| P4-06 | DONE | Codex `/root`（已释放 Lane D） | P4-05、P1-06 | 七语言事务通知、安全邮件查单、幂等重试与到期竞争完成本地验收 |

## P4-01 执行登记（2026-09-08）

- Owner：Codex `/root`，Lane A 唯一 executor；开始 2026-09-08T08:08:44Z，基线 `7ae44bd`，跟踪工作区干净；按 ADR-013 从依赖完成的 READY 领取本轮唯一任务。P3-06 验收待续且无 executor。
- 范围：游客购物车初始化/安全读取/原子加购；当前艺人、礼物、资格、已发布价格、市场币种和独立库存策略重验；独立 cart item + 加密 intent + cart version + 幂等安全引用 + outbox 同事务。无留言匿名合法，公开视图保留真实内容语言来源。
- 顺序与所有权：先冻结合同与失败测试；storefront_read 独占新 cart-runtime 合同/纯领域/test；storefront_directory 独占新 PG cart 仓储、0023迁移及其测试；storefront_e2e 独占新 cart HTTP/transport/composition 与真实协议脚本；root 独占 Application、空字段封装密钥端口与KMS、共享exports/registry/OpenAPI/config/manifest/生成物/进度与Git。子步骤不另占任务，冻结前只读。
- 验证：定向 RED→GREEN、旧合同兼容、format/lint/typecheck/build、真实PG迁移up/down/up与回归、HTTP cookie/Origin/CSRF/幂等/并发/回滚/隐私。新加购在结账前不预占；测试覆盖按单零库存、限量不足、旧显式资格和日常全部艺人规则。冻结后统一完整check，非作者复核与S.U.P.E.R。本轮不修改产品UI，P4-02再实现抽屉和编辑体验。整仓门检出共享合同依赖使P2-04/05指纹过期，因此必须通过原浏览器采集器刷新这两项；P2-02/03原门仍有效。P3的63次Lighthouse留在未完性能验收，不重复作为本任务购物车证据。
- 风险：R-01/02/03/17；初始化丢响应可以留下过期前空车，但不携带第一行；用户先建立稳定cookie后加购，丢加购响应必须同车同key重放。没有PSP/真实收款/生产账号或新人工证据；保护既有文件，仅本地提交。

## P4-01 整合评审（2026-09-08T09:20Z）

合同、纯领域、Application、KMS、PG、HTTP 与生产配置装配已完成；非作者复核已接受当前分层、旧合同兼容与两函数迁移。实际主协议及三次独立空车中新发布即加购通过（6029 总断言含准备、1905 准备 API 请求），PENDING/DYNAMIC 两种拒绝危险回退均保留实际数据 SHA。原第四轮 daily CONTENT_UNAVAILABLE 未定位且未复现，不能声称根因已修复；第五轮有预读，第七入口三次无预读/重试均通过。第六入口只是诊断模块未声明依赖导致 import 失败，修正 TEST 相对模块路径后实际 import smoke 通过。

开始整合 REVIEW，待原 P2-04/05 浏览器刷新和单条完整 check 后决定 DONE。实现输入 1734 项已冻结，清单 `output/checks/p4-01-cart-runtime/final-source-snapshot.json`；证据入口 `final-verification.md`、`contract-domain-review.md`、PG `README.md` 与 `output/checks/p4-01-cart/`。Quality 超时预算由20改30分钟，定向配置门红绿通过、Security仍20，原检查未删除。

### 整合门异常与证据范围

完整check第二入口476.27秒失败于旧发布HTTP的PUBLICATION_PERMISSION，原源定向又在CLAIM_WINDOW拒绝；仅增强TEST安全统计后的定向11243断言/1276请求通过，不能称旧失败根因已修。独立临时PG的8秒/183采样实际测得544403微秒自然墙钟倒退，同期宿主Node无倒退；实例已清理，未改系统时钟或任何业务时间/权限门。原始失败与聚合观测见本轮证据目录。正在对最终1734输入重新执行单条完整check，P4-01仍REVIEW。

## P4-01 验收完成（2026-09-08T10:07:46.800105+00:00）

- 交付：匿名安全会话、当前内容/价格/资格/独立库存重验、加密意图、原子item/intent/version/outbox/幂等回执和恢复；前端抽屉/编辑与结账/支付分别留给P4-02及以后。
- 实际验证：23迁移/159表up/down/up，全部原PG/HTTP/TLS S3链路通过；完整门中的购物车6029断言含准备、1905准备请求，主29请求、3次无预读首次新礼物加购，以及两种禁止危险回退通过。发布HTTP12337断言/1406请求，媒体恢复423断言；P2-04/05原collector和checker均通过，P205既存moderate/人工/真机边界保持。
- 完整门准确退出：full3在1247.50秒因output-only时钟诊断脚本两处URL未显式导入而exit1；PG/HTTP/S3均已通过。只补Node URL导入后，原check自Prettier至最后出口验证的完整后缀33.578秒exit0，类型60/60、测试60/60、构建35/35、31实际Node出口通过，使用部分缓存。1734实现输入SHA `57cf44e3d4e2667340912c102e217161de23906de19fae4e7aae478a5d076d65` 逐字节未变，非作者独立核对两段完整覆盖原门；未改称单次整条exit0。
- 收敛/评审：合同、PG、API、Application/KMS分责，code-simplifier只做小范围表达收敛；S.U.P.E.R 10项PASS，非作者ACCEPT；secret scan与high dependency audit通过。精确命令、缓存、原失败、源SHA、截图和风险在 `output/checks/p4-01-cart-runtime/final-verification.md`。
- 保留风险：第四次daily CONTENT_UNAVAILABLE、旧发布/租约的间歇拒绝未定位；独立PG实测自然墙钟回退约544ms，仅是环境观测，不冒称原失败根因已修。无AWS/IAM、PSP/实际收款、生产部署或新真机验收。P3-06保持IN_PROGRESS、无executor，P3不关闭。
- 本任务DONE并释放Lane A，只解锁直接后继P4-02为READY、无executor；总计23DONE/1READY/1IN_PROGRESS/24PENDING=49。按用户偏好仅创建本地Git检查点，不push/merge。

## Phase 必须证明

- 浏览器篡改偶像、variant、价格、币种或库存不能生效。
- 公共 cart/order DTO、日志、分析、对象元数据和录像不含留言/完整显示名。
- 成功、失败、取消、回跳早于 webhook、UNKNOWN 和 10 次重复 webhook 均正确。
- 同一变体送不同偶像保持独立，历史订单不随实时商品变化。
- cart/订单固化 presentation locale；偶像/礼物/媒体各自固化 TranslationSnapshotRef，政策固化 translation revision，payment 固化平台 requested/provider actual locale，notification 固化 requested/resolved locale + templateVersion。切换 UI 不改变 market/currency/金额/attempt，七语言邮件完整且历史翻译不漂移。

## Phase 退出证据

已按 ADR-013 激活本地开发；尚无 Phase 4 退出证据，P3 也未退出。

## P4-02 执行登记（2026-09-08T11:34:42.903443+00:00）

- Owner：Codex `/root`，Lane B 唯一 executor；从 `c6ca6ba` 与干净跟踪工作区领取本轮唯一 READY 任务，分支 `codex/p4-02-cart-storefront`。P3-06 无 executor、未完验收保留。
- 范围：七语言真实购物车抽屉/页、礼物详情加购、数量调整、删除、私密留言/署名编辑、多艺人行隔离、失败回滚和同键恢复；补齐必要 PATCH/DELETE 与最小授权私密编辑协议。复用 P4-01 PostgreSQL/KMS/Cookie/Origin/CSRF，不把购物车放入浏览器存储。
- 视觉：沿用黑金与原色摄影；礼物和收礼艺人作为每行主信息，轻分隔、清晰金额与唯一主动作；复用抽屉过渡、加购确认和 reduced-motion，避免新装饰动效。
- 顺序：先审计并冻结合同/端口；独占文件边界后并行后端、界面和协议验收，root 负责整合与真实浏览器。修改前失败测试。
- 验证：并发版本冲突、授权/隐私、重复请求/断网恢复、原子更新/删除及真实PG；七语390×844与1440×900，键盘/焦点/live region、错误/空/加载/reduced-motion；受影响测试→format/lint/typecheck/build→原集成门与非作者S.U.P.E.R复核。
- 边界：结账、预占、订单与支付仍属P4-03及以后；不改批准视觉、原P3性能门或生产发布门。风险R-01/02/03/07/17；本地Docker PG自然时钟回退已知，保留失败原证据。只本地提交，不push。

## P4-02 整合评审（2026-09-08）

- 合同/PG/Application/API/BFF 与七语 UI 已实现，非作者分责复核当前范围 ACCEPT。448 个旧合同根、旧 OpenAPI components 和 0001–0023 迁移保持；仅增加编辑协议与 0024 审计/回执/独立事件，旧 cart 响应引用有记录地扩展删除后重放错误。
- `check-dev-2.log` exit 0：类型60/60、测试60/60、构建35/35，格式/lint通过；首轮仅测试文件格式失败，保留原证据后格式化修复。密钥扫描、high 依赖审计通过。此开发门不替代实际 PG/浏览器/正式整仓门。
- 真实协议最新 `run-2026-09-08T12-20-02.282Z`：5757准备断言/1902准备请求 +167协议断言/33cart请求，共5924；另0024拒退8断言。真实并发同版本不同键严格一成功一冲突，同键一更新一重放；已确认事务中止的恢复保持原规则。
- 浏览器首轮检出礼物详情独立布局未接 CartProvider/CSS，实际radio高度22px；补齐礼物系列独立布局接线，保留流式加载/404/SEO。新增页面回归RED5FAIL→定向86PASS、types/lint/format通过。第二轮实际首购、Secure/HttpOnly Cookie、双艺人行隔离、44px触控和en390cart axe通过；抽屉初始焦点仍在诊断，尚不称浏览器矩阵完成。
- 证据入口 `output/checks/p4-02-cart-storefront/final-verification.md`、`contract-persistence-review.md`、`api-bff-review.md`、`ui-implementation-review.md`；待最终浏览器、原P2-04/05刷新、实现输入冻结与完整check后决定DONE。当前Lane B仍由root持有。

### P4-02 最终门复核中（2026-09-08T12:53Z）

- 已完成七语两视口16cases/40PNG/30axe零违规与端到端并发、丢响应同键恢复；14个drawer的aria-hidden-focus incomplete保留，不能宣称人工无障碍通过。原浏览器四次失败均记录分类与对应修复，未跳过原门。
- 原完整 `pnpm check` 首次入口1.34秒失败：新ja/zh词库使旧字体子集失效；按现有锁定输入生成器重建两CSS、两WOFF2和manifest。无缓存首尝试失败被保留，随后精确SHA固定下载并生成通过。41个字体/设计单测通过后，原设计门另发现cart.css两处尺寸未使用token；改用现有layout/space变量，41tests和原设计门最终通过，没有修改检查器或阈值。
- 再次刷新P2-04→P2-05，严格顺序使用原collector，两项exit0。初始72项共享证据与第一次已通过刷新分别完整归档，未改旧报告hash来代替采集。字体后购物车矩阵正在以原命令重新编译验证。
- 最终实现输入1799项冻结于 `final-source-snapshot-3.json`，SHA `315b79316cff1cd681f16113d2e4d0dc3a54c2afff40913a46c7d5579dc4bdac`；相对首版只变字体5产物与cart.css的2处token替换。P4-02进入REVIEW，Lane B仍由root持有，等最终整仓门结果再验收。

### P4-02 原整仓门续验说明

最终字体后的新run12:52:45.960Z已一次通过全部16cases/40PNG/30axe零违规与5924协议断言，进程清理exit0。full2原单条check在351.162秒于旧0017资源管理same-recipe并发case失败（SQLSTATE23514，96断言），冻结1799输入无变更；未改原脚本的定向129断言exit0，但不能称精确根因已修。正在以实际package scripts逐字派生的原后缀继续：失败节点及剩余PG包链→其余API PG链→完整quality后缀，所有命令/组退出保存check-resume-1.json/log。保留原失败，只在全部原门同源覆盖后验收，不伪称单条check全绿。

续验PG12命令45.763秒、API14链846.065秒均exit0。第三组开始前防漂移发现仅admin/next-env.d.ts两条Next自动导入转为dev路径；来源是原admin-workspace的next dev。保存暂态并精确恢复冻结字节，1798其他输入保持；不称1799全过程无漂移。quality组原未执行，现以正确pnpm PATH启动原8项完整后缀（含S3），结果待check-quality-suffix-1.json。

## P4-02 验收完成（2026-09-08T13:25:34.507306+00:00）

- 交付：礼物详情实际加购，七语言购物车抽屉/页面，多艺人独立行，数量、删除、私密留言/署名编辑与加密审计，版本冲突显式确认、失败回滚和原key/body恢复。按单礼物保持独立库存策略；不因零现货阻止重复售卖。结账仍准确提示准备中，不包含预占、订单或支付。
- 真实浏览器：最终字体/CSS版本run12:52:45.960Z，16cases/40PNG/30axe零violation、0pageErrors；172触控目标最小44×44，双端20Tab+20ShiftTab与删除焦点/live region通过。14项drawer incomplete保留，桌面正常motion/移动reduced motion；全程TEST身份，已清理。P2-04/05原collector最终顺序刷新并保持当前fingerprint，既有moderate/真机门边界不改。
- 全部原检查步骤有通过证据：full2在351.162秒因旧0017资源并发23514失败，未改原脚本定向129PASS；原PG后缀12命令45.763秒exit0、API14链846.065秒exit0；最后原8项质量后缀108.613秒exit0。包含24迁移/162表、实际PG/HTTP/TLS S3与媒体423断言、新cart5924断言含5757准备及33协议请求、独立0024拒退8项。类型60/60（56缓存）、测试60/60（56缓存）、构建35/35（33缓存）、31Node出口、format/lint/架构/合同、secret与high依赖审计通过。不是单条完整check exit0。
- 一致性：1799最终输入集合与字节匹配冻结SHA315b79316cff1cd681f16113d2e4d0dc3a54c2afff40913a46c7d5579dc4bdac。原后台next dev曾仅改自动next-env两条类型导入，防漂移中止后已存暂态并精确恢复；不称全过程零漂移。2260原未跟踪文件逐SHA完整保留。非作者实际复核原命令全覆盖/源/七語浏览器/共享证据，ACCEPT；S.U.P.E.R10项PASS。
- 证据入口：`output/checks/p4-02-cart-storefront/final-verification.md`、`gate-coverage.json`、`final-independent-review.md`；续作运行命令在 `docs/runbooks/cart-runtime.md`。旧资源并发首次23514确切根因仍未定位；旧环境时钟观测不能直接当成本次解释。七语人工译审、P3-06性能/人工运营/VoiceOver、正式资产，以及AWS/IAM、PSP、生产域名/真机/部署证据均不在本轮完成范围。
- P4-02 DONE，释放Lane B；只解锁直接后继P4-03 READY、Lane A无executor。P3-06仍IN_PROGRESS/无executor，Phase3与Phase4保持ACTIVE。当前24DONE/1READY/1IN_PROGRESS/23PENDING=49。按用户偏好只创建本地检查点，不push/PR/merge。

## P4-03 执行登记（2026-09-08）

- Owner：Codex `/root`，Lane A 唯一 executor；开始 2026-09-08T13:33:34.260131+00:00，基线 `059dd9d`、干净跟踪工作区。按 ADR-013 领取唯一 READY 任务，分支 `codex/p4-03-checkout-preflight`。
- 范围：服务端 checkout preflight、版本与五类 canonical 数据重验、不可变报价和订单金额、TRACKED 原子预占、按单/预售独立规则、待付款订单与各对象语言/媒体/政策快照、加密联系人、幂等和会话授权。支付能力与 PSP 留给 P4-04。
- 顺序：合同/端口与失败测试先行，再按文件独占并行 Application、PG 和 API/协议；root 整合。独立审计冻结后才开始实现。
- 验证：金额/过期/篡改/版本冲突、库存并发与回滚、政策与各对象语言历史不可变、私密信息隔离、真实 PG/HTTP、原有浏览器回归、format/lint/typecheck/build 与原整仓门；非作者复核和 S.U.P.E.R。
- 边界：保留 P3-06 未完性能/人工验收；不引入实际支付、生产假设或虚假译审。只本地提交，不 push。现有未跟踪文件逐 SHA 存于 `output/checks/p4-03-checkout-preflight/initial-untracked.json`，不改动既有产物。

### P4-03 REVIEW（2026-09-08T14:47:39Z）

- 三个 Cookie 授权端点完成：服务端持久预检、明确政策确认后创建待付款订单、同车读取历史结算。KMS 在 SQL 事务外，最终事务重验当前内容/价格/库存/政策并原子保存报价、金额、各对象来源快照、联系人密文、库存账本/预占、履约事件、幂等回执及持久事件。无支付动作。
- 第五轮原 HTTP 入口实际 exit0：20 cases、195 cart/checkout 请求、1644 协议 + 5760 准备 =7404 断言，另8项真实0025拒退；17订单/32行及履约/17加密联系人/3预占/68政策确认/17创建回执，零 payment attempt。七语历史、真实中文原文、新价1500→1637、原车明确确认新价、并发不超卖、断线同键恢复、3秒TEST报价前后历史读取均通过。
- 前四次真实失败分别保留：canonical JSON 保存与哈希不一致、遗漏初始履约 Outbox、旧通用 Outbox 默认时间早于事件、测试政策复制保留了早于新 revision 的 effectiveAt。前三项按原约束修复并有效 RED→GREEN；第四项只修正常政策投稿夹具。没有删除检查或放松 SQL 守卫；自然时钟旧观测不作为本次根因。
- 468旧合同根/旧OpenAPI保持；25迁移/165表真实往返、0001–0024原SQL逐字保持；原P2-04/05采集器顺序重新通过。新应用层465测试、PG时间回归19断言、原全消费者开发检查通过；全仓原单条 `pnpm check` 正在执行，待结果决定 DONE。
- 1856实现输入冻结于 `output/checks/p4-03-checkout-preflight/source-final.json`，摘要 `cd848a5ab50fd8f629c5a668068acde7465295827133c0d84507d148b3f0c95e`。证据入口 `final-verification.md`、`http-independent-review.md`、`postgres-README.md`；`docs/runbooks/checkout-preflight.md` 记录恢复边界。Lane A 仍由 root 持有。

## P4-03 验收完成（2026-09-08T15:16:46.209247+00:00）

- 交付：服务端报价预检、准确政策确认、当前事实二次重验、不可变订单/金额/各对象语言来源快照、加密联系人、TRACKED 原子预占与按单/预售独立售卖、初始履约及持久事件、锁车/锁意图和同键恢复。前端付款入口与 PSP 仍属后续任务。
- 最终实际协议：原全仓门中 20cases/195 cart-checkout 请求，5760准备+1643协议=7403断言（1902准备运营请求+87协议运营请求），另8项0025拒退；17未付款订单、32行与履约、17加密联系人、68政策确认、3真实预占、17创建回执与checkout事件、32原履约Outbox事件，零支付attempt。七语、中文源稿、真实改价1500→1637及原车明确确认、并发最后一件、断线恢复、实际到期与历史稳定均通过。第五轮7404仍保留，轮询自然计数差异没有删除用例。
- 完整门：原单条 `mise exec node@24.20.0 -- corepack pnpm check` 于2026-09-08T15:11:42.141Z exit0，用时1442.426秒。真实25迁移/165表up/down/up、所有原PG/API/TLS S3/媒体423断言、原UI静态门、新Outbox时间19断言及checkout、format/lint/typecheck/test/build、31Node出口完整通过，无跳步或替代后缀。类型60/60（56缓存）、测试60/60（56缓存）、构建35/35（35缓存），按实际保留缓存范围。
- 浏览器：原P2-04/05采集器exit0；16场景/18PNG/10axe零violation及4incomplete；8场景/22PNG/3axe保留原3项moderate与3incomplete，blocking0及physical-device门不变。没有本轮新结算UI或真机验收。
- 保护与兼容：1856实现文件集合/字节与冻结SHA `cd848a5ab50fd8f629c5a668068acde7465295827133c0d84507d148b3f0c95e` 一致；2267原未跟踪文件完整不变；48旧SQL、468旧合同根及旧OpenAPI保持。原后台Next仅自动改写类型导入，暂态归档后精确恢复，未称全过程零漂移。
- 收敛与终审：定向有效RED→GREEN、最小代码收敛、S.U.P.E.R10项及非作者ACCEPT；额外secret scan exit0（35.738秒）与high dependency audit通过。前四轮实际失败、有效回归/夹具错误和旧未定位间歇风险均保留，不用旧时钟观测替代根因。证据 `output/checks/p4-03-checkout-preflight/final-verification.md`、`final-independent-review.md`、`gate-coverage.json`；续作入口 `docs/runbooks/checkout-preflight.md`。
- 范围：TEST加密履约配置与本地KMS adapter不代表真实配送审批/AWS KMS；没有PSP收款、正式资产/译审、云或生产发布。本轮不关闭P3-06未完性能/人工验收。
- P4-03 DONE并释放Lane A；只解锁直接后继P4-04 READY、无executor。P3-06仍IN_PROGRESS且无executor，Phase3/4保持ACTIVE。总计25DONE/1READY/1IN_PROGRESS/22PENDING=49。按用户偏好仅本地Git检查点，不push/PR/merge。

## P4-04 执行登记（2026-09-09）

- Owner：Codex `/root`，Lane A 唯一 executor；开始 2026-09-08T17:05:54.878806+00:00，基线 `f1f702f`、跟踪工作区干净，分支 `codex/p4-04-payment-runtime`。P3-06保持未完验收且无executor。
- 范围：绑定既有checkout/cart会话的支付能力、冻结provider/account/environment/method/rule/locale的两事务创建Saga、持久幂等与崩溃恢复、托管付款动作、回跳只查询、UNKNOWN受认证审计reconcile。复用P4-03现有订单/报价/预占，不重复创建订单；可信事件推动订单/库存完整闭环保留P4-05边界。
- 界面：沿用黑金风格，结算复核、联系邮箱与政策确认、支付方式及安全等待/未知状态；七语、移动/桌面、键盘与reduced motion。具体接口冻结后分工，实现不在浏览器保存支付凭证或私密留言。
- 流程：先审计旧payment port/schema/authority及失败测试，root冻结共享合同；PG、API/实际协议、界面按文件独占并行，root负责Application/共享合同/生成物与整合。原有任务/阶段门与合同兼容保持。
- 验证：真实PG两事务/并发/唯一活动attempt、同键重放与崩溃窗口、改变配置不改既有account/amount/locale、授权/隐私、已知终态受控重试、UNKNOWN不换路、回跳不能成功、reconcile可信证据；真实HTTP与七语390×844/1440×900浏览器；受影响测试→format/lint/types/build→原整仓门→非作者复核/S.U.P.E.R。
- 待定输入：收款主体、首发市场/币种与首个批准PSP仍OPEN，已异步询问用户；按规范§13.1/21先做明确TEST的Fake链路，不自行选择或承诺真实支付商。实际PSP sandbox/小额支付缺证据时不把整个P4-04或Phase4标DONE。风险R-03/05/17及支付相关隐私/库存。
- Git/产物：仅本地提交，不push/PR/merge/部署；2349项既有未跟踪文件已逐SHA记录于 `output/checks/p4-04-payment-runtime/initial-untracked.json`。

### P4-04 本地联合验收（2026-09-09）

- 两事务支付创建、持久幂等/lease/恢复、可信证据与加密托管动作、五个受保护API及BFF、七语结算/国家与方式选择/托管跳转/回跳只读均已接通。普通GET无支付副作用，已知取消后可受控重试，UNKNOWN不换路，成功证据保持EVIDENCE_PENDING而不提前PAID。
- 最终浏览器入口 `run-2026-09-08T19-28-30.305Z` 实际exit0，7077联合断言；31cases包含14完整加购→结算→独立TEST PSP→真实返回、14无Cookie空态、双端键盘和保留原订单语言的语言切换。71PNG、57axe零违规/零incomplete、0pageErrors；日语reduced motion。并发、健康变化、实际PSP进程重启、接受后丢响应及两次真实COMMIT后结果边界注入均通过；后者是测试注入，不冒称真实数据库链路故障。
- 原生TEST PSP表单曾因no-referrer得到Origin:null、再因form-action self阻止跨站303回跳；两个实际RED保留，分别仅改TEST hosted HTML的strict-origin与固定配置returnOrigin CSP，原exactOrigin/CSRF不弱化。生产BFF的精确反代Host绑定、无Cookie空态与SQL domain[]读取亦经有效RED→GREEN及非作者复核。详见本轮 `final-verification.md`。
- 1979实现输入冻结，SHA `5d43c607c9ca945792c88cea1f697116946df6e5ce986de3c6ee182e1918c5ed`；2349原未跟踪文件复核完整不变。原合同502根/87路径/161components不变，0001–0025的50旧SQL保持，新增0026；26迁移/168表实际往返已通过。
- 原P2-04/P2-05采集器与完整check尚待最终结果。当前阶段仅为本地检查点验收，不将P4-04标DONE；首个实际PSP尚待用户输入，P4-05仍PENDING，25DONE/2IN_PROGRESS/22PENDING计数不变。


### P4-04 本地 TEST 检查点验收（2026-09-09）

- 本轮本地支付创建、托管页面、持久幂等、丢响应和重启恢复、七语言结算入口完成。最终浏览器为 31cases/71PNG/57axe 零 violation/零 incomplete、0pageErrors，7077 联合断言；含14购买流程、14新访客空态、键盘和语言切换。实际PG/独立TEST PSP后续 HTTP 在新 seed 下再次通过 5761准备+801协议=6562断言，另8项拒退与30表哈希不变。
- 原检查链38步骤均有通过证据，详见本轮 `gate-coverage.json`。原单条 `check-full-2` 于旧内容发布授权403失败；后续旧purge CLAIM_WINDOW/旧内容读取403保留，未改动实际HTTP子进程最终12826断言/1462请求通过，确切原因仍未知。全仓合同测试5169ms超5000ms后同源码/同阈值复验通过。不能称单条完整check exit0，也不称间歇问题已根治。
- 最终原7项质量后缀33.910秒exit0：format、lint、types60/60（56缓存）、tests60/60（57缓存）、build35/35（33缓存）、adapter边界、31Node出口。原P2-04/05 collector分别29.347/37.756秒通过；旧moderate/incomplete/physical-device边界保留。26迁移/168表、实际PG/API/TLS S3与媒体423断言完整通过，最终secret scan25.264秒和官方registry high audit通过。
- 原合同门发现TEST seed重复locale表，改为复用已有copy并以真实正常PG配置/HTTP复验；原adapter门发现新增private factory公开导出，移除多余barrel export并加负例，有效RED→GREEN，正式事务manager接线不变。最终1979输入SHA `88c0bbbac1a1299885cafc7f27dd8999f4197518e55e0fcb4dd8f13dd80ee744`；浏览器后这两次源差异均记录，不混同各轮构建。旧50SQL、502合同根/87路径/161components及2349原未跟踪文件完整保持。Next自动类型文件曾暂态变化，已归档并精确恢复。
- 非作者复核与本地范围S.U.P.E.R10项通过；证据入口 `output/checks/p4-04-payment-runtime/final-verification.md`、`final-independent-review.md`、`gate-coverage.json`；复验及故障恢复入口 `docs/operations/checkout-payments.md`。
- 这不代表实际收款：首个批准PSP/商户主体/首发市场币种与sandbox账号仍OPEN；不包含PAID终结、库存commit/release、查单通知、正式译审、真机/VoiceOver、云或生产部署。P4-04继续IN_PROGRESS，Lane A由root持有；P4-05仍PENDING，25DONE/2IN_PROGRESS/22PENDING=49不变。按用户偏好仅本地Git检查点，不push/PR/merge。

## P4-04 通用支付接入续作（2026-09-09T09:26:00Z）

- 用户明确：先完成 Visa/Mastercard、USDT 与聚合平台的通用接入基础，具体商户与协议差异待取得资料后对接；本轮继续 P4-04，不领取 P4-05。Owner `/root`，Lane A，基线 `53340ca`，只本地提交。
- 范围：版本化连接合同、静态适配器工厂/可重建配置投影、独立 Secret 引用解析边界、可运行的仓库标准网关协议客户端与 raw webhook 验签、USDT 精确数量/网络/报价/到账评估及接入说明。银行卡保持 PSP 托管；不接触卡号/CVV/私钥。
- 设计边界：仓库的标准网关协议不是所有厂商通用 API；厂商差异由已部署 adapter 处理。账户协议与商户绑定不可就地改写，旧支付恢复必须保留原账户。PostgreSQL 已发布路由仍是业务真相，配置注册器只做可重建投影，不自行授予商户或支付方式可用性。真实管理中心商户发布、首家 PSP sandbox 与最终收款验收仍 OPEN。
- 验证：先合同与有效失败测试；独占文件并行；配置原子更新/拒绝未知 adapter/旧账户保留/凭据轮换；HTTPS 实际传输、超时/丢响应/禁止重定向、严格响应关联、签名/时间/错账户；USDT 少付/多付/迟到/错链/确认与大整数；受影响测试后执行原整仓门及非作者 S.U.P.E.R。无前台视觉修改。
- 证据目录 `output/checks/p4-04-payment-connectors/`，既有未跟踪文件已按 SHA 保护。P4-04 与所有真实支付门保持 IN_PROGRESS，计数不变。

### P4-04 通用接入本地检查点验收（2026-09-09）

- 新payment-gateway：版本化连接/静态工厂/全量配置投影原子切换、旧连接保留、Secret引用解析与轮换、七操作HTTPS协议、来自固定配置的CARD品牌/3DS/capture要求、总截止和回调raw字节验签。Application/API已支持运行中目录新增，PG路由与订单金融权威不变。
- USDT新增独立资产/网络/token/精度/报价/认证观察合同及BigInt/微秒评估；匹配仅为MATCHED_EVIDENCE。通用HTTP工厂仅CARD/LOCAL_PAYMENT，具体USDT mapper/持久报价绑定与实际商户接入仍待，不冒称可启用链上收款。
- 定向：新包8文件97测试、合同3文件53测试、Application3文件30测试、API5测试通过；真实TLS七操作/七断连一次dispatch/坏CA和SAN/过大正文/总截止/签名固定向量通过。非作者复核与S.U.P.E.R10项本地范围通过。
- 原38检查步骤全部有通过证据，但不是原单条check全绿。首条1350.252秒失败在旧daily READ_OPERATION FORBIDDEN（7161断言，权限JOIN未命中，具体原因未知）；同源checkout107.775秒复验7405断言/195请求通过。实际payment-runtime6562断言及11项独立TEST PSP验证、26迁移/168表、原PG/API/TLS S3和媒体423断言通过。原5秒合同测试限时出现7224ms失败，同源同阈值原turbo test复验通过。原后缀runner的PATH错误亦单独保留，未改项目命令。
- 质量：format/lint、types61/61（29缓存）、tests61/61（60缓存）、build36/36（31缓存）、adapter边界、32Node出口通过；secret scan与官方registry high audit通过。原P2-04/05采集器通过，旧moderate/incomplete/真机门保留；首次P205并行工作区状态守卫失败后，冻结再跑原命令通过，守卫未改。
- 兼容：539旧合同根、92paths/171public components与全部52旧SQL保持，新增11内部合同根。1998实现输入SHA `dcaf38f0a4cb8e926b3477c4db212a24d46085a6fd248dbe290e733e10c27ea2` 最终逐字保持；2361原未跟踪文件完整保持。Next自动dev类型导入已归档精确恢复。
- 证据 `output/checks/p4-04-payment-connectors/final-verification.md`、`gate-coverage.json`、`final-independent-review.md`；续作 `docs/operations/payment-connectors.md`。真实PSP/商户资料、USDT专属接入、Secret Store实际云配置、PG商户发布/广播和管理中心简化表单、P4-05订单终结仍未完成；不扩大本轮为生产验收。
- P4-04继续IN_PROGRESS，root持有Lane A；P4-05仍PENDING，25DONE/2IN_PROGRESS/22PENDING=49。用户已明确暂缓商户细节，继续保留通用接入检查点；仅本地提交、不push/PR/merge/部署。

## P4-05 执行登记（2026-09-10）

- Owner：Codex `/root`，Lane A 唯一 executor；开始 2026-09-09T17:55:09.429808+00:00，基线 `acbdedc`、干净跟踪工作区，分支 `codex/p4-05-order-completion`。按 ADR-014 从 READY 领取本地范围，P4-04 与 P3-06 均无 executor。
- 范围：可信持久证据关联及订单/支付/预占/意图/历史/Outbox 原子推进，然后安全查单与七语言成功/时间线；复用既有订单快照，不重复创建订单。按单礼物不伪造库存，迟到成功 ON_HOLD。
- 顺序与分工：合同/端口先冻结；root 独占调度文档、Application、Worker 接线、共享 exports/生成物。Erdos 独占 PG 实现及新迁移；Hilbert 独占真实协议及回归脚本；Noether 先独立审计合同/查单边界，冻结后分配明确文件。子步骤属于同一 Task，不另占 Lane。
- 验证：有效 RED→GREEN；实际 PostgreSQL、独立 TEST PSP、重复/乱序/错绑定/事务回滚/并发库存及断点恢复；受影响质量检查和全仓门，非作者复核及 S.U.P.E.R；界面变更须七语双端、键盘与 reduced motion。
- 边界：P4-04 实际商户/PSP、P3 未完验收及生产门不解除；本地原未跟踪清单 `output/checks/p4-05-order-completion/initial-untracked.json` 逐 SHA 保护；不 push/PR/merge/部署。25 DONE /3 IN_PROGRESS /21 PENDING =49。

## P4-05 恢复执行登记（2026-09-15）

- 用户要求完整核对大纲、进度与后续任务后继续；当前工作区仍为 `codex/p4-05-order-completion` / `acbdedc`，接续原未提交付款应用检查点，未领取其他 Task。Owner `/root` 保持 Lane A 唯一 executor。
- 已复核原完整 check 实际退出 1（1653.618 秒）：PG、全部 API 协议、6827 项新订单协议、TLS S3 / 媒体423断言、format/lint/types已通过；最后 PG composition 旧测试遗漏新增仓储键，原 legacy 三键断言仍正确。先保留并复现该失败，仅更新扩展 manager 的精确键集，再跑原质量后缀、兼容/源码保护与非作者复核。
- 本轮检查点收口后接续安全查单设计；凭证/会话、受保护历史读取与七语 UI 按原顺序推进。真实商户、P3未完验收、P4-06通知及Phase5门继续保留，总数25/3/21不变。

### P4-05 付款证据原子应用检查点验收（2026-09-15）

- 已交付可信证据关联、订单/attempt/cart/intent/inventory/history/audit/Outbox同事务应用，永久回执、双来源唯一capture与默认Worker持久恢复。按单/预售不伪库存，失败直接回调释放，真实过期后迟到收款PAID_REVIEW/ON_HOLD。
- 真实协议两轮均6827断言（5763准备+1064协议）、18case/96checkout+74payment请求，另0027拒退8项/35表hash不变；27迁移/170表往返，全部原PG/API/TLS S3、媒体423断言通过。COMMIT边界是注入，非真实网络断连；准确范围在final-verification。
- 原完整check exit1/1653.618秒末端漏manager新键；恢复先复现1FAIL/19PASS，仅补扩展键后20PASS。第一次后缀合同5000ms超时不改阈值，定向6PASS后原7项最终41.952秒exit0：types61/61（61cache）、tests61/61（60cache）、build36/36（29cache）、32出口；39项原门分段覆盖，不称单次全绿。
- 最终2031输入SHA388a14d506e6e3423cb2ea6e0b528b158254b3307da2a47a917644915ef950e5；恢复只改一条测试预期，原生产/集成输入保持。550旧合同、OpenAPI、52历史SQL、2371原未跟踪文件不变；secret scan0，同lockfile原high audit通过。原共享浏览器P204/205分别18/22PNG已刷新，既有moderate/incomplete/真机门保持。
- 非作者resume-independent-review接受并解除两旧P1，S.U.P.E.R10项本地范围通过；根级质量/兼容/源码证据入口output/checks/p4-05-order-completion/final-verification.md与gate-coverage.json。运行入口docs/operations/order-payments.md，完整路线docs/progress/current-overview.md。
- 下一顺序子检查点：安全查单token/session及兼容DAILY v2原文的历史读模型，随后七语成功/订单时间线。P4-05保持IN_PROGRESS；P3-06/P4-04未完验收与P4-06/Phase5门保持，25/3/21=49。仅本地Git提交，不推送或部署。

## P4-05 安全查单执行登记（2026-09-15）

- 接续本地ab0b137，开始基线采集2026-09-15T12:29:16Z，跟踪工作区干净；Owner `/root`保持Lane A唯一executor，仅执行P4-05第二顺序检查点。
- 范围：安全凭证签发/消费/会话轮换与撤销，已付款checkout会话bootstrap，受保护历史快照读取（含DAILY v2），可靠限流与真实PG/HTTP验证。成功页/时间线在下一UI检查点，邮件在P4-06。
- 先冻结新兼容合同和端口，再按PG、API、HTTP协议独占文件并行；root拥有合同/Application/共享配置与生成物/进度/Git。凭证仅transport内存，业务仅接keyed摘要。
- 验证：有效RED→GREEN；跨订单/跨cookie/Origin/CSRF/重复header/过期/撤销/并发消费与丢响应、限流持久性、七语言与真实原文历史保持、只读零PSP/金融/通知副作用；相关质量门、实际PG与非作者S.U.P.E.R。本地提交不推送，原验收与生产门保留，25/3/21不变。

### 安全查单验收中发现的 webhook 保留期修正（2026-09-15）

- 第二原完整check在1416.464秒exit1：前30项已通过（含实际PG和购物车/结账/payment-runtime），第31项旧webhook短测503而非202。相同源码两次定向复验及只读SQL观察确认第一条payload INSERT触发原webhook_payloads_retention_check；原签名、事件时间、队列与请求不变。不能把该失败简单归为偶发时钟回退。
- Owner仍root/P4-05/Lane A；为解除已定位的相邻订单入口阻断，范围增加最小PG适配修正：存储expiry不晚于调用方授权期限，且不晚于PG事务created_at的原七天上限。先真实生产参数SQL RED→GREEN，保留0005原约束/校验/时间阈值，独立非作者复核后跑受影响原PG与剩余订单协议、S3/全仓质量门。所有原失败保留；若分段复验，不声明单条完整check通过。

### P4-05 安全查单服务端检查点验收（2026-09-15）

- 四个受保护API、内部签发、原子一次性消费/会话轮换与撤销、已付款checkout授权、历史只读快照和持久限流完成。严格Origin/CSRF/重复头/限额/日志隐私，原图不公开；内容改名/换图/价格变化后历史保持。
- 实际PG/HTTP/TLS S3/独立TEST PSP两轮6860断言（5763准备+1097协议）、9cases含七语言与DAILY；8份历史DTO与原衍生图不变。新7短测、原4支付短测+6827入账协议、28迁移/172表、整个PG再跑376.188秒与媒体423断言均过。
- 保留期旧bug为原webhook_payloads_retention_check精确拒绝；一SQL表达式收紧到期到调用方与PG七天上限的较早者，原SQL/时间/验签不变。生产SQL5case/13断言RED→GREEN、原仓储9tests与原失败HTTP测试202通过。
- 原40项门差分分段通过：最终候选24项复跑（前缀1–13、PG14、31–40），16项未受影响HTTP沿用第二候选。后缀689.053秒含PG/协议/S3，最后7质量门37.550秒：types61/61（58cache）、tests61/61（58cache）、build36/36（36cache）、32出口；前缀17.106秒exit0。不是单条全check或所有门同源一次全绿；161.330秒旧head失败与1416.464秒旧webhook失败及全部开发失败保留。
- 最终2070源集合/字节一致，SHA9603ad3c5123470fda4b5e30440eef836a3c049698190b1aa2c772ea693b6dd4。555旧合同/92路径/171组件/54旧SQL及2412原未跟踪保持；Next自动两声明与wrapper失败已归档精确恢复。原P204/205采集器18/22PNG通过，当前渲染输入一致；保留既有人工/physical-device门。最终secret scan与官方high audit通过，无依赖版本改动。
- 非作者ACCEPT、S.U.P.E.R10项通过；证据`output/checks/p4-05-order-access/final-verification.md`、`gate-coverage.json`、两份独立review；运行/恢复入口`docs/operations/order-access.md`。真实数据库故障为提交前callback注入+回滚，不称COMMIT网络断连；Cookie恢复需已知订单号，EXCHANGE跨实例限流范围如实限定。
- 下一顺序检查点为订单BFF/transport、七语言付款成功/确认中/待工作室处理、查单页面与真实事件时间线；未实现邮件/fragment浏览器验收。P4-05仍IN_PROGRESS、P4-06未开启、Phase5保持锁定；25 DONE /3 IN_PROGRESS /21 PENDING=49。仅本地Git提交，不推送或部署。

## P4-05 订单界面执行登记（2026-09-16）

- Owner：Codex `/root`，Lane A 唯一 executor；开始 2026-09-15T19:27:00.037205+00:00，基线 `ae625e1`、跟踪工作区干净，接续本任务第三顺序检查点。
- 范围：独立订单 BFF/transport、付款结果与已付款 checkout 授权、fragment 一次性交换/受保护查单、七语言历史订单详情与状态进度、失效/撤销/网络恢复。保留真实历史图文/金额/语言；进度仅展示已保存事实，不推算准备或送达时间。
- 视觉：沿用原色黑金；状态与艺人礼物照片为主，订单明细轻分隔，单一明确下一步；复用按钮/焦点/克制过渡与 reduced motion，不追加装饰动画。
- 分工：root拥有控制器/页面路由/结算衔接与共享登记；BFF/客户端传输、历史详情视图/七语文案、实际浏览器夹具分别独占文件；复用已冻结订单服务端合同，不另领Task。
- 验证：有效失败测试先行；授权/令牌清除/响应作用域/会话恢复/异步生命周期；真实PG、TLS S3、独立TEST PSP与七语言390×844/1440×900，键盘/错误/reduced motion；相关质量门、原整仓门及非作者S.U.P.E.R复核。
- 边界：邮件继续属于P4-06，不显示未实际发送的邮件或没有依据的履约时刻；P3/P4商户/生产门保留。25/3/21=49不变，仅本地提交不推送。初始未跟踪文件清单见`output/checks/p4-05-order-storefront/initial-untracked.json`。

### P4-05 订单界面整合 REVIEW（2026-09-16）

实现和非作者源码复核完成，进入最终整仓门。第四轮实际浏览器7373断言（6187准备+1186浏览器）、25场景/55截图/55 axe零违规零incomplete通过；原生Back重新加载与授权通过，pageshow.persisted=false，不称真实bfcache命中。三轮原失败和精确测试夹具修正保留。令牌fragment、历史原文、语言切换、真实过期与撤销丢正文恢复均已覆盖。

P204 collector补入root layout的order-entry依赖，先有效RED再整组GREEN；P205原已涵盖全storefront，无实现修改。共享P204/P205原采集器通过，保留既有moderate/人工/真机门。P204首轮工作区状态守卫失败（同期新建output文件），原源字节无变化；冻结全部文件创建后原命令通过，不改守卫。最终2131源SHA `6e746b77a95fefd3b771e8603bcaed361a6fa54e55bffa2a6c1d320753072176`；完整check执行中，最终验收前不标DONE。25DONE/1REVIEW/2IN_PROGRESS/21PENDING=49。

### P4-05 订单界面与任务本地验收完成（2026-09-16）

- 七语言查找/fragment授权/详情/付款结果、独立BFF/transport及checkout衔接完成。付款结果只来自授权canonical历史订单；购买时图文/规格/金额/原文保持，进度只显示当前状态和真实下单时间。隐藏/恢复重新验证，撤销未知保留关闭意图，UUID大小写等价；原合同/数据库/金融权威不变。
- 第四轮实际PG/TLS S3/独立TEST PSP/Next浏览器7373断言（6187准备+1186浏览器）、25场景/55PNG/55axe零violation/incomplete；七语言双端、真实菜单同单切换、跨单/重放/到期/轮换/丢正文恢复通过，金融/库存/履约/通知/PSP计数保持。三轮原测试脚本失败完整保留。
- 原单条完整`pnpm check`于2026-09-15T20:35:28.036400Z结束，1737.580秒exit0：40项原门、28迁移/172表、全部原PG/API/TLS S3、媒体423、入账6827/查单6860断言通过。最终类型61/61（59cache）、单测61/61（59cache）、构建36/36（34cache）和32实际Node出口通过；不宣称冷缓存或CI远端验收。
- P204补真实渲染依赖指纹，53工具测试通过；原共享浏览器P204/P205已刷新，既有moderate/incomplete/人工/真机门保留。首P204状态守卫失败后冻结文件创建，原命令通过；Next两条临时dev声明精确归档恢复，不掩盖原失败。
- 最终2131输入SHA `6e746b77a95fefd3b771e8603bcaed361a6fa54e55bffa2a6c1d320753072176`，前后集合/字节一致。573合同根/96公开API路径/180组件/56旧SQL与2412原未跟踪文件不变；secret scan与官方registry high audit通过。独立源码/证据复核与S.U.P.E.R10项通过，根证据`output/checks/p4-05-order-storefront/final-verification.md`、`gate-coverage.json`；续作运行手册`docs/operations/order-access.md`。
- 范围：JSON正文丢失是Next响应边界注入；实际原生Back重新加载通过但pageshow.persisted=false，无真实bfcache命中。真实商户/PSP、邮件、云/staging/生产、人工译审/读屏与物理手机仍未验收；预计准备时间待批准SLA，邮件提示待P4-06实际投递，P5-02实际履约时再记录准备/送达事件时间。
- 合并前两顺序检查点，本地P4-05最低验收已满足，现DONE并释放Lane A；P4-06 READY，Lane D无executor。P3-06/P4-04仍待验收且无executor，Phase5仍LOCKED。26DONE/1READY/2IN_PROGRESS/20PENDING=49。只本地Git提交，不push/PR/merge/部署。


## P4-06 执行登记（2026-09-16）

- Owner：Codex `/root`，Lane D 唯一 executor；开始 2026-09-16T01:31:27Z，基线 `7c63148`，跟踪工作区干净，分支 `codex/p4-06-notifications`。从依赖完成的 READY 领取唯一任务；P3-06/P4-04 无 executor。
- 范围：订单快照与固化 locale 驱动的付款/准备/送达七语言事务通知，不可变模板及译审清单、可观测英文事故 fallback、持久发送幂等/重试/未知结果恢复；受条件锁保护的 reservation/intent/cart/token 过期清理。沿用现有支付权威与一次性查单链接，不伪造准备/送达事实。
- 顺序：先审计既有合同、通知端口、KMS/联系人与 token、Outbox/Worker、清理锁序；冻结兼容新增合同后按文件独占并行。root拥有共享合同、Application/Worker组合、进度与整合，子任务不另领 Lane。
- 验证：有效 RED→GREEN；实际 PostgreSQL、持久队列及本地收件协议，重复/并发/崩溃重试/故障恢复、旧模板重现和 fallback 告警、清理与 webhook 竞争；七语模板双视口浏览器；受影响测试和原整仓门、独立评审及 S.U.P.E.R10项。
- 边界：正式发信服务/域名和人工译审仍 OPEN，本地收件不对真实用户发信；真实商户、P3未完验收、Phase5/上线门保留。26DONE/3IN_PROGRESS/20PENDING=49；只本地提交，不push/部署。2413项初始未跟踪文件 SHA 清单见 `output/checks/p4-06-notifications/initial-untracked.json`。

### P4-06 整合 REVIEW（2026-09-16）

- 付款、准备、送达七语言历史模板，固化传输/内容/收件身份的幂等发送与 UNKNOWN 恢复、真实 Worker 消费及资源到期清理已实现。全部模板 DRAFT；生产装配仍要求人工 APPROVED，TEST 不向真实邮箱发信。
- 实际 PG/TLS/持久队列/真实邮件 href 浏览器整合 6812 断言通过（5763 准备、1048 协议、1 输入一致性），22 cases；七语言模板 44 浏览器场景/842 断言/44 axe 零违规和 incomplete。390 与 1440 实际查单截图已复核，金额清楚可见。
- 实际过期/库存竞争主夹具 6105 断言通过；额外真实 UNKNOWN→ACTION 与 SQL 更新时间截止竞争 5843 断言通过。修复到期资源重新开放支付入口的问题：过期后保持 UNKNOWN 继续对账，可信成功仍入账 PAID/ON_HOLD。
- 独立复核指出凭据应提前校验，现已在启动时校验并固定所有活动/保留 profile 的凭据；7 项组合测试通过。旧合同/公开 API/旧迁移/2413 初始未跟踪文件保持；待共享浏览器刷新、完整 check 和最终非作者验收后决定 DONE。
- 当前 26 DONE /1 REVIEW /2 IN_PROGRESS /20 PENDING=49，Lane D 仍由 root 持有。

- 全仓首轮 25.097 秒失败于旧参数 SQL 提取器缺少 `restoresNonterminal` 变量；修为分别展开两个分支并实际 PostgreSQL PREPARE，45 断言/38 SQL 与原 action guard 10 断言通过。第二轮 174.870 秒失败于旧目录回退测试确认头仍为0028；集中更新旧回退入口和当前头断言，先证明0029新历史为空、再正常回退，原防丢历史检查全部保留。原失败日志不覆盖。
- CI Quality 预算从30改45分钟（上一轮1737.580秒，本次再增加约367秒实际集成），精确配置检查 RED→GREEN；Security20分钟保持。Ubuntu运行前提和TEST收件边界独立源码复核通过，不等于实际远程CI通过。

## P4-06 验收完成（2026-09-16T03:45:04.935533+00:00）

- 交付：三类七语言不可变事务通知、历史内容/固定 locale、事故英语 fallback 告警、固定传输/正文/收件身份的持久幂等与 UNKNOWN 恢复；实际 Worker 消费、一次性邮件查单及独立 checkout bootstrap；cart/intent/reservation/token/session 到期清理。修复过期 UNKNOWN 重新开放支付入口的风险，提交时重验截止，可信迟到收款仍入账 PAID/ON_HOLD。
- 实际通知整合：`mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:notifications`；最终6814断言（5763准备+1050协议+1输入），实际PG/TLS独立接收器/pg-boss Worker/生产构建Next邮件CTA均通过。`persistence/run-2026-09-16T03-30-06.970Z/`有双端390×844/1440×900、4PNG、键盘/reduced motion/可见金额与2axe零violation/incomplete。
- 实际清理：同环境 `pnpm --filter @fan-support/persistence-postgres test:postgres:commerce-expiry`；action5843与expiry6105断言通过，分别见`output/checks/p4-06-commerce-expiry/action-2026-09-16T03-26-33.604Z/`及`run-2026-09-16T03-27-47.921Z/`。涵盖真实截止跨过UPDATE、UNKNOWN后续CAPTURE、webhook两种锁顺序和CREATE在途竞争，不能释放正在付款的资源或吞掉可信成功。
- 模板：七语三事件双端与500项订单摘要共44场景/842断言，44axe零violation/incomplete；证据`templates/browser-2026-09-16T02-27-19-394Z/`。21条人工译审均DRAFT，生产启用门仍关闭。root与非作者复核模板和真实查单截图。原P2-04/05 collector刷新通过，18/22PNG，既存moderate/人工真机门保留。
- 原完整check第三轮2220.017秒exit1：29迁移/174表、全部实际PG/API/TLS S3/媒体423、新通知/清理、format/lint/types已通过；旧`translation-transfer-repository.test.ts`首次动态import超过原5000ms，包639/640通过。原测试与阈值未改，定向两项0.899秒exit0。初次后缀包装PATH失败0.011秒exit127保留；修正输出目录包装器后原七项质量后缀46.254秒exit0：types62/62（62cache）、tests62/62（59cache）、build36/36（32cache）、32实际Node出口与边界通过。43原门按root22步骤仅展开PG/S3的口径全部分段覆盖，不称单条全绿，偶发超时根因未定位。
- 中途变化准确保留：通知fixture执行前补齐API/Worker/Storefront依赖的28项构建，实际最终命令通过；Next admin dev生成的两条声明import已归档并精确恢复。最终冻结2190实现输入SHA`fdfeb7436391fd492f5484f0cd1b769755ee8f6f27a4b5b1e372f061de26db91`一致，不称全程零漂移。573旧合同根、96API路径/180组件、56SQL及2413初始未跟踪文件保持。
- 非作者最终ACCEPT，无未闭环P1/P2；启动校验/固定所有保留发信凭据的P2已闭环。S.U.P.E.R10项通过（测试为同源分段证据），secret scan26.561秒/high dependency audit0.693秒exit0。精确argv、缓存、原失败、review、完整门映射及剩余风险见`output/checks/p4-06-notifications/final-verification.md`与`gate-coverage.json`；运行入口`docs/operations/order-notifications.md`。
- 范围：TEST网关只持久接收回执，无真实SMTP/收件箱；准备/送达是正常付款订单上受约束测试事件，不代表P5运营或实物送达。正式域名/邮件、人工译审、云KMS、实际PSP、小额支付退款、物理手机/读屏、staging/生产均未验收；Linux/GitHub CI也未运行。
- P4-06 DONE并释放Lane D；27DONE/2IN_PROGRESS/20PENDING=49，无READY。P3-06/P4-04继续待验收且无executor，Phase5仍LOCKED。按用户偏好只保存本地Git检查点，不push/PR/merge/部署。

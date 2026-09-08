# Phase 4 — 加购、结账与订单闭环

> 状态：ACTIVE
> 任务：6  
> 解锁条件：通常须 Phase 3 退出；2026-09-08 按用户继续下一阶段与 ADR-013 启用本地开发例外，P3 未完验收保留

## 目标

形成选择偶像、礼物、私密留言、测试付款、canonical 订单及查询读模型、安全查单与通知的真实纵切片。

## 任务状态

| ID | 状态 | Owner | 依赖 | 证据/说明 |
|:--|:--|:--|:--|:--|
| P4-01 | DONE | Codex `/root` | P1-03/04/05、P3-05 | 匿名 cart + presentation/fan-message locale + cart_item/support_intent 原子事务 |
| P4-02 | DONE | Codex `/root` | P2-03/04、P4-01 | 七语真实加购/抽屉/页、数量/删除/私密编辑、冲突与同键恢复 |
| P4-03 | DONE | Codex `/root` | P4-01、P4-02 | Preflight/quote+amount + order presentation locale + per-object TranslationSnapshotRef + policy revision |
| P4-04 | READY | — | P1-06、P4-03 | PaymentProvider/provider locale mapping/idempotent create Saga/hosted action/reconcile |
| P4-05 | PENDING | — | P4-04 | Provider evidence/order/reservation/locale-preserving token exchange |
| P4-06 | PENDING | — | P4-05、P1-06 | 七语言 Notification/fallback alert/expiry cleanup |

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

# P3-06 性能第三轮 S.U.P.E.R 补充复核

结论：**第 1–9 项在本次性能改动范围内 ACCEPT；第 10 项 PARTIAL。** 本文不表示 P3-06 DONE、性能预算通过或生产发布完成。

复审者 `/root/storefront_read`，2026-09-08；采用项目 skill 的十项清单。本次仅轻量读取源码、冻结清单与已有结果，只写本文；未执行测试、构建、服务、浏览器、HTTP 或其他网络操作，没有干扰进行中的性能采样。

## 源码与复审归属

- 最终清单是 **`implementation-source-before-final-matrix.json`**，1540 个源码/配置/测试输入，SHA-256 **`662dcb3e30ca0d97e070e90262a7e8b6945d5b52ba12088a338ea7d119cc148f`**，捕获于 2026-09-07 18:22:32 UTC。本次独立比对 29 个相关当前产品文件与清单 SHA，全部匹配，没有重新扫描或重算全仓指纹。
- 与前一份 `implementation-source-performance-iteration-3-final.json`（1539 项，`7f4695db…`）逐清单比较，仅新增 `apps/api/scripts/storefront-acceptance-lazy-validation.mjs`；没有产品文件变化或删除。最终浏览器 `source-provenance.json` 另记录了 662 清单与重新编译来源。此前 5caf、7f 的记录保留其原范围，不改写为新的完整运行结果。
- **作者边界：** 首页/艺人流式组合和 GiftPurchase/Quantity/纯选择函数拆分由本代理实现，复用 `/root/storefront_directory` 的非作者评审；root 的礼物读取调度、loading 字体与 stacking 调整复用 `/root/storefront_e2e` 的非作者评审。root 的 locale/filter 与目录代理的 lazy validation 已由本代理独立复核；本次综合报告不是对本人实现再宣称一次独立审查。

## 十项检查

| # | 检查 | 状态 | 当前源码事实与边界 |
| --- | --- | --- | --- |
| 1 | 模块/文件职责单一（S） | ACCEPT | `GiftPurchase` 负责真实购买信息展示；`GiftQuantity` 只管理数量交互。gift-selection-values 只保留纯选择/链接函数，原入口保留查询校验。GiftFilters server wrapper 只准备展示，client 管理编辑与操作生命周期，validation 调用原完整校验。directory facade 只管理异步加载/取消边界，validation 执行原请求校验。上一轮两个 server child 仅承担各自下屏等待与渲染。 |
| 2 | 函数承担单一概念职责（S） | ACCEPT | 现有金额解析和查询构造没有复制到 client；新 `validateGiftFilterDraft` 仅将原校验结果分为输入错误、范围错误或合法 URL。取消函数只作废操作并清理相应 UI 状态。canonical helper 只判断精确 canonical 成员；没有泛化调度框架、后台写入或业务事实计算。 |
| 3 | 数据单向流动（U） | ACCEPT | Server page/reader → 已验证公开 DTO → server 展示或 client props；Browser 交互 → deferred 完整校验 → 原 BFF/API。Domain/Port/PG 未因本轮引入 React/Next。GiftPurchase 与原 server reader 保留 server-only；购买 client 不接触商务读取、配置、权限材料或 PostgreSQL。 |
| 4 | 无新增循环依赖（U） | ACCEPT | 纯 selection leaf 不回引原 query 模块，旧入口单向 re-export。directory query 类型最终归 validation，facade type-import/re-export，不再有反向类型边；validation 不回引 facade。server wrappers 依赖 client 边界，client 只 type-import props/copy/contracts；没有反向导入 server wrapper/formatter。这里只核本轮依赖边，不替代最终全仓检查。 |
| 5 | 接口由 schema/types 定义（P） | ACCEPT | 原公开 DTO、schemaVersion、IdolId、金额及 query schema 保留。SSR 初始目录来自严格 reader，交互查询/响应仍由原完整 schema 校验，不能以类型断言代替。购买 max 来自真实 offer，未知 variant 不替换为另一规格；礼物类型与 TRACKED/预售/按需采购库存策略仍独立。无新合同 root 或简化的业务协议。 |
| 6 | 跨模块业务 I/O 可序列化（P） | ACCEPT | GiftQuantity 只接一个数值上限与三条文案；filter props 为普通 query、draft、copy、href 和字符串 hint，不传 formatter、schema 或 Error。内部 async import/AbortSignal/ReactNode/Promise 属于进程内操作或服务端渲染组合，不成为公共业务载荷。私密留言、身份凭据、完整显示名或内部发布证明没有因此进入浏览器 DTO。 |
| 7 | 无新硬编码部署配置（E） | ACCEPT | 没有新增生产站点/域名、艺人 ID、价格、市场、币种、密钥或 locale 业务特判。canonical 值仍只有合同一份；语言只改变表示层，不决定价格/地区。既有金额 hint 示例移动到 server，不是报价默认值；loading 使用既有 system font token，正式 Noto 字体覆盖不变。协议路由、DOM 标识、数量最低 1 与原 TEST 样例不冒充部署配置。 |
| 8 | 依赖显式声明（E） | ACCEPT | 比对 5caf 与 662 清单，所有 package.json 和 pnpm-lock.yaml 均无变化；新增模块使用已有 React/Next/contracts/UI。动态加载改变已有依赖的加载时机，没有引入外部 CDN、包、隐藏服务或新运行时业务依赖。 |
| 9 | 模块可按合同替换（R） | ACCEPT | 等待/展示/交互加载可在 storefront 内替换，不要求修改 API、Domain、Port 或数据库。旧 selection 导出仍指向同一实际函数；独立 AST 复核确认原纯函数定义相同。替换仍必须保留当前发布证明、状态/locale 一致性、真实市场/库存与 404/失败语义；可替换性不等于允许跳过这些门。 |
| 10 | 改动后所有验证通过 | **PARTIAL** | 已有 52 files / 377 tests、全 storefront typecheck 与定向检查 PASS；最终源码对应的完整 UI 矩阵 88 cases / 88 PNG PASS，85 axe 报告 0 violations，另有真实 chunk 取消/故障/恢复 9 cases / 51 assertions PASS。**63 个 Lighthouse 样本已采集完成，但性能预算 FAILED；最终 pnpm check 待跑，真人门未完成。** 局部测试或 UI PASS 不能覆盖已失败的性能门。 |

## 保留的行为与已解决问题

- 首页/艺人 hero 仍先通过真实存在/发布证明；慢目录或商务 context 留在独立 server child，最终目录仍 SSR。未知艺人/礼物的存在检查仍先于正文 shell；礼物并行读取没有放宽严格 reader、虚构价格或吞掉异常为成功。
- canonical helper 使用 `parsed === value`，拒绝大小写/空白/内部 locale 变体。presentation 的 TypeError 及消息不变；`storefrontHref` 非法运行时 locale 从 ZodError 改为 TypeError 是已记录的局部兼容边界，当前没有依赖旧错误类的调用者。合法路径、重复查询参数、market/currency/交易上下文仍保持。
- 首屏不执行 deferred loader；艺人搜索保留非空、IME、250ms debounce、abort 与 latest-wins。动态模块仍完成完整 query/response 校验；失败不能变成空目录或默认成功。filter 编辑、IME、Drawer、卸载、history 和 reset 均作废旧操作。
- 本代理发现的两个 filter 竞态已有有效 RED→GREEN：pageshow 必须在 rAF 前同步取消；reset 必须在浏览器完成导航前同步取消。对应真实组件 closure 的小测试是受控 hooks/window 验证；此次另有最终编译产物的实际交互门，二者证据范围分别记录。
- `isolation: isolate` 仅建立 storefront 局部 stacking context。原 overlay RED 与单声明 GREEN 证明保留；最终 UI 中新增真实点击命中检查也通过。没有放宽共享 Drawer/Menu 的键盘与焦点规则。

## 复用的独立评审和已有结果

| 来源 | 本次使用方式 |
| --- | --- |
| `streaming-composition-independent-review.md`、`gift-purchase-boundary-independent-review.md` | 目录代理对本代理实现的非作者 ACCEPT；流式证明门、规格/库存/数量及纯函数同定义已审。旧文中的“浏览器待跑”是当时范围，不能当成最新最终状态。 |
| `root-performance-independent-review.md` | E2E 代理独立 ACCEPT root 调度、loading token、stacking 和修正后的失败/无 shell 测试；不将其未亲自执行的测试算成独立执行。 |
| `directory-lazy-independent-review.md`、`root-client-boundary-independent-review.md` | 本代理此前非作者 ACCEPT；分别独立 14 tests、76 tests PASS，另记录了类型归属清理与两个取消竞态修复。本次不重跑。 |
| `client-boundary-compiled-review.md` | 目录代理读取 63 个公开 route manifests、实际 loader 与 emitted code：7f 编译产物的初始 entries 未包含 schema 初始化块，GiftQuantity 替代购买展示 client entry。662 产品源码一致；不把静态 chunk inventory 当成页面实际传输字节或性能达标。 |
| `performance-iteration-3-storefront-tests-final.log`、`performance-iteration-3-typecheck-reviewed.log` | root 已执行 52 files / 377 tests PASS、types PASS。无新增测试执行声明。 |
| `run-2026-09-07T17-13-43-828Z/lazy-validation-attempt-2/verification-summary.json` 与 `README.md` | 真实 Chrome 152.0.7977.82、9 cases / 51 assertions / 9 screenshots PASS；使用真实编译应用与 API，仅延迟/503 validation script。首轮 locator 失败保留，第二轮只收窄实际 Drawer 定位。艺人原 retry 在本次 Chrome/Turbopack 构建实际恢复，但不推广到所有浏览器加载器。 |
| `run-2026-09-07T17-13-43-828Z/browser-attempt-4/ui-verification-summary.json` 与 `source-provenance.json` | 662 / 1540 输入的实际 production-compiled TEST Next + PG/API/TLS media；84 矩阵页面加 4 组交互/错误，88 cases / 88 PNG PASS，0 page errors，overlay 9/9。85 axe 报告 0 violations；仍有 29 color-contrast 与 1 aria-hidden-focus incomplete，共 536 nodes，不能写成自动扫描已证明完全可访问。 |
| 同次 `publication-visibility.json` 及 UI summary | PUBLISH 10418ms、ROLLBACK 10240ms，均在 60000ms 门内；是本地真实链路，不是正式外部 CDN 或 RUM。 |

UI 截图流程会强制 DOM 主图 eager 以完成视觉解码；独立资源测量保留原初始导航。两类结果不能互相冒充。全部七语、390×844 与 1440×900 的本地 UI PASS，也不能替代实体手机或真实 VoiceOver 语音输出。

## 最终性能结果追加

本文冻结前，本代理只读确认同次 `browser-attempt-4/performance/results.json` 的状态为 **`COLLECTED_BUDGET_FAILED`**：84 条资源记录、0 条资源采集失败、63 条 Lighthouse 原始记录。root 已读取当前全部 21 组 aggregate，以下分组数值采用其汇报，未由本代理重新采样或计算：

- 性能分数 ≥ 0.9：20/21 组。
- LCP < 2500ms：仅 1/21 组（泰语艺人页 2416.4ms）；全部组 LCP 范围 2416.4–5415.9ms，最高为日语礼物页。
- CLS：21/21 组为 0。
- 84 条资源记录的 JS 传输量 203468–207239 bytes；图片 SHOULD 门全部通过。这不能抵消 LCP 预算失败。

因此现状是**采集完成但预算失败**，不是性能尚未给出判定，也不是第三轮性能通过。原始失败与完整样本保留；没有改预算、方法或选择性丢弃样本。

当前未发现本次局部模块边界的新架构缺陷；但真实性能预算失败仍是必须继续处理的验收阻断。**第 10 项继续 PARTIAL**：性能修复后的重新验证、最后完整整仓检查、真实辅助技术体验、非开发者 3/5/8 分钟任务、正式译文/素材审核仍需各自证据。生产 CDN、staging、RUM 按其阶段归属验证；本次不把它们伪装成本地通过，也不修改 Phase/MASTER 或宣布 P3-06 完成。

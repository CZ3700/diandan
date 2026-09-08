# Final bounded review — 7db722b4

审查对象：`fd19144d9b19c6fe7752b635dbc99cef117660b3..7db722b4f5480ffb78eb19f5e2eec7675e50b1bd`，52 个提交文件。按项目开发 skill 的 S.U.P.E.R 十项及 code-simplifier 做只读收尾；没有修改产品、依赖、阈值或旧证据，没有执行测试、构建、数据库或浏览器。本代理是 Header/Drawer 的作者，这部分为最终自审并结合 `/root/storefront_read` 的独立 ACCEPT；gift streaming、字体与命令依赖为非作者复核，不把作者测试冒称独立重跑。

**结论：本次范围未发现必须新增修复的业务、安全或旧行为回归；实现审查 ACCEPT，P3-06 验收仍未完成。** 不建议为减少行数合并 Menu 与 Drawer 的加载状态机：两者 SSR ARIA、首次键盘/触屏焦点和父级关闭语义不同，现有显式分支有对应失败回归和真实浏览器证据。

## S.U.P.E.R 十项

| # | 项目 | 只读结论与实证 |
| --- | --- | --- |
| 1 | 单一模块职责 | PASS：两个本地懒加载入口只负责下载/激活交接；原共享 Menu/Drawer 继续负责菜单、模态层和焦点锁。gift 的 recipient/context 展示与读取调度分离；字体生成、资源探针、静态门各自独立。 |
| 2 | 单一函数概念 | PASS：activate/cancel/commit 分别处理请求、失效和 DOM 交接；读取函数只调度已有 reader。较长浏览器/字体函数属于明确的验收或生成流程，拆成通用框架不会增加当前正确性。 |
| 3 | 单向数据流 | PASS：严格 reader → server-only 展示区 → 已解析客户端 DTO；不存在前台反写业务真相、价格/库存重新推算或绕过发布证明。本提交没有 Domain、Application、PG、API route 或业务合同变更。 |
| 4 | 无新循环依赖 | PASS（新增依赖图检查）：facade → 动态 leaf → 现有 UI primitive；primitive 不导入 storefront。gift sections 不反向导入 factory。字体开发脚本依赖词库和静态资产，不进入运行时模块图。 |
| 5 | 显式类型/合同 | PASS：复用 DrawerProps、LanguageControlProps、StorefrontContextResponse、IdolDirectoryResponse。UI 新 props 为可选受控 open/ref/focus；原消费者默认行为保留，无新增业务 schema/version 或旧 artifact root 变更。 |
| 6 | 可序列化业务 I/O | PASS：gift 的 Promise 仅在 server-only 组合内部流转，await 后才把已有公开 DTO 传入 picker；没有 DB/session/错误对象进入客户端。React 回调、ref、组件构造器仅是同一渲染层的局部机制，不是 HTTP/队列载荷。字体 manifest 为 schemaVersion 1 JSON。 |
| 7 | 配置与环境无关 | PASS：产品复用真实 locale/copy/query、现有 tokens；没有新增品牌、艺人、市场、币种、密钥或服务地址。字体来源是可审计配置文件中的固定官方提交/哈希，运行时仅本地 CSS/WOFF2。测试 origin/证书由参数提供。 |
| 8 | 依赖明确 | PASS：`apps/api/package.json:42–46` 五条 storefront 验收/性能/预览和 management 预览/验收命令均补 `--filter=@fan-support/design-tokens...`，保持原命令步骤。design-tokens 已是 storefront 的 workspace 依赖；没有新增 npm 包或 lockfile 变化。字体开发生成器 PEP 723 显式锁定 fonttools 4.64.0、brotli 1.2.0，网站构建/运行不依赖 Python。 |
| 9 | 可替换性 | PASS：局部 loader 可替换而不改业务 reader/合同；共享 primitive 可在 UI 包内替换。字体可从固定来源重建或移除两条附加 import，完整旧 Fontsource 字体仍在。没有引入外部 CMS、商城、字体运行服务或新状态存储。 |
| 10 | 验证全部通过 | **PARTIAL / 未全过**：受影响单测、类型、格式/lint 与最终 compiled UI 通过；完整 check 和独立 P2 回归在本报告写入时仍由其他代理执行。最终 Lighthouse 明确未达门槛，字体零容差 metrics 探针也保持 FAIL。不得标记十项全 PASS 或 P3-06 DONE。 |

## 必要边界复核

- **SSR/懒加载**：`lazy-drawer.tsx:159` 的替换受 `Control && (committed || open)` 控制；取消和 commit 二次检查防止迟到模块替换焦点仍在的旧 trigger，或抢回已经移走的焦点。原 Drawer SSR 的 `aria-expanded=false` 与原 Menu SSR 尚未注册时省略该属性分别保留。首次 touch 仅请求原 popup 焦点，keyboard/pen 默认策略不扩张。连续失败可达同 URL reload，未吞错误或缓存成功业务假响应。相关真实结果为 `drawer-browser-attempt-2/results.json` 的 23 项/153 断言，以及 `header-browser-attempt-2/results.json` 的 11 项/67 断言；两者 browserClosed=true。
- **旧 404 与价格资格**：`gift-page-factory.tsx:44–62,153–159` 仍在返回 shell 前验证 handle、canonical gift 和 scoped proof；仅非关键目录/context 延后。非 gift 页的 context 已在初始 Promise.all 立即订阅，先前迟到 rejection 回归未复现于最终实现。当前 scoped recipient/offer 不被迟到目录覆盖，失败不伪造空成功或可购买状态。作者最终 102 项受影响测试及有效 RED 见 `gift-streaming-README.md`。
- **本地字体**：两个附加 CSS import 排在原完整字体后；同 family/100–900 可变字重、optional display 与精确 unicode-range 保留原文任意字形回退。固定来源、OFL 原文、生成脚本和七个最终产物均已提交。已独立重算当前七个产物 SHA，与 `font-feature-repro-result.json` 全部相同；JP 96,956 B、SC 84,152 B。生成器保留旧 webfont GSUB/GPOS 功能集合，验证 cmap、轴、垂直 metrics、100/400/900 的轮廓/advance；常规静态门核 manifest 与字节，不能代替真实字体表/shaping 证明。
- **源码对应关系**：本次只读重新计算 `source-final.json` 全部 995 个输入及排序/NUL/hash 聚合，缺失和变化均为 0，聚合精确为 `df759a88a8dd62d8f08a08eccf87f2e29781e867ffffe955e4f554b7cadce62e`。该清单是声明的构建输入范围，不是所有测试/文档/Git 状态的哈希。

## 实際结果与未过门槛

读取同 fixture `../p3-06-storefront-acceptance/run-2026-09-08T01-40-26-728Z/browser-attempt-6/{results,browser-results}.json`：最终七语双端 88/88 项、88 PNG、22,705 callback 断言；85 次 axe 零 violations，**30 条 incomplete 仍保留**。真实发布/回退至 API、Chrome HTML 和 XML 可见分别 9,177/9,368 ms；这不是外部 CDN、生产或真人验收。

独立解析该 run 的 `browser-attempt-7/performance/results.json` 与全部 21 个 aggregate：**63/63 样本收齐，评分 18/21、LCP 3/21、CLS 21/21 组达标**，状态 `COLLECTED_BUDGET_FAILED`。84 个资源页的首屏 JS gzip 为 **148,428–152,024 B**，仅 **14/84** 满足 150,000 B SHOULD，图片建议预算全部满足。未挑选最佳样本，也未把 SHOULD 改为必需门或把 observed 时间替代模拟 LCP；无 RUM/INP/新物理设备结论。

`font-shaping-browser-feature-compatible/README.md` 与原始结果保留 **FAIL / exit 1**：3,692 组实际像素、字宽和 DOM 宽高相同，但中文 weight 700 的 20 个完整字符串 `actualBoundingBoxDescent` 有约 1.9e-6/3.8e-6 px 差异。现证据未显示可见排版回归，但不能声称所有原始浮点 metrics 完全相同或探针整体通过。完整检查/P2、真人读屏/运营计时及关键译文/正式资产批准须由对应门继续记录，不能据本次源码审查关闭。

本报告冻结后不再修改源码；仅记录已存在的证据及其边界。

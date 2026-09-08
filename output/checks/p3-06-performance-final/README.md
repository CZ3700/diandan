# P3-06 首屏性能优化检查点

从 `fd19144d9b19c6fe7752b635dbc99cef117660b3` 的简洁管理中心版本继续。实现已冻结为本地提交 `7db722b4f5480ffb78eb19f5e2eec7675e50b1bd`；独立工作区 `codex/p3-06-performance-final`，无 GitHub 推送。最终 995 项编译输入 SHA256 为 `df759a88a8dd62d8f08a08eccf87f2e29781e867ffffe955e4f554b7cadce62e`，与提交字节逐项一致。P3-06 仍 IN_PROGRESS，Phase 4 保持 LOCKED；功能回归通过不代表性能与人工退出门已通过。

实现和验收记录已通过 fast-forward 同步回原工作目录的 `codex/p3-06-storefront-acceptance`。同步后核对 995 项编译输入、1,217 个保留证据文件及 845 个本次未刷新旧 tracked output，全部一致；原 1,375 未跟踪文件及另记 SHA 的一项预览状态更新均完整保留。共享 UI 旧报告和原工作区旧日志先归档再刷新，见 `integration.json`、`preservation-final.json`。Git 保存概要、复核与精选截图；完整原始报告、trace、全部截图和字体来源仍留在本地，见 `retained-evidence-manifest.json`。

## 最终实现与真实结果

- 礼物的当前发布与报价证明仍先完成，艺人目录和市场/政策区域独立服务端流式返回。异常与真实 404 边界保持；非礼物页仍等待其必要上下文，避免后台 Promise 拒绝无人处理。
- 语言菜单及三个默认关闭的抽屉仅在使用时加载。原始按钮和键盘入口保持，加载期间的 Escape/Tab/移焦/父抽屉关闭能够取消，加载失败可重试；连续失败提供刷新入口。触屏先聚焦弹层，避免自动唤起搜索键盘；打开后的焦点陷阱、滚动锁与关闭动画仍由现有共享组件负责。
- 中日文当前全部 149 个静态 UI 文案使用可重复生成的字体子集，日文 303 / 中文 322 个码点；其他任意艺人、商品和描述文字保留原字体完整回退。实际原 WebFont 的布局功能集合、字形和许可来源不变；最终日文 96,956 B、中文 84,152 B。
- 最终七语言 × 390×844 / 1440×900 回归：88 场景 / 88 PNG、22,705 个 callback 断言，85 次 axe 零 violations、30 项 incomplete 保留，零页面错误。真实发布/回退可见耗时 9,177 / 9,368 ms（预算 60 秒）。源码对应 fixture 的 `browser-attempt-6/`。
- 同一最终编译输入的实际 Chrome 专项：Header 11 场景 / 67 断言，Drawer 23 场景 / 153 断言，34 PNG。冷方向键、触屏、反复开关、加载取消、503 重试、两次失败及嵌套弹层通过。见 `header-browser-attempt-2/`、`drawer-browser-attempt-2/` 和各 README。

完整性能证据为 fixture 的 `browser-attempt-7/performance/`：原样保留 63 次 Lighthouse 13.4.1 mobile simulate 报告，按 21 组各三次中位数计分，未剔除波动样本。独立复算每组 min/median/max 和实际构建脚本字节，见 `final-performance-review.json`。

| 最终实验室门槛 | 结果 |
| --- | --- |
| 性能评分 ≥0.90 | 18/21 组通过 |
| LCP <2500 ms | 3/21 组通过 |
| CLS <0.1 | 21/21 组通过，全部为 0 |
| 首屏 JS gzip SHOULD <150000 B | 148,428–152,024 B；14/84 页通过、70 页略超建议值 |
| 实际图片预算 | 234 张均通过 |

性能整体正确记录为 **COLLECTED_BUDGET_FAILED**。礼物页 JS 从本轮基线 207,283 B 降到 152,024 B（减少约 26.7%），但不能据此关闭性能门。最终英文礼物 LCP 中位数约 2.61 秒、日文约 3.76 秒，仍超 2.5 秒。中文礼物三次波动全部保留，未选择最好的一次。

进一步逐份检查 LCP 节点和报告内最终截图：62 次为内容图片，`ja-artist-mobile-2.json` 为实际“暂时不可用”页面。该次 HTTP 200 / 无 Lighthouse runtimeError 不构成艺人内容成功证明；原三次汇总全部保留，不能据此声称 63 次均为正常内容性能。现有 Next 日志没有底层 API 错误/SQLSTATE，具体原因未确定，见 `remaining-performance-diagnosis.md`。后续测量必须增加同次测量的业务内容状态证据。

## 检查与来源

最终完整 `mise exec node@24.20.0 -- corepack pnpm check` **attempt3 单条 exit 0**，2026-09-08 03:31:05–03:50:51 UTC，1186.146 秒。真实 PostgreSQL/API/TLS S3/媒体 worker、静态边界/合同、format/lint、类型 58/58（57 cached）、测试 58/58（53 cached）、构建 35/35（34 cached），31 个 package exports 由 Node 实际导入。使用了构建/测试缓存，不冒称全部冷跑。最终 995 项编译输入及全部 tracked 产品/测试/工具源码仍与 `7db722b4` 相同，见 `source-after-full-check.json`。全仓重新生成的两个旧固定路径报告已保留本轮字节，再恢复此前 canonical 报告；实际新证据见 `full-check-generated-reports/`。

前台 56 文件 / 442 测试、共享 UI 19 文件 / 100 测试此前已实际定向运行；干净 detached checkout 顺序刷新 P2-03/04/05（55 PNG /21 axe）。整仓 attempt1 在 P2-04 旧浏览器证据过期处退出 1；attempt2 在 PostgreSQL publication-preflight 夹具准备阶段失败，主断言尚未开始。旧包装器的默认 `ASSERTION` 标签不能证明原异常为 AssertionError，原 cause 未保留。原样单脚本重跑 166 断言 / 5.856 秒通过，之后整条 attempt3 通过；根因仍未确定、未改源或断言，见 `preflight-failure-review.md`。成功复跑不冒充自然失败已修复。最终结构审查前九项通过；S.U.P.E.R 第十项仍如实保留性能和字体严格浮点探针的未过门，P3-06 不标 DONE。

共享 UI 回归工作区为 `.turbo/p3-06-shared-ui-check`，源提交固定 `7db722b4`；新证据先写 `shared-ui/imported-evidence/`，原 canonical 证据先归档再刷新。真实 fixture 提供 PostgreSQL / TLS S3 / worker / API / Next，本地测试结束后清理自身资源；不是实际生产部署、PSP 支付、RUM 或新真机证据。

原 checkout 开始时 1,376 个未跟踪文件中，1,375 项逐字节保持；既有管理预览的 `management-state.json` 在预定到期附近更新，原预览退出 0。该更新另作 SHA 记录并保留，未用旧字节覆盖，见 `preservation-runtime-update.json`。两份新 OFL 许可保留上游精确字节，含原有行尾空格；diff 空白检查只排除这两份许可，其余代码仍按原门槛检查。

## 基线与第一轮

同一真实 PostgreSQL / TLS S3 / worker / API fixture 在 `../p3-06-storefront-acceptance/run-2026-09-08T01-40-26-728Z/`，准备与公共协议 32,461 断言通过。原 1,640 项实现输入逐字节匹配，见 `source-baseline.json`。新 fixture 初次冷构建暴露预览命令漏建 design-tokens，原失败保留；API 的五条相关测试/预览命令已显式加入这一现有依赖。

第一轮产品变更：保留礼物与当前报价的真实 404/权限证明，艺人列表和市场政策在独立服务端区域流式返回；语言菜单点击时才下载；中日文合并当前全部静态 UI 词库字形，完整原字体回退仍保留。字体来源/许可证/二进制与三档字形校验及可重复生成入口见 `../../../scripts/fonts/README.md`（仓库入口为 `scripts/fonts/README.md`）。

| 同 fixture 的礼物页三次中位数 | 原基线 | 第一轮 |
| --- | ---: | ---: |
| 英文 LCP | 3219.6 ms | 2774.3 ms |
| 日文 LCP | 5421.8 ms | 3908.4 ms |
| 英文评分 | 0.92 | 0.96 |
| 日文评分 | 0.70 | 0.83 |
| 首屏 JS gzip | 207283 B | 178364 B |

原始六次报告、HTML、trace、devtools log、Lantern 输入分别保留于 `baseline-trace/` 和 `candidate-trace/`。每次均创建独占 Chrome、原预算和默认 mobile simulate；保留所有样本（包括原基线首个 optimizer MISS），两轮均正确以预算未达标退出 1。不是全链路冷缓存、独占整台机器、生产或 RUM 结论。锁定 Lighthouse 13.4.1 重算两轮全部 12 次 LCP 与原报告精确一致，`lantern-node-analysis.json` 保存原依赖图；不能把 observed 的短图片下载时间冒称模拟 LCP。

第一轮实际 UI：编译 generation 4 的七语言、390×844 / 1440×900 共 88 项 / 88 PNG 通过，22,705 个 callback 断言；85 次 axe 零 violations，30 条 incomplete 保留，零页面错误。语言菜单另有真实 Chrome 11 项 / 67 断言，冷方向键、异步取消、失败重试和移动嵌套 Drawer 通过，见 `header-browser-README.md`。这些证据只对应第一轮编译字节，后续源码变化需重新验证。

## 字体证据边界

`font-feature-repro-result.json` 记录最终 7 个产物从官方固定输入重新生成后逐字节完全一致；早期 `font-repro-result.json` 对应第一轮较大字体，不混用。`scripts/fonts/README.md` 提供官方固定来源、许可证、生成及验证入口。生成时使用原 Fontsource 全部 shard 的真实 GSUB/GPOS 功能集合，未引入原 WebFont 不含的 TTF 替代字形。

`font-shaping-browser/README.md` 保留最初探针自身 URL 分配竞态及有效 RED→GREEN；最终报告在 `font-shaping-browser-feature-compatible/`。42 个字体响应均以实际 HTTP body SHA 和 Chrome CDP 确认未使用系统回退，3,692 组实际像素、文本宽度及 DOM 宽高一致。中文 20 项 weight 700 全字符串的 Canvas `actualBoundingBoxDescent` 仍有 1.907e-6 / 3.815e-6 px 浮点差，**完整 metrics 零容差探针保持 FAIL / exit 1**，不放宽阈值或冒称所有浮点指标相等。这不覆盖全部操作系统或任意连续字重。

## 尚未退出

全部 21 组三次性能已经收齐，但移动 LCP 和部分评分仍未过门，JS SHOULD 仍有小幅超标。下一轮只针对最终报告可支持的主线程/资源依赖继续诊断，不能将观测图片耗时当作 Lighthouse 模拟关键路径。真人运营计时、实际读屏和当前关键译文批准不以自动化代替；支付、生产发布与新的物理手机证据不在本轮结论内。总进度保持 22 DONE / 1 IN_PROGRESS / 26 PENDING（49）。

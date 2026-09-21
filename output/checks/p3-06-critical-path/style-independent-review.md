# P3-06 样板样式隔离独立复核

2026-09-21，`/root/scheduler_audit`。只读审查；本 agent 不运行 Chrome、测试、构建或服务，不修改应用/测试。真实运行与最终证据由 root 提供。

## 预审：范围可行，但直接同时移动两份 CSS 有顺序风险

公开店面的首页/艺人/礼物、购物车与订单没有使用 `@fan-support/ui/composites` / `composites-client` / `motion` / `motion-client` 运行时组件，也没有直接输出这些样式定义的 `fs-hero`、`fs-idol-portrait`、`fs-gift-tile`、`fs-idol-context`、`fs-cart-line`、`fs-order-timeline` 或 `fs-motion-*` 类。运行时消费者位于内部 `ui-composites-*` 和 `ui-motion-*` 样板，由 `/_internal/design-foundations/` 路由引用。

特别核查了公开 `storefront/cart-item.tsx` 的 `Quantity` / `Price` 与自身 `cart-*` 结构、`order-detail.tsx` 的 `Media` / `Price` 与 `order-*` 结构、`gift-purchase.tsx` / `gift-content.tsx` 的业务 `gift-*` 与 `PublishedImage`。包的根入口只导出 Button/Field/Icon/Link/Price/Status，`ui/client` 只导出 Media/Quantity，没有隐藏地再导出 composites/motion。所以不能仅因样式名含 cart/order 就认定公开交易页面在使用它们；当前源码支持只在内部加载 composites。

但是，旧 `globals.css` 的顺序为 composites → interactions → motion → primitives。将 motion 原样放入子 layout，通常会排在 root primitives 后面，出现一个具体的同优先级覆盖变化：

- `motion.css` 的 `.fs-motion-idol__media { border-radius: 0 }`。
- `primitives.css` 的 `.fs-media { border-radius: var(--radius-media) }`。
- `IdolSwitcher` 通过 `CompositeMediaFrame` / `MediaFrame` 输出同时带两类的元素。原顺序中 primitive 后写生效；顺序反转后，图片圆角会变成 0。

这是可以由源码确定的级联风险，尚非新浏览器实测结果。已在生产修改前发送给 root / resource_audit，并建议 baseline 与候选记录对应元素 `getComputedStyle().borderRadius`；不能用 CSS 文件字节未变代替 computedStyle 不变。

## 最小候选建议

本次 **只将 composites.css 移到内部 design-foundations layout**，motion.css 保持 globals 原位置，保留 motion → primitives 顺序。仅更新 composites 静态门；不重复导入完整 UI CSS、不引入新 cascade layer、不修改原规则。这缩小单变量，也避免为多移一份小样式扩大实现。

已逐项核对 composites 对 primitives/interactions 的潜在交叉：

- Hero/cart media 使用 `.fs-media.fs-*` 或父后代选择器，优先级高于单 `.fs-media`；原先已经胜出，不因搬后而改变赢家。
- IdolPortrait/GiftTile 的媒体规则只设置 `aspect-ratio: ... !important`；primitives 没有竞争属性，原 inline ratio 的关系不变。
- Hero action 基础规则与 `.fs-link:hover` 存在相等 class 级别，但另有更高优先级的 `.fs-hero .fs-hero__action:hover`，继续决定 hover 颜色；普通 link/color/border 不依赖旧后写规则。
- Cart quantity label / media fallback 的 composite 规则为更高优先级；状态、context、timeline 没有直接复用 primitive class，未发现相等优先级同属性冲突。
- 内部样板 CSS module 对 `.fs-composite-state` 的规则带局部父类，优先级高于 composite 单类；motion 的 Hero 子节点动画属性与 composites 布局属性不同。

当前源码预审未见 **仅移动 composites** 的阻断发现；实际 CSS chunk 合并顺序、完整内部视觉和错误/键盘/reduced-motion 仍需 root 的浏览器证明。本结论不提前接受尚未出现的最终 diff 或测试结果。

## 后续复核

待 root 确认候选、resource_audit 完成测试/实现后，继续核对最终 diff 和对应证据。此时不宣称性能收益、静态门通过或阶段验收通过。

## 最终候选源码复核（2026-09-21 13:36 UTC）

已复核最终五个修改/新增文件。生产 diff 仅两行迁移：globals 删除 composite CSS import，内部 layout 增加相同 side-effect import。layout 的环境 gate、配置加载和 noindex 未动。其余三文件是 storefront 隔离测试与 composites 静态门/测试；motion 静态门无 diff。

独立 `git show HEAD:<path>` 与当前字节比较确认以下四份样式 **完全不变**：

| 文件 | SHA256 |
| --- | --- |
| composites.css | `3ee4e56969c66d35ef856cce2eec479fb76ae1cb345f30217620a21d1fb82791` |
| motion.css | `700ef044016ce6f52a083f76f155f49247c12448313c911e7a0a91ad5fb0278b` |
| interactions.css | `139db391faf82bc5bb655ae0ac3a2aa614bff4510832234ac6f55af72e28c199` |
| primitives.css | `44ffa6eb3f21fdf83bdd2d1001c57f6a38875869c4b439c7d437ffb258eeb21a` |

先前 motion 媒体圆角风险通过缩小范围被避免；没有改变圆角声明来适配新顺序。composites 对原 primitive 的交叉关系仍如预审所列，源码层未见阻断。

### 测试与静态门

- 新隔离测试覆盖 root layout 与所有公开 route TSX 的直接 CSS import，并递归跟随 CSS→CSS 引用；内部 layout 必须保留 composite 各规则族与 reduced-motion，公开样式必须保留 primitive/media/overlay/motion，原三份 UI CSS 顺序必须保持。
- 首次 GREEN 的失败是 `.fs-hero` 子串匹配到了保留 motion 中的 `.fs-motion-hero > .fs-hero ...`，并非 composites 主体仍被下载。改为匹配独立 composite selector 是合理的 test-oracle 修正；原 RED 的 `.fs-composite-state`、`.fs-cart-line` 等主体规则依然被禁止，没有通过放松生产规则掩盖失败。这是源文件回归哨兵，不是任意压缩/间接动态导入的通用 CSS 依赖证明；实际网络证据另行覆盖产物。
- 新静态门保留原 CSS 逻辑属性/文本不裁切、包 exports/sideEffects、primitive barrel 边界、route/locale 与工作流检查，仅替换消费位置。内部 import 用 TypeScript AST 识别，要求恰好一个 side-effect import，拒绝缺失、重复、注释、字符串和 type-only 假消费。公共 globals 继续拒绝该准确 CSS import，范围没有扩成全仓任意字符串禁令。
- 只读日志确认：旧应用隔离测试 2 FAIL / 2 PASS；旧静态门 RED 保留；候选首次隔离测试 1 FAIL / 3 PASS 的误报原日志保留，修正后 4/4；新静态门筛选测试 9/9。最后一项含七个新边界用例及两个既有正例/逻辑 CSS 用例，不能写成整套仓库测试已通过。本 agent 未重新执行测试。

**源码与相应测试局部 ACCEPT；最终浏览器/全仓门仍待 root。**

### 一次性汇总器审查与已落盘对照

已读 `summarize.py` 和对应 `run-comparison.mjs`。它读取固定 `browser-attempt-1/2` 各三个已存在样本，无网络、采样、优选或回填逻辑。对每份 capture 所列原件重算字节/SHA，核对同导航内容、无 runtimeError、0+1 成功读取及 LHR/artifact settings；从 Lighthouse network-requests 的实际资源条目汇总 stylesheet/JS/font/image/document 体积，并从 Stylesheets 内容确认 composite 规则消失、primitive/overlay/motion 保留。组首发布响应只命名为组首证明，没有冒充逐导航发布版本锁定。

已独立核对两组首个 artifacts 的全部四份 stylesheet 内容 SHA：其中三个 chunk 字节/哈希完全相同，唯全局 chunk 从 43,606B 变为 32,305B，少 **11,301B**；这是实际收集的 CSS 内容差异，不是把原文件 11,552B 当传输收益。完整汇总显示三个 baseline 的 stylesheet 总量均 173,321 resource bytes / 48,494 transfer bytes，三个 candidate 均 162,020 / 46,963，传输条目少 **1,531B**，四个 stylesheet 请求数保持。原件全量 SHA 检查是 root 汇总器结果，本 agent 此处独立重读两份 artifacts 与四份原样式，不冒称独立重算全部54件。

六份实际报告保留两组 `COLLECTED_DIAGNOSTIC_BUDGET_FAILED`，模拟 LCP 中位分别 **4212.1395 / 4359.5727ms**。汇总器明确 `formalPerformanceAcceptance:false` 并说明顺序/服务端图像缓存与时序差异；没有从字节减少推导 LCP 提升，也没有把候选第二次单份评分 0.93 当整组通过。字体“相同资源”在此指名称和 resource size 集合相等，不等同于本汇总器独立下载并比较所有字体二进制。候选图像与 JS 的响应资源尺寸保持。

两份官方离线 replay 结果共六报告、十二个 FCP/LCP 项全部 difference=0，仍为 `performanceAcceptance:false`。这是对已记录重放结果的只读核对，本 agent 未执行重放或浏览器。`summarize.py` 对当前固定六样本用途无阻断发现；不将它扩称为通用性能认证框架。


## 最终实际证据复核（2026-09-21）

结论：**本次 composites 样式隔离补丁局部 ACCEPT，无阻断发现；P3-06 性能与整阶段验收不通过、不标 DONE。** 已核对 README、MASTER、phase-3 本检查点结果及 final-verification，29/2/18 计数和既有门保留，措辞没有将字节减少写成提速。本文早前“待真实运行”是当时预审状态，现由下列证据补齐。

- `check:dev` exit0：type/test 各63/63（各62缓存）、build36/36（35缓存）；五个完整设计/UI静态门、最终 adapter/artifact 门均 exit0。真实 fixture exit0，协议32,461 assertions；七语言双端88场景/88PNG/85axe、0违规/30incomplete、0pageErrors。独立重算 `ui-summary.json` 全91件长度/SHA，均相符。
- 内部原浏览器门 P2-03/04/05 均完成，场景/PNG/axe 分别13/15/8、16/18/10、8/22/3，blocking 均0；原始违规为1项 moderate `region`、0项、3项 moderate `heading-order`，incomplete 分别5/4/3。逐项与基线 `3fc5df5` 原件对比，规则、级别及节点目标完全相同：menu 的 `#_R_pmdbsnpfiv5ubtbH1_`、motion 三扫描的 `div[data-active="true"] > h3`。三个 runner 字节与基线相同，未新增忽略项或降级门。独立重算内部清单26/31/31件均相符；抽看390×844越南语 composite、1440×900日语 motion截图，样式完整且 motion 图片仍有圆角，不称逐像素等同或全量视觉人工验收。
- P2-03 首失败确实来自原 runner 结束时要求 `dirty=false` 且 status 为空；并非仅要求前后状态一致。因此已有5042未跟踪与候选改动足以触发错误，错误文案不能证明测试中改源。独立确认干净快照提交 `115ce9a0532383184cb9c2a9f5548e5a3f0c8a79`、offline frozen install 和原 runner exit0；主工作区与快照2345候选输入分别逐项重算，均同清单 SHA `6d89e148830443ec72da7982a9e3cd0d8ae9bf44e0a46ce2a9f1b20a11375600`，26件导回证据与快照原件逐字相同。P2-04/05 支持稳定 dirty fingerprint，实际 before/after 完整 Git 对象各自相等。未把主工作区声称为 clean。
- adapter 首失败日志是缺失其他包 dist 声明，符合原 P2-03 runner 清除全仓 dist 后仅重建 storefront 闭包的源码行为；36/36缓存构建恢复后原 adapter/artifact 门通过。首失败与修复运行均保留，无源码放宽。
- 独立重算旧102件共享UI备份全部相符。root 的 `protection-final.json` 记录5042原未跟踪不变、13个已记录端口无监听；本 agent 未重复哈希全部旧未跟踪文件或重跑端口检查。`secrets-result.json` 确认最终显式暂存后的秘密扫描 exit0/47.571秒。

### S.U.P.E.R 十项（仅本补丁功能与资源隔离范围）

| # | 检查 | 结论与依据 |
| --- | --- | --- |
| 1 | 文件单责 | PASS：样式消费位置、隔离测试和静态门职责明确。 |
| 2 | 函数单责 | PASS：测试遍历/规则断言和 AST import 校验各自明确。 |
| 3 | 单向依赖 | PASS：route/layout 消费 UI CSS，未改变业务层依赖。 |
| 4 | 无环 | PASS：只迁移既有 CSS import，无反向引用。 |
| 5 | 明确接口 | PASS：沿用既有包 exports；无新增跨模块业务对象。 |
| 6 | 可序列化 I/O | PASS：业务合同未改，检查证据为 JSON/文本。 |
| 7 | 外部配置 | PASS：未新增业务域名、密钥或环境常量；静态门路径只指仓库约定。 |
| 8 | 声明依赖 | PASS：无新依赖或 lockfile 修改。 |
| 9 | 可替换模块 | PASS：样式仍由既有 UI 包拥有，消费位置与业务核心解耦。 |
| 10 | 验证 | PASS（局部）：上述功能/构建/静态/浏览器门及秘密扫描通过；未跑单条完整 `pnpm check`，不扩称全部阶段测试通过。 |

模拟性能两组仍 FAIL，候选 LCP 中位并未下降；因此 S.U.P.E.R 局部接受不能替代 P3-06 整体退出。既有 moderate/incomplete、物理设备/VoiceOver、人工运营与译审/资产、真实商户与云部署继续待验收；不添加豁免，不推送或发布。

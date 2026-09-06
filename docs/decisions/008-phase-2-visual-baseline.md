# ADR-008：Phase 2 品牌交互视觉基线

> 状态：Accepted — V2 后续开发视觉基线已获用户批准；正式资产独立待定
> 日期：2026-09-05
> 提案人：Codex `/root`；决策者：项目负责人（当前用户）
> 关联：P2-06；R-07、R-12、R-17；规范 §6、§17 Phase 2、§21

## 背景与评审入口

P2-01 至 P2-05 已交付设计令牌、原语、交互、组合组件和动效。P2-06 将这些能力整理成供后续页面复用的视觉基线。当前仍是内部样板；价格、人物、礼物、订单和交互状态是 fixtures，不能据此判断真实购买或支付已交付。

首版历史评审入口：`output/playwright/p2-06/index.html`。七种首发语言分别提供 390×844 与 1440×900 的真实 Chrome 截图，覆盖海报、人物/礼物、购物车/履约及动效终态；英语另外提供完整 loading/empty/error 状态矩阵。先前六个标准视口、320px、伪语言、原生 200% zoom、键盘和真实手机动效证据作为补充，而非替代本次双视口矩阵。

## 拟批准的视觉与交互约束

| 项目 | 本次提交的基线 | 实现入口 |
|:--|:--|:--|
| 视觉方向 | 电影感人物画册、深色底与浅色正文、克制金色主动作；单一区段一个主要视觉与动作 | `packages/design-tokens/src/tokens.ts`、规范 §6.1/6.6 |
| 令牌与语义 | 品牌值集中配置；人物只能覆盖 `--idol-accent`，不足 4.5:1 则回退安全色；成功/警告/错误语义色保持独立 | `packages/design-tokens/src/idol-accent.ts` |
| 字体 | Latin 用 Manrope + Noto Sans；越南语独立字形包；SC/JP/Thai 分别用 Noto Sans SC/JP/Thai；自托管、按 locale 加载；正式字体采用与否待批准 | `packages/design-tokens/src/font-profiles.ts`、`styles/fonts/` |
| 多脚本排版 | 正文 16–18px、行高 1.6；标题随视口缩放；关键文本不固定高度或省略；CJK/Thai 标签不强制大写或加宽字距；越南语保留附标 | `packages/design-tokens/src/tokens.ts`、`packages/ui/styles/composites.css` |
| 响应式空间 | 画布最大 1440px，普通内容列 1200px；边距 16/24/48px；48rem 与 64rem 断点 | `packages/design-tokens/styles/foundations.css` |
| 海报裁切 | 小于 48rem 选择独立移动资源与 4:5 构图；大于等于 48rem 选择桌面资源与 16:9 构图。焦点属于每张资产的数据，不写死在组件内 | `packages/ui/src/composite-media-client.tsx`、`packages/ui/styles/composites.css` |
| 内部海报焦点 | 组合样板：移动 (0.5,0.3)、桌面 (0.74,0.44)；动效样板桌面 (0.72,0.4)，用于同一内部图片的另一构图。拟审阅的是已展示的两种裁切；后续实际照片逐张复审 | `apps/storefront/src/app/ui-composites-specimen.tsx`、`ui-motion-lab.tsx` |
| 图片比例与降级 | 人物 4:5、礼物 1:1；购物车缩略图按上下文使用 1:1；媒体保留尺寸、信息性图片有本地化 alt，失败后有可读替代内容 | `packages/ui/src/media-frame.tsx`、`packages/ui/styles/composites.css` |
| 操作与状态 | 主按钮至少 48px；焦点可见，键盘等价；数量修改、移除恢复、不可用、loading/empty/error 与图片失败保留明确反馈；私密留言仅显示有无，不输出内容 | `packages/ui/styles/primitives.css`、`packages/ui/src/composites*.tsx` |
| 动效节奏 | fast 120ms、控件 220ms、布局 360ms、Hero/Success 720ms；使用 transform/opacity，避免持续漂浮、滚动劫持和长时间 loader | `packages/design-tokens/src/tokens.ts`、`packages/ui/styles/motion.css` |
| 动效输入等价 | 鼠标允许空间过渡，触摸/笔使用透明度过渡，键盘/辅助激活与减弱动态立即呈现终态；快速反向切换以最后一次选择为准 | `packages/ui/src/motion-policy.ts`、`motion-client.tsx` |
| 减弱动态 | 系统 reduce 下取消位移和自动序列，保留选择、处理中、错误与成功反馈 | `packages/ui/styles/motion.css`、P2-05 真机证据 |
| 语言与业务上下文 | 语言不隐含国家、市场、币种或支付能力；本样板不承担购物车或支付真相源职责 | ADR-006、`packages/contracts/src/locale.ts` |

## 资产与正式品牌决定

| 待决定项 | 当前材料 | 当前状态 |
|:--|:--|:--|
| 正式品牌名称与 Logo | 尚未提供；内部文字不是正式品牌 | OPEN |
| 视觉方向与字体采用 | 本评审包展示默认深色/金色及 Manrope/Noto 系列 | 待人工批准 |
| 正式摄影与肖像/品牌许可 | 现有图片均是仓库生成的虚构内部样例；来源见两份资产 README | OPEN，不能晋级正式资产 |
| 图片交付规格 | 内部移动图 1122×1402；内部桌面图 1672×941，低于规范建议的 2400×1400。正式资产需分别交付桌面/移动构图、焦点、alt 与来源记录 | 正式交付未完成 |
| 字体许可 | Fontsource 5.3.0 对应字体 OFL notices 已保留 | 技术资料已具备；品牌采用待决定 |
| 多语言文案 | 内部样例可验证字形、附标、换行及膨胀；不代表正式文案已经由母语/法律审校批准 | 正式内容批准未完成 |

资产来源：`apps/storefront/public/ui-composites/README.md`、`apps/storefront/public/ui-motion/README.md`；字体许可：`packages/design-tokens/THIRD_PARTY_NOTICES.md`。

## 首版技术修正与历史证据边界

真实 Chrome 先复现动效页本地化说明标签对中文、日文、泰文施加 1.44px 字距与 uppercase。修正仅将该规则限制到 en/es/pt，与现有 Hero 规则一致。修改文件：`apps/storefront/src/app/ui-motion-specimen.module.css`；失败证据 `typography-before.json`，修复后的逐语言 computed styles 在 `browser-results.json`。

该修正改变桌面渲染指纹，因此重新运行完整 P2-05 浏览器 runner，再采集 P2-06。P2-05 原真机记录保持原版本，不回写采样、不宣称手机已运行本次新 CSS；差异核对见 `source-continuity.json`。差异只有内部说明标签的字体样式，Hero/人物切换/加购/成功的组件、控制器、动效 CSS、字体与媒体资产均未改动，因此原真机证据仅复用于这些未变的动效机制。若后续修改这些机制或正式素材，应按影响范围重新执行桌面与设备检查。

截图为 Chrome、DPR 1 的字体缓存命中后重复访问；不是新的一轮真机、冷启动、母语翻译、线上发布或 field INP 证明。布局指标和 axe 结果不能替代人的审美判断，也不能穷尽所有字形碰撞或辅助技术问题。

## 批准记录（待填）

- 视觉版本：`output/playwright/p2-06/browser-results.json` 中 source 与截图哈希。
- 人工批准人/时间：未提供。
- 390×844 与 1440×900 的 en、zh-CN、ja、th、vi、es、pt：均待人工批准。
- 品牌名称、Logo、正式字体与摄影授权决定：未提供。
- 用户修改要求（2026-09-05）：认可黑金气质，但要求参考 research 竞品，支持多颜色、多场景艺人照片与完整场景礼物；据此形成下述 V2。此反馈确认方向，不等于批准新版本或正式品牌。

用户发出的“继续下一步”表示执行本任务，不是对未展示样板的签署。按照规范 §21，正式品牌决定与人工视觉批准完成前，P2-06 保持 REVIEW，Phase 3 保持 LOCKED。若项目负责人希望调整品牌门禁时间，需要明确记录该范围变更，不能由开发代理隐含延期。

## 验证与后续变更

技术命令、结果、截图和录屏入口集中在 `output/playwright/p2-06/README.md`。批准后将版本、批准人、时间与具体范围写入本记录，再同步 P2-06 DONE 和 Phase 解锁计数。

正式品牌令牌可通过主题配置替换；组件行为、媒体裁切、字体或动效发生变化时重新生成受影响视觉基线并复审。修正如需撤回，只撤回本任务的样式差异并重跑相关检查，不回滚其他用户改动。此决策不改 schemaVersion、数据库、支付编排、云部署或运营计划。


## V2 候选：中性黑金框架与原色影像（2026-09-05）

当前交互评审入口：`/_internal/design-foundations/:locale/brand`；可重复证据与命令见 `output/playwright/p2-06-brand/README.md`。这是对用户具体反馈的完整页面式回应，首版组件与动效画廊作为历史资料保留。

- **色彩**：炭黑页面、暖白正文、香槟金主动作/选择反馈；保留粉紫、冰蓝、暗蓝琥珀、酒红、奶油暖橙与深蓝礼盒各自原色。视觉统一来自边距、比例、字体与层级，不要求照片/产品采用统一金棕调色。
- **人物**：Hero 文案与自然日光照片分区，文字不压在复杂背景上。桌面双栏、手机先照片后文案；人物选择卡 4:5。桌面与手机分别选择原生生成资源，焦点是当前内部素材的构图数据，不能默认用于后续正式人物。
- **礼物**：完整 1:1 场景，标题与价格在图片外；桌面三列、手机两列。统一卡片比例不等于要求实物与幻想礼物使用同一背景。目录支持类别过滤和明确收礼人。
- **文字**：七语言文案与五类字体分包；CJK 保持自然字距，中文逗号处允许语义短语换行；长标题平衡换行，不固定高度或裁切字形。
- **交互**：复用 Dialog/Drawer/Button/Price/Media；选艺人、筛礼物、详情、演示加入/数量上限/移除均可操作。每条演示礼物保留加入时的收礼人，语言导航只携带严格限定的虚构 ID 与数量，不传价格、私密留言或真实订单数据。样板不持久化真实购物车，不是支付/库存权威。
- **动效**：无自动轮播，沿用现有有效时长令牌与减弱动态开关；轻微透明度/位移进入、指针 hover 仅作反馈。新样板没有新增真机性能结论。
- **原创素材**：七张新 WebP 的提示词、编码、真实尺寸、SHA 和用途边界见 `apps/storefront/public/ui-brand/README.md` 及 `provenance.json`。竞品图片未复制为产品素材。

V2 仍是内部候选。正式品牌名、Logo、肖像与商品摄影许可、实际履约内容以及最终文案均未因此自动批准；不把本次设计样板等同于 Phase 3/4 的真实业务交付。

V2 技术复核：24 场景、86 PNG、26 axe（serious/critical0，内部说明region moderate22）、完整pnpm check与独立视觉/实现复核通过；`validation.json`记录最终版本。当前候选已提交用户，人工批准未填写。

## V2 批准与阶段推进（2026-09-05，最新有效记录）

用户确认：“视觉风格我认为差不多了”，要求“根据这个风格作为基础开展下面的阶段”，并明确把动画特效留到后续补充打磨。接受版本为 `output/playwright/p2-06-brand/` 的 V2，source fingerprint `aeaea1e5dec8ddafd21124eebbc3473ec608363628e83a2b7824f622a4585747`。这是开发视觉基线的批准，不推断每个 locale 已经母语审校或每种设备已由用户逐项签署。

据此关闭 P2-06/Phase 2，并进入 Phase 3。正式品牌名、Logo、最终字体品牌采用和正式摄影授权继续 OPEN，需在正式内容/资产导入前且不晚于 P7-01/P7-02 完成。该门禁时间调整由用户明确“以当前风格开始下一阶段”的指令支持，见 ADR-009 和规范 2.2.0；此前 Proposed/REVIEW/LOCKED 段落保留为历史，不再作为当前阻塞。内部素材不自动成为正式资产。现有可访问性与 reduced-motion 要求继续执行；额外装饰动效后续按实际页面打磨并复验。

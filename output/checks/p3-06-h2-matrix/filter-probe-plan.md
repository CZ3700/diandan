# P3-06 手机筛选弹层最小补证

Owner: `/root/matrix_plan_review`（仅本文件与 `probe-filter.mjs`）；执行与验收由 `/root` 负责。生产基线 `bfe259a` 不变。

本次只准备工具，不启动浏览器、服务、构建或测试。必须等待完整性能矩阵停止后执行，不能与采样并行。该工具不会修改产品源码、预算、既有 axe 原件或历史结果。

## 入口与原场景绑定

`probe-filter.mjs` 导出 `verifyBrowser(context)`；使用现有 `runAcceptanceFixture(database, s3, { ui: true, serve: false, verifyBrowser })` 注入点。由 root 的一次性包装器复用原 ephemeral S3/PG fixture，不另建测试框架，也不要同时设置 `performance: true`。

```js
import { verifyBrowser } from "./probe-filter.mjs";
// Existing owned TEST fixture wrapper supplies database and s3.
await runAcceptanceFixture(database, s3, {
  ui: true,
  serve: false,
  verifyBrowser,
});
```

context 必須来自实际 fixture，包含 `manifest.environment === "TEST"`、`origin`、`gateway`、`fixtures`、`next`、`output`、`check`。允许原 loopback HTTP 或已有精确 TEST 证书 viewer origin。使用原 `withAcceptanceBrowser`，不新增浏览器开关或系统信任；默认使用原 HTTP 入口，补证不测性能。

原场景在 `apps/api/scripts/storefront-acceptance-matrix.mjs` 的 `mobile filter focus reduced motion and cancellation`：390×844、reduced motion、葡语公开礼物目录、当前 fixture 市场/币种、点击手机筛选、12 次 Tab、最低价填写 `10,50`、axe、Escape 与触发器恢复。新 probe 在新隔离 context 重现该片段；不是原 84 导航的重跑，不声称复现原生成 ID。

输出进入本次 browser-attempt 下的新 `filter-probe-<UUID>/`，不覆盖原证据：

- `results.json`：实际 BUILD_ID、Next generation、相关源码和原报告 SHA、弹层及背景 DOM、当次 incomplete 节点 identity/完整 HTML/role/文字/computed style、背景祖先及伪元素、9 点遮挡命中、固底对比度、原 12 次及补充 24 Tab/24 Shift+Tab、Escape、焦点恢复和 cleanup 状态。
- `axe.json`：当次完整原始 axe 结果，保留原 check 数据和所有 incomplete HTML，不只保留生成 ID。
- `mobile-filter-open.png`、`mobile-filter-keyboard.png`；失败时尽可能追加 `failure.png`，保留失败结果，不能循环重跑挑结果。

先获取实际 DOM，再按当次 axe target 解析。`#base-ui-_r_5_` 仅是历史记录，不作为工具定位或语义推断依据。背景必须实际 `aria-hidden=true`，两个 inside guards 必须实际隐藏；任何非弹层/非已识别 inside guard 的焦点立即失败，guard 仍使用原 500 ms 回归边界。关闭后背景恢复、焦点返回触发器。

固底证明只接受透明中间背景至真实不透明背景、全祖先 opacity=1、无 blend/filter、无背景图/伪元素覆盖、文字不透明且9点均实际命中。色值来自实际 computed style，用相对亮度计算，统一以普通文字 AA 4.5:1 判定。复杂背景、未知节点、其他 incomplete 规则或不确定遮挡返回 `COLLECTED_MANUAL_REQUIRED`，不能视作 PASS；确定低于门限、焦点错误、axe violation 或页面错误保留 FAIL。不会把截图肉眼可读等同对比度数学证明。

## 原 30 条 incomplete 的分类和可复核证据

最新原件：

`output/checks/p3-06-storefront-acceptance/run-2026-09-21T15-55-54-248Z/browser-attempt-3/browser-results.json`

SHA256 `8a4a263a51a184aa7997c499390c4d25c2b2011b4033fb658f7ebedc62c68a55`，665662 B。

85 次扫描零 violations；30 条 incomplete 是：

- **28 条 / 532 节点**：七语 × home/artists × 双视口。手机每场22节点、桌面每场16节点，全部 `figcaption` 标题/状态、全部“partially obscured”原因。文字在照片下方的固底区域，不依赖运营照片颜色。
- **1 条 / 1 节点**：`mobile-filter-open` 的 `color-contrast`，原 target `#base-ui-_r_5_`，原因 partial overlap。当前简化报告未保存节点 HTML/role，因此不能仅凭编号认作说明文案。88 PNG 未包含筛选打开截图，这正是本 probe 补证范围。
- **1 条 / 3 节点**：同一弹层的 `aria-hidden-focus`，`.storefront` 加两个 Base UI inside guards。不是三个已确认焦点缺陷，也不自动算 PASS。

目录人工技术复核可复用的历史实际浏览器证据：

`output/checks/p3-06-storefront-acceptance/run-2026-09-07T17-13-43-828Z/axe-incomplete-probe-attempt-1/axe-incomplete-review.json`

SHA256 `2ec20d79000b4fcc66f43c919d90803663716e1261c751e2e5930e5dc580e620`，94965 B。包含 en/zh-CN/pt × 双视口 × 第2/12卡片共12个可见样本、24文字实际 computed/祖先背景/边界与中心命中；固底 `#0a0a0c`，标题 `#f6f3ee` 对比度 **17.8719405029773:1**、状态 `#aaa6a0` **8.167911:1**。还包含中葡语24 Tab及24 Shift+Tab共96次、8次已识别 inside guard 在500ms内恢复、Escape回触发器。对应 Markdown 和14 PNG 留在同目录。

本次只读核对以下三份当前源码与 `output/checks/p3-04-storefront/implementation-source-final.json` 的记录 SHA 完全相同：

| 文件 | 当前 SHA256 |
| --- | --- |
| `apps/storefront/src/storefront/artist-directory.module.css` | `83ad4916d27061b7f4b7c337cddda5c452308bc9375d59fff6a16337f5fae26e` |
| `packages/design-tokens/styles/foundations.css` | `bb836b5726dd265cb264bfd2391e11520bb5ff2701528883d9fd9d42cde9c96a` |
| `packages/ui/styles/interactions.css` | `139db391faf82bc5bb655ae0ac3a2aa614bff4510832234ac6f55af72e28c199` |

该旧源码清单 SHA256 `ea1d987f224dcad0daa4a6e64342891d09d8ebe1c25d7652fb672d5e1941a5f3`。当前目录 DOM `artist-track.tsx` SHA `4d8fb7ddc4c3f23ef61f0c74ad0be0a85d12ed955e4b30cfc54807849eb77528`；照片容器与 `figcaption` 分开。当前 `storefront.css` SHA `0702860f81200bdf43e06ebb0ecbecf83bde2e03a09e41dd4c1eb5e76a233caf`；根为固色背景，含后续修复的 `isolation: isolate`。

已只读查看最新 `en-390-artists-images.png`、`ja-1440-artists-images.png`，可见标题/状态位于照片下方固底、横向卡片裁切如预期；不能宣称全部88图已被本 reviewer 重新观看。目录532节点可记录“现有实际样本 + 当前相同样式 + 数学对比度的技术人工复核完成”，仍保留原 axe incomplete，不能记自动零 incomplete 或照片叠字全通过。

历史专项探针发现过 sticky header 覆盖抽屉的真实缺陷，后来已用 `.storefront { isolation: isolate; }` 修复。修复证据是 `output/checks/p3-06-storefront-acceptance/overlay-hit-test-review.md` 及 RED/GREEN 原件。最新 browser-results 的 `overlayStacking` 标题/说明/关闭按钮9点实际命中均正常；不可把旧bug截图当作当前状态，也不可据此盲认当前生成 ID 已解决。

## 收尾与明确边界

root 在性能采样结束后运行本工具的格式/静态检查、一次原样实际 fixture 补证和独立复核。当前文件尚未执行或验证，不宣称工具已通过。

仅操作公开 TEST 礼物目录和本地筛选表单，不提交筛选、不加购、不创建订单，不接触私密留言/鉴权/管理中心。完整 DOM 和截图仅来自公开合成测试内容。读屏实际朗读、真实手机、运营计时、译审和生产摄影仍遵循 `docs/operations/storefront-acceptance.md`，本工具不能代替这些证据，更不关闭 P3-06。

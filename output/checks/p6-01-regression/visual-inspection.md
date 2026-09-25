# P6-01 截图复核记录

本记录是 Codex 对实际浏览器输出的视觉检查，不是人工读屏、真实设备或译文签署。

- SEO retry-2 的 `fallback-idol-th-1440.png`：保持现有黑金结构、完整英文艺人标题/简介/长描述与泰语操作外壳，英语回退提示存在；未见横向截断或组件重排。
- 同轮 `fallback-idol-vi-390.png`：手机纵向布局、越南语多行标题/按钮/页脚均可见，英文对象与回退提示保持；图片仍沿用既有媒体适配。
- journey diagnostic-2 的 `zh-CN-390-cart.png`：留言/昵称仅显示已保存状态，无明文。该截图是在已滚动位置捕获 fullPage，sticky 页头在合成图中压住标题，已要求最终截图先滚回顶部再等待布局；没有据此修改产品 CSS 或隐藏键盘焦点。

这些是诊断版本证据，完整最终矩阵通过前不计最终视觉验收。SEO 源路径见 `catalog-1/seo-retry-2.txt`，journey 源路径见 `journey-debug-4/report.json` 所列自有工作区。

## 当前目录预检截图复核（2026-09-23）

只复核 catalog-precheck-2 的实际截图；这是诊断范围，不替代最终五组验收。

- `/Users/mario/Desktop/.fan-support-regression/103dcfa3-d9ff-4772-9089-462389ecf7f7/workspace/output/checks/p3-06-storefront-acceptance/run-2026-09-23T12-12-50-101Z/browser-attempt-1/th-390-gift-images.png`；SHA-256 `ba98b74cc9baf37ac2385305fbb6f403db139521e2ad56f3fd85ba963273ff3a`。390×844 泰语礼物详情：黑金基线、图片、价格、选项、泰文换行和履约内容可见，无可见截断或控件覆盖。

- `/Users/mario/Desktop/.fan-support-regression/103dcfa3-d9ff-4772-9089-462389ecf7f7/workspace/output/checks/p3-06-storefront-acceptance/run-2026-09-23T12-12-50-101Z/browser-attempt-1/pt-1440-gifts-images.png`；SHA-256 `f0b59998c7b74960f337b42916d586a6f49608e040e8bb0c5cca468316c94d72`。1440×900 葡语目录：三列多色礼物、筛选排序和底部分页清晰，无可见截断或水平溢出。

## 最新冷启动购买矩阵目视检查

root 实际查看 zh-CN 390 结账与 pt 1440 已付款订单 PNG：黑金基线保持，中文表单/政策项及按钮均清晰，长葡语双栏无可见截断或重叠，图片保持比例，邮箱截图已遮罩。此为自动浏览器截图人工式目视检查，不代替实体设备或真人 UAT。

- `journey-coldstart-fixed-2/browser/zh-CN-390-checkout.png` SHA256 `7f587d28f7c2a3aab7f6c00d5146fd66e255b16330b5eab5569a6778fa4465c0`
- `journey-coldstart-fixed-2/browser/pt-1440-paid-order.png` SHA256 `f2310775f206b358cce88e4d5bb59eb2ceaa7efde4f77ba56b2e6d66b6e1cf5e`

## final-8 fresh screenshots

- `/Users/mario/Desktop/.fan-support-regression/2df26fe4-e0a8-4286-bad3-9eaaa3d3a8ca/workspace/output/checks/p3-06-storefront-acceptance/run-2026-09-23T15-37-02-186Z/browser-attempt-1/th-390-gift-images.png` SHA256 `ba98b74cc9baf37ac2385305fbb6f403db139521e2ad56f3fd85ba963273ff3a`. Thai 390-wide gift detail: photo, price, variant controls, long delivery text and region choices have no visible overlap or horizontal clipping. Actually viewed by root.
- `/Users/mario/Desktop/.fan-support-regression/2df26fe4-e0a8-4286-bad3-9eaaa3d3a8ca/workspace/output/checks/p3-06-storefront-acceptance/run-2026-09-23T15-37-02-186Z/browser-attempt-1/pt-1440-gifts-images.png` SHA256 `176c740c3cfe7da1affc1fa3fd3f7d277c2f4bc3a7261fa9d063638c2e310880`. Portuguese 1440-wide catalog: three-column images, long heading, sorting/filter actions and page navigation remain aligned without visible clipping. Actually viewed by root.

Visual samples only; not human translation approval, a full accessibility audit or a physical-device claim. Full-browser and journey reports remain the actual coverage gates.


## 最终 fresh journey 图片抽查

root实际查看泰语390×844 checkout与葡语1440×900 cart的全页截图。未见水平溢出、明显文字/控件重叠；金额与主操作可见，邮箱使用不透明亮色遮罩，购物车仅显示私密内容已保存状态。此检查不是语言译审、键盘/读屏或物理手机验收。

- `/Users/mario/Desktop/.fan-support-regression/ebefac61-3dcb-4695-abef-ac81885046db/workspace/output/checks/p6-01-regression/journey/test-regression-30cf1a0c927447a2/browser/th-390-checkout.png`；SHA-256 `8937378538717f0211ff6fdbe9facb333ac41c38ddd6e7454ba598f97d373072`。
- `/Users/mario/Desktop/.fan-support-regression/ebefac61-3dcb-4695-abef-ac81885046db/workspace/output/checks/p6-01-regression/journey/test-regression-30cf1a0c927447a2/browser/pt-1440-cart.png`；SHA-256 `71ed5f4258750ae88c62f3c428786c56e3c8971b1eace379185a590f2a38ebeb`。

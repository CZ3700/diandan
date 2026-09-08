# 真实 Chrome 字体对照

入口：`mise exec node@24.20.0 -- node scripts/fonts/verify-font-shaping.mjs`。使用独占临时本机 HTTP 字体服务和真实 Chrome，不启动 Next 或 Lighthouse。每次创建新 attempt，所有失败保留。

最终有效对照：`attempt-2026-09-08T02-20-07.833Z-e2a7e7a5/results.json`。条件为 32px、DPR 1、字重 400/500/600/700、normal line-height，覆盖日文 303 个 codepoints、中文 322 个 codepoints，以及每种语言全部 149 条当前 default copy。候选与原始完整 unicode-range cascade 分别使用两个 alias family。

- 日文 **1808** 项：所有文本宽度、DOM 宽高、Canvas metrics 和逐 RGBA 像素完全一致。
- 中文 **1884** 项：所有文本宽度、DOM 宽高及逐 RGBA 像素完全一致；20 条字重 700 的完整字符串，Canvas `actualBoundingBoxDescent` 分别存在约 `1.9073486328125e-6` 或 `3.814697265625e-6` px 的原始数值差。每个单 codepoint 都完全一致。
- 保留全部 metrics 零容差条件，因此该报告及进程仍为 **FAIL / exit 1**。未四舍五入、删除差异或修改阈值。它支持本次实际像素和布局一致的结论，不支持“所有浮点指标相等”的结论。

真实性：227 个不同字体源有 227 个不同 HTTP URL；实际使用的 42 个字体响应均读取了 `response.body()` 并与预期原文件 SHA256 完全匹配。原始组 25/15 个参与分片与候选均显式 load，所有字重 FontFaceSet.load/check 为已加载；最终 DOM 的 CDP 平台字体记录双方均是 custom Noto，无 Hiragino/PingFang 回退。Chrome 与静态服务均已关闭，无 page error 或网络失败。

## 初始探针错误与修复

前两份 `attempt-2026-09-08T02-13-34.015Z-318ca98a` 和 `attempt-2026-09-08T02-16-38.874Z-38256e1e` 原 FAIL 保留，但不能用作产品字体对照。探针并行读取字体时，在 `await readFile` 前根据相同 Map.size 分配 URL，导致日文 124 个原 face、中文 101 个原 face 各自错误映射到同一个 URL。其响应被后续字体覆盖，ASCII 恰好一致而 CJK 实际落到系统回退；第二份 CDP 记录证实了这一点。

最小修复把“重新检查去重、分配 URL、注册字节”合成读取完成后的同步步骤。新增真实异文件并发与重复文件测试，断言 URL 唯一、相同文件去重、响应字节与 SHA 对应，已有效 **RED→GREEN**；日志在上级目录 `font-probe-assets-integrated-red.log` / `font-probe-assets-green.log`。最终浏览器也新增每个描述与 HTTP 映射的预检查、实际响应 SHA 和 CDP custom-font 检查，没有放宽字体对照条件。

这些是单平台、特定尺寸/字重和完整当前静态 UI 词库的对照；不能代替任意动态文本、所有连续字重、其他浏览器/平台、实际首屏字体请求数、Lighthouse 或 RUM。性能仍以完整原门和原预算单独验证。

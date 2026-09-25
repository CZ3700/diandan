# 最终 feature 兼容字体：真实 Chrome 对照

本次使用正式冻结的日文字体 `925cbc2f…`（96,956 B）与中文字体 `b717bd33…`（84,152 B），沿既有探针完整运行。没有修改探针、阈值或字体策略。

结果目录：`attempt-2026-09-08T02-46-54.011Z-68000520/`。原始 `results.json` 保持 `FAIL`，进程实际退出码为 1。原因是中文的 20 条零容差 canvas metric 差异，不能把该命令写作整体通过。

| Profile            | 全部比较 | 文字宽度 / DOM 宽高差异 | 像素差异 | 原始 metric 差异 |
| ------------------ | -------: | ----------------------: | -------: | ---------------: |
| Japanese           |    1,808 |                       0 |        0 |                0 |
| Simplified Chinese |    1,884 |                       0 |        0 |               20 |

覆盖全部 303/322 个 UI 码点、各 149 条完整 UI 字符串，400/500/600/700 四档字重、32px、DPR 1。中文 20 条差异全部是 700 字重的完整字符串，唯一不同字段为 `actualBoundingBoxDescent`，候选比原字体少 `0.0000019073486328125` 或 `0.000003814697265625` px；详见 `metric-differences.json`。其余 metric 字段和全部 RGBA 像素均相同。整份 3,692 条 comparison rows 已与此前有效探针逐条 `deepEqual` 通过，包含这些完全相同的 20 条差异。

真实 Chrome 152.0.7977.82 在比较前明确加载字体。注册的 227 个唯一源文件对应 227 个唯一 HTTP URL；42 个实际字体响应全部 HTTP 200 且响应体 SHA 与目标字体一致。CDP 显示原始与候选均为实际自定义 Noto 字体；无 page error 或 network failure。结束后 `browserClosed`、`serverClosed` 均为 true，没有留下独占浏览器或静态服务。

独立源码复审确认：正式生成器从实际原分片同时派生 GSUB/GPOS 功能集合，生成后拒绝每张表新增原本不存在的 feature，既有 cmap、轴、轮廓、advance、垂直 metrics 和字节检查保持。实际最终字体的 GSUB/GPOS 表也已独立与 manifest 对照一致。Node artifact 测试验证的是 manifest 关系、来源与字节漂移；真正字体表和 shaping 检查分别由生成器与本次 Chrome 执行，未以元数据代替浏览器证据。

这份证据支持本平台上的实际文字布局和像素一致性，不等于所有原始 metric 零差、任意字体 feature 配置等价，也不等于 Lighthouse 或真实用户性能过门。旧失败与旧字体探针全部保留。

运行命令：

```sh
mise exec node@24.20.0 -- node scripts/fonts/verify-font-shaping.mjs output/checks/p3-06-performance-final/font-shaping-browser-feature-compatible
```

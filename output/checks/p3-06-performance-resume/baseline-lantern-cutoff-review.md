# 已保存 trace 的官方 Lantern 截点核查

2026-09-16；只离线读取 baseline 的 CN gift / JA home 各 3 次。官方重放耗时 0.41 秒，没有 Chrome、构建或新测量。原始文件未改，分析另存 `baseline-lantern-cutoff-replay.json`（含 24 个输入文件的 SHA-256、全部模拟节点/依赖、字体原始时间和图成员）。新脚本 `verify-lantern-cutoff.mjs` 的最终 format/lint 均通过。

使用锁定 Lighthouse 13.4.1 的 `LanternFirstContentfulPaint.request`、`LanternLargestContentfulPaint.request` 及 `getComputationDataParams`，直接传入保存的 Trace、DevtoolsLog、GatherContext、URL、HostDPR、空 SourceMaps 和原 settings；不自行实现构图，不改变节流。默认路径为 **DevTools network graph + trace paint 时间**；脚本拒绝切换 `INTERNAL_LANTERN_USE_TRACE` 算法。

六份的 FCP/LCP 重算值均与原 LHR **严格等于，误差 0**；12 个 observed paint timestamp 也逐个严格相等。以下因此来自真实重放图，而不再只是假定 LHR 网络条目的成员关系。

|样本|observed LCP ms|实际 FCP 图字体数（optimistic/pessimistic）|实际 LCP 图字体数|LCP optimistic / pessimistic ms|模拟 LCP ms|LCP 图终点|
|---|---:|---|---|---:|---:|---|
|CN gift 1|227.790|0 / 0|0 / 0|2613.405 / 2613.405|2613.405|Script 后的 RunTask|
|CN gift 2|218.611|0 / 0|0 / 0|2706.902 / 2706.902|2706.902|`2p07cckado7sy.js`|
|CN gift 3|219.362|5 / 5|5 / 5|4507.992 / 4507.992|4507.992|`simplified-chinese-ui…woff2`|
|JA home 1|612.889|0 / 0|0 / 0|2469.551 / 2643.551|2556.551|两图均 RunTask|
|JA home 2|640.350|0 / 0|2 / 2|3162.459 / 3612.459|3387.459|两图均 `japanese-ui…woff2`|
|JA home 3|620.627|0 / 0|1 / 1|2618.990 / 2941.990|2780.490|两图均 RunTask|

CN gift 3 的五个字体是 Latin、UI、117、112、116；UI 也是该次 FCP 3457.992ms 的两图终点。JA home 2 纳入 Latin 和 UI，home 3 只纳入 Latin。102 个原始字体节点的 cutoff 条件与四种 FCP/LCP 图的实际成员判断均吻合。

## 原始时间校正了先前推断的精度限制

官方 graph 使用的 UI 字体完成时间相对同一 trace navigationStart 为：

|样本|UI 完成 ms|减去 observed LCP ms|LCP 两图中 UI|
|---|---:|---:|---|
|CN gift 1|228.016|+0.226|无|
|CN gift 2|219.314|+0.703|无|
|CN gift 3|218.713|−0.649|有|
|JA home 1|613.610|+0.721|无|
|JA home 2|637.521|−2.829|有|
|JA home 3|621.147|+0.520|无|

这些数与 LHR `network-requests` audit 的相对结束时间有小量偏移。因此先前 `lcp-regression-hypotheses.md` 的 LHR 时序算术只保留为假说来源，本次 **raw graph timestamp + 实际 graph membership** 才是准确基准。此处证明 baseline 的模拟分档确有不同字体成员和不同终点；未做反事实删节点，也未证明 candidate 的每一个 LCP 差值都由此造成。

## 新候选 trace 到齐后的核查

等待 root 通知采样完成后，再对新目录逐份串行重放；缺失 trace/log/input 时直接失败，不用 LHR 猜造输入，不把 invalid navigation 算作有效验收。输出新 JSON 路径，脚本以 `wx` 禁止覆盖已有证据。先核对 CN gift / JA home 六份，再按需要扩到全部 27 份。

```sh
mise exec node@24.20.0 -- node \
  output/checks/p3-06-performance-resume/verify-lantern-cutoff.mjs \
  NEW_TRACE_DIRECTORY NEW_ANALYSIS_JSON \
  zh-CN-gift-mobile-1 zh-CN-gift-mobile-2 zh-CN-gift-mobile-3 \
  ja-home-mobile-1 ja-home-mobile-2 ja-home-mobile-3
```

对比顺序固定：原始 content validity → 12 个 metric/observed exact match → 实际绘制/TTFB/图片发现时序 → 图中字体/脚本与祖先依赖 → 两图实际模拟终点。若重算不完全吻合，标 `REPLAY_MISMATCH_DO_NOT_INTERPRET` 并保留结果，不解释该图。源码路径、主机或新 fixture 变化不以本工具替代已有 source fingerprint；这里也不裁定性能预算或生产体验。

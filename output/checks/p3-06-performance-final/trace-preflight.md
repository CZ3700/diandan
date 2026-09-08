# 有限 Lighthouse Trace 诊断

本工具只诊断真实编译版 TEST 前台，不能替代七语言 63 次正式门。未修改正式预算、节流或协议；没有改动原 checkout 或当前管理预览。

## 入口

```sh
mise exec node@24.20.0 -- node output/checks/p3-06-performance-final/trace-preflight.mjs \
  "$STORE_DIAGNOSTIC_ORIGIN" "$STORE_DIAGNOSTIC_FIXTURES" "$STORE_DIAGNOSTIC_CERTIFICATE" \
  "$STORE_DIAGNOSTIC_OUTPUT" "$STORE_DIAGNOSTIC_SOURCE"
```

五参数依次是已就绪的 localhost 编译版 origin、正常 seed 的 fixture-manifest.json、同 TEST gateway 的公开证书、新结果根目录、已经独立核验的 source manifest。工具不启动或构建服务，不自行证明 source manifest 与构建一致；由协调者先核验。

默认 en/ja gift 各 3 次。`--kinds=home,artist,gift` 扩展至 18 次；`--repeats=1` 为六页各一次，不能得出三次中位数结论。每次执行自动创建唯一 attempt 子目录，保存所有尝试而非最佳值。

每个目标先以新 context / 390×844 / cache-disabled 采集资源，直到 networkidle 和 fonts.ready，未滚动或强制 eager；接着串行 Lighthouse 13.4.1 默认 mobile simulate（默认屏幕 412×823、DPR 1.75），与正式 collector 显式 flags 相同。Lighthouse HostDPR=1 是主机值，与其模拟屏幕 DPR 不矛盾。JS gzip 是实际 response body 用 Node gzip 重新压缩的建议预算指标，不是 wire transfer bytes。服务端 optimizer 可能热，用户桌面应用保留，不声称全链路冷或机器全空闲。

每份原 LHR/HTML、Trace、DevtoolsLog 均保存，事件不改写；同时保存 SHA/bytes/eventCount 和 lantern-inputs.json（URL/GatherContext/HostDPR/settings，以及实际 SourceMaps 空数组或非空摘要，非空时不存 source map 正文）。全新独占浏览器只访问公共 TEST 路由，无操作者 cookie/Authorization 注入。

三次聚合直接复用正式 aggregateAcceptanceLighthouse：score median >= 0.9、LCP median < 2500 ms、CLS median < 0.1。有限组超标时 `COLLECTED_DIAGNOSTIC_BUDGET_FAILED` 且 exit 1；采集失败 `DIAGNOSTIC_COLLECTION_FAILED`。诊断全部通过也仅 `DIAGNOSTIC_COMPLETE`，不宣称 P3-06 完成。

## 定向检查

两个 Node tests 验有限参数边界、原始证据保存/缺失拒绝/不可覆盖；测试、格式和 ESLint 已通过。测试没有替代真实浏览器。

```sh
mise exec node@24.20.0 -- node --test output/checks/p3-06-performance-final/trace-preflight.test.mjs
mise exec node@24.20.0 -- corepack pnpm exec eslint output/checks/p3-06-performance-final/trace-preflight.mjs output/checks/p3-06-performance-final/trace-preflight.test.mjs
```

## 当前基线

2026-09-08 01:50 UTC，source `7bc844b288300d40a55b8b37449258c2e2126e761b7a3d2ca41011c9bbe30622`；fixture origin http://localhost:60599。完整 6 次诊断在 `baseline-trace/attempt-2026-09-08T01-50-00.639Z-64843ee6/`。进程真实 exit 1，原因是预算未达标；采集 failures=[]，独占 Chrome 已关闭，fixture 保持由 root 管理。

|语言|三次模拟 LCP / ms|中位数|分数中位数|
|---|---|---:|---:|
|en|3245.4 / 3066.3 / 3219.6|3219.6|0.92|
|ja|5422.9 / 5421.8 / 3610.2|5421.8|0.70|

JS SHOULD 未达标，图片 SHOULD 通过。真实 observed 网络细节见 `baseline-observed-network.json`：所有请求 HTTP 200、HTTP/1.1；ja1/2/3 observed LCP=567/722/671 ms，TTFB=513.1/673.1/636.3 ms。ja1/2 observed LCP 前有 19 个字体响应、390817 transfer bytes；ja3 只有 5 个、146765 bytes。不能将这些 observed 阶段直接加成评分用的 simulated LCP，字体队列的因果需 root 对保存的原始 trace/log 重算 Lantern。

冷图片事实：en1 的 750w AVIF 响应明确 `x-nextjs-cache: MISS`，等待响应头 198.512 ms，LCP 图片阶段 199.105 ms；后五次同图片为 HIT，响应头等待分别 8.05/5.02/3.20/13.02/5.46 ms。图片 body 均 47884 bytes；没有排除首个样本或为了结果预热。

## 上轮 662 源的全部 21 组（历史证据）

来源：原 checkout 的 `output/checks/p3-06-storefront-acceptance/run-2026-09-07T17-13-43-828Z/browser-attempt-4/performance/`。这批 1540 输入、662dcb3e 源早于管理中心，不冒充当前代码。

单位 ms；各列为三次独立中位数，列之和不必等于 observed LCP。模拟 LCP 来自评分 audit；其余阶段来自实际 trace insight，不能相加当作模拟阶段。唯一例外 en artist 第三次 LCP 为无图片元素，图片发现/下载中位数仅计算其余两次，标记 †。

|语言|页面|分数|模拟 LCP|Observed LCP|TTFB|资源发现延迟|图片阶段|元素渲染延迟|
|---|---|---:|---:|---:|---:|---:|---:|---:|
|en|home|0.94|3138.8|493.0|4.6|462.8|2.1|22.8|
|en|artist|0.96|2764.0|85.0|58.3|3.8 †|3.3 †|19.6|
|en|gift|0.92|3226.8|751.0|682.0|3.9|7.6|57.2|
|zh-CN|home|0.91|3467.5|432.0|4.2|401.0|2.0|21.3|
|zh-CN|artist|0.96|2763.2|101.0|64.6|3.5|3.0|29.0|
|zh-CN|gift|0.92|3210.8|681.0|633.0|3.5|3.0|34.7|
|th|home|0.92|3304.0|474.0|4.1|435.7|2.0|32.4|
|th|artist|0.97|2416.4|105.0|53.7|3.5|2.8|44.9|
|th|gift|0.92|3213.2|758.0|643.0|4.0|3.9|68.8|
|vi|home|0.94|3060.6|512.0|4.0|490.8|1.8|16.2|
|vi|artist|0.94|2912.3|98.0|67.7|3.5|6.3|24.9|
|vi|gift|0.92|3213.1|591.0|544.2|3.4|5.0|34.7|
|ja|home|0.91|3461.3|522.0|3.6|496.4|1.7|27.5|
|ja|artist|0.96|2706.2|102.0|67.9|3.4|2.9|20.7|
|ja|gift|0.70|5415.9|695.0|658.3|3.6|3.4|37.3|
|es|home|0.95|2912.1|517.0|3.6|490.4|2.1|27.7|
|es|artist|0.94|2908.3|105.0|63.0|3.5|3.4|35.9|
|es|gift|0.94|3063.0|587.0|552.4|3.5|3.7|22.6|
|pt|home|0.95|2920.8|534.0|3.9|505.3|2.3|24.0|
|pt|artist|0.94|2908.7|95.0|52.3|3.4|3.9|35.3|
|pt|gift|0.94|3064.4|675.0|645.9|3.6|4.5|21.3|

可证伪的下一步：

- 首页 TTFB 只有 3.6–4.6 ms，但图片发现约 401–505 ms；需对齐 HTML chunk/主图 preload/数据读完成，检查快速 shell 后的关键数据等待。不能把低首字节当作主内容已返回，也不要重复添加已有 eager/high。
- 礼物页 TTFB 中位数 544–682 ms，而发现约 3–4 ms；应逐类测 canonical content/scoped commerce/SEO/recipient 读链，保留真实 proof、权限与先判 404 后输出的语义。
- 艺人页 observed LCP 85–105 ms，而 simulated 通常 2.7–2.9 秒；模拟网络依赖与排队必须单独分析。低 TBT 不支持普遍长脚本执行为主因，JS SHOULD 和 LCP 因果要分开验证。
- 日语字体 CSS 33023 bytes、英文 1257 bytes；上轮日语 gift 总字体 20 片/408129 transfer bytes，英文通常 2 片/61360。仅当真实 Lantern critical chain 证明字体并发是主因时，再考虑保持同一字体和完整任意字形回退的小范围分片实验。
- 不把 render-blocking insight 的 FCP savings 冒称 LCP savings；上轮 ja gift 第一次约 3430 ms CSS savings，但该 audit 的 LCP savings 明确为 0。

完整门入口：`mise exec node@24.20.0 -- corepack pnpm verify:storefront-acceptance:performance`。它执行真实 PG/S3 seed、全协议、compiled Next、84 资源页、63 LH；可省完整 UI 矩阵，但不能省协议或选最佳样本。仅在协调后的独占工作区运行。

# P3-06：固定 12 次 HTTPS 协议对照结果

2026-09-21，`resource_audit` 只读汇总本轮已保存报告。**12 份测量原件及已有官方重放有效；整批传输门禁仍 FAIL。** 本文没有新采样、重放、测试、服务启动或生产改动，不覆盖后续独立 font-range 检查点。

## 证据范围与完整性

固定顺序为 `h1-a → h2-a → h2-b → h1-b`，每组三次，无择优替换。原始目录为：

`output/checks/p3-06-storefront-acceptance/run-2026-09-21T15-45-06-322Z/transport-{h1-a,h2-a,h2-b,h1-b}/gift-render-trace/`

每组样本名均为 `zh-CN-gift-mobile-{1,2,3}`。原代理报告位于同 run 的 `browser-attempt-1/transport-results.json`；准确路径映射见本目录 `analysis-manifest.json`，已有重放位于 `replay/{h1-a,h2-a,h2-b,h1-b}/`。

`analysis-summary.json` 已验证 108 个采集原件的字节长度/SHA、12 份同导航内容审计、相同 Lighthouse 设置、每次原生日志的 `GIFT_CONTENT=0 / STOREFRONT_GIFT=1` 成功读取，以及 24 个 FCP/LCP 重放值与原 LHR 一致。`validOriginalSamples=12`、`allTwelveSamplesRetained=true` 与 `wholeTransportGatePassed=false` 同时成立：原件有效并不撤销传输失败。

四组原始 API 发布响应均为 4244 B，SHA `b48a5119c997630e977f35496a9818e2b74c0fd6db718cf31cf745fe6b718b38`；fixture manifest 均为 38020 B，SHA `7ff1e10882e68adeb16bf52be2717d22bac9a36667f59156f13125513c2487d4`。响应原字节、解析后的 body、manifest 原字节及对象均跨组一致；各组 `fixture-publication.json` 的 body 与其原响应对应，`observedAt` 如实保留各次读取时间。

`source-after-capture.json` 在 15:53:18 UTC 记录：2348 个冻结输入 `changed=[]`。runner 记录测量 build ID 为 `dRjFwmkYTpRBHkzNu7Akl`、Next generation 为 1。采集前准备阶段的旧 build ID `ynvWG4f8UH2_h8SoClzAO` 与 fixture 构建后的测量 build 不同，不能把两者写成同一个构建产物。冻结与采后核验见 `source-frozen.json` / `source-after-capture.json`；这些证据仅对应本轮采集时点。

当前实际浏览器为 Chrome 153.0.8010.48，Lighthouse 为 13.4.1。这里的 **observed** 是本地导航的实际 trace 时间；**simulated** 是原配置下官方慢网估计。二者均不是生产 RUM，也不是真实用户 p75。不能用 observed 数值替换模拟预算，或把三次中文详情页诊断当完整七语言验收。

## 真实协议与保留的传输失败

同一 viewer origin 为 `https://media.example.invalid:63987`。每组独立 Node TLS 探针均通过显式 TEST CA/SAN 验证、协商 TLSv1.3，证书 SHA 均为 `1282e077438ddec1806d83374f2a2eb28033ef6ebd3c423b9637a425823a127c`。Chrome 保留原精确 SPKI 例外，不代表浏览器/系统证书链信任。TLS 探针不请求页面。

| 组 | 原始 CDP HTTP 协议 | 每次 CDP 连接数 | 代理请求区间 | 组内代理 ALPN | 原组状态 |
| --- | --- | ---: | --- | --- | --- |
| h1-a | http/1.1 | 6 / 6 / 6 | [0, 81) | 81 条均 http/1.1 | FAIL：2 条 CLIENT_ABORTED |
| h2-a | h2 | 1 / 1 / 1 | [81, 162) | 81 条均 h2 | COLLECTED |
| h2-b | h2 | 1 / 1 / 1 | [162, 243) | 81 条均 h2 | COLLECTED |
| h1-b | http/1.1 | 6 / 6 / 6 | [243, 324) | 81 条均 http/1.1 | COLLECTED |

四段原组请求与最终快照逐项深等，从 0 连续覆盖全部 324 条；最终 `closed=true / activeRequests=0 / overflowRequests=0`。CDP 协议属于各导航原始证据，ALPN 是组级探针及代理请求证据，没有逐导航到 TLS 连接的一对一绑定。

首组代理请求 26、27 均为 `/_next/image`、0 B、`complete=false / CLIENT_ABORTED`。`fixture-result.json` 的真实运行 exit 1、366.16 秒，以及 `analysis-summary.json` 的 FAIL 均保留。请求的 `status=200` 不能覆盖客户端取消；代理默认 statusCode 也可能为 200。

独立 `aborted-request-audit.md` 将两次取消定位在第一份已记录 LCP 之后约 4.24 秒、其 Trace 窗口之后约 1.79 秒；该导航的 LCP 图片和九个字体均完整传输。这支持继续解释其冻结原件，不证明取消无后续缓存影响。取消发生在后置采集/收尾期间，具体触发动作和图片 query/DOM 绑定仍未确定，不能宣布截图或下一次导航是根因。

`successful-entity-comparison.json` 单独证明：排除并明确列出这两条取消后，22 个静态 pathname 的完整 GET 200 编码实体集合，在四组的 SHA、长度和 content-encoding 上一致。它只比较成功实体，代理没有保存 image query，不能建立每个图片 query 到实体的一对一配对；**不修复整个传输门禁，也不宣称所有请求完整。**

## 全部 12 次数值与模拟末端

单位均为 ms，表中数值保留三位小数；精确值在 `analysis-summary.json`。各次乐观/悲观 LCP 模拟结果一致。字体数是进入 LCP 模拟图的数量，实际每次均下载九个字体。

末端缩写：`SC108/119` 为对应 Noto Sans SC 分片；`UI font` 为 `simplified-chinese-ui.1vmo4wzsh43-s.woff2`；`JS-A` 为 `2p07cckado7sy.js`；`JS-B/C` 分别为 `0vvvbuvfpgllo.js` / `3dxyo5tonng-p.js`；`CPU` 为已有 RunTask 节点。末端是模拟图的最晚节点，实际 LCP 元素仍为礼物图片。

| 组/样本 | 模拟 FCP | 模拟 LCP | observed LCP | LCP 图字体数 | 模拟末端 | 主图缓存 |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| h1-a / 1 | 3474.605 | 5732.806 | 546.208 | 9 | SC108 / SC119 并列 | MISS |
| h1-a / 2 | 1659.694 | 2769.541 | 280.424 | 0 | JS-A → CPU | HIT |
| h1-a / 3 | 1664.658 | 2776.987 | 294.242 | 0 | JS-A → CPU | HIT |
| h2-a / 1 | 1215.948 | 2265.948 | 291.416 | 0 | JS-B / JS-C 并列 | HIT |
| h2-a / 2 | 1205.744 | 2255.744 | 286.875 | 0 | JS-B / JS-C 并列 | HIT |
| h2-a / 3 | 1205.419 | 2255.419 | 263.215 | 0 | JS-B / JS-C 并列 | HIT |
| h2-b / 1 | 1210.521 | 2260.521 | 296.851 | 0 | JS-B / JS-C 并列 | HIT |
| h2-b / 2 | 1205.244 | 2255.244 | 261.342 | 0 | JS-B / JS-C 并列 | HIT |
| h2-b / 3 | 1206.088 | 1956.088 | 282.484 | 0 | JS-C | HIT |
| h1-b / 1 | 3162.983 | 3912.982 | 284.397 | 3 | UI font | HIT |
| h1-b / 2 | 1662.184 | 2868.276 | 286.025 | 0 | JS-A | STALE |
| h1-b / 3 | 1660.435 | 2769.653 | 307.087 | 0 | JS-A → CPU | HIT |

| 组 | 三次模拟 LCP 中位数 | 三次 observed LCP 中位数 | LCP 图字体模式 | 原组诊断预算状态 |
| --- | ---: | ---: | --- | --- |
| h1-a | 2776.9867 | 294.242 | 9 / 0 / 0 | BUDGET_FAILED；另有传输 FAIL |
| h2-a | 2255.7439 | 286.875 | 0 / 0 / 0 | BUDGET_PASSED |
| h2-b | 2255.2436 | 282.484 | 0 / 0 / 0 | BUDGET_PASSED |
| h1-b | 2868.2760 | 286.025 | 3 / 0 / 0 | BUDGET_FAILED |

H2 两组在本次窄诊断中记录的预算状态为 PASSED，不能提升整批传输状态，更不能升级 P3-06 正式性能、全语言、真机或 RUM 门。

## 字体截止改变了哪些图

H2 六份报告均为 **实际九字体、LCP 图零字体**。其最早字体完成也晚于各次实际 LCP 2.632–15.312 ms；最晚字体完成晚 9.910–27.377 ms。因此 pinned Lantern 按实际 LCP 截止构图时排除了字体，零字体并不表示取消下载、删除字形、字节减少或浏览器不需要这些字体。

H1 的两个字体样本也反映同一截止规则：

- `h1-a/1` 的九个字体都早于实际 LCP 完成约 81.658–103.616 ms，全部进入图，字体 transfer 总计 556871 B。
- `h1-b/1` 仅 latin、SC117、UI font 三个字体在截止前完成；图中字体 transfer 为 187618 B。最早字体只早于 LCP 约 1.757 ms，其余字体结束跨过截止。
- 另外四个 H1 样本同样是零字体，最早完成也比实际 LCP 晚约 3.862–9.421 ms。零字体不是 H2 独有现象。

`h2-b/3` 除零字体外，LCP 图还只纳入七个脚本和两个 CPU 节点；其他五份 H2 为八个脚本和三个 CPU 节点。其更低的 1956.0883 ms 不能只描述成同一资源图上的协议收益。官方构图规则及此前已验证的边界见 `prior-critical-path-audit.md` 与 pinned `FirstContentfulPaint.js` / `LargestContentfulPaint.js`；本轮未修改截止规则或原模型输入。

## 末端路径的定量解释

以下为已有模拟中的显式最新依赖链分解，不是某个请求造成带宽竞争的因果归因；正等待仍应理解为 helper 标记的未进一步归因的调度/竞争。

- `h1-a/1`：HTML 908.2015 → 字体 CSS 1358.2015 → SC108 等待 1958.2015、传输 1508.2015，合计 5732.8060。并列 SC119 的等待/传输为 1508.2015 / 1958.2015，得到同一末端。首份主图实际 MISS 加载 171.456 ms，较晚的图片 LCP 也让所有字体进入截止。
- `h1-b/1`：HTML 904.3275 → 字体 CSS 1354.3275 → UI font 1654.3275，字体开始前额外等待为 0，合计 3912.9825。这个样本不能归纳为字体 socket 排队导致；CSS 发现链和慢网传输仍占主要模型时长。
- 零字体的 H1 样本：HTML 约 905–907 → JS-A 开始前等待约 305–307 → JS-A 传输；三份随后还有约 54–55 ms CPU，`h1-b/2` 则止于 JS 下载。总 LCP 约 2769–2868 ms。
- 前五份 H2：HTML 约 905–916 → JS-B 等待 1200、模拟传输 150；并列 JS-C 等待 1350、该节点模拟增量传输为 0，止于约 2255–2266 ms。`h2-b/3` 为 HTML 906.0883 → JS-C 等待 900、模拟传输 150，合计 1956.0883。这里的零增量是模型的连接/字节账本结果，不是现实中脚本瞬间下载的测量。

固定版本会依据实际协议选择连接模型，所以这些对照证明协议输入及其对应模型路径确实不同；但实际截止、脚本入图、主图 MISS/HIT/STALE、时间顺序及两次事后取消可能产生的缓存影响也同时存在。不能把中位数差值全部归因于协议，更不能把这批结果外推为用户端或生产 CDN 提速幅度。

十二份 observed LCP 为 261.342–546.208 ms；主图下载完成至呈现为 3.308–46.450 ms，CLS 均为 0、TBT 为 0–12 ms。本批没有重现旧的约一秒绘制等待，也没有证明旧问题被修复。本轮得到的是更明确的协议证据、截止敏感性和末端资源路径；后续任何字体或业务资源优化需独立冻结、采样和验收，不能合并进这批原始结果。

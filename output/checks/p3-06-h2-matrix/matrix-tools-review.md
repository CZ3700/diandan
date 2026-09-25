# 本轮矩阵工具独立只读复核

审查者：Codex `slow_lcp_audit`。范围仅为本轮一次性 `run-matrix.mjs`、`verify-matrix.mjs`、`run-filter-probe.mjs` 与它们调用的既有函数；没有执行浏览器、测试、构建或重采，没有修改上述脚本。`probe-filter.mjs` 的具体检查由另一 reviewer 负责，不在本审查结论内。形成此记录时 63 次正式采集仍在进行，不判断运行是否通过。

## 初次源码快照

| 文件 | SHA256 |
| --- | --- |
| `run-matrix.mjs` | `49ce1fb707ec7d3483ede5e84ee087e87dc10823bf4552bcd7e2bf394fdda8d9` |
| `verify-matrix.mjs` | `5ea16b4485c5f2f34d50a64b080863b3f0b371b594c5293205de6b22f7ae8009` |
| `run-filter-probe.mjs` | `6fef5597c36e261b53cd8fcebc575e7404808e071230b43a6a4f11f523aa46e0` |

初次结论：**采集入口与原函数相容；离线验证器需补证据绑定后再作最终证据验收。** 以下缺口是离线检查器的问题，不要求修改产品、重跑已开始的矩阵或替换采集样本。

## 已确认的相容性

- `run-matrix.mjs` 通过 `runAcceptanceFixture({serve:false, ui:true, performance:false, verifyBrowser:verifyMatrix})` 进入原真实 PG/S3/worker fixture，并在回调中仅替换 `origin` 为自有 H2 viewer。`performance:false` 防止 fixture 再次运行一次性能函数；`ui:true` 在这里负责进入自定义回调，不代表执行了原完整 UI 验收。
- `verifyMatrix` 直接调用既有 `verifyAcceptancePerformance`，没有复制或重写采集与聚合逻辑。原 `acceptancePages` 为 7 语言 × 6 路由，`acceptanceViewports` 为 390×844、1440×900，因此资源采集是 84 次。原性能循环仅取 home/artist/gift，固定每组 1/2/3，共 21 组、63 次，全部原报告落盘。
- 原 `aggregateAcceptanceLighthouse` 拒绝 runtime error、非有限指标或性能分数、无效同导航内容审计；固定三次且保留 min/median/max。原门保持 score median ≥0.9、LCP median <2500 ms、CLS median <0.1。原 `summarizeAcceptancePerformanceBudget` 保持资源 SHOULD 与性能硬门区分，未把 JS/图像建议改成整阶段验收。
- 原采集保存 JSON/HTML、原配置、warnings、内容审计与 aggregate。内容 gatherer 在 Lighthouse 测量的文档中验证 URL、locale、目标可见及错误状态，没有额外导航、DOM 修改或重试。默认模拟 profile、浏览器启动参数和精确 TEST SPKI 豁免来自原函数。
- `FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS` 在父/子入口都必须未设置。没有新增额外预热；原 84 资源页先于 Lighthouse，会使共享服务/图像优化缓存变暖，原 `report.conditions.serverCache` 已准确记录，不能称服务器完全冷缓存。
- H2 viewer 在原 Next 注册之后加入同一 `context.own` 清理栈；逆序清理先关闭 viewer 并保存最终快照，再关闭 Next/API/worker。浏览器资源页 context、Playwright browser、Lighthouse Chrome 各由原 finally 清理；fixture 的 `withAcceptanceResources` 会保留原失败并继续执行其他清理。
- `run-filter-probe.mjs` 仅注入自己的 `verifyBrowser`，同样不会额外触发正式性能函数；标题只称补充筛选证据。该入口不构成原 63 次性能结果，也不应被统计为完整 UI/真机验收。

## 初版验证器的具体缺口

1. **目标与 viewport 绑定不完整。** 初版 64–68 行只按 width 统计资源，未校验 844/900 高度；LHR URL 与同一 report 中的 `entry.path` 比较，而该 path/selector 并未与原 fixture 推导的目标相比较。应读取父目录 `fixture-manifest.json`，复用 `acceptancePages(manifest)` 与 `acceptanceViewports`，逐项校验资源目标、完整 viewport、63 次目标及预期文件名/attempt；同时把 entry 的 config/content/warnings 与对应 LHR 原件交叉核对。
2. **viewer 归属未锁定。** 初版 70–77 行校验了所有记录的 ALPN/httpVersion，但未断言 `viewer.origin===context.origin`、`viewer.protocol==='h2'`。应补充这些断言，避免误用其他 run 的 viewer-final。原报告、context、viewer、fixture、aggregate 文件也应列入 SHA/长度清单；初版仅散列 126 份 LHR JSON/HTML。
3. **字节完成状态必须准确表述。** `finishedAt` 和 `sha256` 存在既可能是完整响应，也可能是中途取消后已收集的部分字节。初版 failures 数组保留 `failure/status>=400`，但未校验 `complete` 与 `failure` 的一致性，也没有区分“元数据闭合”与“全部响应成功”。应保留全部失败并显式统计 complete/incomplete，要求非负整数 byteLength、SHA 格式、结束字段及失败一致；不可把部分 SHA 称为完整响应字节。该 viewer 主动去掉 query，现有记录不能把每个 `/_next/image` 精确配回某张图片。
4. **不能未经关联把失败命名为辅助请求。** 完整矩阵没有前轮 diagnostic trace 的逐请求导航归属，viewer 失败列表本身不提供其发生在测量还是附加收集阶段的证据。若最终存在失败，只能原样报告其记录，单列传输成功结论；不能因为各 LHR 有指标便宣布这些失败全是辅助请求、无影响。原功能采集的 `resourceFailures` 仍必须为零。

前两项已即时报告给 root。第 3/4 项既是工具一致性检查，也是最终摘要的表述边界；不要求为了追求全绿忽略失败或重新采样。

## 结论边界与后续复核

初版 `evidenceVerification:PASS` 仅在上述绑定修复并实际执行后，才可用于描述原件一致性。它必须与 `originalVerdict`、原 lab budget、传输失败统计分开；即便原实验室预算通过，也不推导生产系统信任、部署、SEO、RUM、物理手机、读屏或人工验收通过。

最终复核应读取修订脚本和新输出，确认覆盖、所有原失败保留及清理结果。审查记录仅新增此文件；未更改预算、采样顺序、产品源码或采集原件。

## 采集完成后的复核

最终复核结论：**ACCEPT：本轮工具相容性、原件一致性与原实验室三次中位预算结论；不接受“全部传输成功”或“整个 P3-06 完成”的扩大表述。** 首版意见保留，以下为追加复核。

修订 `verify-matrix.mjs` SHA256：`c104e3c8f20be5c950e0124ad9a7cc696338bd45c5be17332f9d2ffc6e067c5a`。已读取实际脚本，确认新增原 fixture 推导的 target/selector/path、完整 viewport 与资源顺序、各 attempt 文件名、viewer origin/protocol 以及 complete/failure 一致性断言；原聚合函数和预算未更换。脚本成功执行证据为 `matrix-verification-result.json`，摘要为 `matrix-summary.json`。

本次原件根目录：`output/checks/p3-06-storefront-acceptance/run-2026-09-21T16-34-50-464Z/browser-attempt-1/`。独立 Python 只读核对结果：

- `matrix-summary.json.rawFiles` 的 **153 个文件、88371421 B** 全部长度与 SHA 匹配，含 fixture/protocol/context/viewer/results、126 份 LHR JSON/HTML、21 份 aggregate。
- 84 个资源目标与 fixture 的七语言六路由、390×844/1440×900 完整对应；资源失败数组为空。63 份 LHR 原始 URL 四字段、配置、entry 的 config/content/warnings 一致，全部同导航内容检查字段有效，无 runtime error、无 warning。HTML 包含官方许可注释后的 doctype；未把 HTML 当 trace 或精确资源请求证据。
- 21 组 min/median/max 另以 Python 排序核对，每组原三次样本全部保留；全部原硬门通过。LCP 中位范围 **1805.2408–2255.7256 ms**，最低性能分中位 **0.98**，CLS 全部 0。下列 5 个单次 LCP 超过 2500 ms，未删除或替换：中文 home-1 3508.6988、artist-3 **4357.5634**、gift-1 4204.5826；越南语 gift-3 3304.5538；日语 home-3 2705.3121 ms。
- **84/84 页面 JS SHOULD 超过 150000 gzip B**，实际范围 **150027–155368 B**；238 条图片预算项全部通过。原硬门 PASS 不消除这个建议超标，也不证明后续无需优化。
- 3356 个 viewer 记录 ID 连续，全部实际协商 h2/HTTP 2.0；独立核验所有 SHA 为 64 位十六进制、byteLength 为非负整数、结束时间不早于开始、complete/failure 一致。3355 complete、1 incomplete；最终 closed=true、active=0、overflow=0。原真实协议 32461 assertions 与 fixture callback PASS。这里只读这些已完成记录，没有重新启动或执行采集。

其中 entry 元数据交叉核验、字节整数/SHA 格式检查为本次独立补充核对，不能误称最终脚本已逐项实现了所有这些断言。复核首次临时提取对 HTML 使用了过严的 `startswith('<!doctype html>')`，遇官方文件开头许可注释失败；改为允许前置 HTML 注释后通过。只修正只读检查表达式，原 HTML 和采集结果未变。

### id 2970 的可证明范围

原记录位于 `viewer-final.json.requests`，同时在摘要 `viewer.failures` 原样保留：

- `id=2970`，GET `/_next/image`，实际 h2/HTTP 2.0。
- `startedAt=2026-09-21T16:46:10.082Z`，`finishedAt=2026-09-21T16:46:10.092Z`。
- `failure=CLIENT_ABORTED`、`complete=false`、`status=502`、`byteLength=0`；SHA 为标准空字节 SHA256。此 502 是代理取消路径记录的 outgoing 状态，不能据此声称 Next 返回了 502，或浏览器实际收到 502 响应。

时间关联能缩窄到西班牙语首页第 2 次 Lighthouse 的后段：`es-home-mobile-2.json.fetchTime=16:46:05.191Z`，下一份 `es-home-mobile-3.json.fetchTime=16:46:11.324Z`。当前报告 fetchTime 到取消为 **4891 ms**，取消比下一报告 fetchTime 早 **1242 ms**。同期唯一 `/es` 文档 viewer id 2942 于 **16:46:05.232Z** 开始、05.931Z 结束；该报告原 `network-requests` 文档记录为开始 0.261 ms、结束 699.406 ms，两端间隔一致。

`es-home-mobile-2.json.audits['network-requests'].details.items` 共 **22 个请求**，其中 **6 个 Image**，全为 h2、finished=true、statusCode=200；最后测量网络请求结束时间 **824.060001 ms**。原 metrics 给出实际 LCP **528 ms**、traceEnd **3028 ms**。用上述同步文档请求作时间近似对齐，取消发生于导航后约 4850 ms、traceEnd 后约 **1822 ms**。这是同机 wall-clock/相对时间的关联，缺少原 devtools wallTime 锚时不应给出微秒级等式。

`fetchTime` 不是 navigationStart：锁定 Lighthouse `core/gather/base-artifacts.js:21–28` 在 benchmark/version/DPR 后赋当前日期；`core/gather/navigation-runner.js:60–63` 随后执行 navigation 准备。报告 `timing.entries` 还显示先结束导航/读取 DevtoolsLog，再执行 FullPageScreenshot、BFCacheFailures，最后审计；取消的时间位置接近后续取证/关闭阶段。`navigation-runner.js:235–250` 的清理会断开 driver、关闭 Lighthouse 自有 page。**这些只提供时段背景，不证明 id 2970 的实际 initiator 或取消动作是哪一段代码。**

因此可以说：测量网络列表没有与该取消相符的失败条目，取消时间落在该报告测量记录之后、下一报告之前。仍不能确定具体图片、query、请求 initiator，不能未经关联命名为“辅助图片”，不能排除后续缓存影响或把它从总传输失败中移除。viewer 主动剥掉 query，原正式矩阵也未保存逐请求原 devtools/trace；本次未尝试用新采样补造历史关联。

### 最小只读复查入口

```sh
python3 - <<'PY'
import hashlib
import json
from pathlib import Path

base = Path('output/checks/p3-06-storefront-acceptance/'
            'run-2026-09-21T16-34-50-464Z/browser-attempt-1')
summary = json.loads(Path('output/checks/p3-06-h2-matrix/matrix-summary.json').read_text())
for entry in summary['rawFiles']:
    content = (base / entry['file']).read_bytes()
    assert len(content) == entry['bytes']
    assert hashlib.sha256(content).hexdigest() == entry['sha256']
viewer = json.loads((base / 'viewer-final.json').read_text())
print('verified files', len(summary['rawFiles']))
print('cancelled record', next(r for r in viewer['requests'] if r['id'] == 2970))
for name in ('es-home-mobile-2', 'es-home-mobile-3'):
    report = json.loads((base / 'performance' / f'{name}.json').read_text())
    items = report['audits']['network-requests']['details']['items']
    metrics = report['audits']['metrics']['details']['items'][0]
    print(name, report['fetchTime'], 'requests', len(items),
          'bad', sum(not r['finished'] or r['statusCode'] >= 400 for r in items),
          'max network end', max(r['networkEndTime'] for r in items),
          'observed LCP', metrics['observedLargestContentfulPaint'],
          'trace end', metrics['observedTraceEnd'])
PY
```

最终摘要应并列报告：原实验室硬门 PASS、JS SHOULD 超标、5 个慢样本、1 个保留的请求取消及其关联边界。其余人工、真机、RUM、商户、staging 门仍由原计划单独验收。

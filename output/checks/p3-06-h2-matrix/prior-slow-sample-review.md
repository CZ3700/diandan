# 前一轮候选慢样本只读复核

范围：仅复核 `p3-06-font-range` 已保留的三次中文礼物页候选导航，解释为什么冻结产品源码进入完整矩阵。本文不评价本轮正在采集的 63 次 H2 矩阵，也不宣布 P3-06 或生产性能验收通过。本次只读取现有 JSON 与锁定依赖源码，没有启动服务、重新采样或修改产品。

## 原件与绑定

- 原采集：`output/checks/p3-06-storefront-acceptance/run-2026-09-21T15-55-54-248Z/browser-attempt-2/gift-render-trace/zh-CN-gift-mobile-{1,2,3}{.json,-trace.json,-devtools.json,-artifacts.json,-config.json}`。
- 官方计算重放摘要：`output/checks/p3-06-font-range/replay/candidate/zh-CN-gift-mobile-{1,2,3}-analysis.json`。
- 原件长度/SHA、同配置与启动参数、每次实际字体路径/字节及重放绑定入口：`output/checks/p3-06-font-range/comparison-summary-verified.json`，`groups[stage=candidate].samples`。初版 `comparison-summary.json` 不作为最终绑定入口。
- 三个重放均为 Lighthouse `13.4.1`、`graphSource=PINNED_DEFAULT_DEVTOOLS_LOG`，`equivalence.matched=true`，原 FCP/LCP 与官方重放差为 0。本文是对已绑定结果的离线复核，不再宣称重新执行了官方计算。

## 三次差异

| 候选样本 | 模拟 LCP ms | 实际 LCP ms | LCP 图内字体 | 实际字体 | 实际字体 resource B |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 4275.773 | 1383.909 | 7 | 7 | 412348 |
| 2 | 1955.0864 | 252.957 | 0 | 7 | 412348 |
| 3 | 2256.0191 | 242.361 | 0 | 7 | 412348 |

三个样本的实际 LCP 图片 URL SHA 均为 `be16a6abf05bc0fc5b00cf6d2b78e6dc02ac67620f3ad57e09ee5cce12ae6dfc`，`resourceSize=47884`，请求均完成且 HTTP 200。实际图片下载完成时间分别为 355.325 / 228.805 / 214.316 ms。

慢样本 1 在 384.887 ms 已记录目标 renderer/node 的 `PaintImage`，之后 1379.673 ms 又记录该节点绘制，官方最终选中 LCP 为 1383.909 ms。**早期 PaintImage 不证明内容已呈现给用户，不建立图像到 compositor frame 的完整因果关联。** 最大已提取主线程顶层任务为 23.304 ms；现有材料不能用一项长任务或图片传输解释近一秒间隔，也不能据此排除未观测工作。三份结果的 `observed.compositorCause` 均为 `UNKNOWN`，其 `limitations` 明确限制了 raster/frame/visibility 临近事件的因果解释。

慢样本 7 份字体在 393.914–395.254 ms 完成，比实际 LCP 早 988.655–989.995 ms。快样本 2 的字体结束反而在实际 LCP 之后 10.465–11.425 ms；快样本 3 在之后 8.510–9.660 ms。因此实际资源相同，官方模型纳入的资源却不同。

### 模拟图的准确解释

样本 1 的 optimistic/pessimistic 结果相同：字体节点模拟调度区间为 1216.773→3316.773 ms；图片节点为 3316.773→3466.773 ms；终点是 CPU 节点 `87260349.5447271073175`（4275.773 ms）。其末端显式依赖链为：

`Document 412174E6497B9E03719F5EAFF353D71A (916.773) → Script 14291.13 / 2p07cckado7sy.js (4216.773) → CPU (4275.773)`。

样本 2 图终点为 `14320.18 / 3dxyo5tonng-p.js (1955.0864)`，直接依赖主文档；样本 3 图终点为 `14354.17 / 0vvvbuvfpgllo.js` 与 `14354.18 / 3dxyo5tonng-p.js`（2256.0191），直接依赖主文档。快样本两图均无字体。

`terminalDependencyChains` 只沿最后完成的显式依赖回溯，不是资源争用因果图。字体出现在模拟调度前段、脚本/CPU 成为终点，不代表已经确定浏览器 compositor 根因；也不能把两组模拟差额或 2100 ms 字体区间当成删除字体必然得到的收益。图像在模型中等待调度，也不等于真实浏览器直到该时间才开始下载。

## 锁定源码依据

Lighthouse 13.4.1 通过 `node_modules/lighthouse/core/lib/lantern/lantern.js` 导出锁定的 `@paulirish/trace_engine@0.0.65`。实际源目录：

`node_modules/.pnpm/@paulirish+trace_engine@0.0.65/node_modules/@paulirish/trace_engine/models/trace/lantern/metrics/`

- `LargestContentfulPaint.js:27–47` 将实际 LCP timestamp 作为 optimistic/pessimistic 截止；49–55 行从合格图节点中取最大模拟结束时间。SHA256：`9720fadc9a5abdc9b76dfc1265f8c205cf719703b46a159707e36b8393010348`。
- `FirstContentfulPaint.js:100–117` 中，除主文档外，结束/开始晚于截止的网络节点被排除，之后还有脚本与 CPU 筛选。SHA256：`4550072f594f5ab21be08b441d3fb01db7d3bb17d6c36faa442d8d4bea9447b1`。

上述规则与实测字体结束时刻解释了字体 7/0/0 的图结构差异，**并未解释慢样本实际 LCP 为何晚于早期 PaintImage**。

## 可复跑的只读提取

在仓库根执行以下 Python，仅读取现有结果和原 devtools 日志，不写文件、不运行浏览器。浮点尾差来自秒/毫秒换算；表中按三位小数呈现。

```sh
python3 - <<'PY'
import json
from pathlib import Path

root = Path('output/checks')
replays = root / 'p3-06-font-range/replay/candidate'
raw = root / ('p3-06-storefront-acceptance/'
              'run-2026-09-21T15-55-54-248Z/'
              'browser-attempt-2/gift-render-trace')
for index in (1, 2, 3):
    name = f'zh-CN-gift-mobile-{index}'
    analysis = json.loads((replays / f'{name}-analysis.json').read_text())
    observed = analysis['observed']
    model = analysis['simulated']['LCP']['optimistic']
    lcp = observed['selectedLcp']['startMs']
    print(name, 'observed LCP', lcp, 'simulated LCP', model['timeInMs'])
    print('equivalence', analysis['equivalence'])
    print('image requests', observed['imageNetworkRequests'])
    print('matching paints', [event for event in observed['matchedImagePaintEvents']
                              if event.get('nodeMatches')])
    print('largest recorded task', max(observed['topLevelTasks'],
                                       key=lambda task: task['duration']))
    print('cause', observed['compositorCause'])
    print('terminal chains', model['terminalDependencyChains'])
    print('model font count', sum(node.get('resourceType') == 'Font'
                                  for node in model['nodes']))
    origin_seconds = observed['timeOriginUs'] / 1e6
    requests = {}
    for event in json.loads((raw / f'{name}-devtools.json').read_text()):
        method, data = event['method'], event['params']
        request = requests.setdefault(data.get('requestId'), {})
        if method == 'Network.requestWillBeSent':
            request['file'] = data['request']['url'].rsplit('/', 1)[-1].split('?')[0]
        elif method == 'Network.responseReceived':
            request['type'] = data.get('type')
        elif method == 'Network.loadingFinished':
            request['endMs'] = (data['timestamp'] - origin_seconds) * 1000
    for request in requests.values():
        if request.get('type') == 'Font':
            print('actual font', request['file'],
                  'end ms', round(request['endMs'], 3),
                  'end minus LCP ms', round(request['endMs'] - lcp, 3))
PY
```

重放 JSON 的精确键还包括 `simulated.LCP.{optimistic,pessimistic}.nodes`（所有模拟开始/结束/依赖）、`observed.matchedImagePaintEvents` 和 `inputSha256`。若需重新执行官方重放，使用项目已有 `apps/api/scripts/storefront-gift-trace-analysis.mjs` 并选择新的输出目录，不能覆盖原证据；本次没有执行。

## 本轮决策边界

已验证的真实产品收益仍是上轮 ASCII 范围去重：每次字体 9→7，少 141352 resource B（25.53%）。该收益已交付，不能把它再次计算为本轮新增修复。当前三个同产品样本不足以证明应再修改字体显示策略、图片策略或其他产品代码，因此本轮先保持源码、内容、预算和采集设置固定，取得完整七语言三路由矩阵。

矩阵按预定三次中位数规则判断每个单元，保留所有慢样本，不额外预热、不择优重采；单次慢样本也单独报告。其结果只评价明确记录的本地 H2 实验环境，不代替 RUM、物理手机/读屏、人工译审、真实商户或 staging 证据。**本文件形成时本轮完整矩阵尚在采集，未对其通过/失败作结论。**

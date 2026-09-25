# P3-06 transport experiment: prior critical-path evidence

2026-09-21. Read-only audit by `resource_audit`, using the three retained candidates from the preceding composites stylesheet isolation checkpoint. Current continuation base is `c252c52`. This document does not contain new browser samples, model replays, a product change, or a performance acceptance decision.

## Inputs and measurement scope

Original candidate captures:

`output/checks/p3-06-storefront-acceptance/run-2026-09-21T13-25-04-359Z/browser-attempt-2/gift-render-trace/zh-CN-gift-mobile-{1,2,3}{.json,-artifacts.json,-devtools.json,-trace.json,-config.json}`

Previously generated exact-model replay summaries:

`output/checks/p3-06-critical-path/candidate-replay/zh-CN-gift-mobile-{1,2,3}-analysis.json`

The three existing replay reports state `REPLAY_MATCHED`, use Lighthouse 13.4.1's pinned default DevTools graph, and have zero FCP/LCP difference from their respective original Lighthouse reports. The prior `comparison-summary.json` verifies all 54 original files across the preceding baseline/candidate comparison. This audit reads those retained results; it did not rerun their replay or recollect anything.

All three original navigations used `http://localhost` and all actual HTTP response records report `http/1.1`. The original Lighthouse configuration used `throttlingMethod: simulate`, RTT 150 ms, throughput 1638.4 Kbps and CPU slowdown multiplier 4. The configuration also records request latency 562.5 ms and download/upload throughput 1474.56/675 Kbps; these configuration fields do not mean that the observed localhost trace is a physically throttled production session.

**Observed** values below describe that actual local navigation. **Simulated** values are the unchanged official Lighthouse slow-network estimates used by the current lab check. Neither is production RUM or a real-user p75 measurement. A fast localhost observed LCP cannot substitute for the failed simulated budget, and three diagnostic Chinese gift navigations cannot substitute for the formal seven-language matrix, physical device checks or RUM.

## The terminal paths are fonts, not the gift image

| Candidate | Observed LCP ms | Official simulated LCP ms | Last simulated resources | Fonts included in LCP graph | Included font transfer bytes |
| --- | ---: | ---: | --- | ---: | ---: |
| 1 | 568.627 | 5418.0900 | Noto SC108 and SC119, tied | 9 | 556871 |
| 2 | 339.602 | 3012.6870 | Noto SC112 | 2 | 83592 |
| 3 | 281.611 | 4359.5727 | simplified-chinese-ui | 5 | 298954 |

Optimistic and pessimistic LCP estimates agree within each of these three reports. Every last explicit dependency chain is the document → `1t9s50a05f_y-.css` → font. That CSS contains 102 font-face declarations/references, is 97006 resource bytes and 33363 transfer bytes, and was unchanged by the preceding composites isolation. The earlier useful reduction of 11301 CSS resource bytes / 1531 transfer bytes was in another global stylesheet chunk; it did not remove this font dependency chain.

The following decomposition adds intervals along each selected latest-finished explicit dependency chain. It is **not** an attribution of bandwidth contention to individual competing requests. In particular, the replay helper labels positive wait after dependencies `UNRESOLVED_SCHEDULER_OR_CONTENTION`.

| Candidate / terminal | Document duration ms | CSS duration ms | Font wait after CSS ms | Font simulated duration ms | Chain total ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 / SC108 | 754.5225 | 1204.5225 | 1954.5225 | 1504.5225 | 5418.0900 |
| 1 / SC119 | 754.5225 | 1204.5225 | 1654.5225 | 1804.5225 | 5418.0900 |
| 2 / SC112 | 754.2290 | 1204.2290 | 0 | 1054.2290 | 3012.6870 |
| 3 / UI font | 753.1909 | 1353.1909 | 0 | 2253.1909 | 4359.5727 |

The gift image finishes at approximately 2406–2409 ms in all three LCP simulations, before their respective terminal fonts. The last fonts of candidates 2 and 3 have no positive start wait after CSS, so describing all remaining failure as an H1 six-connection queue is unsupported. Serialized discovery through CSS and the simulated transfer duration under shared bandwidth remain material.

Included CPU durations sum to 92, 90 and 34 ms; original TBT is 6, 2 and 0 ms. These are not independent durations to add to the terminal path. They do not support calling long JavaScript execution the terminal bottleneck in these samples; script downloads still share the simulated network capacity.

## Why the same font assets yield a 9 / 2 / 5 graph

Installed `@paulirish/trace_engine@0.0.65` sources explain the boundary:

- `models/trace/lantern/metrics/FirstContentfulPaint.js:93–117` filters network nodes by their actual paint cutoff, except that the main document is retained. Requests ending or starting after the cutoff are excluded.
- `models/trace/lantern/metrics/LargestContentfulPaint.js:27–57` uses the actual observed LCP timestamp for that graph and takes the latest simulated completion, excluding low-priority images where specified.

All three navigations actually download the same nine-font set, but their LCP cutoffs are 568.627, 339.602 and 281.611 ms. Candidate 2's SC117 finishes at 339.753 ms, only **0.151 ms after LCP**, and is excluded; its UI font finishes at 340.279 ms, **0.677 ms after LCP**, and is also excluded. Candidate 3 includes five fonts, while SC115/113 finish just after its cutoff at 282.408/282.565 ms. Candidate 1 includes all nine.

This discontinuous selection is a property of the pinned official model, not grounds to edit its cutoff, exclude resources manually, alter protocol records or discard unfavorable samples. A different simulated LCP with equal resource totals can reflect both transport behavior and a changed graph. New protocol results must retain and compare the font sets and terminal nodes in addition to the overall score.

## What the actual local navigation does and does not establish

| Candidate | Observed document TTFB ms | Image discovery after TTFB ms | Image load duration ms | Image completion → LCP ms | Next image cache response |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 345.665 | 3.522 | 201.861 | 17.579 | STALE |
| 2 | 281.548 | 3.619 | 6.207 | 48.228 | HIT |
| 3 | 245.967 | 3.416 | 3.826 | 28.402 | HIT |

The actual LCP element is the same eager, high-priority image, discoverable in initial HTML. All three image responses have the same ETag and 47884 resource bytes, but the first is STALE and the following two HIT. Equal image bytes do not make cache state, timing or the resulting paint-cutoff graph identical. The observed request timing cannot by itself separate image optimizer work, upstream response and other causes of its first 201.861 ms load duration.

Each navigation has six actual CDP connection IDs. All font responses reuse connections. Maximum recorded font `response.timing.sendStart` is 6.096 / 4.371 / 3.192 ms; this is a request-timing field, not a complete attribution of browser scheduling. The retained local data does **not** show seconds of real font socket waiting. No roughly one-second image-completion-to-paint gap appears in this batch; the older compositor anomaly remains unproven and unfixed.

## The bounded H1 / H2 comparison can falsify a specific hypothesis

Pinned `ConnectionPool.js:45–55` derives TLS from URL scheme and H2 from actual `request.protocol === 'h2'`, using a minimum of one H2 connection versus six for H1. `TCPConnection.js:75–99` has different warmed-H2 byte accounting and sets its modeled warm TTFB to zero; line 133 acknowledges warm-H2 timing-model limitations. `Simulator.js:187–222` checks connection availability and shares configured throughput among in-flight network requests. Consequently the protocol is a real model input, but this implementation does not establish a promised speedup or prove that H1 caused the existing failures.

The next fixed four groups, **H1 / H2 / H2 / H1**, each with three navigations through the same local TLS front door, can test whether negotiated H2 reduces relevant waiting and/or completion times under unchanged content and model settings. Node validates the certificate and SAN against the explicit TEST CA; Chrome retains the existing exact SPKI exception. This is not browser/system-trusted TLS, staging or production evidence. All groups retain the same certificate and browser flags. The diagnostic must preserve every result and the previous failed evidence.

For each of the 12 results, retain actual CDP protocol and independent front-door ALPN evidence; observed document/image timings and cache state; the unchanged official FCP/LCP; all included font identities; terminal resources and latest-dependency chains; and CSS/font simulated start, end and wait. CDP `response.protocol` proves the recorded HTTP protocol and should not be mislabeled as a TLS ALPN handshake field.

If only the cutoff and included font set change, the entire score difference cannot be attributed to connection optimization. If H2 reduces start waits but the retained CSS/font transfer chain still exceeds budget, that weighs against **protocol queueing as the primary remaining bottleneck**. A continued failure then directs product work back toward the resource dependency/transfer path while preserving all glyphs and image/visual requirements. These are interpretation rules for the coming experiment, not results or new acceptance thresholds. Production CDN, RUM, full language coverage and all existing performance/manual gates remain unverified by this bounded local study.

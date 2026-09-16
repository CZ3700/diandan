# Fixture age / mutation 条件只读核对

结论：新诊断环境健康尚不能覆盖原环境的请求历史与存活时间；但现有源码和旧样本也不支持直接判定“发布证明到期”或“UI 回滚残留”是根因。原两次内容失败仍有效，未解释。本次只读源码与已有 JSON，未启动 Chrome、构建或修改源文件。

## 已核实时间与状态

时间均为 UTC；run 目录时刻代表 fixture 启动，不代表每条内容的实际 publishedAt。

| 事件 | 时刻 | 可核实事实 |
| --- | --- | --- |
| 原 fixture 启动 | 06:56:33.163 | `run-2026-09-16T06-56-33-163Z` |
| 原 protocol 完成 | 07:01:12.807 | PASS；279642ms |
| 原 UI visibility | 07:32:09.927–07:32:55.142 | 真正 PUBLISH / ROLLBACK 均 PASS，分别10856/10858ms |
| 原 attempt3 中文首页失败 | 07:40:22.249 | LHR `storefront-content.score=0`，匹配URL/locale，但 contentVisible=false、errorVisible=true；fixture 已运行43m49s |
| 原 attempt4 同一中文首页成功 | 07:50:01.110 | LHR同审计score=1，contentVisible=true、errorVisible=false，比前次失败更晚9m39s |
| 原 attempt4 日语同一艺人成功 | 07:53:06.522 | `ja-artist-mobile-1` score=1 |
| 原 attempt4 日语同一艺人失败 | 07:53:12.680 | `ja-artist-mobile-2` score=0，仅相隔6.158s；fixture 已运行56m39s |
| 新 fixture 启动 / protocol 完成 | 08:15:50.568 / 08:20:53.683 | protocol PASS；303113ms |
| 新诊断 LHR 已落盘范围 | 08:21:47.988–08:24:38.654 | 27份样本均`storefront-content.score=1`；从fixture启动约5m57s–8m48s |

证据：原 run 的 `protocol-results.json`、`browser-attempt-2/publication-visibility.json`、attempt3/4 `performance/{zh-CN-home-mobile-1,ja-artist-mobile-1,ja-artist-mobile-2}.json`；新 run `protocol-results.json`；本轮 `diagnostic-trace/attempt-2026-09-16T08-21-29.460Z-32df9e34/*.json`。新诊断有额外 schema 校验及同步日志开销，不能作为正式性能预算比较。

## 假设与可证伪边界

1. **通用分钟 TTL 导致公开证明过期：未找到对应读取条件，且不能单独解释晚些时候自行恢复。** `published-content-repository.ts:78–160` 检查当前 head、proof_version、manifest/receipt、媒体证明；`content/publication-manifest.ts:130–199` 校验不可变材料与当前媒体资格，没有“发布后 N 分钟失效”分支。`content/published-content.ts:27–130` 约束发布/生命周期/当前指针与评估时间，无基于年龄的上限。fixture 价格 `gift-storefront-fixtures.mjs:369–386` 使用过去 validFrom 和 `validUntil:null`；policy只有过去已生效的起点（535–562）。管理员 session 是7200秒（`storefront-content-client.mjs:35`），旧两次失败均早于两小时，公开读取也不依赖该session。不能把上传授权或管理会话有效期当作公开内容有效期。

2. **时间倒序：仍缺失败时的实际上下文，不能据年龄推出。** 旧proof v2读取走 `publication-preflight-repository.ts:104–136` 的 GREATEST(clock_timestamp, transaction_timestamp, snapshot/lifecycle/审批时间/head.updated_at)；公开校验会拒绝 publishedAt 晚于 evaluatedAt。该保护削弱简单“同瞬间倒序”解释，但失败时未保存 proof_version、比较结果或SQL错误，所以不能声称已穷尽排除时钟异常。需要失败时的安全比较枚举/阶段记录，而非根据LHR时间猜测。

3. **新环境并非没有发布/回滚或媒体状态变更。** 两次 `protocol-results.json` 都通过 `normal-publish-rollback-invalidate-cursor-and-lastmod` 和 `normal-rights-expiry-fails-proof-closed-and-restores`。`storefront-acceptance-seo.mjs:207–370` 使用独立临时艺人做发布/回滚/改名/归档；373–411还会将首个艺人的HERO_DESKTOP媒体标为EXPIRED，随后在finally恢复APPROVED并验证完整目录恢复。这些已在新环境执行。新环境截至本次读取没有重放的是额外 **UI visibility 对第120艺人的发布/回滚与88项UI请求历史**，以及约44–57分钟的存活/空闲/连接复用历史。

4. **UI额外回滚存在真实持久差异，但不是直接改了失败艺人。** `storefront-acceptance-visibility.mjs:79` 选择`artists.at(-1)`，复制内容改名再回滚原revision（385–475）。回滚保留新的publication/head version/审计与SUPERSEDED历史，绝非把数据库还原为从未发生变更。原两次失败关联首页及首个`mira-vale`：首页hero来自`artists[0]`（`storefront-acceptance-fixtures.mjs:99–105`），初始前三艺人见`gift-storefront-fixtures.mjs:59–65`。第120艺人不直接作为首屏hero；它与其它艺人仍可能共享已发布媒体，故不能据对象不同完全排除间接影响。现有visibility报告表明变更当时七语API/HTML/XML均已恢复，但没有失败瞬间的head/manifest/共享媒体状态证据。

5. **测试故障注入残留：已见清理逻辑，没有残留证据。** matrix `564–574` 的故障只针对gift路径，finally `630–633` 清除proxy/media开关并关闭浏览器context；页面图片route在该context内。两次失败发生在其后新Lighthouse导航，且后续同页再次成功，不符合一个始终开启的固定故障开关。不能把源码finally等同于对失败瞬间状态的实测，但当前没有支持残留的观测。

6. **后台任务：此fixture未启动常规通知/商务过期/purge调度。** `storefront-acceptance-runtime.mjs:175–189` 只启动图片worker，覆盖schedule为无操作；`storefront-media-fixtures.mjs:295–304` 在seed期间显式runOnce直到SUCCEEDED。publication composition仅建立用例/池生命周期，没有purge worker；visibility证据也明确`manuallyRunPurgeWorker:false`。据此不能把一个未在fixture启动的定时过期任务列为既定原因。进程/连接空闲、外部资源错误仍需实际失败时诊断才能确认。

## 下一次观测如何证伪

保持现有失败文件；在带诊断的同一个新fixture上依次记录：当前健康基线、原UI visibility及矩阵之后、与原环境相近的存活时间及请求/暂停历史之后。按阶段保存新文件，不覆盖原FAIL，也不要以等候或重试成功充当修复。额外UI修改和年龄应分别比较，避免同时改变多个条件后归因。

当前仪器能区分 LOAD_RETURN / LOAD_THROW / WORK_RETURN / TX_THROW / 网关JSON/schema/transport；gateway与事务按请求开始阶段保留，API只声称COMPLETION_ONLY。若再次失败，先根据observedAt与LHR fetchTime定位：LOAD失败指向持久层/证明组装，LOAD成功但WORK失败指向投影/合同边界，API成功但网关transport失败指向连接，网关成功且内容仍错误才继续SSR响应边界。原环境没有这些逐次诊断，因此新环境全健康既不能解释原两次失败，也不能声明相同条件已经覆盖。

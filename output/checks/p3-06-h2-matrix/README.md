# P3-06 完整七语言 H2 实验室验收

基线 `bfe259a2f96220f709978db88ac7ef377537f51c`；2026-09-21；仅本地检查点。产品源码、字体、图片、浏览器参数与预算均未改变。

## 已完成的性能证据

原 `verifyAcceptancePerformance` 完整执行：84 次资源导航（七语、六类页面、390×844 与 1440×900），随后移动端首页/艺人详情/礼物详情各三次，合计 63 份 Lighthouse 13.4.1 JSON + 63 HTML，21 个原聚合全部 PASS。无重试、替换样本或额外预热，TEST 读取诊断关闭；原共享服务/图像优化缓存可能已被资源采集温热。

- 各组 LCP 中位数 **1805.2408–2255.7256 ms**，性能分数中位 **0.98–1.00**，CLS 中位均 0；门保持 score ≥0.9、LCP <2500 ms、CLS <0.1。
- 最慢单次 LCP **4357.5634 ms** 原样保留；分组门使用三次中位数，不宣称所有单次都小于 2.5 秒或之前呈现等待根因已消失。
- 图片 SHOULD 预算全部满足；84 页 JS gzip **150027–155368 B**，仍略超 150000 B 建议值（0.018%–3.579%）。这是待 P6-03 继续优化的建议项，未把它改成通过或改动原门。
- viewer 记录 3356 次实际 H2/ALPN 请求，3355 个完整响应；1 个 `/_next/image` 为 `CLIENT_ABORTED`、0 字节，代理内部终结状态为502，不代表浏览器收到502。该请求在 es-home-mobile-2 测量网络记录外、后续取证/关闭时段，缺少query/requestId无法确认具体图片或initiator；原件保留，不声称全部传输成功。84 次资源采集无资源失败；原 Lighthouse 无 warning，全部同导航内容检查通过。
- viewer 最终 closed，active/overflow 都为 0。原 fixture 正常退出，784.371 秒、exit 0；实际 PostgreSQL/TLS S3/媒体 worker 的原协议检查保留在该 run 的 `protocol-results.json`。

原件目录：`output/checks/p3-06-storefront-acceptance/run-2026-09-21T16-34-50-464Z/`。`matrix-summary-final.json` 逐项重新验证 fixture 目标、完整 viewport、63 次文件名/次序、原配置/内容/warnings、原聚合、viewer 归属和完成状态，保存 153 份原件长度/SHA。摘要验证通过与实验室门通过分开记录；失败传输仍在列表中。

H2 viewer 只改变本地浏览器入口，原上游为 HTTP，沿用原 TEST SPKI 豁免。不是已部署 CloudFront、系统可信 TLS、生产 SEO、RUM、真实用户 p75、手机或读屏证据。合成测试照片不替代正式素材验收。

## 无障碍与操作文档

`filter-probe-plan.md` 将前次 30 条 axe incomplete 分成：28 条/532 个被轨道裁切的固底文字节点、1 个手机弹层对比度节点、1 条背景与焦点哨兵记录。目录节点复核采用历史实际浏览器样本、当前相同 CSS SHA 与实际数学对比度，不篡改原 incomplete。

实际补证 `run-2026-09-21T16-49-18-618Z/browser-attempt-1/filter-probe-176253d2-9ff4-4356-a361-a1dfeaf0ec69/` 已通过：127检查、2PNG、0axe违规/0页面错误，原2incomplete保留。当前target精确定位为说明段落，实际固底对比度 **7.7158717:1**，9点无遮挡；原12Tab+24Tab/24ShiftTab共60键盘步骤、5次已识别哨兵在原500ms内恢复、Escape回触发器及背景隐藏/恢复均通过。root查看新截图，`verify-filter.py` 独立核对当前/历史原件与CSS SHA，结果见 `filter-summary.json`；这只是技术复核，不代签真实读屏或运营人员操作。

`docs/operations/storefront-acceptance.md` 已按当前单一管理中心修正真人操作入口及原文发布规则：3/5/8 分钟目标不变，自动回归与真人计时分开，旧多角色/七语导入流程只作为历史工具保留。

## 可重复入口

```sh
python3 output/checks/p3-06-h2-matrix/run-check.py matrix mise exec node@24.20.0 -- node output/checks/p3-06-h2-matrix/run-matrix.mjs
python3 output/checks/p3-06-h2-matrix/run-check.py matrix-verification-final mise exec node@24.20.0 -- node output/checks/p3-06-h2-matrix/verify-matrix.mjs output/checks/p3-06-storefront-acceptance/run-2026-09-21T16-34-50-464Z/browser-attempt-1 output/checks/p3-06-h2-matrix/matrix-summary-final.json
python3 output/checks/p3-06-h2-matrix/run-check.py filter-probe mise exec node@24.20.0 -- node output/checks/p3-06-h2-matrix/run-filter-probe.mjs
```

重新采集时必须用新检查点目录/命令名称保留旧结果；性能与构建、其他浏览器或压力测试串行。这里只记录已执行原命令，不建议为获得更好分数重复采样。

## 剩余任务

P3-06 仍 IN_PROGRESS，保留真人运营、读屏、当前真机、关键译审/正式图片验收。P4-04 保留真实 PSP/商户资料与实际接入。总计 29 DONE / 2 IN_PROGRESS / 18 PENDING，不以本地性能通过伪造阶段完成。

`docs/plan/remaining-delivery.md` 准确列出余下20项及外部证据，扩大本地开发排期仍是待用户确认提案。`p5-04-readiness-review.md` 已完成只读准备，指出可复用路由/能力/PG约束及真实缺口；未领取或实现受原门限制的 P5-04。

最终质量门、独立复核、S.U.P.E.R、源码/旧未跟踪保护、资源清理与本地提交结果以 `final-verification.json` 和 phase 执行卡为准。不推送、不部署。

本地提交仅收录本检查点工具、摘要、复核文档和选择的原始元数据/补证截图。全部63份Lighthouse JSON/HTML原件仍保留在上述本机run目录，153份SHA清单可复核；没有把既有5587个未跟踪文件加入提交，也没有删除或覆盖旧失败。

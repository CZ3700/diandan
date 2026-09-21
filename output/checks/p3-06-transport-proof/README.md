# P3-06 传输与字体主要耗时核验

本检查点完成固定12次同构建对照与原件核验；**原fixture与整批传输门仍FAIL，不是P3-06验收通过**。后续字体修改属于独立的 `../p3-06-font-range/` 检查点。

## 结果

| 固定组 | 协议 | 三次LCP中位ms | 本组LCP预算 | 入LCP图字体数 |
| --- | --- | ---: | --- | --- |
| h1-a | HTTPS/H1.1 | 2776.9867 | 失败 | 9 / 0 / 0 |
| h2-a | HTTPS/H2 | 2255.7439 | 通过 | 0 / 0 / 0 |
| h2-b | HTTPS/H2 | 2255.2436 | 通过 | 0 / 0 / 0 |
| h1-b | HTTPS/H1.1 | 2868.2760 | 失败 | 3 / 0 / 0 |

H2六次分数0.98–0.99、CLS0、LCP均低于2500ms。所有12次实际仍下载同9字体；H2样本字体在实际LCP截止之后完成，因而未进入官方LCP图。这不能证明字体问题解决，也不能把整段数值变化都归功于协议。服务器/图像缓存可能变暖，h2-b第3次图还少一脚本/CPU节点。精确逐样本和链路分析见 `transport-findings.md`；完整旧失败保留。

首组请求26/27在原导航测量窗口之后被取消，实体0字节，触发运行器“每条请求都完整”的额外断言。因此fixture366.160秒exit1、reader exit1原样保留。它们不在原CDP/trace，不能反向改写已经留存的LCP图；也不能确定具体辅助采集动作或排除后续缓存影响。详见 `aborted-request-audit.md`。没有重采或替换任何样本。

## 核验与边界

- 原真实PostgreSQL/TLS S3/worker协议32,461断言通过。四组共12次原导航、108原文件（157,855,983B）SHA/长度核验、同导航内容/原native读取0+1、原配置一致、24个官方FCP/LCP重放误差0。四份原API发布响应与fixture manifest字节相同。
- 同viewer origin、证书、Next generation1/BUILD_ID；Node显式TEST CA/主机名/ALPN证明，CDP实际HTTP协议与group一致。Chrome使用原精确SPKI测试例外，不修改系统信任，不冒称系统可信浏览器TLS、CDN/staging/SEO证明。
- 324条服务器记录逐组绑定最终快照；closed=true、active=0、overflow=0。排除且逐条列明上述2取消后，22个静态路径的完整GET200实体SHA/长度/编码集合四组相同；见 `successful-entity-comparison.json`。这是成功响应子集，不是完整传输门；代理未记录query，不能声称图片query与实体逐一配对。HTML原字节/编码实体在12次亦一致。
- 2348输入文件在采集前后SHA不变，见 `source-frozen.json` / `source-after-capture.json`；fixture按原流程重新构建后组内BUILD_ID不变，不能把fixture前的旧BUILD_ID当作采样构建。新增代理仅用于TEST；此批生产内容/样式/字体/图像/预算未改。
- 新代理真实TLS/stream/abort/cleanup20tests通过，联合原采集/分析tests共41通过。check:dev最终exit0/24.160秒，types63/tests63/build36，缓存62/62/35；adapter/artifact通过。首次lint失败（reader URL导入及未使用变量）和失败日志保留并修正。
- `independent-review.md`局部ACCEPT工具与诚实归档，S.U.P.E.R1–9通过，第10完整退出未满足；不把fixture失败写成全绿。此批没有新UI或物理设备测试，不能冒充后续字体检查点的UI回归。全阶段性能/人工/真实商户门与29 DONE/2 IN_PROGRESS/18 PENDING保持。

## 复现入口

`plan.md`为预登记协议；`run-transport.mjs`运行真实同fixture固定H1/H2/H2/H1，每组3次；原件目录为 `output/checks/p3-06-storefront-acceptance/run-2026-09-21T15-45-06-322Z/`。各实际命令/时间/退出码在同名 `*-result.json`，全部失败日志保留。

```sh
FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS=1 mise exec node@24.20.0 -- node output/checks/p3-06-transport-proof/run-transport.mjs
mise exec node@24.20.0 -- node apps/api/scripts/storefront-gift-trace-analysis.mjs --input <original-group>/gift-render-trace --output <new-replay-directory>
mise exec node@24.20.0 -- node output/checks/p3-06-transport-proof/analyze-transport.mjs --manifest output/checks/p3-06-transport-proof/analysis-manifest.json --output output/checks/p3-06-transport-proof/<new-summary-name>.json
```

不要覆盖本批原件或已有summary；输出是诊断而非正式63次矩阵或真实用户p75。原5227未跟踪保护、暂存秘密扫描与本地提交收尾记录在下一字体检查点的最终验证中。仅本地，不push。

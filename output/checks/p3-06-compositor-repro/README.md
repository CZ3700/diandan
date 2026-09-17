# P3-06：固定十二次提交等待复现

本地基线 `a01cefe`，2026-09-17 UTC。继续 P3-06 / Lane D；本轮只增加一次性采集编排与证据，生产应用及既有采集工具没有修改。

## 本轮结论

同一真实 PostgreSQL / TLS S3 / worker / Next 构建固定四组、每组三次中文礼物页导航，十二次全部留档，未额外预热或优选补采。**G1-1 复现了 975.560ms 的激活后至提交前等待；问题尚未修复。**其余十一份在最终 LCP 前扫描到的目标 renderer 已激活帧没有超过500ms的同阶段等待。

这次慢帧对应首次文字 FCP，最终图片 LCP 在后一帧。前一笔 renderer pending submit 已于346.449ms随ACK结束，慢帧373.422ms激活后至1348.982ms提交期间没有持续待ACK记录。因此本样本反驳了“renderer被前一帧待ACK持续占用”的解释。真实 BeginImplFrame 从331.708ms跳到1348.571ms，需求期间保持开启；这把调查缩窄到帧调度交付链，尚不能据此宣布浏览器、OS、测试环境或应用的最终责任。

详见 `trace-audit.md` 与 `trace-audit.compact.json`。这些是诊断结论，不是性能修复或新的正式验收。

## 预算与证据范围

| 组 | 实际LCP，ms（按采样顺序） | 模拟LCP中位数，ms | 原预算 |
| --- | --- | ---: | --- |
| 1 | 1367.335 / 264.561 / 309.271 | 2572.0995 | FAILED |
| 2 | 329.615 / 399.061 / 300.267 | 2629.8720 | FAILED |
| 3 | 259.817 / 274.474 / 271.261 | 4061.5365 | FAILED |
| 4 | 264.009 / 348.652 / 345.656 | 2629.1330 | FAILED |

全部108原始文件SHA/长度、十二份同导航内容、配置和0+1成功读取由非作者复核。四组使用同一构建、每组独立Chrome，服务/图像缓存可能随顺序变化；扩展追踪有额外开销，不能与旧默认profile作性能收益对照。官方Lighthouse离线复算12份报告、24个FCP/LCP值全部相等，最大差0。四组预算均未通过，外层 `COLLECTED_DIAGNOSTIC` 只表示预定采集完成。

`budget-audit.md` 同时审计了上轮三个无长等待样本：字体、框架脚本和图片分别进入不同模型截止。仅保留CSS内联为一个可证伪候选，但因样式体积、SSR/RSC重复与跨页缓存代价，现有证据不足以建议生产启用；本轮没有改字体、图片质量或框架代码。

## 复跑与定位入口

采集命令（会新建真实TEST环境与新的输出目录）：

```sh
FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS=1 mise exec node@24.20.0 -- node output/checks/p3-06-compositor-repro/run-diagnostic.mjs
```

本轮真实产物根：`output/checks/p3-06-storefront-acceptance/run-2026-09-17T16-33-58-576Z/`。四组在 `compositor-group-{1..4}/gift-render-trace`，编排总记录在 `browser-attempt-1/reproduction-groups.json`。原始大文件保留在本机，本检查点只提交精简证据和复跑入口。

官方重放命令（每次需要不存在的输出子目录；父目录必须已存在）：

```sh
mise exec node@24.20.0 -- node apps/api/scripts/storefront-gift-trace-analysis.mjs --input <capture-group>/gift-render-trace --output <new-analysis-directory>
```

首个离线命令因父目录未创建而ENOENT退出，原日志/结果保留为 `analysis-group-1.log` / `analysis-group-1-result.json`；创建父目录后四组顺序重放全部通过。该失败发生在读取capture之前，没有修改或重采任何导航。完整离线大图仅本机保留，四份 `trace-analysis/group-*/results.json` 提交作为指标核对证据。

## 验证与保护

- 真实fixture正常退出0，402.135秒；32,461协议断言通过，十二次采集完整完成。
- 离线提取复跑结果除生成时间外完全一致：12份、64个阶段、23条含显式Activation、1条>500ms；本组一次性脚本及验证结果一并保留。
- 相关采集/重放工具测试25/25；全仓 `check:dev` exit0，15.854秒，类型62/62、测试62/62、构建36/36均复用缓存。另有真实fixture本轮构建及实际执行，不将缓存结果冒充冷跑。
- adapter边界与构建产物检查exit0；最终源码/秘密扫描/独立评审结果见 `final-verification.json`。
- 2,229项实现输入保持SHA `b9d3fb5b842c6a6ac028018a0063e3bd0fcfa45fa30553e776b6c83342f9cf7c`；4,479个原未跟踪文件逐SHA保持。`source-binding.json`、`protection.json`提供重建入口与结果。
- fixture使用 `serve:false` 自动清理；`cleanup.json`复核实际记录的Next和四个Chrome端口均无监听，没有对旧PID发送信号。

本轮未重跑完整 `pnpm check`、七语言双端UI、正式63次性能矩阵、RUM、真机/读屏/真人运营/译审或真实PSP。生产实现未变，本轮没有新增页面功能，也没有解除这些门禁。

## 后续边界

停止本轮随机补采。优先沿已捕获慢导航的renderer→Viz显式flow、FrameSink及BeginFrame来源验证调度决策；无法从现有事件绑定的原因必须保留为假设，再设计单变量的有界复现。不能通过关闭浏览器限流、降低图片质量或放宽预算把诊断伪装成性能通过。

P3-06仍IN_PROGRESS，27 DONE / 2 IN_PROGRESS / 20 PENDING（49）保持，Phase5继续LOCKED；仅本地检查点，不push/merge/部署。

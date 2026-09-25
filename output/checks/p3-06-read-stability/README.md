# P3-06 读取稳定性续验

2026-09-16，从本地 `995d1c5` 接续，root 继续 Lane D。P3-06 仍 IN_PROGRESS，27 DONE / 2 IN_PROGRESS / 20 PENDING；仅本地开发和提交。

## 本轮范围

1. 复现并修正 TEST gateway 的 HTTP 逐跳响应头转发。原网关将上游 `keep-alive: timeout=72` 转发给 Next，而本机 Node 24.20.0 默认 socket 约 6003ms 关闭。原真实 HTTP 失败测试保留，修复让 Node 按自身连接策略声明。41 次自然边界探针没有捕获 reset，**此项不等于旧内容错误根因已确认**。
2. 补齐默认关闭、仅由 owned TEST Next 启动的 Undici 下游诊断，观察首页/艺人实际 fetch；不修改请求/响应、重试、业务守卫或时间预算。
3. 对照保留 trace：中文礼物存在绘制完成后约1秒才呈现的帧空档；英文模拟终点依赖共享 JS。没有证据支持猜测性 CSS/字体补丁，见 [只读报告](render-delay-review.md)。

## 协议依据

核验日期 2026-09-16：[RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1) 要求中介移除 Connection 及其指定字段；[Node 24 HTTP](https://nodejs.org/download/release/latest-v24.x/docs/api/http.html#serverkeepalivetimeout) 说明自身保活时间与缓冲。具体本机值由真实 Node 24.20.0 探针证明，不依靠文档推断。

## 验证与保护

- [开始未跟踪文件](initial-untracked.json)：3386 项逐 SHA 保留，不暂存旧文件。
- [旧源码冻结](baseline-source.json)：2203 输入与 `995d1c5` 工作区全部一致。
- [旧网关实际关闭](gateway-keepalive-actual-close.json)、[自然边界探针](gateway-keepalive-boundary-probe.json)、[RED/GREEN](gateway-headers-result.json)。
- [现有诊断覆盖](diagnostics-review.md)：成功计数和错误阶段不能代替逐请求关联，礼物首屏并非该 observer 的完整覆盖范围。
- [基线 fixture](baseline-fixture.json)：新建真实 PostgreSQL/TLS S3/媒体 worker，重演完整 UI 发布/回退历史；使用进程已加载的旧 gateway。性能诊断启用观测开销，不当作正式同条件验收。

最终命令、实际结果和未完成项在本轮结束时另存 `final-verification.json/md`。保留原始失败，不把后续成功补进失败样本，不把自动化当真人、真机或生产证据。

## 诊断复验入口

使用原 `preview:storefront-acceptance`，显式设置 `FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS=1` 才启用观察。不设置时维持原默认行为。若要一开始运行完整 UI，可在原命令末尾追加 `--ui`；随后只向该次日志明确打印的 `ownerPID` 发送 `SIGALRM`，运行独立的原性能 callback。

每次 callback 都重新构建并启动自有 Next 子进程，所以 UI 与性能分别拥有独立观察窗口。`next-runtime-N.log` 中的 `STOREFRONT_TEST_FETCH_DIAGNOSTIC` 固定 JSON 记录目标类别、阶段、时间与安全错误枚举。它不记录 URL、语言、handle、正文、header 或原始错误。

- 每进程最多 256 个匹配请求、768 条正常事件，超限输出一次 `TRUNCATED` 并停止订阅。截断后的零错误不能算稳定性证据。
- `HEADERS` / `COMPLETE` 仅代表原生 HTTP 阶段，须结合 API/persistence 诊断与同导航内容验证判断页面；同类并发请求不能仅凭相邻时间强行关联。
- 已有故障注入、原生 socket 断开和调用方取消用于验证诊断能力，不是旧自然故障的复现。原预算不变，不加重试。
- 观察存在成本，本目录带诊断的性能采样只用于调查。最终正式性能仍需关闭诊断、独立完整采集。

## 首个候选及整合修正

[candidate-source.json](candidate-source.json) 记录 2206 项输入，SHA `88601233cbe1fe16abfb5c8776627e5a7dd3a3f23289f21febe0f765494d4b1d`。相对 `995d1c5`，仅三个原 TEST/检查接线文件改变，新增三个 TEST 观察/测试文件；2200 个原输入相同。新测试已接入原 `test:postgres:storefront-acceptance`，不新增一套替代验收命令。

该候选真实协议通过但 Next 健康检查失败，不能算浏览器通过：两个新 `FAN_SUPPORT_*` 诊断环境键被现有严格配置白名单拒绝。失败见 [原整合失败](candidate-attempt-1-failure.json)。随后真实配置解析测试先 RED，再只把两个私有变量改成 `STOREFRONT_TEST_FETCH_DIAGNOSTICS` / `_ORIGIN`，部署 test 门和生产白名单保持；见 [修正 RED/GREEN](next-fetch-config-result.json)。修正后的输入单独保存为 [candidate-source-final.json](candidate-source-final.json)，原候选和原失败没有覆盖。

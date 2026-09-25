# 固定三次礼物 trace 工具

仅新增 `apps/api/scripts/storefront-gift-trace-comparison.mjs`、`storefront-gift-trace-verification.mjs` 与对应两个 Node 测试文件。未改生产读取、旧验收 runner、内容 gatherer、Chrome 参数或 Lighthouse 阈值。

## 执行

```sh
FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS=1 mise exec node@24.20.0 -- node apps/api/scripts/storefront-gift-trace-comparison.mjs
```

模式来自本目录 `mode.json`，严格只接受 `{ "schemaVersion": 1, "mode": "baseline" }` 或 `candidate`，不接受次数、fullMatrix 等配置。复用原真实 PG/TLS S3/worker/Next fixture 与协议门。每次 browser callback 固定中文礼物页三次 Lighthouse，无普通页面导航、额外浏览器预热或失败补采。后续同 fixture callback 按原 harness 的 SIGUSR1 机制触发，须先由 root 冻结相应源码和 mode；SIGTERM 清理自有 fixture。

每组在实际现有 public scoped API 只读一次当前发布响应并保存；这是组前点证明，不是逐导航 body 版本绑定。随后使用原 launcher flags 与原 Lighthouse 设置、同导航内容 gatherer。逐样本先写原始 LHR、Trace、DevtoolsLog、完整 artifacts、MainDocumentContent、HTML 报告、配置与原生日志，再校验。固定三次全部保留，任一样本无效时组 FAIL，不能被成功样本替代。指标超预算以 COLLECTED_DIAGNOSTIC_BUDGET_FAILED 记录，不改阈值。

产物位于每次 fixture `browser-attempt-N/gift-render-trace/`；文件名为 `zh-CN-gift-mobile-{1,2,3}`。`results.json` 含原始文件 SHA/字节数、各次读取窗口与汇总。配置包含全部 LHR/artifacts settings、输入 options、Chrome flags、内容分类信息、INTERNAL_LANTERN_USE_TRACE 是否存在，并复制原内容配置源码；不设置该环境变量。

## 工具级验证

先 stub RED（真实 exit1），再11项 Node工具测试 GREEN，覆盖模式输入、固定三次、baseline 1+1/candidate 0+1、原始文件保留、内容失效、缺 trace/network、版本错误、runtime错误和抛出异常。最终限定四文件 Prettier、ESLint、Node tests 均 exit0；每条命令和实测耗时在 `trace-tools-*-result.json`，原日志对应保留。

实现代理未启动实际 PG、S3、Next、Chrome 或 Lighthouse；实际采集由 root 唯一执行。本轮独立只读代码审查未发现阻止采集的问题。完整 Chrome/RTT/CPU/throughput一致性仍须由实际报告核对；同导航 gatherer证明 URL/locale/可见内容与无错误，不证明所有子区域状态或完整 revision 绑定。工具与实验通过不构成完整性能门、物理手机或生产上线证据。

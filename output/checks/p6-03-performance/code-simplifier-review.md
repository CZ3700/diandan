# P6-03 code-simplifier 只读复核

结论：**无必要新增重构，不阻断 当前冻结候选。** 本轮未修改任何产品或工具源文件，未启动浏览器、构建或数据库负载；仅新增本报告。后续完整验收仍由主任务执行，本报告不替代运行证据。

采用 `/Users/mario/.codex/skills/code-simplifier/SKILL.md`：保持行为、接口、数据格式、时序和安全边界；优先清晰性，不能为了减少行数而合并职责。按主任务要求只读审指定产品入口、接收端、聚合和 CLI，没有重复已完成的性能/RUM 工具全审。

## 保留当前结构的理由

| 范围 | 复核意见 |
| --- | --- |
| `rum-client.ts` | `startRum` 隔离可测的采样、路径归属和 metric revision 状态，`startBrowserRum` 只绑定浏览器 API 与传输。`pageFamily` 的白名单 switch 使排除敏感页面的边界直观。把这些职责压入 React effect 或通用 callback 工具会降低可审查性。BFcache 创建新 key 时的 viewport 冻结与初始文档 context 有不同语义，两个 viewport 判断不值得抽象成新的公共层。 |
| `rum-intake.ts` | `readBody` 负责字节、UTF-8/JSON、时间与 reader 释放；`createRumIntake` 负责同源、内容类型、速率、并发及 sink。body deadline 与 sink deadline 的取消/占槽语义不同，不应合并为一个通用 timeout helper。`expired` 与 `releaseOnReturn` 是已验证竞态和资源所有权的显式状态，不应为缩行删除。stdout sink 绑定留在入口，使可替换 sink 与运行环境分开。 |
| `packages/observability/src/rum.ts` | sink schema 校验与聚合入口校验各自保护公开边界。`revisionValues` 与 `latest` 分别检测任意旧 revision 冲突和选择最终 revision；不是重复缓存，合并会恢复已修复的较低 revision 冲突遗漏。dedup identity 包含 navigationType，而分布 group key 有意不包含它；不应为了共用 key builder 而混淆两种身份。收到记录数与唯一 measurement 数保持分离，缺样本不能变成零值。 |
| `render-rum-dashboard.mjs` | `readRumLogs`、`renderRumDashboard`、`main` 分别承担有界读取、纯报告渲染和 CLI 文件所有权。普通 stdout 与损坏的明确 RUM 行分别处理是必要边界。HTML 使用经过 report schema 校验的数据、JSON escaping 与 textContent；引入模板框架或打包器只会增加本地离线工具的职责和依赖。 |
| 辅助入口 | `rum-bootstrap.tsx` 负责服务端启用及敏感入口判断，`rum-collector.tsx` 是薄 effect 绑定；`rum-runtime.mjs` 仅桥接 storefront 已声明依赖的公开导出。没有发现值得合并的空泛抽象。 |

## 非阻塞的可读性观察

1. 聚合器 `assessment` 有三层条件表达式，依次区分 local/automated、样本不足和预算结果。按 skill 的偏好，后续可把这段改为局部命名函数的显式 if/return。当前顺序明确，现有测试覆盖 LOCAL_ONLY / INSUFFICIENT / OVER_BUDGET 等语义；这属于小幅可读性整理，不是必须修复的问题。当前冻结版本不为此引入新的差异和重验。
2. 看板模板的内嵌 JavaScript 使用几行较长表达式，维护 filters/render 时不如多行排版直观。后续触及该模板时可以只格式化内嵌脚本，保持生成数据、DOM 行列、占位逻辑及交互不变。当前未发现混入业务聚合的职责错误；不建议此时拆文件、创建新渲染层或添加依赖。
3. 聚合器在 `revisionValues` 检查后，又在相同最新 revision 分支保留值冲突断言。前一检查已覆盖这一情形，后一个条件可以删减；但当前冗余很小且表达了局部不变量，删除不会带来实质结构收益。本轮保留，并未把“少一个条件”当成必要改进。

这些观察均为维护建议，不是已发现的功能缺陷、额外验收门或后续阶段的激活条件。

## 核对与限制

- 阅读指定实现、聚合/CLI 测试及薄接线入口，核对职责、重复判断和状态所有权。
- 最新 204 空响应消费补丁仍只处理 status 204，保留 keepalive / credentials omit / no-referrer / no-store 和统一 rejection 处理；本报告不提出传输语义修改。
- 此次只读审阅没有重复执行测试。此前受控真实 collector 回归与 36 项工具测试的结论保留在 `rum-lifecycle-tool-freeze.json`；它们不能替代 当前冻结候选 的完整 Next RUM 与正式性能矩阵。
- 不以“代码更短”或个人命名偏好要求改动；未发现需要新增重构的实质问题。

## 读取版本

| 文件 | SHA-256 |
| --- | --- |
| `apps/storefront/src/storefront/rum-client.ts` | `90d5f4e142acd735202e55dde0f969c386a77a3b0cf3284dc420bd1a938204fb` |
| `apps/storefront/src/server/rum-intake.ts` | `845545e1d7d951e312206cd20f3f4331ee50fad0a97015ac14eb953dba45cebf` |
| `packages/observability/src/rum.ts` | `72448d278c5c098ea97a575ddaf037f2539a83921925a13298263792cb165a09` |
| `packages/observability/src/rum.test.ts` | `c2662e0157a0d11166ba700e366a7241bab974a764c80d046661fe9d8c21ffef` |
| `scripts/render-rum-dashboard.mjs` | `61850e6a27f8df43aa8d248e2ced53715aa7e948655d63f52dd9489a6f0523c6` |
| `scripts/render-rum-dashboard.test.mjs` | `8ac7758bf4b5e7511eae0bc56b461de886b2fc202006da48c2bef17a47522033` |
| `apps/storefront/src/server/rum-bootstrap.tsx` | `d0ac5d79bb75089c26bd498fcadb83def75f6b09fa83d3ab0fffedaf6a7b0013` |
| `apps/storefront/src/storefront/rum-collector.tsx` | `5e5b3739dec282af822f3a37e0abb15df932b881389f9784ff1698e9901b9790` |
| `apps/storefront/scripts/rum-runtime.mjs` | `fa9cdac65ba81a60bd7523ab1004bac424ecd2569bf6d16075b32f804a4b4a7f` |

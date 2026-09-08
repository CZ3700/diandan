# P4-02 最终独立验收复核

结论：ACCEPT，本地 P4-02 范围内未发现需阻止检查点交付的缺陷。复核者为 `storefront_directory`；本次只读源码、命令、原始日志和结构化证据，并独立重算摘要，没有重跑 PG、构建或浏览器。合同／PG 是本代理的实现，已由其他代理非作者复核；Application 与 API/BFF 的非作者复核见本目录既有报告。

## 原始门的完整覆盖

直接读取当前根和 PG package scripts，与 `check-resume-1.json` 保存的三条原命令逐字比较，全部相同；后续命令数组亦逐项匹配，未删除、重排或放宽门禁。

| 证据 | 实际结果 |
| --- | --- |
| `check-full-2.json/log` | 原 `pnpm check` 351.162 秒 exit 1；前缀通过，在旧 resource-management 并发检查 96 条后遇 23514 |
| `resource-management-rerun.log` | 原脚本未改，129 assertions PASS；初次失败根因仍未确定，不称已修复 |
| `check-resume-1.json/log` 的 PG 组 | 从失败节点重新开始的全部 12 条原命令，45.763 秒 exit 0 |
| 同文件 API 组 | 剩余全部 14 条原 API 链，846.065 秒 exit 0；末 cart 协议 5924 assertions PASS |
| `check-quality-suffix-1.json/log` | 剩余全部 8 项，108.613 秒 exit 0：S3、worker 423 assertions、完整 Prettier 清单、lint、类型、测试、构建、最终 adapter / artifact 门 |

最终类型 60/60（56 cached）、测试 60/60（56 cached）、构建 35/35（33 cached），31 个 package exports 由 Node 实际导入。以上为原失败前缀加完整后缀覆盖，**不是一次原始整条 `pnpm check` exit 0，也不是全冷缓存运行**。

resume1 在质量组开始前因生成声明漂移停止，状态 STOPPED_AT_SOURCE_GUARD / exit 1；质量组当时没有启动，因此未发生预计的 PATH 127。后来使用 `pnpm exec sh -c` 恢复原 pnpm 本地 binary PATH，并从 S3 开始执行完整八项，没有跳过 S3。

## 同源和保留性

- 独立重读全部 1799 个冻结文件，逐个 SHA 与 `final-source-snapshot-3.json` 匹配；文件列表 JSON 聚合摘要精确为 `315b79316cff1cd681f16113d2e4d0dc3a54c2afff40913a46c7d5579dc4bdac`。root 的 `source-after-all-checks.json` 另记录集合无新增／缺失。
- snapshot1→2 仅两 CSS、两 WOFF2 和字体 manifest；2→3 仅 cart.css。原字体生成器、固定来源、OFL、fallback、测试阈值、设计扫描与 P2 collector/checker 均未修改。cart.css 使用既有 token。
- 运行中曾有一个已记录的例外：原 admin 集成启动 Next dev，把 `apps/admin/next-env.d.ts` 两条导入切换到 `.next/dev/types`。本代理核对暂态仅此两条，恢复后的 `1862ac4b…` SHA 精确匹配冻结值。原字节／差异保留于 `generated-declaration-restoration.json` 及其引用文件；不能称 1799 个输入全过程无漂移。
- P2-04 的 319 个、P2-05 的 645 个输入，独立逐 SHA 对比当前文件全部相同，采集 before / after 也相同。两套原 collector 分别通过；P2-05 保留 physical-device gate 和原 moderate / incomplete，未冒称零违规或真机完成。
- 新购物车 `run-2026-09-08T12-52-45.960Z/validation-summary.json` 绑定同一最终 source SHA；所指 browser report 的实际 SHA 匹配。16 cases、40 PNG 均存在、30 axe scans / 0 violations、14 incomplete、双端 20 Tab + 20 ShiftTab 与 44px 目标检查通过，wrapper exit 0、正常 finally 清理已有记录。旧字体前报告留作历史，不替换旧结果。
- 2260 个本轮开始前的未跟踪文件已由本代理实际逐个重算 SHA：changed / missing 均为空。0001–0023 的 46 份 SQL 与 23 个 manifest entry 也已独立对照 `c6ca6ba`，原字节不变。448 旧 schema 根与旧 OpenAPI 边界兼容结论见 `contract-persistence-review.md`。

## S.U.P.E.R 10 项

| 项 | 本任务范围结论 |
| --- | --- |
| 1 单一职责文件 | PASS：UI 状态、编辑器、API/BFF、Application、Port、PG 授权／写入分责 |
| 2 单一概念函数 | PASS：私密授权读取、KMS、再次确认和原子修改边界明确 |
| 3 单向依赖 | PASS：业务不依赖 HTTP / PG provider；最终 adapter 门通过 |
| 4 无新增循环 | PASS：工作区检查与最终类型／构建通过 |
| 5 schema 接口 | PASS：新命令、专用 editor DTO、回执、事件均严格版本化；旧根不变 |
| 6 可序列化 | PASS：跨模块 JSON；密文／Buffer 留在私密适配边界 |
| 7 配置隔离 | PASS：复用配置、Cookie 与 token 入口，无新增生产身份／密钥／市场硬编码 |
| 8 声明依赖 | PASS：无新增依赖或 lockfile 变动；字体生成复用原锁定开发工具 |
| 9 可替换部件 | PASS：独立事务／KMS 端口，固定 BFF 合同；旧 dispatcher 不误领新事件 |
| 10 验证覆盖 | PASS：原门逐项覆盖完成，缓存、原始失败和生成声明恢复均明确记录 |

接受范围是本地 TEST PG / API / TLS 对象存储、真实加密 adapter 接本地 TEST KMS 和 production 编译 Chrome 流程。独立编辑事件仍持久 PENDING，未来消费者尚未实现；本阶段直接读 PG，不伪造派发完成。AWS KMS 线上认证、生产 HTTPS / 发布、真机、读屏、人工翻译审批、P3 性能、订单／预占／支付不在本次通过范围。原资源并发 23514 未确定根因，保留为未定位的历史验证风险，未修改业务或时钟掩盖。

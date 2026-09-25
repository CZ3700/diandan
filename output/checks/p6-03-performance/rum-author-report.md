# P6-03 RUM 作者交接

2026-09-24。只覆盖 root 已领取 P6-03 的委派子范围；不改进度、不提交、不 push，不跑浏览器/Next build/负载。完整仓库与真实浏览器由 root 串行整合。

## 已实现

- `packages/contracts/src/rum.ts`：严格 versioned intake/observation/report；`rum-browser.ts` 只暴露常量和 erased types，避免客户端为 RUM 引入 runtime Zod。`artifact-registry.ts` 注册新3根；`rum-openapi.ts`/`artifact-documents.ts` 注册实际 `/api/storefront/rum`，不改既有业务合同语义。
- `packages/config/src/rum-config.ts`：默认 disabled、显式 local/field、field production 限制、bounded samplePermille；沿用 config-layers，不分散解析 env。config keys 和 server export 已接。
- `packages/observability/src/rum.ts`：可替换 stdout sink 及严格 receipt-window 聚合；最高 revision 去重、冲突拒绝、nearest-rank p75、来源/locale/page/viewport/自动化/采样分组；无访客或业务数据，汇总无 measurementKey。
- Storefront 独立 bootstrap/collector/client/intake 和 route：默认不渲染 client 引用，不载 web-vitals；order-access 不挂 collector；公开路径先分类再注册官方 observer，每文档固定采样与一次订阅。标准硬文档归属，soft-route 漂移的 BFCache 恢复不采，防止错页；同路径 BFCache 新 metric/key，本 key 内 context 冻结。
- 客户端只 fetch 同源，credentials:omit、no-referrer、keepalive；不发送原URL/query/hash、entries/DOM、原metric.id、业务/会话/访客ID或PII。measurementKey 随机且仅该 metric 生命周期关联，raw sink 保留用于覆盖去重。
- Intake Origin/Fetch Metadata/content-type/严格body校验；2048字节stream限额、2秒body超时、600/minute/进程、16并发未决预算。sink 2秒超时503，不重复write，未决write占槽至真正settle，错误不回显payload。
- `scripts/render-rum-dashboard.mjs`/`apps/storefront/scripts/rum-runtime.mjs`：bounded streaming本地日志→JSON/HTML、locale/page/source/viewport筛选；空窗口与缺metric明确INSUFFICIENT，不补INP0，local/automated绝不当field；整个工具永不宣布fieldAcceptance=true。
- `docs/operations/rum.md`：启用、隐私、生命周期、限流/超时、运行参数及生产门。根 .env/package/锁/生成文件由root整合。

## 实际验证

最新独立命令原始记录：

| 范围 | 结果 | 证据 |
|---|---|---|
| 新合同 + OpenAPI | 2 PASS | `rum-contracts-final.txt` |
| Config全包 | 181 PASS | `rum-config-final-2.txt` |
| Observability全包 | 45 PASS | `rum-old-revision-green.txt` |
| Storefront RUM | 11 PASS | `rum-incomplete-stream-green.txt` |
| Dashboard/reader | 2 PASS | `rum-corrupt-log-green.txt` |
| Contracts/config/observability/storefront TypeScript | 四包exit0 | `rum-*-typecheck.txt` |
| 相关源码格式与ESLint | PASS；最后CLI修复重新format | `rum-format*.txt` / `rum-lint-final.txt` |

上述合计241个单测（不同最终包命令），不是整个仓库单测数。CLI最后corrupt-log修复、intake与旧revision冲突修复后均另行lint/types通过，仍需root统一最终build/浏览器；package/root合同生成与原业务兼容由root核对。

有效先RED→GREEN包含 contracts、config、OpenAPI、client、bootstrap、BFCache归属、sink timeout、损坏RUM日志。slow stream/cancel rejection、同源/有界入口、p75与隐私有实际通过断言。`rum-bfcache-red.txt`证明真实错归；`rum-sink-timeout-red.txt`是未设sink超时时pending不返回导致原5s测试FAIL，修复没有放宽阈值；`rum-corrupt-log-red.txt`证明原parser确实漏拒绝损坏JSON。

## 保留的过程偏差和失败

1. 初次合同/config tests 命令使用 pnpm exec，在manifest新增web-vitals后仓库自动安装触发了root lockfile变化，而非作者显式install。Root独立发现无关 Lighthouse传递 third-party-web 0.29.2→0.30.0，并仅恢复该段、保留 web-vitals6.2.2，随后offline frozen install。本文件不冒称作者严格未触及lockfile；后续全部直接node_modules/.bin命令，未再次普通install。初始安装输出保留 `rum-contract-green.txt`。
2. 聚合/intake第一轮RED命令的relative --config按--root错误解析，实际是工具启动失败；作者未及时检查已写实现。之后intake测试还发现一处括号语法错误。原 `rum-aggregation-red.txt`/`rum-intake-red.txt` 和早期green命名日志保留，**这些不是行为RED或PASS**。
3. 按root要求，在独立临时目录复制tests，使用aggregate空结果/sink空实现/intake无验证204的stubs，实际9个行为测试FAIL，临时目录已清理，产品源未改。`rum-post-implementation-counterexample.txt`明确标注 **实现后反证，不是历史测试先行**；不能逆改上述时序。
4. CLI first green尝试失败为Node require.resolve不支持import-only exports；改成storefront声明依赖的ESM桥接后通过。`rum-dashboard-green.txt`原FAIL保留，最终为green-2与corrupt-log-green。
5. root新增.env两配置后config原例子键清单首次FAIL，`rum-config-final.txt`保留。更新对应test清单后全181通过，不放宽“每键一次”校验。

## 余项/边界

- 非作者/root实际browser需要验证真实PerformanceObserver回调→HTTP→stdout→CLI→可见dashboard、defaultdisabled/no extra chunks、order-access禁采和自动化分组，不把unit stub或输入JSON当真实INP。
- 真实field样本、窗口、代表性、隐私/保留决策、生产exporter/边缘容量、云dashboard/告警触达仍未完成；P6-03不因此DONE。
- mode只由server追加，automation由browser自报；匿名公开入口无法证明人类流量。samplePermille是服务器当前配置，变更后须刷新观测页面并开新窗口，不声称统计无偏。
- API运行记录与业务事实未改；原用户实例未reset，作者无浏览器/网络业务写入。官方web-vitals/npm只读核实记录见 `rum-audit.md`。
- S.U.P.E.R 1–9 作者自查：模块职责与流向分明、序列化合同、公开依赖、配置注入、sink可替换；10本子范围通过，整仓/实际浏览器由root合并门确认。

## root 独立审读发现的两项已修缺陷

- 完整JSON chunk但stream一直不EOF：原timeout先cancel reader，cancel可先满足pending read导致误204。`rum-incomplete-stream-red.txt`实际204≠400；现先expired+reject，再cancel，并在race返回检查expired，11个前台RUM测试和lint/types通过，不延长2s预算。
- rev2先到，再来两个互相冲突的rev1：原latest-only会静默忽略这两个旧值。`rum-old-revision-red.txt`实际缺预期拒绝；现独立revisionValues在highest-revision选择前比对，输入100000条总界保持，全observability45及编译/types/lint通过。不是仅靠更改报告文案掩盖。

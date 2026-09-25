# P6-03 RUM 只读审计与最小接线方案

日期：2026-09-24（Asia/Bangkok）。审计基线 b7df3400；本文件是实现前调查，不声称真实用户性能达标。

## 当前事实

- `packages/observability/src/node.ts` 注册 W3C trace 与 request context，但 `NodeTracerProvider.spanProcessors` 为空；没有 metrics exporter、RUM sink、p75 聚合或 dashboard。
- `packages/observability/src/logging.ts` 是严格 allowlist 的服务运行日志，不能直接把 web-vitals 对象传入 logger。`fastify.ts` 使用 route template，适合沿用不记录原 URL 的原则。
- `apps/storefront/src/instrumentation.ts` 仅 Node runtime 初始化。`src/app/layout.tsx` 是可放独立客户端 collector 的现有根入口；避免将整个布局改为 client。
- `apps/storefront/src/server/request-origin.ts` 已处理反向代理下已配置的公网 origin 匹配。公开 intake 仍须自行校验 Origin/Fetch Metadata，helper 本身不授予授权。
- `packages/config/src/server-config.ts` 提供严格部署环境和站点 origin；`resolveConfigLayers` 支持四层配置。现有 `PublicRuntimeConfig` 的严格两字段合同不应为了 RUM 改宽，应新增独立 RUM 配置片段。
- `packages/contracts/src/artifact-registry.ts` 和现有 OpenAPI 生成器可注册新版本根；旧业务合同应逐值保持。
- `infra/opentofu/modules/operations/main.tf` 只有基础 CloudWatch CPU/task/ALB/RDS/预算等警报，无 RUM dashboard。没有理由因本地 RUM 接线扩成生产观测供应商或云 apply。
- Next 16.3.4 的本地 `dist/client/web-vitals.js` 包装 onCLS/onFCP/onLCP/onINP/onTTFB；其内嵌包版本未明确暴露。推荐独立锁定官方标准库，降低 Next 包装的版本/重复订阅不确定性。

## 当前主源核实

2026-09-24 查询 npm registry `/web-vitals/latest` 返回版本 **6.2.2**、Apache-2.0，无 runtime dependencies，发布 integrity `sha512-oto5x6dLEgrRqfcWed+pZEUb2q6ikbFmqF54CRDhI/QGbn+qxC49b4C4OkbH+kb9C3a8shpFD3SgR9kRcs80ZQ==`。官方同 tag 类型已核对。

- [GoogleChrome 官方包清单](https://raw.githubusercontent.com/GoogleChrome/web-vitals/main/package.json)
- [6.2.2 Metric 类型](https://raw.githubusercontent.com/GoogleChrome/web-vitals/v6.2.2/src/types/base.ts)
- [官方使用与生命周期说明](https://github.com/GoogleChrome/web-vitals)
- [Next 独立 client collector 文档](https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals)

标准 onLCP/onINP/onCLS 直接测浏览器指标，不用 TBT 或最大单次事件冒充 INP。默认 hard navigation/BFCache 语义；不启用 reportSoftNavs。未交互的访问没有 INP，不能填零。CLS/INP 可在多次 hidden 后报告，BFCache 会产生新 metric；因此必须使用每个 metric 的匿名短期 measurement key 和单调 revision 覆盖，而不能将每条回调计为新访问。原 `metric.id`、`navigationURL`、entries/DOM/attribution 不发送。SPA 后续页面不伪装为新的硬导航样本，dashboard 明确文档生命周期范围。

## 最小闭环

1. 独立 `RumCollector` 只订阅一次官方 standard bundle。当前公开路线在本地映射到低基数 page family 与规范 locale；不存原 URL/query/hash。order-access 交换页和内部/后台/非法路由禁采。只用随机采样，不写 cookie/localStorage/visitor ID。
2. 同源 `/api/storefront/rum` POST：严格 schema、有限 body streaming、固定 content type、Origin 与 Fetch Metadata、私有 no-store、无响应数据，跨源/多余字段/负数或不合理数值拒绝；不读取/转发 Cookie、IP 或 Referrer。匿名全进程有限速率只是额外预算，生产 WAF 限流仍有原部署门。
3. application 形态的 intake 调用可替换 observation sink；本地 sink 只写严格 RUM record 到 stdout。采集 mode、receivedAt 由服务器配置/时钟追加，客户端不能自报 field。
4. CLI 从本地日志导出严格 observation，按最高 revision 去重。原 raw stdout 仅为有界保留的匿名测量记录；结果 JSON/独立 HTML 不暴露 measurement key，按来源、locale、page、viewport、metric 列出 count、window、nearest-rank p75 和阈值。
5. local/test/automated 永不视为 field；缺样本显示 INSUFFICIENT。服务器 field 配置也不证明流量来自真人；浏览器 automation 仅为自报筛除信号，field 后续仍需实际用户窗口和运营审查。受控浏览器验证仅证明接线。

## 合同/依赖与文件建议

- 新增 `packages/contracts/src/rum.ts`：版本化严格 intake、server observation、report schemas，独立 `/rum` export，唯一复用 SupportedLocale。
- 新增 `packages/config/src/rum-config.ts`：默认 disabled；local/field 显式配置，field 仅 production；配置错误不反射输入。独立 server export。
- 新增 `packages/observability/src/rum-*.ts`：sink、聚合、隐私安全 route classification/metric projection（browser 单独 subpath，不能携带 Node/OTel）。不改变旧运行日志 schema。
- 新增 `apps/storefront/src/storefront/rum-collector.tsx` 与 server intake；根布局仅挂载 null collector。新增 BFF route，复用 origin helper。
- 新增 `scripts/render-rum-dashboard.mjs` 及测试、`docs/operations/performance.md` 运行说明。技术 dashboard 不进入简单日常管理中心，也不暴露公开 GET 查询。
- 只增加精确 `web-vitals:6.2.2` storefront dependency。根 lockfile/root scripts/生成 registry 由协调者串行整合，避免并写。

## 失败测试与验收建议

合同拒绝原 URL/业务 ID/entries/未知字段、无限/NaN/负值、非法 locale/navigation、过大 body；server 配置和来源不可伪造、跨源拒绝、响应 no-store/无 Cookie、disabled 无采集。客户端重复 mount 不重复 observer，BFCache 新 key、same metric revision，SPA 仍归原文档而不误归当前页，自动化/local 模式分离，传输网络失败不干扰操作且不存待重放私人数据。聚合 out-of-order/replay/conflict、INP 缺失不补零、p75 边界和样本窗口、HTML escaping、无 key 输出应先 RED 后 GREEN。

实际浏览器由 root 统一在轻量测试完成后串行运行：使用真实 browser PerformanceObserver 回调进入同源 intake/stdout/报告，核对所有原始值，不用手写回调冒充性能；覆盖滚动、输入、hide/restore、七语路由分类及 order-access 禁采。再合并 format/lint/typecheck/build 与性能预算。生产用户样本、云 exporter、告警触达、真实用户 p75 达标保留为后续原门。

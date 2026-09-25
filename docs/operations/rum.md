# Storefront RUM 接线与本地性能看板

这套接线使用锁定的 `web-vitals 6.2.2` 标准库采集浏览器 LCP、INP、CLS，经同源严格接口写入 stdout，再离线生成匿名汇总看板。默认关闭。它不新增日常管理中心步骤，也不依赖外部分析服务或修改业务数据库。

## 启用范围

配置通过 `packages/config` 的独立片段校验，遵循已有四层优先级：

```dotenv
FAN_SUPPORT_RUM_MODE=disabled
FAN_SUPPORT_RUM_SAMPLE_PERMILLE=1000
```

- `disabled`：不挂载 collector、不下载独立 web-vitals 实现、不发送 RUM 请求；POST 接口返回 404。共享客户端 chunk 仍携带 collector 包装代码：最终 candidate-5 与基线同页面对照多 1042 B gzip（旧 candidate-2 为 1009 B），因此关闭不等于首屏脚本成本为零。这个差值只描述这两份实际构建，后续版本须重新测量。 最终七语双端首页启用后由 153435 B 增至 156684 B，额外 3249 B 恰为独立 web-vitals 实现；这是实际响应字节比较，不是速度A/B。
- `local`：只允许 development/test/preview/staging，供本地或受控环境验证。
- `field`：仅 production 且必须显式配置。这个标签表示配置来源，**不证明流量来自真实用户，更不自动通过上线门**。
- 采样率为每千文档 0–1000，默认 1000。随机采样对同一文档固定，不写 Cookie/localStorage、不跟踪访客。0 与关闭具有相同传输行为。

启用或调整后重新启动服务并刷新观测页面；改变采样率时开启新的观测窗口。记录中的 samplePermille 是当前服务器配置，不能作为客户端入组概率经过认证的证明。生产启用前仍需确认观测与隐私运营决策、日志保留及采样方案；目前仅交付本地接线。

## 采集与隐私边界

仅发送规范 locale、低基数页面类别、mobile/desktop 视口桶、自动化自报标记、指标名/值/导航类型及临时随机 measurementKey/revision。measurementKey 只关联同一个指标的更新，没有跨指标或跨文档访客身份含义；BFCache 的新 metric 生成新 key。它只出现在受限原始观测日志，汇总 JSON/HTML 不输出。

不发送原 URL、query、fragment、商品/订单/艺人/会话 ID、IP、邮箱、姓名、留言、DOM、metric.entries、attribution、navigationURL 或库原 metric.id。客户端 fetch 使用 credentials:omit 与 referrerPolicy:no-referrer；接口不读取或转发 Cookie/Referrer/IP。token 交换页不挂载 collector，内部和未知路由不注册观察器。

标准库每文档只注册一次；普通 SPA 导航仍属于初始硬文档指标，不伪装成独立页面 LCP。BFCache 恢复时若当前 pathname 已偏离初始页面则不收该恢复指标，避免把页面 B 记成页面 A；相同路径恢复使用新 measurementKey 与本周期视口桶。进入敏感/未知页面后不发送回调。不支持或没有发生交互的访问可能没有 INP，**不得补零**。

接口 `/api/storefront/rum` 只接受同源 POST JSON；Origin 必须精确匹配配置，Sec-Fetch-Site 必须为 same-origin，代理公网头需由部署入口覆盖。body 不超过 2048 字节，即使无 Content-Length 也逐流限制；读取最长 2 秒。每进程最多每分钟 600 次入场、16 个处理中请求/未决写入；这是有界资源保护，生产边缘 WAF 与容量验收仍需完成。sink 失败或 2 秒未完成返回 503，超时写入继续占槽直到实际 settle，不重复提交，不假返回 204。所有响应为空、private/no-store，错误不回显输入或 sink 异常。

stdout sink 是可替换 port；生产采集器必须只接收已验证的 `performance.web_vital` 记录，并配置有限保留，不能把任意原始 HTTP body 写入观测平台。日志访问使用部署现有最小权限。本地输出不是永久业务真相源，也不作为支付或订单证据。

## 生成独立看板

先完成依赖包编译；工具通过 storefront 已声明依赖的公共 `/rum` exports 读取同一合同及聚合器。

```sh
node scripts/render-rum-dashboard.mjs \
  --input /absolute/path/to/storefront.log \
  --output /absolute/path/to/new-report-directory \
  --from 2026-09-24T00:00:00.000Z \
  --to 2026-09-25T00:00:00.000Z \
  --minimum-samples 100
```

可重复 `--input` 合并最多 32 个日志文件。输出为 v2 合同的 `rum-report.json` 和可直接打开、无需网络的 `rum-dashboard.html`。工具拒绝覆盖已有产物，流式读取累计最多 100 MiB、单行 65536 字符、100000 条有效观测；超限按有界时间片另建报告。非 RUM 普通日志忽略，声明为 RUM 但不符合合同的行会中止，错误不反射原行。

聚合以服务器接收时间 `[from,to)` 为窗口。同一 measurementKey 取最高 revision，重复/乱序不增加访问数。匿名上报不能作为可信标识来源：同 revision 不同值或身份维度变化时，v2 隔离该 key 在窗口内的全部记录，包括较新或随后到达的 revision；其他 key 仍可查看。报告 `integrity` 明确列出状态、隔离 key 数、隔离记录数和保留记录数，只输出计数，不输出原 key。只要存在冲突，整个窗口及所有行均为 `DEGRADED`，展示保留样本的 p75，但暂停预算判断；即使其他行样本足够也不能显示 `WITHIN_BUDGET`。全部记录被隔离时仍生成可读的降级空报告。损坏日志或非法 schema 属于不同错误，继续 fail-closed。

p75 使用 nearest-rank（排序后第 ceil(n×0.75) 项）；按 mode、automation、locale、page、viewport、采样配置、metric 独立分组。`receivedRecords = acceptedRecords + quarantinedRecords`；`acceptedRecords` 包括合法重复更新，`uniqueMeasurements` 和行样本数只计未隔离且去重后的观测。CLI 成功退出仅代表报告已生成，stdout 始终 `fieldAcceptance:false`，并显式打印完整性状态。`CLEAN` 只说明未发现 key 冲突，不能证明匿名样本真实或代表性。遇 `DEGRADED` 时保留受限原始日志、调查入口滥用/采集缺陷并建立新的完整观测窗口，不应删掉冲突行重做“通过”证据。

旧 `RumReport` v1 合同及 `aggregateRum` 保留历史解码与原冲突拒绝行为；新 CLI 使用 `RumReportV2` 和 `aggregateRumV2`。历史 v1 看板明确标记未报告隔离完整性，不能当作 v2 的 `CLEAN` 证据。

无冲突窗口中，实验室、本地和自动化流量为 LOCAL_ONLY。field 样本不足为 INSUFFICIENT；满足样本数时比较规范严格预算 LCP <2500 ms、INP <200 ms、CLS <0.1。污染窗口统一显示 DEGRADED，但原 mode/automation 来源保持，不会将本地数据升级为真实流量。WITHIN_BUDGET 只表示这个受限分组的数值比较，不是 Release Gate PASS。空窗口或缺某指标在看板明确标记 INSUFFICIENT；样本阈值由报告参数公开列出，不冒充统计置信度保证。真实用户分布、实际代表性和观测窗口仍须上线阶段取证。

## 复验入口

- `packages/contracts/src/rum*.test.ts`：严格字段及规范 OpenAPI。
- `packages/config/src/rum-config.test.ts`：默认关闭、配置层级与来源门。
- `packages/observability/src/rum*.test.ts`：v1兼容、v2冲突隔离、全部/空窗口、乱序与重复、p75、来源/样本门及 sink 失败。
- `apps/storefront/src/server/rum*.test.ts*`、`src/storefront/rum-client.test.ts`：同源/体积/超时/并发、禁采、一次订阅和 BFCache/SPA。
- `node --test scripts/render-rum-dashboard.test.mjs`：真实CLI污染窗口仍可查看正常样本、降级声明、损坏日志拒绝、本地文件边界与空窗口。
- 根 `verify:rum`：真实生产编译的自有 TEST 接线。使用独立 Chrome 默认上下文与真实切换标签页产生可信 hidden，保持被测文档、URL 和 timeOrigin 不变；要求三项真实库回调、隐私字段、完整 requestfinished 和实际同源 204、服务器记录逐条对应。客户端只消费成功 204 的空响应，失败不重试。敏感页面按相同生命周期观察完整 10 秒且 POST 尝试为零。自动化观察明确属于 local，不能替代 field p75。

针对本次浏览器问题的独立诊断入口（先完成依赖编译，输出目录必须是新的绝对路径）：

```sh
node apps/api/scripts/rum-browser-lifecycle-regression.mjs --output /absolute/path/to/new-lifecycle-report
node apps/api/scripts/rum-browser-dashboard-regression.mjs --input /absolute/path/to/actual-run/rum/dashboard-cli --output /absolute/path/to/new-dashboard-report
```

前者只验证实际 collector/锁定库与受控204接收器，不能替代Next入口；后者只读完整七语双端42组的实际CLI产物，复用相同看板验收函数，不能生成或替代指标。完整验收仍使用根 `verify:rum`。原生切tab必须保持文档存活，不能用卸载后Playwright未观察到请求来判定禁采；成功响应须完整结束，单看204响应头或服务器有记录不足以证明浏览器传输完成。看板原生select通过准确combobox可访问名称定位，避免把label内部的选项原始文本当成控件名称。

官方依据（2026-09-24 核实）：[web-vitals 官方仓库](https://github.com/GoogleChrome/web-vitals)、[6.2.2 Metric 类型](https://raw.githubusercontent.com/GoogleChrome/web-vitals/v6.2.2/src/types/base.ts)、[Next 独立 collector 指南](https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals)。本实现没有启用 soft-navigation 选项或 attribution build。

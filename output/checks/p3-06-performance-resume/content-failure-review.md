# P3-06 首页内容失败只读复核

**结论：原 Lighthouse 失败有效，根因尚未定位。** 本次仅阅读现有源码、日志和 LHR；未修改产品源码，未启动 Chrome、构建或测试，也未调整采样/性能阈值。

## 已确认

- 原证据为 `../p3-06-storefront-acceptance/run-2026-09-16T06-56-33-163Z/browser-attempt-3/performance/zh-CN-home-mobile-1.json`。第 10/63 个样本的同导航 audit：URL/locale 正确、contentVisible=false、errorVisible=true。root 已核实其原 final screenshot 是 HomeContent 的中文 PageState，hero 缺失。因此不是只凭 errorVisible 泛匹配推断首页失败，也不能把该错误页的性能分数当作有效样本。
- 本导航 Document HTTP 200，约 884.751 ms 完成；LHR 网络记录无图片请求。它与“首页业务结果被转换成安全失败页”一致，不支持直接归因为 8 秒 fetch 超时。
- 同 run 的 `next-runtime-3.log` 仅含启动信息，没有该请求的上游状态或异常分类。Next `public-catalog.ts:99–147` 把网络/JSON/schema/HTTP 状态/locale 不匹配与配置异常统一为 CONTENT_UNAVAILABLE；应用及投影层也会收敛失败，故缺少异常日志不能反证数据层正常。
- root 后续报告 API/gateway 各 40 次均 SUCCESS 且 schema 有效，SSR 40 次都有 hero。这是后续观测，无法解释或否定原失败。前两版 raw HTML 探针误匹配序列化 copy/加载占位符的结果保留；root 的 v3 精确 PageState 标记诊断另行记录，不替代原 LHR。

## 源码边界

- `page-factory.tsx:41–48` 先发起并等待 homepage；之后才渲染 `StorefrontPageShell`。新增 `cart-restoration-hint.ts` 仅调用 request-local `cookies().has()`，header hint 只控制购物车自动恢复，不调用或更改 homepage fetch。未发现它直接产生 CONTENT_UNAVAILABLE 的路径；源码检查不能排除调度变化暴露原有瞬态问题。
- legacy 发布读取的 `publication-preflight-repository.ts:104–117` 使用 GREATEST(clock、transaction timestamp、snapshot 生命周期/审核时间、head.updated_at 等) 生成 evaluatedAt；主记录 publishedAt 已属于 snapshot 生命周期下界。`published-content.ts:76` 的时间比较因此不能被简单解释为同一次裸 now 倒序。该链没有 materializedAt 字段。
- 另有 DAILY/proof_v3 路径以裸 clock_timestamp() 读取 evaluatedAt（`daily-publication-read.ts:43`），并拒绝 publishedAt 更晚（`daily-publication.ts:138`）。这是不同路径的理论条件，必须先确认失败对象 proof_version 及同一次失败的时间对，不能据此猜测本 fixture 的根因。
- TEST fixture 的 logger 输出被关闭，且未安装完整事务失败观察。现有 onInfrastructureFailure 主要监听 pool error，不覆盖所有查询/投影拒绝；当前资料无法区分当次 API 503、gateway 传输异常、Next 解析/locale 校验失败或发布证明拒绝。

## 后续验收约束

保留 attempt-3 及原截图、原诊断和所有后续观察，不重写失败为成功。下一轮完整 63 样本必须独立成集，不挑选/替换本轮失败样本；成功只证明新集合通过，不能宣称旧问题已查明。若再次出现，需捕获同请求的安全上游状态、schema issue 路径、允许的异常分类或投影阶段，再形成可复现根因；当前不建议凭时钟猜测修改产品源。

# P3-04 本地联合验收

浏览器结果：`results.json`、`accessibility.json`。本轮真实 PostgreSQL、HTTP API、TLS S3、图片 worker 和 Chrome 使用同一组已发布数据；Next 从 production 编译产物在显式 TEST runtime 中运行。不是 staging、生产部署或真机证据。

- 120 个经正常创建、七语言审核和发布的 TEST 艺人身份；两组原创虚构成年人物的独立双端素材，重复身份仅用于规模测试。
- 9 组明确标注的测试衬底构图，原照片像素未放大，原文件及嵌入像素 hash、原尺寸和位置保存在结果中。没有正式素材上线批准。
- 最终浏览器矩阵包含七语言的首页、目录、详情，390×844 与 1440×900，共 42 张页面截图及 9 张交互/状态截图。`en-home-empty.png` 和 `en-directory-empty.png` 是同一流程发布前的空数据库证据；`browser-failure.*` 是诊断失败记录，不是最终通过证据。
- 验证包含首页/目录搜索第 100 位、IME、键盘、稳定 ID 定位、语言切换保留上下文、120 条连续分页不重复、暂停状态、真实 BFF 错误与重试、目录版本变化、媒体传输错误恢复、移动菜单滚动锁/焦点恢复、reduced motion、48 项视口重排检查，以及无效 locale 和七语言不存在艺人的实际浏览器 HTTP 404。
- 10 次 axe 扫描均零 violations。轨道外的卡片产生 `color-contrast` incomplete，保留了安全的 DOM target 和 failureSummary 供人工复核；不把 incomplete 当作自动通过。
- 81 个真实 DOM srcset 候选已下载并解码，尺寸均不超过对应已发布源图；错误来源、路径、查询、格式和重定向被拒绝。源字节由实际 S3 与 PostgreSQL checksum 校验；优化字节使用独立解码检查。

性能只是本机观察：未施加网络或 CPU 节流，DPR=1，Next 图片缓存可能已预热。`imageTransferBytes` 在强制 eager 验证全部 DOM 图片后采集，不是首屏图片预算。LCP/CLS 不替代 P3-06/P6 的正式预算验收。本轮最终观察最大 LCP 1028 ms、CLS 0。

交互诊断保留同一数据库并反复重建 Next，因此当前 `results.json.assertions` 的 62533 是包含诊断重跑的累计计数，不能称为 62533 个独立最终通过断言。最终案例、截图、axe 和图片解码结果以最后一份 `browser` 对象为准；正常新运行只计 setup 和最终一次浏览器验证。

可重复入口（Node 24.20.0，先构建 API、worker、i18n、UI 依赖）：

```sh
node apps/api/scripts/storefront-http.mjs
node apps/api/scripts/storefront-http.mjs --production --ui
node apps/api/scripts/storefront-http.mjs --production --ui --serve
```

默认入口只运行 PG/HTTP/TLS S3/worker，不启动 Next 或 Chrome，独立写入 `http-results.json`；其中另行验证当前 featured publication head、handle 修改、暂停、featured 归档、正常重发首页恢复以及独立 hero 归档后 fail-closed。浏览器分支保留预览数据完整。`--serve` 浏览器失败时保留本轮服务，日志明确显示可发送 SIGUSR1 的 owned PID；该信号仅在该诊断等待状态使用，会重建同一 fixture 的 Next 并重跑浏览器。

无管理员 token、Cookie、签名上传 URL、HAR、完整日志请求体、私密留言或真实粉丝资料进入这些截图和报告。正式品牌、正式素材/人工译审、PSP、云 CDN、staging 和生产发布仍为后续门禁。

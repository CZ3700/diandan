# Candidate5 最终 RUM 编译与实际下载成本

结论：最终默认 disabled 相较原 baseline 的三个可比页面各净增 **1042 B Node gzip**，不是 candidate2 的旧 1009 B。采集启用后，已实测的七语言 × 两尺寸首页各再增 **3249 B**；实际下载的独立 web-vitals 块恰好解释该增量。旧报告 `rum-disabled-bundle-cost.json/md` 原样保留作历史证据。

本次只读，无浏览器、构建、数据库或源码修改。候选 sourceHash：`ea5371aa693c4c2d46c238ac393036b11770c15e267d69e90460c829fe26baab`。机器核算、输入归档/原件 SHA、各资源与编译产物比对，以及可重放只读审计入口分别见 `rum-final-5-bundle-cost.json`、`rum-final-5-bundle-cost-audit.mjs.txt`；其 Node 24.20.0 执行退出 0。

## 实际响应与最终编译内容

- `formal-performance-5` 的 294 个 disabled 资源单元共 **2352/2352** 条 script 响应，其状态 200、SHA-256、解压后原始字节与 Node gzip 字节全部精确匹配 candidate5 `.next/static/chunks`。
- `rum-final-5` 的 14 个 enabled 首页单元共 **126/126** 条 script 响应也全部匹配同一最终编译产物。
- 原 baseline 三格共 **24/24** 条 script 响应与原基线磁盘产物匹配。baseline 仍是 `DIAGNOSTIC_COLLECTED` 的三个 zh-CN/390 单元，未被重标为正式294格基线。
- 最终 disabled 与 enabled 资源报告的归档字节分别精确等于 candidate5 原运行 21:34:38 与 21:27:10 的资源报告；两次传输条件不同的限制见下。

| 编译资产 | 原始字节 | Node gzip | 实际初始响应出现 |
| --- | ---: | ---: | --- |
| 原 baseline 共享块 `3rrddfj_zf4lv.js` | 14378 | 3661 | 3/3 baseline 页面 |
| 最终 collector 共享块 `2u-3gy2cnotm0.js` | 16714 | 4703 | 294/294 disabled；14/14 enabled |
| 独立 web-vitals `38xug_56lnpts.js` | 8790 | 3249 | 0/294 disabled；14/14 enabled |

共享块编译正文直接包含 `RumCollector` 导出、固定 `/api/storefront/rum` 发送包装和最新的成功204空响应消费，`load:()=>e.A(77332)` 的异步模块注册明确映射到独立 `38xug_56lnpts.js`。独立块自身导出 onLCP/onINP/onCLS 实现。归因基于编译内容及实际响应，不是仅凭 hash 或文件名变化猜测。

最终共享块 SHA：`39d8642aef0f6a973b98d4dea39125fc6a775ca4f55853a032051f5c300e2699`。独立 vitals SHA：`91d4794136799ac000a1b51686f742345754298f2d55d75d69c1ed2c0e50bd27`。

## 与 baseline 的准确比较

每对页面均同 locale、页面、390×844，仍为八个脚本；**七个脚本 SHA/原始字节/gzip 全部未变**，唯一替换是上表共享块，字体 SHA 集合也相同。

| 页面 | baseline | 最终 disabled | 差值 |
| --- | ---: | ---: | ---: |
| zh-CN-home-390x844 | 152393 B | 153435 B | +1042 B |
| zh-CN-artist-390x844 | 150744 B | 151786 B | +1042 B |
| zh-CN-gift-390x844 | 154012 B | 155054 B | +1042 B |

共享块净增 **2336 原始字节 / 1042 B gzip（约1.02 KiB）**。相对旧 candidate2，该块又增加55原始字节/33 B gzip，因此旧1009 B不能用于最终交付。

这是整个共享块的净差，包括 collector/异步加载注册及编译压缩差异；不能把全部4703 B当成RUM开销，也不能把净1042 B精确拆成某个函数的独立压缩或CPU成本。

## 开启采集的实际首页资源成本

每对资源清单的八个原有 script **逐 SHA、原始字节、gzip 完全一致**，enabled 唯一多出独立 vitals 块（8790原始字节/3249 B gzip），没有其他脚本替换或删除。每对字体 SHA 集合也相同。

| locale/视口首页 | disabled（8脚本） | enabled（9脚本） | 差值 |
| --- | ---: | ---: | ---: |
| en-home-390x844 | 153435 B | 156684 B | +3249 B |
| en-home-1440x900 | 153435 B | 156684 B | +3249 B |
| zh-CN-home-390x844 | 153435 B | 156684 B | +3249 B |
| zh-CN-home-1440x900 | 153435 B | 156684 B | +3249 B |
| th-home-390x844 | 153435 B | 156684 B | +3249 B |
| th-home-1440x900 | 153435 B | 156684 B | +3249 B |
| vi-home-390x844 | 153435 B | 156684 B | +3249 B |
| vi-home-1440x900 | 153435 B | 156684 B | +3249 B |
| ja-home-390x844 | 153435 B | 156684 B | +3249 B |
| ja-home-1440x900 | 153435 B | 156684 B | +3249 B |
| es-home-390x844 | 153435 B | 156684 B | +3249 B |
| es-home-1440x900 | 153435 B | 156684 B | +3249 B |
| pt-home-390x844 | 153435 B | 156684 B | +3249 B |
| pt-home-1440x900 | 153435 B | 156684 B | +3249 B |

14个开启场景均为 **156684 B Node gzip**，对应关闭首页均为153435 B。相较原 zh-CN/390 首页基线总计增加4291 B gzip，其中1042 B是最终共享包装净差，3249 B是开启后实际新增的独立指标库。该结论只覆盖已测首页，不外推为其他 enabled 页面均有相同体积。

## 对外文档与验收口径

默认 disabled 可以准确表述为：不挂载 collector、不启用采集，正式294格初始资源中没有下载独立 web-vitals 实现；**不等于RUM相关包装代码零下载**。当前编译共享包装净增加1042 B Node gzip，已包含在正式资源预算。启用时已测首页实际增加3249 B独立库。

- 所有 gzip 值均由实际解压响应正文通过 Node gzipSync 按原验收方法重压，不是浏览器真实 wire transfer 字节；最终CDN、Brotli/gzip和缓存会影响传输成本。
- disabled正式矩阵使用 H2 viewer；enabled采用同源 HTTP 与原生标签可见性生命周期。这允许正文/字节比较，**不能把其计时、LCP或INP差异称为受控性能A/B**，更不能称为 field p75。
- 资源观察窗口是首导航至 network idle / fonts ready。它不能证明后续所有交互不会加载额外资源，且资源观察器不记录fetch/POST；此报告不独自证明“0 POST”，不替代专门的真实RUM/敏感入口验收。
- **150000 B 仍是原 SHOULD JS 预算**。上述基线三页本来已超过；最终关闭及开启的首页也超过。正式LH硬门PASS不能擦掉这个建议项差异。

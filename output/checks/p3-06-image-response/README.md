# P3-06 礼物目录入口隔离（2026-09-17）

本检查点接受范围是页面依赖隔离。礼物详情原来经共享 server factory 静态引用 GiftDirectorySection，实际首访 JS 包含未显示的 GiftFiltersClient。新增 server-only 目录入口，由七语言目录路由提供同一个目录组件；共享 factory 保留 type-only 依赖并用判别 tuple 强制目录调用传入组件。9 个生产文件的修改不移动原读取/await/SEO/404/Suspense/CartProvider 分支，不改图片/字体/价格/支付配置。

P3-06 仍 IN_PROGRESS，27 DONE / 2 IN_PROGRESS / 20 PENDING（49），Phase 5 LOCKED。只本地提交；没有推送、合并或部署。

## 可重复入口与验证

所有命令从仓库根目录运行，使用 `mise exec node@24.20.0 --`：

- RED：`corepack pnpm --filter @fan-support/storefront exec vitest run --config ../../vitest.config.ts --root . src/storefront/gift-page-entry-isolation.test.ts src/storefront/gift-directory-page-entry.test.tsx`；exit 1，21 个非目录依赖断言失败，26 例通过，共47。生产修改前、baseline采集后运行，见 `red.log` / `baseline-checkpoint.json`。
- GREEN：同上追加 `gift-page-scheduling.test.tsx`、`gift-content-read.test.ts`、`gift-seo.test.tsx`、`page-factory-dependencies.test.ts`（均在src/storefront），6文件142 tests通过，见 `green.log`。
- `corepack pnpm check:dev`：最终 exit0，34.624秒；format/lint、typecheck62/62、test62/62、build36/36，缓存61/61/35。首轮在新output分析器的URL/Buffer缺少显式导入处停止，已修正；首失败日志/退出码与最终日志均保留。不是完整 `pnpm check` 或生产发布门。
- 实际fixture：`FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS=1 mise exec node@24.20.0 -- node output/checks/p3-06-image-response/run-comparison.mjs`。复用现有真实PG/TLS S3/worker和公开内容协议，32,461断言通过。运行前 `stage.json` 显式baseline，baseline3次后写candidate并由root向该次owned PID发SIGUSR1重建；candidate3次后写ui再重建。旧PID不能复用。所有信号、build日志与原输出保留在 `fixture.log` 和实际fixture目录。

## 固定脚本比较

实际目录：`output/checks/p3-06-storefront-acceptance/run-2026-09-17T08-41-18-090Z/`。attempt1=当前92ae73c目录入口，attempt2=隔离候选，attempt3=候选完整UI。两组详情读取均是0 unscoped + 1 scoped，collector的candidate模式仅指共享读取语义；独立stage记录标注本次before/after。没有回退先前读取优化，没有额外浏览器预热或优选重试。

Lighthouse13.4.1 / Chrome152.0.7977.84，同一虚构公开中文礼物、同fixture、各固定3次、原mobile simulate设置，RTT150ms/吞吐1638.4Kbps/CPU4；实际viewport412×823/DPR1.75。组前完整公开响应SHA相同仅是两个点的证明，不冒充逐导航不可变版本绑定。54原文件长度/SHA、6同导航可见内容/读取/配置均核验；全量摘要见 `capture-summary.json`。

`analyze-entry-scripts.mjs --before <attempt1/gift-render-trace> --after <attempt2/gift-render-trace> --before-source output/checks/p3-06-image-response/baseline-source.json --after-source output/checks/p3-06-image-response/candidate-source.json --output <全新目录>` 绑定capture/source/实际响应Script内容，所有parsed脚本含inline检查不变源码的四个特征。实际请求ID唯一，body完整字节与NetworkRecords解压字节相符，六次设置完全相同。

| 每次首访脚本 | 旧入口3次均相同 | 候选3次均相同 | 减少 |
| --- | ---: | ---: | ---: |
| 实际脚本请求数 | 8 | 8 | 0 |
| 解压后完整JS字节 | 519,533 | 513,708 | 5,825 |
| 本地gzip level6字节 | 155,368 | 153,989 | 1,379 |
| 实际观察transfer字节 | 159,320 | 157,941 | 1,379 |

旧入口三次确含筛选特征，候选所有parsed Scripts三次均不含。完整body SHA/字节/请求关联见 `script-comparison/results.json` 与逐导航报告；gzip只是一种固定本地口径，实际transfer另列。source manifest是root提供的构建关联，分析器不声称单独证明编译器输入。

## 性能边界与图片审计

两组原预算均 FAILED：模拟LCP中位 5441.416 / 4817.547ms，候选最小2111.332、最大5427.074ms，不声明稳定提速或无性能回归。12个FCP/LCP官方离线复算差值均0；命令是 `node apps/api/scripts/storefront-gift-trace-analysis.mjs --input <三次capture目录> --output <全新分析目录>`，见两组trace-analysis/results.json。

历史约一秒绘制等待在本轮旧入口sample2再次出现：图片结束528.146ms，官方LCP1597.291ms，间隔1069.145ms；没有定位或修复。候选三个间隔10.658/37.893/30.480ms不能证明该异常消失。此前42份加本轮6份共48诊断报告保留；不是正式63次性能矩阵，也不是RUM/真实手机证据。

图片仅完成pinned源码审计，未完成服务端分段实验。原60秒TTL、AVIF优先/quality75/尺寸/字体均保持。Next STALE先返回旧缓存并后台再验证；上游无ETag仍可用源bytes hash复用优化结果。因此历史STALE约207ms不能直接归因编码。当前MISS/STALE及HIT的原始响应时间/ETag/尺寸见capture-summary；单次模块require计时不构成HTTP根因证据。后续应针对重新出现的实际绘制等待和首次响应边界做固定样本取证，不改变阈值、TTL或字形制造通过。

## 交付与剩余门

完整UI已PASS：88场景/88截图/85axe（0 violations、30 incomplete留人工）、0 pageErrors；七语言390×844/1440×900、搜索/分页/金额筛选/返回/移动抽屉键盘/错误/reduced-motion/SEO均覆盖，root查看中/英/泰/葡四张双端截图无本改动布局回归。真实发布10084ms、回退10310ms。adapter/artifact门通过，显式暂存后秘密扫描exit0/40.534秒；原4210未跟踪逐SHA未变，2229candidate输入验证后仍相同；owned fixture正常清理exit0，端口62919/62920无监听。独立复核ACCEPT本补丁，S.U.P.E.R十项仅在此局部实现/功能范围通过，完整性能门仍失败。汇总见 `final-verification.json`。七语言关键译审、人工运营计时/VoiceOver/手机以及P4-04真实商户/PSP/staging门仍保留。图片源码审计与工具结果不能代替它们。

源码大清单、原始trace/截图/逐脚本body与完整日志保留在本地。仓库提交紧凑 `source-binding.json`：从已提交的 `p3-06-gift-read-reuse/candidate-source.json` 按列出的删除/替换项可重建本轮两份完整输入清单及其aggregate SHA；未重复提交两份完整清单或原始媒体。

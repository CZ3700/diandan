# P3-06 共享脚本与首访工作只读审计

基线 `92ae73c`；审计者 `/root/gift_read_impl`。仅检查已有 A3/B3 trace/artifacts、当前 `.next` manifest/字节和源码。没有构建、测试、Chrome、服务或生产源码改动。唯一新文件为本报告。

## 结论

`2p07cckado7sy.js` 是 Next App Router 启动与其编译内置 React DOM 运行时，当前没有可直接从该文件删除的业务模块，也没有证据支持为达标延迟整个 hydration。现有应用最具体的可缩减依赖候选是：**详情页不使用的礼物目录筛选模块仍在其首访 chunk 内**。可以独立验证 server route 入口拆分是否去掉这个引用；这不会消除 React DOM 本身，也不能预报 LCP 达标。

### A3/B3 字节与模型证据

两份原始 artifacts：

- A3：`output/checks/p3-06-storefront-acceptance/run-2026-09-17T04-12-40-212Z/browser-attempt-1/gift-render-trace/zh-CN-gift-mobile-3-artifacts.json`，SHA256 `ac2a6a598fa53047bdae05442b83335ad73e973dd1d05bf51b6aeb5bbefe0236`。
- B3：同 fixture `browser-attempt-2/gift-render-trace/zh-CN-gift-mobile-3-artifacts.json`，SHA256 `92da85540827d5d59ce9fd178ca04b65597c901099ddab7d5dfc4b6fcc1e0c49`。

直接对 `Scripts[].content` UTF-8 字节求 SHA，两个样本中的下列文件均与当前磁盘逐字一致：

|文件|UTF-8 原始字节|Node 24 默认 gzip 字节|SHA256|
|:--|--:|--:|:--|
|`2p07cckado7sy.js`|234156|73278|`2a22dc37ba2a7bec1956a7d402601129dae9908cd12de6447cb3f0f07cc17de2`|
|`40tqntsixbaba.js`|27559|8679|`364865a6938c1435d4b1b86a57eacc404b687f7e58d30676ac545ce1f838bcef`|

此前快速回复的 73054 是 Python 默认 level9 gzip；本表固定 Node `gzipSync` 默认 level6，不能混用这两个压缩口径。原 trace 的共享 React chunk `transferSize` 为73777，包含真实传输口径，不等于本机重压后的73278。

原分析 JSON 的 A3/B3 optimistic/pessimistic 均结束于共享脚本之后的一个 `RunTask`，原始及模拟时间如下：

|样本|真实脚本网络窗口ms|真实 terminal RunTask窗口ms|其中EvaluateScript / v8.compile / RunMicrotasks ms|模拟terminal CPU ms|
|:--|:--|:--|:--|--:|
|A3|286.948–306.902|308.068–323.163|14.727 / 3.291 / 11.377|60|
|B3|221.240–238.399|255.694–269.918|13.883 / 3.020 / 10.814|57|

这些事件存在包含关系，不能把三个 duration 相加。B3 的 LCP 事件位于同一任务期间，但不证明整个任务必须完成图片才能呈现。原始 `EvaluateScript` 直接指向该共享 chunk；Task 内还含模块启动和 microtasks，缺函数采样/source map 的现有摘要不能把每一毫秒分摊给 React 或某个业务组件。两个样本约1505ms的模拟脚本网络时长、60/57ms的模拟 CPU 都不是真实浏览器等待时长。

## chunk 的实际构成

读取当前 Turbopack 注册数组，只捕获 factory 函数及 `toString()`，**没有执行任一 module factory**。主要注册项：

|module id|factory UTF-8字节|对应职责/源码线索|
|:--|--:|:--|
|3092|200693|React DOM client production；有 `hydrateRoot`/`createRoot`、react错误表、rendererPackageName与内置版本 `19.3.0-canary-cbb046ab-20260731`|
|31642|3454|React scheduler production，MessageChannel等调度|
|72744|3722|Next `app-index`，调用 hydration/创建router初态|
|36123|5549|Next App Router 客户端组件|
|9522|851|Next `appBootstrap`|
|82827|1428|Next `AppRouterAnnouncer`|

3092 单个 factory占整个文件原始字节约85.7%，但这不代表占85.7%实际CPU。对应本地官方代码：`apps/storefront/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.production.js:18318`（内置版本）、`:18371`（hydrateRoot）；`next/dist/client/app-index.js:14` / `:302`（react-dom/client导入与hydrateRoot调用），`next/dist/client/app-next-turbopack.js:12`（appBootstrap）。这属于锁定 Next 自身编译运行时，不是修改应用包声明中的 React 版本就能任意删除的库。

中文礼物路由的 `page/build-manifest.json` 将该文件列入 `rootMainFiles`，与 React基础、Next router/RSC及Turbopack runtime同层；该路由 `page_client-reference-manifest.js` 中项目组件则映射到其他chunk。没有从3092中发现GiftRecipient、ArtistSearch、GiftFilters等业务factory。

## 最小可测候选：移除详情页对目录筛选的静态引用

证据不是仅看文件大小：

1. 同次 A3/B3 `Scripts` 实际均下载 `40tqntsixbaba.js`；其中module65184为 `gift-filters-client.tsx`，factory 5651原始字节。
2. 该详情页的同次 `MainDocumentContent` 不含 `data-gift-filters` 或 `data-gift-directory=`；它没有目录筛选交互。
3. 入口依赖链明确：七语言的 `/gifts` 和 `/gifts/[handle]` 都导入 `gift-page-factory.tsx`。该工厂静态导入 `GiftDirectorySection`，后者导入 `GiftDirectory`（`:9`导入`GiftFilters`，`:86`渲染），再到server `gift-filters.tsx` 和client `gift-filters-client.tsx`。工厂在 `kind === "gifts"` 时才实际渲染目录，但构建的client引用包含筛选。

候选实现可以先将目录专属分支与client imports移到仅目录route使用的server入口，复用相同外壳/metadata机制，详情route不再静态依赖该分支。不建议为此拆整个应用、更新Next、碰共享合同或调整 runtime。简单把 import 改成 dynamic 并不保证 RSC manifest/分块会变好；必须查看实际候选产物和真实网络请求。

这个候选能成立的验收条件：详情首访chunk确实不再包含目录筛选代码，目录页功能/七语言/筛选/键盘无变化，原首屏/SEO/cart/404/错误/政策及原文展示不变。保留同设置固定样本，再报告实际压缩/传输差异。5651仅是旧factory原始大小，打包重组和共享模块会改变结果，不能当作可保证节省量。此报告没有实施或测得收益，也不主张与root当前图片链实验混在一起。

## 次级候选与已排除的重复工作

- `gift-recipient.tsx` 静态导入ArtistSearch、directory-model/request，并在关闭抽屉时初始化directory state、构造初始艺人按钮元素。其factory2559字节；合并的ArtistSearch/directory factory5616字节都位于 `40tqntsixbaba.js`。将panel实现延迟到打开时，可能去掉这部分首访代码，但需要保留即时反馈、冷键盘/触屏焦点、Escape/Tab取消、加载失败重试、IME、当前选中艺人和catalog变更恢复。该目录初始处理仅当前窗口，不是全艺人扫描。
- 关闭 `LazyDrawer` 时并不挂载 ArtistSearch组件，源码只在搜索框打开且非空输入后发请求；不能称当前有多余首访搜索网络请求。directory-validation已经是动态import，不能重复计算其节省。
- `CartHeader` 已有 `restoreOnLoad`，无cookie首访不会自动恢复cart。`CartPanel` 仅open时挂载，cart-body已动态加载；cart-validation在实际请求之后动态加载。没有再做一遍这项优化的依据。
- Header的初始滚动状态、关闭drawer的取消监听和cart session小状态初始化都存在，但当前trace没有把 terminal 的CPU归因到这些操作。不能通过删除焦点/取消行为追求没有测得的毫秒收益。
- `PublishedImage` 所在共享chunk仍含Next image helper；目录动态图片、cart和艺人选择也依赖该组件。只把礼物主图挪到server不保证删除整个image helper，更不能绕用Next私有优化URL。

## 后续建议与边界

本轮继续让root先拆清首次/过期图片响应成本。脚本方向有一个可独立验证的“目录入口隔离”候选，暂不建议对2p共享框架代码打补丁或人为延迟hydration。所有结论来自已保留的相同字节与只读源码；未获得新性能结果、当前真实手机证据或正式性能退出结论。

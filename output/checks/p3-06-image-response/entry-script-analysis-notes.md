# 目录入口隔离：离线脚本证据入口

仅新增一次性离线工具 `analyze-entry-scripts.mjs`。本子任务只读现有源码和原 artifacts 结构；没有执行该分析工具、tests、build、服务或 Chrome。真实运行由 root 在固定采样结束后执行，以下不是已验证的候选收益。

## 输入与运行

```sh
mise exec node@24.20.0 -- node output/checks/p3-06-image-response/analyze-entry-scripts.mjs \
  --before <baseline gift-render-trace directory> \
  --after <candidate gift-render-trace directory> \
  --before-source output/checks/p3-06-image-response/baseline-source.json \
  --after-source <candidate source manifest> \
  --output <new output directory>
```

输出目录必须不存在；不得覆盖旧失败。每组固定三个已成功且同导航内容有效的 captures。使用现有 trace capture `results.json` 中的长度和SHA绑定LHR、完整artifacts、DevtoolsLog及config；核对URL/settings与完整artifacts中的DevtoolsLog。组父目录 `entry-isolation-stage.json` 必须分别声明baseline/candidate、同样的scoped-shared读取和三次导航；capture mode必须同为candidate，每导航实录计数为GIFT_CONTENT0/STOREFRONT_GIFT1。六次configSettings必须完全一致。源码清单绑定文件本身SHA，并记录head/声明的总摘要/每个变更文件的前后SHA；该关联依赖root的构建冻结记录，不能仅凭manifest证明编译器确实用了这些输入。

## 标记来源

`gift-filters.tsx` 是server wrapper；实际client实现是 `apps/storefront/src/storefront/gift-filters-client.tsx`。使用四个原源码标记：

- `data-gift-filters`
- `data-gift-price-min`
- `data-gift-price-max`
- `data-gift-reset`

工具要求该client文件当前SHA与before/after两清单中的SHA完全相等，也要求四标记确实存在于源码。这样是隔离入口变化的实验，不接受同时改标记或client实现后宣称代码消失。未采用示例中的 `data-gift-filter-form`，因为实际源码没有这个属性。未绑定任意minifier模块ID或固定chunk文件名，也不执行已捕获JavaScript。

只读原 retained `Scripts` 已确认：该数组包含外链及内联代码，内容字段为 `content`，`length` 是UTF-16长度，不能直接充当UTF-8资源字节。旧礼物导航的已下载脚本包含四标记；本轮before/after仍必须用新固定采样证明，不能用旧结论冒充新基线。

## 完整性与大小口径

原artifacts没有序列化 `NetworkRecords`。工具调用pinned Lighthouse13.4.1的 `NetworkRecords.request`，从同导航DevtoolsLog离线重建。每个Script网络请求必须完成、未失败、状态200，并能按完整URL绑定至少一个保留的Script body；其解码resourceSize必须等于实际UTF-8字节数。任一不完整或绑定歧义即失败，不丢弃该请求假装总体变小。

每个Scripts条目保存完整UTF-8 SHA、UTF-16长度、原始字节、Node gzip level6字节和精确raw body副本（以SHA命名去重）。网络requestId必须各自唯一，重复URL但不同requestId仍分别计数。网络请求分别保存transfer/resource与缓存状态；内联脚本属于HTML传输，不能重复计为独立脚本请求。唯一external body大小与按请求累计的网络大小分别报告。

成功标准是新before三个导航各有至少一份外链body包含全部四标记，新after三个导航的所有parsed body（含内联）中均无任一标记，避免把代码挪到inline却假称移除。HTML是否包含筛选markup另行记录；其中仅数据引用并不自动证明有可执行工厂，但parsed script中出现标记仍保守判定本工具未证明消除。该结果表示GiftFiltersClient特征实现从实际下载集合移除，不提供工厂精确边界/执行次数，也不把工厂gzip字节当作实际网络节省。总体脚本gzip只是本机重压诊断，实际传输变化取逐请求NetworkRecords值。

目录页交互是否保留由root原七语言完整浏览器矩阵验收；本工具不代替该功能证据。所有结果 `formalPerformanceAcceptance:false`，不将脚本消除视作LCP因果或性能门关闭。

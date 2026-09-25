# P3-06 第三轮首屏依赖调整

状态：源码冻结；完整七语UI通过，63次性能采集完成但原预算失败。

第二轮同条件六页诊断全部完成，LCP 2,613.7–4,519.0ms、CLS均0，JS 324,347–337,622 bytes，仅减少约7.5KB。原报告在 `run-2026-09-07T17-13-43-828Z/performance-preflight-iteration-2/`。observed LCP与simulated LCP分开；现有大JS已gzip，字体已optional，全部首屏主图已eager/high且可在初始文档发现，没有用改变这些标签或压缩配置冒充修复。详细Lantern离线分析同目录。协议、模拟方法和预算不变。

## 改动

1. Header路径使用合同唯一locale纯值解析器后检查 `parsed === input`，保持七语精确大小写与拒绝非canonical输入，不把normalized locale静默写回URL。presentation-locale原TypeError及其消息保持；私有storefrontHref的非法运行时locale异常从ZodError改为明确TypeError，成功URL与非法path规则不变。未发现依赖旧错误类的调用者。
2. 目录/艺人搜索在真实请求时加载原schema验证模块。初始SSR已验证数据沿branded IdolId流转；输入和完整响应校验、语言/数量/版本一致性、IME、防抖、abort、latest-wins及失败重试保留。默认limit仍来自原query schema，未复制规则。
3. 购买展示变为Server Component，价格、ICU库存提示、规格链接与资格均在server渲染；唯一Quantity client接收max和三条文案，仍按variant/max/recipientkind重置。礼物选择纯函数移到无schema初始化的叶子，旧导出保留且5函数定义逐字不变。
4. 筛选的初始格式、金额示例、重置与恢复链接由server准备，client只在提交时加载原金额/查询schema。未选市场不自动生成市场，货币不由语言推导。加载异常使用已有七语错误文案，保留原页面context的整页重试入口。
5. 新异步窗口增加编辑、IME、关闭、卸载及history取消。非作者复审找到pageshow到rAF之间和Reset导航未卸载期间两个旧apply竞态；受控模块加载、真实组件closure的测试有效RED2 FAIL /1 PASS，修复后3PASS。该测试使用受控React hooks/window，不冒称真实浏览器；编译后的chunk/网络故障回归另行执行。

## 验证

- Root canonical value边界有效RED19 → GREEN；筛选server准备有效RED7 → GREEN；根定向5files73tests PASS。
- 目录最终8files70tests、types/lint/format PASS；非作者14tests PASS。
- 购买区6files69tests、types/lint/format PASS；同绑定与原函数AST完整字节复核通过。
- 全前台最终52files377tests PASS (`performance-iteration-3-storefront-tests-final.log`)；types PASS (`performance-iteration-3-typecheck-reviewed.log`)；root scoped lint PASS (`performance-iteration-3-root-lint-reviewed.log`)；格式已修复。
- 全前台首次有6个既有SSR markup tests因新server-only入口而缺少测试条件失败，已按同类测试加runner mock，原6断言未删未改；记录保留。根新测试的index-signature类型和类型import lint错误另保留，修复后才冻结。
- 非作者复审 `root-client-boundary-independent-review.md` ACCEPT，独立6files76tests PASS；另见目录与购买区独立review。
- 最终1539项源码/配置/测试输入：`implementation-source-performance-iteration-3-final.json`，SHA256 `7f4695db1562591e674b91776af7ca095ecea0cb44da77d62e94555fe49a4446`。

没有新增业务合同、依赖或字体改动。实际bundle、LCP、首次交互chunk失败/恢复、完整七语矩阵、共享P2指纹、全仓check与人工门仍待验收。P3-06 IN_PROGRESS，Phase4 LOCKED。

## 最终验收补充

上述1539项是六页诊断时来源；随后仅新增独立lazy-validation浏览器模块，最终1540项SHA256为 `662dcb3e30ca0d97e070e90262a7e8b6945d5b52ba12088a338ea7d119cc148f`。最终生产编译与完整七语双端UI88项、lazy9项51断言、共享P2-04/P2-05回归均通过。原1539产品文件没有变化。

最终63次Lighthouse/21组三次中位数：20组score≥90，1组LCP<2500ms，21组CLS为0；LCP范围2416.4–5415.9ms，日语礼物页为最大。84资源页JS203468–207239bytes、236图片均达预算、无资源失败；JS仍超150KB SHOULD。所有63原始JSON/HTML与21组汇总保留，未改变协议/模拟算法/预算，未挑最好一次。完整整仓门与人工门继续单独记录于总README/validation；性能仍须优化，P3-06保持IN_PROGRESS。

# P3-06 首屏 JavaScript 只读诊断

2026-09-08，`/root/storefront_directory`。仅解析已有资源报告、生产编译 chunk/client manifest、源码和已安装依赖；没有运行 build/test/browser、修改产品源码或配置。性能采样继续由 root/E2E 串行执行。

**结论：首屏体积有明确可优化来源，但不是站点七语文案全量加载。** 最大业务依赖块保留了 Zod namespace，包括 62 种错误语言包、JSON Schema/编译能力；其次是必要的框架基线、Base UI 菜单/定位，以及公共 DTO 与内部证明 schema 的同模块初始化。政策页还保留了不使用的礼物交互入口。先针对这些具体边界做小范围对照，不能据此承诺减到 150KB，也不能把 unused JS 全部当作可删代码。

## 采样与映射依据

读取 `run-2026-09-07T17-13-43-828Z/browser-attempt-1/performance/results.json` 时，84 个资源样本已齐，整体仍 `RUNNING`，Lighthouse 正在继续。以下结论仅使用这 84 个资源样本和已存在的 `en-home-mobile-1.json`，不预判最终 63 次 Lighthouse 结果。

资源窗口为实际导航至 network idle 与 fonts ready，未滚动或强制图片 eager；每页新 context、禁用浏览器缓存，服务端图片优化缓存可能已热。`javascriptGzipBytes` 是成功脚本响应解压后用 Node gzip 重压的统一口径，不包含 HTML/RSC 内联数据，也不是所有页面实际线缆编码总量。

对报告中的全部 **16 个不同脚本**，只读检查 `apps/storefront/.next/static/chunks/`，其文件原始长度与 Node gzip 长度均逐项等于报告；使用的是生产目录，未将 `.next/dev` 的源码映射混入结论。生产 chunk 没有对应 `.js.map`，因此用 TypeScript AST 解析 Turbopack 模块编号/导出及已有 `page_client-reference-manifest.js` 映射，未执行编译脚本。混合 chunk 的 gzip 不可再线性拆成模块节省量。

七语言、两尺寸各自的脚本字节完全一致：

| 页面类型                       | 每页 gzip 字节 | 脚本数 |
| ------------------------------ | -------------: | -----: |
| 首页 / 艺人目录                |        331,928 |     12 |
| 艺人详情                       |        332,371 |     12 |
| 礼物目录 / 礼物详情 / 政策详情 |        345,161 |     14 |

150,000B 是当前资源 SHOULD 建议，未达到；它与 Lighthouse/LCP/CLS 实验室硬断言是不同门，不能通过修改分类伪装达标。

## 首页 331,928B 的组成

| 编译 chunk                                                           | gzip 字节 | 有证据的归属                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | --------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3k-20c3y8y-2r.js`                                                   |    85,933 | Zod classic/core 全 namespace、JSON Schema、compile、62 locale exports，以及 contracts locale/schemaVersion。导出模块包括 `52731: z`、`66561: 62 locales`、`20602: supportedLocaleSchema/localeContextSchema`。 |
| `2p07cckado7sy.js`                                                   |    73,278 | React DOM 与 Next bootstrap/polyfill。最大模块 `3092` 是 React DOM 实现；不是业务商品逻辑。                                                                                                                     |
| `1rzy3cp4msjdo.js`                                                   |    47,193 | Next router、RSC、server action dispatch、导航状态及错误处理。                                                                                                                                                  |
| `1usu9wsia47ji.js`                                                   |    32,396 | Base UI Menu、Floating 定位、项目 Menu/LanguageControl，以及 locale URL/cookie helper；导出模块 `3135` 保留 22 个 Menu 部件。                                                                                   |
| `284u0o263rb96.js`                                                   |    24,909 | Base UI 共用 DOM、焦点、定位、交互工具及少量 React 辅助。和上一块合计 57,305B，不能全部当作可删除菜单开销。                                                                                                     |
| `1qkso-275ktas.js`                                                   |    36,701 | catalog/media/revision/discovery schema、受控富文本与 entities 解码数据；并含 SiteHeader、PublishedImage、navigation/Next image helper。混合块，不能把全部 36,701B 都算作无用合同。                             |
| `2ebuwn8ca4vfd.js`                                                   |     9,589 | 艺人请求/搜索/状态模型、目录样式映射，及由公共合同同文件依赖引入的额外 proof schema 初始化。                                                                                                                    |
| `1b29_qjaraxqp.js`                                                   |     8,475 | ArtistDirectory 与所用共享 UI/查询部分；RSC manifest 将首页客户端入口绑定到这一组合。                                                                                                                           |
| `1eb2a8tunus1g.js`、`1oktdg9jp8u14.js`、`turbopack-01wm1a8ps3dbq.js` |    13,039 | 其余框架/路由与 bundler runtime。                                                                                                                                                                               |
| `2qun_6obf6abx.js`                                                   |       415 | 项目 global-error fallback。                                                                                                                                                                                    |

框架两大块及其余 runtime 合计 **133,510B**；Zod 混合块 **85,933B**；Base UI 两块 **57,305B**；其余业务/合同/图片/错误混合块 **55,180B**。这是上述首页 chunk 的完整加总，不是按源码模块估算的收益。

## 具体依赖链与判断

1. **Zod 的 namespace 保留是实际产物事实。** `packages/contracts` 已设置 `sideEffects: false`，UI 已将 sideEffects 限定为 CSS，i18n 也为 false；不能归咎于忘写声明。已安装 Zod 4.5.4 的 `index.js` 将 `z` 暴露为 `classic/external.js` namespace，后者再导出 core、JSON Schema、compile、locales。当前 Turbopack 的产物确实保留了这些成员。依赖自身的注释讨论 Rollup/Webpack 的 namespace shaking，不能据此假定本次 Turbopack 已同样消除它们。

2. **存在公共 response 与内部 record/snapshot 的同文件初始化链，但没有“全部 378 个合同 roots 都被下载”的证据。** `directory-request.ts` 引入 `idolDirectoryResponseSchema`；该对象定义在 `contracts/src/catalog-directory.ts`，同文件还构造内部 record、snapshot、cursor，并静态引入 `public-projection.ts`、`publication.ts`。`catalog-discovery.ts` 同时包含艺人和礼物查询，依赖 `catalog-content.ts`；后者及 media/content lifecycle 又共享 authoring/revision 定义。编译 `2ebu...` 中实际保留 `current policy publication`、`import approval evidence` 等内部校验消息，`1qkso...` 中保留 priceBook/revision/media schema 导出。包级 sideEffects 声明不能自动消除这些模块内顶层调用。

3. **不能盲删 HTML 解码器。** `content-lifecycle.ts` 的 `createControlledRichTextSchema` 使用 `entities.decodeHTML`，实际 chunk 有其压缩解码表。公共 authored 内容仍须遵守既有受控富文本合同；删除解析或改用宽松字符串来减包会改变安全/数据语义。可分离 scalar/public/authoring 文件依赖，不能降低 response 解析与当前 scope 校验。

4. **政策页的礼物依赖确实可疑。** `gift-page-factory.tsx` 同时静态引用 GiftDirectorySection、GiftDetail、PolicyBody，按 kind 在函数内选择。生产 `/(public)/(latin)/en/policies/[handle]/page_client-reference-manifest.js` 仍列出 `gift-filters.tsx`、`gift-purchase.tsx`、`gift-recipient.tsx`；真实政策页加载集合与礼物页一样，包含 `3f890_mkphtmf.js`（9,394B）和 `3yq-g6_6uhr47.js`（11,987B）。后者包含 GiftFilters 及 IntlMessageFormat。已经完成的首页工厂拆分确实使首页不加载这两个块；可以对政策/地区页面采用同样边界，而不是重构整个前台。

5. **没有站点七语字典进入这些首屏脚本的证据。** 七份文案源码中 358 个长度大于 20 字符的字符串，在全部已下载脚本的 AST string literals 中命中 0；`StorefrontCopy` 多处为 type-only，正文 copy 从服务端作为字典传入。`3yq...` 的 ICU formatter 不等于全 locale 字典。此检查不计 HTML/RSC 中按页序列化的 copy，也不说明这些 HTML 数据已最小化；仅排除把当前 86KB Zod 错误语言包误报为站点七语文案的归因。

6. **菜单在首屏静态加载。** `site-header.tsx` 静态引入 Drawer/LanguageControl，后者依赖项目 Menu；`ui/src/menu.tsx` 使用 Base UI Menu namespace。收起状态不阻止模块下载。定位与焦点能力有真实无障碍职责，不能直接删除；有理由验证窄部件导入或交互时加载是否减小初始依赖，但收益和首次操作延迟必须实测。

## 小范围优化候选，按验证成本排序

- **先隔离政策/地区工厂。** 保留读取/metadata 共享 helper，把不使用 GiftDetail/GiftDirectorySection 的路由组合移到独立入口；不改变真正 404 在流式响应前判断、七语文案审核和商业 query context。验收条件是对应 client manifest 不再声明 gift filter/purchase/recipient，真实政策/地区首屏不请求这些 chunk，同时礼物与目录回归不退步。21,381B 是当前两个共享块的体积上界线索，不是保证节省量。
- **再做一个合同边界的对照。** 将目录公共输出与内部 snapshot/record/proof 的模块组织分开，通过旧入口重导出，保留原 schema 对象、解析规则和业务 roots；从艺人 response 单一链开始，验证内部 proof 消息/模块是否退出客户端。不要只换 barrel 为同一文件的 deep import，也不要直接标注整段 schema 构造为 PURE 以跳过未知副作用。合同比较、旧解析负例及真实错误路径应完全保留。
- **Zod imports 做受控小实验，暂不全仓迁移。** 当前需要验证的是 Turbopack 对 namespace 和精准命名导入的实际行为；可在最小公共叶子边界比较产物，再决定是否采用一致的窄 facade。已安装 Next 对 `experimental.optimizePackageImports` 的文档说明它是导入优化，默认列表不含 Zod；没有证据证明加配置即可解决本次 namespace，不建议直接作为修复提交。不要把所有合同换成 Zod Mini 或删除运行时解析来追求 150KB。
- **菜单按真实无障碍能力做一次窄化对照。** 首先核实只引用所需部件能否被编译器消除其余 Menu namespace；若考虑延后加载，保留首屏可用触发器、焦点移动/回收、键盘、移动端滚动锁和 reduced motion，补首次点击加载/失败的实际体验。UI/shared/package/config 改动可能触发 P2 fingerprint，须由 root 统一刷新真实证据。

React DOM/Next 的 133,510B 基线不是本轮最小业务修复目标；不为资源建议擅自换框架。首页继续 SSR 真实内容、只在交互时加载目录请求解析也可作为后备方案，但当前 navigation 自身仍调用 locale schema，且 shared chunk 同时服务 header/image；只给单个请求加 dynamic import 不能保证移除 Zod，须先切清依赖再测。

## Lighthouse 已有一条样本的交叉证据

`en-home-mobile-1.json`：TBT **2ms**、模拟 LCP **3,622.05ms**；unused JavaScript 总估算 **143KiB**。报告明示：

| chunk              | Lighthouse totalBytes | wastedBytes | wastedPercent |
| ------------------ | --------------------: | ----------: | ------------: |
| `3k-20c3y8y-2r.js` |                80,092 |      67,930 |        84.82% |
| `2p07cckado7sy.js` |                73,344 |      27,083 |        36.93% |
| `1rzy3cp4msjdo.js` |                47,235 |      25,717 |        54.45% |
| `1usu9wsia47ji.js` |                32,425 |      25,191 |        77.69% |

这些是这一条 Lighthouse 的传输/覆盖率估算，和前述 Node gzip 资源口径不同，不能混加。unused 也包括以后交互会使用的代码。低 TBT 与高模拟 LCP 并存，不能把 LCP 唯一归因于 JS 执行；完整 63 次采样、请求发现、CSS 与字体路径应由 root 综合判断，本报告不更改任何预算或失败结论。

用于复核映射的生产文件 SHA-256：

| chunk              | SHA-256                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `3k-20c3y8y-2r.js` | `a979da1f8a21bafea4e36afe6aa9f63b01b0d2be0911e4eee249e805c2311f63` |
| `2p07cckado7sy.js` | `2a22dc37ba2a7bec1956a7d402601129dae9908cd12de6447cb3f0f07cc17de2` |
| `1rzy3cp4msjdo.js` | `5d7b1470acd6e89278ffe764bed19ee17c926ea81ea4d0a4db1531ed68c176a6` |
| `1usu9wsia47ji.js` | `3fa8cdf93bc6563edab3f777c721f1fac281418103643aa26a47d3dae5ced2f9` |

本诊断完成后冻结，源码、构建配置、预算与正在写入的性能结果均未修改。

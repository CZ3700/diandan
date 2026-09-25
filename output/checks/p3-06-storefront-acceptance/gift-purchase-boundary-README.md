# 礼物购买区服务端展示与数量交互边界

作者 `/root/storefront_read`，按 root 授权的性能第三轮范围实现。没有运行 Next build、服务或浏览器，没有修改合同、gift-query/filters、navigation/header 或艺人目录。精确 7 文件快照见 `gift-purchase-boundary-source.json`，不是全仓输入快照。

## 改动及保留条件

- `GiftPurchase` 改为明确的 `server-only` 展示组件。规格链接、真实价格、起价、库存策略、ICU 剩余数量说明、不可用理由与禁用 checkout 仍使用原分支，在服务端计算。
- 唯一新增客户端组件 `GiftQuantity` 只接收 `max`、`label`、`decreaseLabel`、`increaseLabel` 四个标量。它复用原 `Quantity`、`useId`、初始数量 1 和本地 state；不导入合同、copy/i18n，不接收整份 gift、offer、recipient、price 或完整文案对象。
- 数量组件的 key 保留原 variant ID / maxQuantity / recipient kind 身份。最大值仍来自当前合法 offer，TRACKED、PROCURE_ON_DEMAND、PREORDER 不互相替代；无 recipient、无价格、缺货、未知规格的原分支不提供数量输入。结算按钮继续禁用，没有新购物车或支付行为。
- `gift-selection-values.ts` 承载 `giftSelectionHref`、`giftCanonicalPath`、`selectGiftOffer` 三个纯函数，旧 `gift-selection.ts` 原名同绑定 re-export。原 query parser 和 recovery schema 留在原模块。GiftRecipient 只把 href import 指向纯 leaf，交互内容未改。
- 独立 TypeScript AST 比较确认五个原有函数定义与 HEAD **逐字完全一致**，见 `gift-selection-definition-equivalence.log`。保留市场切换清理金额筛选、艺人/地区切换清理旧 variant、页码清理、canonical 隐私字段剔除、未知 variant 不替代与最低可用报价选择。

纯 leaf 仍通过 root 拥有的 navigation 保持本地 URL 和 locale 验证；其运行时依赖收敛由 root 同期修改负责，不在这里复制 locale 或放宽 URL 边界。

## RED→GREEN 与实际检查

命令环境为 `mise exec node@24.20.0 -- corepack pnpm ...`。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| 有效 RED：购买展示仍是 client + 3 个纯导出声明仍依赖 schema | 4 FAIL / 17 PASS，均命中实际旧源码 | `gift-purchase-boundary-red.log` |
| 初始 GREEN（含原报价选择回归） | 3 files / 22 tests PASS | `gift-purchase-boundary-green-final.log` |
| 最终定向回归 | 6 files / 69 tests PASS | `gift-purchase-boundary-regression.log` |
| 全 storefront typecheck | exit 0 | `gift-purchase-boundary-typecheck-green.log` |
| 7 文件 ESLint | exit 0 | `gift-purchase-boundary-lint.log` |
| 7 文件 Prettier check | exit 0 | `gift-purchase-boundary-format.log` |
| 五函数 AST 定义等价 | PASS | `gift-selection-definition-equivalence.log` |
| 7 文件 git diff whitespace check | exit 0 | 本次工具输出；没有写 Git 状态 |

定向用例覆盖原价格/库存/收礼人/未知规格/URL/SEO/页面调度，并新增实际 client component spy：确认唯一数量边界接收到的 props 恰好是四个标量；原 SSR 的 spinbutton、真实 max/min、价格与禁结算断言均保留。同绑定测试确认旧 exports 总集合未变。

两次失败如实保留：有效 RED 后首次新 leaf 查找测试只处理 `.js`、漏了 app 使用的无扩展名 import，导致 ENOENT，见 `gift-purchase-boundary-green.log`；修的是测试定位器，之后才得到 `green-final`。最初全前台 typecheck 读到了目录代理仍在改的 branded ID/旧测试引用，见 `gift-purchase-boundary-typecheck.log`；没有跨范围修改，目录代理修完后完整 typecheck 通过。

## 复审与限制

目录代理已只读复审 ACCEPT：GiftPurchase 实际消费者是服务端 GiftDetail；价格、库存 ICU、规格链接和禁用 checkout 保留；GiftQuantity 四标量、min1 与真实 max 不变；unknown variant、无价格/未选 recipient 不出现数量选择。作者定向测试与其非作者源码审查分开。

此次证明的是服务端/客户端代码边界与旧行为保留，没有测量新首屏 JS 字节、模块下载顺序、真实交互或 LCP。root 后续须用同输入构建与浏览器验证；不能用静态依赖隔离或单位测试代替全样本性能、最终全仓检查和人工 UAT。`super-performance-addendum.md` 绑定此前 5caf 源码，不能冒用为本轮新源码的完整十项验收。

# P4-04 Storefront 实现与定向验证

执行者 `/root/storefront_read`；基线 `f1f702f`，2026-09-09。本文件记录前台作者证据，真实支付/浏览器验收待 root 集成，不替代全任务完成门。

## 交付

- 七语言 checkout/return 共14个薄路由，沿原黑金 shell、locale字体布局、CartProvider与静态文案加载；页面metadata noindex/no-referrer。BFF与HTTP安全头由API agent负责，不重复实现。
- 礼物袋进入结算；移除礼物详情旧的“结账未开放”禁用占位，Offer/GiftAdd/价格与收礼人分支保持。公开复核仅消费严格不可变文本/金额/政策，逐对象保留真实 `lang`；不伪造历史图片。
- 独立 transport/validation/controller：current恢复、预检、明确邮箱/政策确认、创建结算、真实国家/能力选择、同attempt GET/recover、最新GET后才跳转REDIRECT。仅声明支持REDIRECT。所有价格、库存、资格与是否可重试仍来自服务器。
- 邮箱和未知请求body/key仅在内存；同一次恢复保持原body/key，双击不二次dispatch；导航销毁，刷新通过Cookie找既有checkout。return保留原locator，不接受success断言；订单locale可不同于界面locale。
- UNKNOWN/可信证据待处理显示确认中，无新付款/成功宣称。轮询仅GET、单请求、有界次数、隐藏暂停、pagehide同步清timer、离页后旧响应与poll不能唤活。交互提交卸载原按钮时恢复焦点；用户已移走焦点则不抢回。
- 国家切换保留select节点，旧配置冲突清掉旧能力；政策/价格变化撤销过时preflight并要求再次明确确认。已创建历史政策始终可复核。

## 实际验证

全部命令使用 `mise exec node@24.20.0 -- corepack pnpm`。未运行Next build、浏览器、PG、完整check或字体生成器。

| 范围 | 结果与日志 |
| --- | --- |
| 新接口/状态入口 | `storefront-state-red.log`：6项缺失接口断言FAIL；随后实际传输/状态用例GREEN。此初始RED是新接口尚不存在，不是数据库/浏览器故障。 |
| UI入口/支付状态 | `storefront-ui-red.log`：4FAIL/4PASS，随后GREEN；包含原CartBody仍无checkout链接，以及新review/status入口。 |
| 真实行为回归 | `storefront-lifecycle-red.log` 2FAIL（销毁后旧refresh复活、return重试丢locator）；`storefront-focus-config-red.log` 2FAIL（焦点helper缺失、旧配置继续可选）；`storefront-country-red.log` 1FAIL（select会卸载）；各同名green通过。 |
| 轮询 | `storefront-polling-red.log` 缺失入口RED；`storefront-poll-pagehide-red.log` 1FAIL证实pagehide未清timer，修后green。受控计时器/DOM，不冒称Chrome。 |
| 旧gift占位/历史政策 | `storefront-entry-policy-red.log` 15FAIL/2PASS；同一旧占位被14个既有gift分支检出，另1项缺历史政策。最小移除/补显后同名green 17PASS，旧Offer分支断言保留。 |
| 最终整个 storefront | `storefront-full-suite-final.log` exit0：74files/511tests。覆盖当前包全部测试（含其他作者BFF），不是全仓/真实浏览器。 |
| 最终类型/静态 | `storefront-types-final.log` exit0；`storefront-lint-final.log` exit0；`storefront-format-final.log` scoped格式化exit0。初次类型仅测试Promise类型，初次lint仅测试局部名/module规则与fixture未使用变量，记录保留。 |
| 七语词库 | 新36key。`storefront-copy-red.log` 2FAIL/18PASS准确检出旧hash；只更新真实source/translation hash，DRAFT/null审批字段不变；`storefront-copy-final.log` 20PASS，`storefront-copy-build.log` exit0。 |

`storefront-owned-files.json` 给出51项作者检查范围（包含既有cart-body测试），`storefront-source-freeze.json` 记录这些文件实际SHA。测试夹具放在 `src/test-support/checkout-fixtures.ts`，不进入真实业务/公开对象。code-simplifier收敛仅替换状态文案与schema选择的嵌套三元表达式，没有另造业务工作流或改公共合同。

## 集成与剩余门

稳定DOM标记已发API agent：cart-checkout、checkout-root/session、checkout-email、checkout-policy、checkout-confirm、checkout-error/retry、payment-country/create/state/recovery/continue/recover/refresh。截图前必须清空或遮罩邮箱和敏感action，禁止带私密payload的HAR/trace。

七语词库/review已冻结并通知root按原中日字体生成器统一处理。现有DRAFT词库仍阻止production；关键政策未真实批准时不可假译审。真实TEST hosted流程、Origin/Cookie/CSRF、after-commit丢响应、同key恢复、七語390/1440/320/zoom/键盘/reduced-motion及实际P2/整仓门待集成；静态controller/markup测试不能替代。

S.U.P.E.R：1–9按当前单责UI模块、向内依赖、严格可序列化HTTP合同、显式依赖与配置边界完成作者复核；#10仅上述定向/整个前台包PASS，真实浏览器和全任务门仍PARTIAL。PSP正式账号/sandbox/小额付款/PAID订单库存闭环不在这份作者证据中，P4-05边界不变。

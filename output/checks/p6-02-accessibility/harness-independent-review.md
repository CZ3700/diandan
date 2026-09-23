# P6-02 accessibility harness 独立复核

结论：**ACCEPT（实现审查），原 cleanup 阻塞已修复，未发现新的阻塞。** 完整真实浏览器验收仍以根任务 fresh run-2 的最终结果为准；本轮复核没有启动浏览器。

复核者：`/root/home_gift_audit`，没有参与 harness 实现。本次读取 runner / owned / browser / flows / tools / matrix / completion / cleanup / publication 及相关测试。与 run-2 冻结 `source.json` 比较，全部 **14 个 accessibility 源文件 SHA-256 一致**。

修正复核：

- **Cleanup：** context、browser、state 分别通过 `Promise.allSettled` 尝试关闭；其中任一个拒绝不会跳过剩余资源、临时 profile 删除或最终报告保存。任一步失败将返回对象状态改为 FAIL，仅记录固定资源标签。`runJourneyLifecycle` 因此拒绝将清理失败当成通过或触发成功 reset。诊断只保留静态模块文件/行列号，不持久化 matcher message、cookie、token 或表单值。已覆盖三种 close 失败、remove 失败和 save 失败。
- **Viewport height：** regular / desktop / narrow 的测量现在同时要求实际 width 和 height 等于声明的尺寸；错误高度会失败。native zoom 保留独立的真实窗口、CSS viewport、DPR 和 visualViewport 测量门，不使用 viewport 缩窄冒充 200% zoom。
- **Mailbox：** helper 在导航前注册 `/session` POST 的 response 等待，要求 204，再等待邮件服务完成自有 reload 后才出现的 Refresh messages 链接。它解决授权交换未完成就继续导航的竞态。授权前仍清空 cookie，真实单次邮件 capability 链接仍通过顺序键盘激活；后续格子仅复用内存中的短期 session，不声称重复兑换单次链接。实际服务会清除 viewer fragment；订单交换后也断言 fragment 已清除。未并行运行会启动 Chrome 的 browser-tools 测试。
- **Daily completion：** 浏览器矩阵前从该隔离实例的实际 daily gift head 读取 source locale，再经真实仓储/public projector 检查七语言、身份、source/requested locale 和无 offer。完成门要求该结果 PASS、七个规范 locale、有效 source locale 与至少 49 项检查；缺少此证据不得通过。

整体证据口径保持准确：28 cells 是七语言 × 四种视口模式；每格七个生产页面，共 196 个核心页面检查。只有首格完成一笔 TEST 支付、独立邮件授权与审核/送达，其余格子验证新的键盘加购/结账表单和已授权订单布局。axe 严重/致命项、页面异常、未完成矩阵、错误尺寸或 native zoom、缺 daily 证据均阻止通过；自动化不声称人工屏幕阅读器或真实手机已验收。

独立执行命令：

```sh
mise exec node@24.20.0 -- node --test scripts/accessibility-cleanup.test.mjs scripts/accessibility-matrix.test.mjs scripts/accessibility-completion.test.mjs scripts/regression-journey-lifecycle.test.mjs
```

结果：**12 tests PASS，0 fail，退出码 0**。这些测试不会启动 Chrome。

另外阅读了保留的 run-1 隔离 snapshot 中 `diagnose-fixed.json` 与 `diagnose-daily-browse.json`：作者的局部诊断分别记录 mail/order/management/operations 修正通过，以及实际 daily browse 七语言 49 checks PASS。它们只是作者诊断证据，没有覆盖原始 run-1 的 FAIL，也没有在本报告中被计入独立测试或冒充完整 run-2 通过。复核时 root run-2 状态仍为 RUNNING。

## Run-3 前的 canonical order route 增量复核

结论：**ACCEPT，无新增阻塞。** 已读 `run-2-canonical-order-diagnosis.md`，并对照产品 `order-client.tsx` 确认：exchange 后可以先渲染 OrderDetail，随后由 effect 执行 `window.location.replace`；因此临时 PAID DOM 和空 fragment 不能证明 canonical order 路由已到达。

新 `settleAccessibilityOrderRoute` 等待精确配置 origin、购买时 locale、`/orders/{publicOrderId}` pathname 和空 fragment，完成 DOMContentLoaded 后再验证 PAID。flows 在采样 `page.url()`、切换显示 locale、保存可复用 session 之前等待该 helper。它没有更改产品、支付状态判定、token 生命周期或授权方式，避免了把临时 exchange URL 再次导航成无 token 的入口。

控制测试源码覆盖“临时 PAID + 清除 fragment + 延迟 200ms replace”的真实竞态，并检查最终路径及重载后的订单内容。作者报告其真实 Chrome RED/GREEN 与 14 项工具测试通过；本次独立复核未重跑 Chrome。独立执行三个变更模块的 `node --check` 均通过，三个文件 SHA-256 与 fresh run-3 冻结 `source.json` 全部一致。原 run-2 FAIL 保留，完整浏览器通过仍需 run-3 最终结果。

## Run-4 前的后台搜索焦点增量复核

结论：**ACCEPT，未发现阻塞。** 复核者未修改产品或本轮 harness 源码，也未启动浏览器。已完整阅读 root 的一行产品 diff、新 `accessibility-admin-search.mjs` / 测试、flows 调用、completion 门，以及 `run-3-diagnostics` 的 README、实际 RED/GREEN 证据。

- 产品将 effect 依赖从 `[selected, filters.page]` 改为 `[selected, filters]`，与列表请求触发条件对应。打字仍仅更新子组件 draft，提交时才更新 filters。外层 h1 不随 loading 卸载；响应完成时 filters 身份不变，因此不会因请求完成再次抢焦点。没有加入 loading/list 依赖。
- 新 helper 在真实 Enter 提交前安装精确当前 origin 的 orders-list 路由，只暂停新 POST 且 query 等于本次订单号的请求。通过 `route.fallback()` 放行原请求，没有 fulfill、伪造响应或修改请求。直接取得被捕获 Request 的 Response，验证 HTTP 200、规范 schema、唯一且精确的 publicOrderId，再核对 busy=false、无 alert、输入值、渲染行唯一性与内部 orderId；旧 DOM 中已有目标行不能替代新响应证据。fixture 测试使用 mock 服务属于 helper 的受控测试，和作者实际 owned TEST/PG 请求诊断清楚分开。
- pending / complete 两阶段均检查实际 activeElement 为稳定 h1；随后一次真实 Tab 必须进入工作区有效控件，再由原有 tools.activate 验证订单行的顺序 Tab、可见 focus ring 与无遮挡门。completion 要求每个 matrix cell 恰好一条完整 orderSearches 证据，缺响应或 pending 焦点证明无法通过。
- finally 无条件释放 hold，等待 routing 和该响应完成，再卸载自己的 handler；失败仍交由既有 FAIL/外层清理路径处理。真实客户端请求具备 30 秒 AbortSignal 超时。报告只保存固定 cellId 与布尔结果，没有保存请求、响应、CSRF、cookie、query、留言或私密姓名；运行时断言为固定文字，外层错误仍经安全诊断过滤。
- 履约收紧合理：prepare / deliver 必须实际 enabled；送达后除按钮消失外，还等待 workspace 非 busy、detail 存在、finance panel 完成，再重验 deliver 按钮不存在。不能再把加载时临时卸载造成的零按钮当作成功截图时机。

独立验证：同前述四个无 Chrome node:test 文件再次 **12/12 PASS**；新 search、对应测试、flows、completion 四个 `.mjs` 的 `node --check` 均通过。产品 diff + 五个相关 harness/测试文件的 SHA-256 与 fresh run-4 `source.json` **6/6 一致**。作者实际 Thai 320×844 RED 显示 pending/complete 焦点为 BODY，GREEN 显示稳定 h1 且随后键盘进入精确订单；作者 17 个工具测试与此独立轻量验证分开计数。原 run-3 FAIL 保留，完整接受仍等待 fresh run-4 最终结果。

# final-8 财务浏览器读取生命周期一次诊断

2026-09-23，root授权；owner /root/regression_coverage_audit。仅临时观测final-8 owned snapshot内apps/api/scripts/admin-finance-browser.mjs。没有改root源、产品、测试阈值、Set清理规则、故障route或任何金融命令。

原因问题：原final-8在退款响应丢失后，同幂等key/payload恢复和单条DB退款记录断言都已通过，截图helper先执行默认5秒expect.poll(outstandingReads.size).toBe(0)，此处失败。page.setDefaultTimeout(30000)不改变expect.poll默认时间。原报告不能识别当时未终结的请求，errors=[]也不表示所有读取HTTP都已成功。

源码前提：isRead按orders-list/detail/context与finance-list/detail五种endpoint定义语义读取，没有GET限制。这些BFF读取实际通过POST。先前finance-detail人为abort在独立读错误场景撤销；退款故障route仅拦finance-refund POST，route.fetch不属于page上被跟踪的五类读取。本probe严格保留原范围和Set add/delete，仅旁路跟踪同一Request的安全路径、GET/POST/OTHER、递增本地序号、起始stage、主页面navigation generation、response/status、finished/failed闭集、capture时pending age。未记录URL参数、header、body、业务ID或错误原文。

执行一次原 `mise exec node@24.20.0 -- corepack pnpm verify:admin-finance:browser`，显式统一POSTGRES_TEST_BIN，实际metadata为NATIVE_ISOLATED_TEST。原5秒poll未变化。PASS6742/exit0，浏览器330断言全部true、errors=[]，58次capture原门全部通过。278次read均为POST，277 finished与1个设计内finance-detail abort failed，全部起点恰有一个终态。没有重试整条命令。

目标refund-lost-response阶段有20个read起点/20个终态，最长完成33.636ms。目标en-390-partial-refund-recorded截图开始时：当前document generation94有一个刚发出的orders-detail（age0.920ms，尚无response）；它在12.773ms收到200、12.870ms完成，然后当前document又发出两个finance-detail，各收到200并在12.364/12.999ms完成，原poll自然归零。精确顺序在diagnostic-result.json.targetCaptureWindow与read-lifecycle.json。这验证了截图调用和父订单刷新真实并发，符合onUpdated→parent refresh→新FinancePanel读取的源码路径；本次没有旧document残留或漏终态。

限制：原失败未复现，其未终结请求身份/耗时未知。上述新一次证据不能证明原失败也是当前读取较慢，更不能证明其已修复。cause保持NOT_REPRODUCED_UNKNOWN，原full final-8 FAIL/原归档保留。未增加timeout、清空Set、忽略失败请求、跳过截图或改UI状态。若决定后续实现，仍需把拟改变的具体生命周期/就绪条件与可重复失败证据绑定，不能仅凭此PASS扩大门限。

退出后原harness完成浏览器/测试库/S3清理流程，外层finally恢复owned文件并核验原SHA；root同路径亦保持原SHA。无服务仍由此诊断运行。执行与恢复证据分别execution.json、restore.json；原件与temporary.diff保留。

原件/恢复SHA：`2ed4fc4cbec5c6fb1ce0139b3777d4367c24e7b2c09c438180698338d13152ff`。

临时observer SHA：`7346d8e5a21c8f7ce05eec22744b3871a68a30d9d9e8a89f50b6ca82b9f81f91`。

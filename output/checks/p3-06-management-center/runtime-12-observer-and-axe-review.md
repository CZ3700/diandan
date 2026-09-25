# Runtime 12：观察器诊断与可访问性复核

## 原始结果边界

原始证据保持不变：`run-2026-09-07T23-02-10.982Z-3aff62e3/browser-2026-09-07T23-03-04.980Z-ba49a057/results.json`。

- 10 次真实管理操作完成；70 个公开页面的内容、原文语言、图片、实际价格及收礼对象断言通过。
- 98 次 axe 检查，0 个 violation，1 个 incomplete 规则实例（color-contrast，serious，6 个节点）。
- 运行最终为 FAIL：26 个 `ResponseObservationFailure`，仅涉及 management-context/list。7316 项检查中仅最终运行错误汇总为 false，没有任何成功响应 schema 断言为 false，也没有真实 `pageerror` 事件。
- 旧观察器将响应体读取、JSON 解析、schema 与回调异常合并，未保存原始细分。因此不能事后断言这 26 个异常全部由导航造成，更不能将本次运行改记为 PASS。

## 已修的测试生命周期缺口

旧观察器从 response 事件才登记，等待函数只等待当前 Promise Set 的快照。请求已经开始但尚未收到响应时，等待会提前返回；React effect 刷新前的旧列表也可能短暂满足可见断言。

新观察器从 request 开始，直到响应体校验及请求传输都结束才完成；导航前后、最终断言前与关闭前均等待，包含等待途中新增的请求。渲染效果完成两个动画帧后重新检查请求计数，避免立即离开仍在刷新内容的文档。

失败仍全部计入独立的 `observationFailures` 并使检查失败。安全阶段为 BODY_READ / JSON_PARSE / SCHEMA / APPLY / TRANSPORT / DRAIN，保留端点键、状态码、请求序号和文档代次；不保存原文、URL、凭证或原始异常。真正的页面错误继续单独记录。故意注入的上传中断和 HTTP 503 用例未修改。

定向验证：旧快照等待实现出现 1 个确定性失败；修复后 4 个 Node 测试通过，覆盖未响应请求、等待期间新增请求以及真实 body/schema 失败保留。ESLint、Prettier、node --check 通过。尚待下一轮真实浏览器复验。

## 原始 incomplete 的有限人工复核

已实际查看原图：`run-2026-09-07T23-02-10.982Z-3aff62e3/browser-2026-09-07T23-03-04.980Z-ba49a057/zh-CN-390-public-poster-restored.png`。

六个目标是横向艺人轨道第 2、3、4 张卡的标题和状态。截图中第 1 张卡完整显示，第 2 张在右边界部分裁切，第 3、4 张不在当前横向可视范围。可见文字没有覆盖照片；源码中 figcaption 位于 portrait 之后，照片容器与标题、状态是兄弟结构。

静态颜色依据：标题继承 #f6f3ee，状态为 #aaa6a0，底色为 #0a0a0c；按 sRGB 相对亮度计算，对比度分别为 17.87:1、8.17:1。这是源码颜色组合检查，不代替全部目标在实际滚动位置的像素/浏览器检视。

本次运行已关闭，无法将后三张卡滚入视口复核。原始报告只保留规则与目标，没有 failureSummary，不能据此确定 axe 的确切 incomplete 原因。状态保持 **PARTIAL_MANUAL_REVIEW / 滚入视口复核待完成**；不称 axe 全零、不称读屏通过，也不将 incomplete 自动等同于已确认生产缺陷。

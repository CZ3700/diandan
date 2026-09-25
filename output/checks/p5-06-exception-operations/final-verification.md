# P5-06 最终本地验收

基线 `f9c8a619f38a07c095607e4b3b73039b4317f2a0`，分支 `codex/p5-06-exception-operations`；2026-09-22。实现经过 REVIEW 与非作者复核，本 Task 本地验收 DONE，Lane D 释放；按 ADR-016，P5-07 接入手册与 fake 演练的本地范围 READY。Phase 6/7 仍 LOCKED。Git 只做本地检查点，不 push、merge、部署或真实资金操作。

## 交付行为

管理中心新增一个“待处理”入口，集中查询支付事件、失败队列、待确认支付与失败通知，支持筛选、分页、详情、操作原因与二次确认。只暴露安全元数据，没有敏感 webhook 原文入口。当前权限、会话/MFA/CSRF、源版本和永久幂等均在服务端核验；操作和审计原子保存。

- webhook 与失败队列复用原事件、原消费者和原业务幂等；只开放具备可靠幂等保证的已注册消费者。
- UNKNOWN 支付委托既有 finance 核实，固定原账户和原 attempt，不从浏览器回跳判成功。
- 确定失败通知委托原受控重发。SENT、未知发送结果、被后继替代、不满足资料/期限的来源拒绝；重发成功退出 OPEN，原历史仍在 ALL。
- 未确认请求按操作者保存在当前浏览器会话，先持久化再发送；刷新与丢响应沿用原键原正文。权限撤销隐藏详情和操作，但不丢失尚未确认请求。
- 修复真实浏览器发现的无关模块错误横幅泄漏，明确状态文案。界面保持黑金基础风格与单一管理中心。

## 实测

| 检查 | 结果与证据 |
| --- | --- |
| 合同与生成物 | 92 files / 517 tests；check:contracts PASS |
| 实际 PostgreSQL | 53 checks；0037 up/down/up、37迁移/200表、并发/永久回执/租约/历史投影；storage/2026-09-22T07-44-41.865Z |
| 原配置 PG 回归 | 151 checks；storage-legacy-0036-green.log |
| 最终实际 HTTP/Worker/浏览器 | 7143 = 5763 setup + 369 protocol + 27 shared SQL + 809 browser及其夹具 + 175其他夹具断言 |
| 浏览器自身 | 708 assertions / 11 cases / 89 PNG / 89 axe；violations/incomplete/page errors均0 |
| 整仓 check:dev | exit0；format/lint、typecheck64/64、test64/64、build36/36；缓存63/63/35，数量为任务图而非单测断言数 |
| 静态与导出 | CI/runtime/observability、domain/adapter测试及边界、32 package exports PASS |
| 兼容与保护 | 690旧合同根/120旧paths/200旧component不变；72旧SQL字节与36manifest前缀不变；5993原未跟踪文件逐SHA保留 |

最终组合原件：`integration-2026-09-22T08-16-42.172Z/`。七语言覆盖390×844和1440×900、键盘/reduced motion、错误恢复、WEBHOOK操作只读、无权限、UNKNOWN通知限制、服务端分页、真实空列表、浏览器与上游丢写响应、四动作、当前权限撤销与恢复。

十次同键调用与十次原 webhook/outbox handler 重放后，PSP createCalls仍4、refundCalls仍1；可信退款入账恰增加1，履约4/事件5/送达0不变，通知仅出现允许的原任务和受控重发。实际原账户 RECONCILE 新观察恰1。浏览器另外核对各来源永久回执、退款、履约事件与通知/邮件接收数量上限。

中断窗口测试是**模拟提交后省略 settle，实际 PG 租约到期后由新 Worker 实例恢复**；不是杀掉独立 Worker OS 进程。七语只读浏览器角色针对 WEBHOOK 操作，其旧通知权限仍保留，不能说该角色对所有模块纯只读。

## 失败与修复

保留合同先行 RED、SQL NULL/伪造终态/REVIEW与通知投影缺口的RED→GREEN、错误query夹具路径和root证据脚本缺URL导入等原失败。队列故障注入最初误伤旧backlog使目标饥饿，窄修为仅本批两目标故障，108个非目标任务按原正常处理器完成；不删除队列、不放宽生产重试。

第一轮浏览器因返回列表时读到旧aria-busy而竞态失败，并暴露无关错误横幅。下一轮到最后权限恢复时同步读取DOM又产生假阴性；保存了403→200/detail200和实际已恢复截图。最终测试所有相应操作等待真实响应与DOM，保留相同业务断言并完整重跑通过。未捕获拒绝那轮有单独owned清理记录，其余最终资源按finally自动清理。

## S.U.P.E.R 与独立复核

| 项 | 结果 |
| --- | --- |
| 1 单一模块责任 | PASS；合同、授权、读取、命令、恢复、传输、UI及测试夹具分离 |
| 2 函数概念单一 | PASS；UI筛选视图已提取，恢复claim/执行/settle边界明确 |
| 3 单向依赖 | PASS；Browser/BFF→Application→Port→Adapter |
| 4 无新循环 | PASS；全仓边界和workspace检查 |
| 5 合同定义接口 | PASS；versioned Zod请求、响应、claim/settle和run result |
| 6 可序列化I/O | PASS；严格DTO与安全元数据，供应商对象不跨边界 |
| 7 配置外置 | PASS；生产origin/账户/密钥不硬编码，固定动作/消费者为合同 |
| 8 依赖明确 | PASS；无新增依赖或lock变化，仅新增脚本入口 |
| 9 可替换模块 | PASS；原支付/通知能力通过ports委托，UI通过API注入 |
| 10 验证闭合 | PASS；最终单测、真实集成、浏览器及质量门通过，原失败保留 |

`spec-review.md`覆盖非作者合同/应用/存储；`storage-independent-runtime-review.md`覆盖非作者应用/API/Worker/UI；`ui-review.md`为作者自检。root另检查页面和恢复源码，实际查看中文手机、英文桌面及最终权限恢复截图。精确输入复核见`review-input-verification.json`，全候选摘要见`compatibility-verification.json`。

## 范围与接续

没有运行整条`pnpm check`或重跑全部历史PG/S3门，不能把check:dev称作完整正式验收。本轮实际TLS S3/OIDC、持久TEST PSP/邮件用于证明本Task异常编排；不是商业PSP sandbox、真实支付/邮件、真机或人工译审。七语文案保持DRAFT。

P5-06原Task不要求接入新商户或生产上线；本地实证覆盖其自身要求，因此可DONE。P3-06/P4-04/P5-03/P5-04/P5-05的原外部门留在对应Task，不随之完成。P5-07原直接依赖核对见`next-stage-readiness.md`，只释放本地runbook/fake演练，不领取其他任务。

完整持久本地体验尚未就绪，按`docs/runbooks/local-experience-readiness.md`跟踪。达到统一前后台/媒体/Worker/TEST支付、上传到选购履约和重启保留数据闭环后再交付地址及启动命令，通知用户准备服务器。操作与复跑入口：`docs/runbooks/exception-operations.md`。

最终候选2582源文件 manifest SHA256：`7bd8b9ed7fc2d9f2ba24c0510898bc6641e4d14424e0c10bf0e393249b786e21`。证据文件纳入后的秘密扫描exit0，最终临时服务清理PASS；完整计数以`final-gates.json`为准。日志原件保留本地，Git文本副本仅规范化换行/尾随空白，双SHA及对应关系见`log-transcripts.json`。

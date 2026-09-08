# P4-04 TEST PSP 独立只读复核

复核者 `/root/storefront_read`；2026-09-09。范围仅 `apps/api/scripts/payment-runtime-psp-{store,server,process,database}.mjs`、store/http tests 与 `psp-process-green.log`。未修改被审文件、运行服务或重跑测试。

**当前结论：原事件身份问题的源码修复与已提供测试证据 ACCEPT；最新完整协议的静态检查 ACCEPT，实际整链结果仍待执行。下列首轮 REQUEST_CHANGES 与当时的证据边界完整保留，增量复核见文末。**

**首轮结论（历史）：REQUEST_CHANGES — 一个确定性事件身份问题已即时发给 root / storefront_e2e。隔离、跨进程持久性与日志边界其余部分未发现阻断。**

## 必须修复

`payment-runtime-psp-store.mjs:82` 的 `providerEventId` 含每次新的 `command.auditLogId`。同一 SUCCEEDED / capture 再 reconcile 会发出新的 provider event ID，但 `capture_reference` 仍为同一真实交易。旧 `database/migrations/0005_payments-reliable-events.up.sql:596` 的 provider-event transaction-reference 唯一约束不允许为同一 account/environment/type/reference 插入第二事件；当前证据 writer 先按 provider event ID 查询，因此会尝试新 INSERT 而被唯一门拒绝。

应让 TEST PSP 的真实状态事件身份在重复认证查询时稳定，新的 audit ID 只表示本次认证查询，不能成为新的财务事件身份。不修改 PG 唯一约束。另注意 `store:98` 对 PROCESSING→PROCESSING 仍更新 occurredAt 来源 `updated_at`：仅删除事件 ID 中的 audit 后，该重复表单会导致同 ID 的时间事实变化；同状态重复操作应保持原事实，或使用独立持久事件版本。

必要回归：不同 audit 的同一状态 reconcile 返回相同 provider event ID、occurredAt、交易 reference；同一 capture 跨 PSP 进程重启后仍相同，真实业务证据重复写保持一行事件/账本。该问题是只读代码与旧唯一约束的确定性冲突；本复核没有声称已实际运行出 23505。

## 已确认范围

- `database:5` 创建随机 UUID 命名的独立 `p404_psp_*` 数据库；store 还检查专属数据库名、32 字节 secret 与 TEST environment。这里只建两张 PSP 自有表，不迁移业务表。当前测试明确使用 `withEphemeralPostgres`；独立数据库与独立 PSP 进程不等于独立 PG 集群或真实 PSP。
- `store:59` 的 account/attempt 唯一键、INSERT ON CONFLICT、行锁与完整命令 fingerprint 防止并发 create 新建第二身份；不同 body 拒绝，external reference 与托管 HMAC 保持。`store:93` 的终态不可反向改写，重复 SUCCEEDED 不产生第二 capture。
- `store.test` 覆盖两次并发 create、changed body、关闭/重开 store 后重放和重复 capture；其中重开 store 仅是对象/连接池替换。`psp-http.test:22` 另使用真实 fork PID，`:31` 再 fork 且确认 PID 已改变，因此其进程重启证据不是对象重建的别称。
- `server` 只监听 127.0.0.1 的 HTTPS；命令接口需恒定时间比对 Bearer、无 Cookie，精确 Host / origin，bounded body；hosted POST 校验本 PSP Origin + 独立表单 HMAC。故障控制只经自有 IPC，没有公共 fault route。托管页明确 TEST，不包含真实卡号/CVV/钱包输入。
- `process:9` 的 child argv 只含固定 TEST 标记；配置与 secret 经 IPC，不进入 argv/evidence；stdout/stderr 被忽略，IPC 错误仅固定安全文案。stop 有 15 秒 IPC 边界和后续 SIGTERM/SIGKILL 兜底，等待子进程退出；PSP socket/store/secret cleanup 保留。未见原 body、action token、邮箱或连接秘密日志输出。
- server observations 只保留操作枚举、故障模式、accepted 布尔与 hosted 意外凭据布尔。`counts()` 来自独立 PSP 数据库；create/reconcile counts 是在 PSP transaction 内成功提交的 command 日志，不是所有到达网卡请求或已回滚异常次数，不应把它命名为总 HTTP 请求数。

## 当前实际证据

`psp-process-green.log`：Node test 1 PASS / 0 FAIL，test 用时 1486.84425ms，整体 1764.055ms。源码真实执行：create 在 PSP 已接受后断开响应；PG 中一笔 payment；PSP close 后不同 PID 用原库/端口启动；无 externalReference reconcile 得到 REQUIRES_ACTION 且 captures=0；实际 HTTPS GET hosted + 表单 POST 才捕获并 303 到原 return URL；之后认证 reconcile 得到 SUCCEEDED/CAPTURE，captures=1；无凭据串到托管页，匿名命令 401，未许可 TLS origin 被拒绝。

该 test 没有运行浏览器或业务 API/order/payment-runtime writer；没有实际验证业务 PAID、库存聚合、浏览器 return 成功/失败处理、真实 PSP sandbox，亦尚未验证上述重复 capture reconcile 的业务证据唯一性。现有 PASS 保留，不覆盖待修问题。

## 增量复核：稳定事件与真实协议

2026-09-09 只读复核 `payment-runtime-protocol.mjs`、`payment-runtime-runtime.mjs` 与其 HTTP client，及 PSP store/test 修正；未运行服务、测试或改产品源码。

稳定事件修复已对应原问题：`store:247` 的 event ID 改为持久 attempt/status，不再取本次 audit ID；`:300` 同状态 hosted 操作直接返回，不改持久 updated_at。该 TEST 状态图不回到历史状态，因此同一状态的事件身份与 occurredAt 保持，认证 audit 仍每次单独绑定查询。未修改旧 provider event / financial transaction 唯一约束。

`psp-event-stability-red.log` 保留 1 FAIL，错误被既有 EphemeralPostgres 包装；本报告不把该通用报错冒称为实际业务 23505。`psp-event-stability-green.log` 为 2 tests PASS / 0 FAIL（1713.177875ms）：store 用真实独立 PG 验证不同 audit 的重复 PROCESSING、重复 SUCCEEDED 事件 ID/时间相同，audit 不同且 capture 仍一次；另一 test 用真实 HTTPS 与不同 fork PID 验证接受后丢响应、重启和托管表单 capture。后者的重启发生在 capture 前，不能描述为“capture 后跨进程重复业务账本提交已测”。这两项未调用业务 payment-runtime evidence writer，业务证据/账本幂等仍由后续真实链路证明。

完整协议的真实性与范围：

- Cart、checkout、payment client 均用真实 `fetch` 调已监听的 API；每次 initialize 从实际 Set-Cookie/CSRF 取得独立 session，foreign READ 使用另一次初始化结果。API 协议是本机 HTTP 手动携带 Cookie，PSP 通信是受认证的 HTTPS；这里不替代浏览器对 Secure/SameSite Cookie 的真实执行证据。
- `runtime` 使用正常 checkout fixture 和 TEST configuration seed，然后启动真实 API composition、独立 PSP 数据库与 fork 进程。`protocol` 中业务 SQL 仅 SELECT 验证；不存在直接 UPDATE/INSERT attempt、order 或 reservation 来假装完成支付。
- PSP `AFTER` 故障在 `store.execute` 返回已提交接受后真实销毁 HTTP response。restart 先等待原子进程退出，再以同库、同端口启动并检查不同 PID。新 API 的连续 recovery worker 执行实际持久任务；轮询 READ 本身不触发 reconcile。恢复前后 PSP createCalls/payments 必须不增加。
- 显式 hosted HTTPS POST 才产生 TEST capture，303 仅回到原配置 origin/locale/attempt；随后 GET 不变状态与 PSP 创建/对账次数，显式认证 recover 才得到 EVIDENCE_PENDING。协议仍要求 attempt 不为 SUCCEEDED、order 为 PENDING_PAYMENT / payment PENDING，绝不把 capture 当 PAID。
- 私密 canary 仅运行时进入正常加密 checkout；响应严格解析并扫描私密字段，保存的请求事件只有固定 category/status/code。PSP observations 不保留托管 token、Cookie 或明文内容。

本次提前发现并由作者修正的三个必失败 oracle：`orders.status` 改为真实 `orders.order_status`；创建 attempt 后订单 payment aggregate 预期从错误 UNPAID 改为实际 PENDING；foreign attempt READ 预期从 CHECKOUT_NOT_FOUND 改为现有精确 ATTEMPT_NOT_FOUND。没有修改产品行为或放宽 HTTP 状态要求。

原并发场景还补齐了关键数量证明：并发前后 PSP createCalls/payments 各增加恰一；全部成功响应绑定同一最终 attempt；同 checkout 实际 attempt/receipt 各一。只检查最终某个 attempt 的一条 receipt 原本无法排除其它 dispatch，该缺口现已在源码中修正。最新完整协议尚无本次复核所见的整链 PASS，以上是静态可执行性和断言充分性结论。

## 增量来源快照

下列 SHA256 是本次复读时的源码。作者仍可能格式化/接浏览器，最终冻结后需核对是否一致；变化需有界复读，不能把此快照自动套到后续版本。

| apps/api/scripts/ 文件 | SHA256 |
| --- | --- |
| payment-runtime-protocol.mjs | 284e5e5df447aebd861542fefdfd54fbdf0da73456515221ce2784aaf4933894 |
| payment-runtime-runtime.mjs | 2150c6d3e15ca135c3b36117318327da7e00a62a5fad9afa04c18a8f855cd122 |
| payment-runtime-client.mjs | 85f30c700fa3af744492ed08e17b03169ccb43bb0b1be050cb2f68fc6f08a6bc |
| payment-runtime-psp-store.mjs | 33cfd679b1071c2f1eb95b322534bb068e324b676d9eceda463b6e14b5c30434 |
| payment-runtime-psp-store.test.mjs | bbab5d442a06d9e7798acfe96de0ce1f73005337198aa6ab2cf17f3133572154 |
| payment-runtime-psp-http.test.mjs | ad5cb98570e1cf2169d6caae32c6e79a621ed36742248f07ddbe58a5aa296a33 |

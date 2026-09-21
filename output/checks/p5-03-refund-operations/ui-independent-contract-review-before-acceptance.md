# P5-03 independent contract/domain review

Reviewer: `/root/refund_admin_audit`, independent from contract/domain author. Read-only review; no changes made to the reviewed implementation.

Reviewed on 2026-09-22: `packages/contracts/src/admin-finance.ts`, `admin-finance-persistence.ts`, `admin-finance-openapi.ts`, `finance-evidence.ts`; `packages/domain/src/finance-evidence.ts`; `packages/persistence-port/src/admin-finance.ts`. Traced existing provider-evidence, refund/dispute state machines, payment-port response matching, provider-event transaction constraints, and the persisted claim comparison as supporting boundaries.

No blocking findings in this scope.

- Financial amounts use bounded integer minor units. Refund commands require positive, unique item allocations whose BigInt sum equals the requested amount, original currency, expected version, reason, idempotency key and explicit confirmation. Captured/per-item capacity remains the transactional repository's responsibility.
- Public finance responses exclude credentials, raw PSP DTOs/provider references, private fan messages, display names and contact information. Browser commands cannot nominate a provider or change a dispute outcome.
- The provider subset contains only cancel, refund and the two reconcile operations. Claim validation binds refund and reconcile-audit identities; settle validation reuses the complete command/response matcher. Repository settlement additionally compares the complete persisted claim, generation, lease digest and live lease.
- Domain evidence validation checks account, environment, payment attempt, external reference, refund/dispute reference, amount and currency before accepting duplicates. Success requires a native refund transaction reference. Invalid evidence goes to review; early refund evidence waits for durable submission; stale progress does not reverse terminal states; conflicting terminal evidence goes to review.
- Multiple disputes project conservatively. OPEN/LOST cannot be hidden by WON, and independent dispute handling does not rewrite a successful payment attempt.
- Contracts are shape validation, not provider authentication. Production callers must still establish persisted verified-webhook/authenticated-reconcile authority; this review does not replace ingress, transaction/concurrency, PSP or real-funds acceptance.

Non-blocking maintainability note: provider-command selection currently uses indices 4–7 of the frozen payment-port union. Future union changes should preserve an explicit allowed-operation assertion or switch to named operation selection.

Verification executed independently:

```
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/contracts test src/admin-finance.test.ts src/admin-finance-openapi.test.ts
```

PASS: 2 files, 6 tests.

```
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/domain test
```

PASS: 26 files, 196 tests, 94.88% branch coverage. Full transcript: `ui-independent-domain-review.log`.

The initial focused domain run passed its 13 tests but failed the package-wide 90% coverage threshold because unrelated domain files were not exercised. The normal full-package command then passed; no threshold was changed.

## 整合后增量复核（2026-09-22）

只读复核 `packages/application/src/admin-finance.ts`、`admin-finance-context.ts`、`admin-finance-runtime.ts`、`admin-finance-events.ts`、`admin-finance-webhook.ts` 与 API `admin-finance-route.ts`、`admin-finance-composition.ts`、bootstrap/worker 注册位置：未发现阻断。严格请求在事务内转换为 session/CSRF digest + command hash，永久 receipt 先提交，再进行事务外 PSP 调用；原账户/adapter 选择、响应匹配、claim operationId、退款/付款证据应用匹配保持。UNKNOWN 返回不将原命令再次发款，后续仅 reconcile。webhook 的 finance effects 与 inbox 成功同事务；早到 UNMATCHED 抛出保持可重试；bounded runPending 不将暂时失败伪装 applied。

原 providerCommands 下标维护风险已经由 `admin-finance.test.ts` 新精确断言覆盖：只接受 CANCEL_PAYMENT、REFUND_PAYMENT、RECONCILE_PAYMENT、RECONCILE_REFUND 四种，数组重排/误选将导致测试失败。这是原非阻断备注的实质闭合，未修改合同实现。

这份非作者复核不把 TEST PSP 视为真实商户。退款金额占用的实际PG锁/隔离验证由 persistence owner 证据和 root 独立检查承接；本人后来仅按 root 委派机械拆分 apply 文件，不能充当该拆分的非作者最终复核。

## 身份诊断与最终 UI 候选边界

UI 的延迟事件取值、两艺人分配标签、桌面space-6与切换group语义均已修复。本人解析最终样式候选 `integration-2026-09-21T21-01-43.406Z/browser-finance/results.json` 的已运行部分：47截图/47axe、259断言全通过、0violations、0incomplete、0页面错误；英文桌面partial截图实见内边距生效。这只是部分范围，整轮为FAIL，不能替代whole-run。

协调者与runtime/PG提供的聚焦因果诊断已将两个认证异常定位到本机墙钟回拨：一处已签发session的created_live=false、created_at领先实际PG now约61.9ms；另一处callback complete时间早于已存claimed_at、触发0030 check3。生产SameSite、session有效性、MFA/CSRF规则未修改，只有TEST夹具受严格因果条件控制的恢复门正在验证。待42次认证stress与完整HTTP/UI回归后再确认最终候选；本报告不把接口重试或丢弃失败当已通过。

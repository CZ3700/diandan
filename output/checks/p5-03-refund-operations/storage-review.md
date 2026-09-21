# P5-03 PostgreSQL storage review

Scope: local development and controlled TEST fixtures only. No real PSP merchant credentials, live funds, deployment, repository push or production release is included.

## Implementation

- `admin-finance-command` authorizes live MFA/CSRF sessions, locks grants, validates order versions and persists immutable idempotent receipts. Finance reads use `orders.read`; mutations require `finance.manage`, seeded only for the Manager role.
- `admin-finance-refund-request` locks original capture/order/item capacity, reserves every non-FAILED amount (including UNKNOWN and successful refunds), enforces original currency and prevents additional refunds while an actual OPEN/LOST dispute exists.
- `admin-finance-recovery` persists fenced dispatch authorization before PSP I/O. A dispatched or ambiguous mutation only reconciles the original account/environment/attempt/refund identity. Only explicit provider-directory failure before the PSP call permits the same mutation key to be dispatched again. Reconcile dispatch authorization audit is independent from its eventual result/evidence audit.
- Lease validation re-reads wall clock after obtaining the operation lock and after potentially waiting for the order lock. Expired/stale responses write no provider evidence or fabricated result audit.
- `admin-finance-evidence` retains authenticated query outcomes; an exact prior provider event is reused while each actual query still has a separate result audit. Canonical economic transaction correlation covers CAPTURE/REFUND/CHARGEBACK/VOID; OPEN and LOST observations of the same chargeback share one ledger transaction.
- `admin-finance-apply` coordinates locks and routes independent payment/refund/dispute state machines. Unmatched early evidence remains retryable; late progress is ignored, conflicting terminal state or wrong identity is durably marked for review with an audit. Aggregate dispute status is LOST > OPEN > WON > NONE.
- Safe cancellation covers an unattempted checkout and trusted terminal uncharged attempts. Unknown/in-flight payment cannot release funds or inventory without trusted evidence. Cancellation closes checkout/cart/private intents and releases reservations through the original inventory ledger.
- Migration 0035 adds four financial-operation/receipt/retry tables, authorization/append-only/fencing guards, exact order/refund/dispute projections, active-cancellation payment-attempt prevention and fulfillment financial holds. OPEN/LOST and active refunds block prepare/deliver/resume; trusted FAILED/WON only remove the financial hold and do not automatically deliver an order.
- Downgrade locks the financial/audit/provider histories before refusing to erase retained financial commands, receipts, schedules, audits or non-CAPTURE aliases. Earlier migrations are unchanged.

## Lock order review

Payment runtime operations -> finance operations (sorted) -> provider event -> cart/order -> attempt -> refund/dispute/item capacity. Standalone refund request takes no existing operation lock after its order lock. PSP I/O occurs outside repository transactions. The webhook context load performs no early provider-event row lock. Actual HTTP concurrency is independently exercised by the runtime agent.

## Validation

- Lease regression: `storage-lease-red.log` proves the previous implementation accepted a claim after waiting past expiry; `storage-lease-green.log` proves the independent clock recheck rejects it.
- Mapping and SQL parameter regressions retain earlier RED evidence: `storage-pg-first.log`, `storage-pg-second.log`, `storage-pg-third.log`. Fixes use `public_order_id` and UUID-first casting for the platform-generated refund reference.
- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres exec vitest run src/admin-finance-migration.test.ts src/admin-finance-read.test.ts src/admin-finance-recovery.test.ts src/order-payment-application.test.ts src/payment-transaction-canonical.test.ts src/reliable-event-repositories.test.ts`: 6 files / 25 tests PASS (`storage-tests-final.log`).
- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres typecheck`: PASS (`storage-typecheck-final.log`).
- `mise exec node@24.20.0 -- corepack pnpm turbo run build --filter @fan-support/api --filter @fan-support/worker --output-logs=errors-only`: 27/27 tasks PASS (`storage-api-worker-build.log`).
- Owned storage files and scripts pass ESLint (`storage-lint-final.log`) and Prettier (`storage-format*.log`).
- `mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/postgres-integration.mjs --write-catalog`: actual PostgreSQL up/down/up round-trip PASS, 35 migrations / 193 tables (`storage-catalog-final.log`).
- `storage/run-2026-09-21T20-34-12.658Z`: actual PostgreSQL + S3 + original checkout/payment fixture PASS 6023 assertions, including 5763 prerequisite checks, 259 finance/protocol checks and one input-SHA consistency check. `sourceUnchanged=true`.
- Final reproducible public entrypoint: `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:admin-finance`; result recorded separately in `storage-entrypoint-final.log` and its generated run directory. It includes required builds.

## Proven negative cases

Read-only operator mutation; wrong currency; capture/item over-refund; changed idempotency input; competing refunds for remaining capacity; duplicate event/settle; network uncertainty without mutation retry; lease expiry while waiting on operation and order row locks; private/stock checkout cleanup only after safe cancellation; same chargeback native transaction across OPEN/LOST; early terminal and late progress; incorrect LOST+WON aggregate despite an authentic WON event; refund reference bound to another paid attempt; SQL fulfillment bypass during active refund/dispute; unrelated successful audit attached to CANCEL/RECONCILE receipt; deletion of command history; mutation of successful refund amount.

## S.U.P.E.R review

1. Responsibilities separated into command/refund request/read/recovery/evidence/cancel/payment apply/refund apply/dispute apply/projection/repository modules.
2. Request admission, provider dispatch, external outcome recording and evidence application have separate entrypoints; provider I/O is excluded from database transactions.
3. Adapter dependencies point to contracts/domain/ports; no browser or route dependency added.
4. Composition wiring preserves the repository dependency direction; no reverse import introduced.
5. All public port inputs/results use frozen schemaVersion 1 contracts.
6. Public cross-layer values remain JSON serializable; SQL rows, client and callbacks stay internal.
7. Production paths/accounts/brands/locale/credentials are not hardcoded. Fictional fixtures use explicit TEST configuration only.
8. No new external package dependency was introduced.
9. PostgreSQL remains behind `AdminFinanceRepository` and its transaction manager; adapter replacement does not change domain or application contracts.
10. Focused unit/type/build/lint/real PostgreSQL gates above pass. Full-repository compatibility/quality gates and independent HTTP/browser acceptance are coordinated by root/runtime agents.

Final entrypoint outcome: PASS, exit 0, 6023 assertions, `sourceUnchanged=true`, `storage/run-2026-09-21T20-36-06.340Z`. The only fixture change after the earlier 6023 run removed an unused local binding while preserving its awaited DETAIL read. No product or migration change occurred between those runs.

## Legacy order-payment regression follow-up

Root's first full legacy run failed with an AssertionError inside the unlabelled actual-expiry fixture; the persisted failure was at `actual expiry and late authenticated capture retain payment as PAID_REVIEW`, assertion count 6769. No PostgreSQL guard error accompanied that failure. The outer ephemeral harness hid the underlying assertion details.

The same frozen product and migration candidate passed both:

1. A focused actual HTTP UNKNOWN checkout -> real 8-second inventory expiry -> original domain/repository expiry transition -> authenticated late CAPTURE -> PAID_REVIEW (`storage-legacy-expiry-debug.log`).
2. The complete original `apps/api/scripts/order-payment-http.mjs` with a process-only safe assertion diagnostic preload, exit 0, **6827 assertions PASS**, including expiry, rollback/unknown-COMMIT recovery and migration downgrade refusal (`storage-legacy-order-payment-debug.log`; `output/checks/p4-05-order-completion/run-2026-09-21T20-42-01.219Z`).

No product source, database constraint, timeout, expected result or legacy test branch was changed. The diagnostic preload only reports an assertion's safe enum/number and script location when it fails. The first run's exact assertion could not be reproduced; it remains retained as an observed transient fixture failure rather than an invented product fix. Both subsequent actual-expiry checks preserve the PAID_REVIEW invariant.

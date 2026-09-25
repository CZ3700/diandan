# P4-06 notification persistence evidence

Scope owner: `/root/order_bff`. Product changes are limited to new notification PostgreSQL repositories, migration 0029, and the narrowly compatible order-access token-purpose/bootstrap changes. Root owns contract/application/worker wiring, generated catalogs, final whole-repository checks and commit.

## Implemented behavior

- Real immutable outbox events and canonical paid evidence authorize notification materialization. The stored variables equal original order/order-item snapshots, including DAILY names and amounts; private contact, support content, raw capabilities and rendered email are absent from runtime storage.
- Durable fenced claims, append-only attempt results, a fixed provider deduplication deadline, frozen rendering hash/profile/nonce/key version, and current contact audits protect retry dispatch. UNKNOWN reuses the same command and token; a consumed link is never reissued or extended. Failures return observable FAILED decisions.
- Real earlier order events must be terminal before later stages can dispatch. Recovery skips blocked higher stages, including when they were created earlier; deadline expiry remains recoverable even before a later scheduled retry time.
- Notification link rotation leaves existing order sessions valid. Checkout bootstrap tokens use a separate purpose and must be consumed with their exact session/audit before commit; public exchange only accepts LINK purpose.
- Migration 0029 also contains the bounded, exactly audited SYSTEM checkout-expiry transition used by the separately owned expiry repository. The old migration files are not edited. The down migration refuses to erase runtime/bootstrap/expiry historical evidence.

## Actual verification

`mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres exec vitest run --config ../../vitest.config.ts --root . src/notification-repository.test.ts src/notification-lifecycle.test.ts src/notification-migration.test.ts src/order-access-repository.test.ts`

- 26 tests passed in `green-current.log`; the package typecheck/build and owned format/lint checks passed. Root subsequently rebuilt the latest recovery query.
- Earlier effective RED records remain in this folder: missing repository/migration, bootstrap retiring the mail link, missing historical authority, silent SKIP instead of actual FAILED, and initial expired-request cancellation instead of a failed preparation attempt.
- `trigger-probe-red.json` / `trigger-probe-green.json` show real PostgreSQL 42703 fixed by safe cross-trigger row extraction. No old SQL was weakened.

`mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/notification-integration.mjs`

- `integration-first.log`: failed after 6471 assertions in the test fulfillment writer. ON_HOLD row/event reason codes disagreed; the existing database guard correctly rejected it. This run was not final acceptance and used the then-incorrect mail route.
- `integration-starvation-red.log`, `run-2026-09-16T02-26-13.746Z/failure.json`: real limit-one recovery starvation reproduced at assertion 5809. Only unrelated application CTA dist/template identities changed while it ran; no render happened before this exact failure. The tested repository source/dist remained unchanged. This is targeted RED evidence, not full stable-input acceptance.
- `integration-second.log`: entry failed before any business assertion because fingerprint inventory incorrectly named `apps/storefront/app`; corrected to the actual `apps/storefront/src` tree. It is not counted as a business RED.
- `integration-third.log`, `run-2026-09-16T02-31-39.751Z/run-result.json`: **exit 0, PASS 6812, sourceUnchanged true**. 5763 setup assertions, 1048 protocol assertions, and one final input-hash assertion. This exact result is the current complete protocol evidence.

The final run covers all seven frozen locales; exact canonical amounts; three real historical order stages; recovery ordering; bootstrap in both issuance orders; immutable nonce/amount and incomplete-bootstrap rejection; accepted HTTP result loss plus link exchange; loss of the result after actual COMMIT; failure before completion plus real elapsed lease recovery; concurrent claims; explicit locale fallback; revoked/expired links; changed rendering; attempt exhaustion; contact retention; actual sixty-second deadlines with a 120-second retry delay; and untouched requests becoming failed preparation attempts without any provider call.

The same run includes a real HTTPS TEST gateway backed by PostgreSQL, process restart after response loss, concurrent duplicate requests, immutable-command conflicts, refusal of a new send after the receiver deadline, and replay of a stored receipt after the deadline. The provider fixture stores only opaque identifiers/hashes/receipts, not contact/content/token bytes. It deliberately deletes only one TEST provider receipt to simulate finite retention; it does not alter commerce facts or database clocks.

Root's actual pg-boss/Worker composition consumes both real outbox event types, records two effects and one accepted mail. Its exact transient mail HTML link is clicked in production Next, using a real exchanged order session. Vietnamese 390×844 and 1440×900 checks report keyboard/reduced motion/axe zero, one exchange, fragment removal before exchange, no observed private leakage and successful cleanup.

## Visual review caveat

The mobile screenshot has legible amounts and status. Manual review of the desktop full-page screenshot found the order-summary amount text apparently absent while item amounts remain visible; the automatic helper checked data attributes rather than visible price text. This was reported to root and the browser owner for investigation. Do not treat that visual point as accepted solely from the current protocol PASS. Product source was not changed during this review.

## S.U.P.E.R scope review

1. Modules separate source/request, lifecycle, access/contact authority, data helpers and repository boundary; migration owns persistence invariants. Test scripts each orchestrate the notification protocol.
2. Production functions perform one repository operation or one shared transition; no HTTP/provider work occurs inside PostgreSQL functions.
3. Application → persistence port → PG adapter. The adapter does not import Application. Test composition imports concrete adapters only in scripts.
4. Dependency direction is acyclic: repository → lifecycle/access → shared data; access → lifecycle is one-way.
5. All repository commands/results and transported rendering plans use the frozen schemaVersion contracts.
6. External I/O is JSON-compatible; raw buffers are converted to the existing encrypted-value wire format only inside an authorized contact read.
7. Origin, site name, profile hash, key version, lease/deadline and budgets are injected/frozen. Fixed SQL status values and explicit TEST fixture values are not production configuration.
8. No new production third-party dependency was introduced by this scope. Existing contracts/persistence-port/pg and Node built-ins are used.
9. The repository is replaceable behind NotificationRepository and NotificationTransactionManager; root wiring provides its factory.
10. Scoped unit/type/build and real protocol checks passed as stated. **Final full-repository gate, independent combined review and the visual caveat remain root-owned; this document does not assert them complete.**

## Limits

Local TEST gateway acceptance is not delivery to a real mailbox. The PSP is the owned TEST service, not a merchant sandbox. KMS is the local test adapter, not AWS evidence. Physical fulfillment transitions are guarded WORKER fixture SQL over normally paid, message-free orders; no physical delivery or admin fulfillment UI is claimed. Translation human approval, a real sender/domain/provider, actual arrival ordering, staging and release remain separate gates. Only selected actual notification/frontend inputs are fingerprinted here; final whole-repository provenance is separate.

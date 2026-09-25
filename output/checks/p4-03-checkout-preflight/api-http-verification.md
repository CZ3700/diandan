# P4-03 API / real HTTP verification

The original checkout HTTP gate exited **0**. Reproduce with `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:checkout-preflight`. Evidence is `http-fifth.log` and `run-2026-09-08T14-44-01.620Z/{protocol-results,run-result}.json`. The fixture completed at 2026-09-08 14:45:45 UTC and released its resources; a subsequent read-only process check found no checkout harness Node processes. No Next or browser was started.

The final run passed 20 cases and 195 cart/checkout HTTP requests. Its 7,404 counted assertions consist of 5,760 setup assertions and 1,644 protocol assertions (including normal operator changes, bounded expiry polling and read-only database checks). The independent migration rollback proof adds 8 assertions. Counts are actual observations, not a target that permits skipping cases.

The database contained 17 unpaid orders, 32 order lines and fulfillments, 17 encrypted contacts, 68 exact policy acceptances, 3 tracked reservations, and 17 checkout receipts plus 17 checkout Outbox records. Each initial fulfillment also had its exact existing Outbox event, including event identity, sequence, request/correlation, microsecond event time, language, market, currency and `PENDING` payload status. No payment attempt was created.

## Observed behavior

- All seven supported languages created three-line historical orders. Order content, policy revisions, amounts and database snapshots remained unchanged after normal artist, policy and price republication. The seven original quotes remained unexpired during this comparison.
- Validation creates no order/contact/reservation. Cookie, Origin, CSRF, idempotency, version, foreign-session and untrusted amount/language/policy input were checked through real HTTP.
- Two recipients share tracked inventory correctly; two concurrent carts competing for the last item produced exactly one order and one stock rejection. Concurrent same-key creates produced one order and replay, with exact Outbox identities preserved. Independent cookies can use the same request key without sharing orders.
- A local fault proxy forwarded a real successful create and then disconnected its downstream socket before sending response headers. The identical request key/body recovered the existing order. This was an actual HTTP disconnect, not a fabricated success response.
- A real TEST-only three-second TTL proved expired observation rejection and a committed quote's transition from `expired=false` to `expired=true`. The latter preserved historical fields and remained `UNPAID` / `PENDING_PAYMENT`; reading it did not create another business action. The production TTL was unchanged.
- Normal operator actions paused an artist/gift, removed available stock, republished artist/policy content and changed the price book. Stale confirmations were rejected. A real Chinese DAILY gift was published and its Chinese original provenance survived an English checkout.
- The original gift price actually changed from 1,500 to 1,637 minor units. A fresh cart used the new value. The original cart first displayed `CHANGED`, then accepted the new current price ID through its existing versioned PATCH operation, retained the same item, and created a newly confirmed order at 1,637.
- Actual direct SQL and the normal migration runner both refused destructive 0025 rollback. Counts and hashes of all 21 checked tables remained identical. The final log retains normal SERIALIZABLE `40001` retries and the two expected `55000` rollback rejections.

## Preserved failures and fixes

| Run log           | First observed failure                                              | Resolution                                                                                                                               |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `http-first.log`  | Observation INSERT `23514 / checkout_preflight_observations_check2` | Persist the same canonical representation used by the consent hash; the original strict database constraint remains.                     |
| `http-second.log` | CREATE COMMIT `23514 / assert_fulfillment_event_outbox`             | Application appends each initial fulfillment's existing durable event through the same transaction's Outbox port.                        |
| `http-third.log`  | Outbox INSERT `23514 / outbox_events_time_check`                    | Existing Outbox writer supplies creation time compatible with the authoritative event time; prior time/source constraints remain tested. |
| `http-fourth.log` | New policy copy rejected with `POLICY_EFFECTIVE_TIME_INVALID`       | TEST fixture supplies a new real future effective time and waits for it after normal approval; no policy rule changed.                   |

Each run directory, failure JSON and log is retained. The fourth failure was a fixture error; it is not described as a policy product defect.

## Verification boundaries and final source

`api-final-unit.log` records 8 API test files / 28 tests passing; `api-typecheck-2.log` and scoped lint/format checks passed. The original HTTP command rebuilt its real backend dependencies and ran three Node harness tests before starting PG/S3. `api-http-source-freeze.json` records the final 19 API/harness inputs and their hashes. The only change after the successful fifth HTTP run splits request accounting: that original report's legacy `setupRequests: 1989` actually counts all normal operator HTTP requests across setup and protocol. The final runner captures setup requests before protocol and reports protocol operator requests separately. No assertion or business behavior changed, and the original fifth report was not rewritten. Root's complete `pnpm check` exercises the final runner again.

The fulfillment profile rows are explicitly encrypted TEST prerequisites because the operational profile editor belongs to a later phase. S3/TLS media, PostgreSQL, normal publication APIs and the real KMS adapter are exercised locally; AWS KMS service access, browser checkout, PSP, production deployment and human operation are not claimed. Email/message canaries are generated at runtime, kept out of saved evidence, and checked against public responses and structured logs.

S.U.P.E.R review of this API/harness scope: single-purpose transport/composition/fixture/protocol/proof modules; inward dependency flow without added cycles; strict versioned cross-module contracts; serializable command/results; existing explicit server configuration and TEST-only fixture values; declared existing dependencies; replaceable transaction/KMS ports. Scoped tests and the real HTTP gate pass. Root owns the separate full-repository gate and final phase status.

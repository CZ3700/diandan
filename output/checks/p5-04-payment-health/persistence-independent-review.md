# P5-04 payment health persistence independent review

Reviewer: `health_runtime` (application/API author; not the author of the reviewed persistence modules or migration). Date: 2026-09-22 Asia/Bangkok.

Scope: read-only review of `packages/persistence-postgres/src/payment-health-{repository,data,context,probe}.ts`, the new transaction-manager wiring, `database/migrations/0033_payment-provider-health.{up,down}.sql`, and the real PostgreSQL fixture source. No tests, builds, PostgreSQL instances or implementation changes were run by this reviewer. The coordinating task reported the first 56-check real PostgreSQL pass; that is supporting evidence from the author, not an independently rerun result. Concurrent rollout migration 0034 and its write-path changes are excluded.

## Blocking integration finding

**[P1] Partial rollout is rejected by health context validation.** `payment-health-context.ts:23` requires both route and provider rollout percentages to equal 10000. The current P5-04 integration is adding deterministic partial-rollout admission. An otherwise eligible checkout in that cohort will produce a real capability observation, but `record()` rejects its context as `CONTEXT_UNAVAILABLE`; the application consequently closes that capability. The same predicate makes recovery probes for a partially enabled account defer forever. This would make the new rollout path unusable whenever health observation is enabled.

Required correction: validate that this already-published route/provider remains enabled at a positive rollout percentage, while retaining every existing account/environment, publication/version, amount, market/country/currency, action and locale/review check. The health read is not a fresh payment authorization, and its safe-query context has no checkout cohort identity; final payment admission must continue to use the dedicated deterministic cohort decision. Zero rollout must stay unavailable. First add real PostgreSQL RED cases for recording and claiming a valid partial-rollout context, and a zero-rollout negative case; then correct this predicate and rerun the integration fixture.

## Nonblocking consistency observation

`healthProbeContextAvailable` accepts an `INTERNAL` account in either environment. Existing application routing permits `INTERNAL` only in `TEST`. A previously active LIVE account changed to INTERNAL could therefore still receive this read-only health query. It cannot authorize a payment: the actual checkout eligibility check still refuses that account, and the probe has no financial operation. Matching the existing `(ACTIVE OR INTERNAL+TEST)` rule would nevertheless prevent an unnecessary LIVE query and keep eligibility terminology consistent. Cover it when editing the predicate above if this account-state transition is supported.

## Reviewed invariants without another blocking finding

- Every write/claim locks the provider account before its health state. The due claim uses `FOR UPDATE OF account SKIP LOCKED`; it does not reverse that order by locking state first. Health work never acquires checkout/order locks.
- This transaction manager uses READ COMMITTED. Observation receipt lookup is repeated after acquiring the account lock; a conflicting cross-account insert is checked again after `ON CONFLICT DO NOTHING`, when the committed row is visible. Exact replay does not increment the counter or append another health event; changed contents reject.
- Policy values are parsed from PostgreSQL for every state transition/probe. Bootstrap compares the complete normalized policy against the active version and rejects drift. Immutable version history can coexist without automatic activation.
- Clock and probe expiry come from PostgreSQL. Ordinary success does not erase the fixed failure window or recover an open circuit. A new technical failure increments the fence and invalidates any probe. Completion compares probe ID, generation, exact context, exact expiry, current account version and policy version, then checks current PostgreSQL time.
- Recovery completion revalidates the published context before changing availability. Stale/expired completions cannot add recovery evidence or change the account. Failed and successful valid probes append bounded observation evidence; replay cannot append a second recovery event.
- A health transition writes the original append-only health event and advances the original account version in the same transaction, preserving the pre-existing deferred event/head constraint. The health code does not modify payment attempts, PSP keys, order amounts or routing bindings.
- SQL envelopes constrain allowed fields, operations, classifications, reason codes and safe query context; no provider payload or credentials are accepted. Policy/observation history is append-only, and down-migration refuses to discard nonempty history.

Decision: **hold combined acceptance until the partial-rollout integration finding is corrected and covered by actual PostgreSQL evidence.** This review does not approve live PSPs or release readiness.

## Follow-up: resolved before combined acceptance

Read-only source recheck confirmed that `healthProbeContextAvailable` now requires positive provider/rule percentages and rejects `INTERNAL` outside TEST. All amount, identity, current publication, currency/market/country, action and approved locale predicates remain. The real PostgreSQL fixture now publishes actual partial percentages and checks their persisted values; the coordinating task reports RED followed by 81 checks GREEN. The reviewer did not rerun that database fixture. Both review findings are resolved at the persistence boundary; the new combined HTTP/PSP rollout proof remains a separate required integration result. No remaining blocking persistence finding was found in this bounded review.

## Combined integration follow-up

The reviewer subsequently ran the new independent `payment-rollout-http.mjs` fixture. `rollout-http-4.log` exits 0; `rollout-http-2026-09-21T18-28-05.419Z/protocol-results.json` records 343 scenario assertions in addition to 5,761 shared fixture assertions. Actual PostgreSQL, HTTP APIs and a separate TLS TEST PSP prove partial-rollout observations, one fenced safe recovery probe across two lifecycle instances, both repository and deferred-constraint admission defenses, and original UNKNOWN recovery after a normally committed zero-percent replacement publication. See `rollout-http-review.md` for exact scope and retained test-harness failures. This independently resolves the previously outstanding combined acceptance question; it is not live merchant or production evidence.

# P5-04 combined rollout, health and payment HTTP evidence

Runner: `apps/api/scripts/payment-rollout-http.mjs`. Executed by `health_runtime` against the coordinating task's successful `api-build-4` (migration manifest through 0034). No product build was run by this agent.

## Verified result

`rollout-http-4.log`: exit 0. `rollout-http-2026-09-21T18-28-05.419Z/run-result.json`: PASS, 6,104 assertions. `protocol-results.json` separates **5,761 existing fixture assertions** from **343 combined scenario assertions**, including protocol-client and helper checks. Three ordinary server-created checkouts supplied both cohorts; one additional real checkout tested the replacement zero-percent publication. The selection loop is bounded to 30 and never fabricates checkout identities or supplies a client rollout seed.

The fixture uses actual PostgreSQL and migration constraints, actual HTTP API compositions, TLS object storage, and a separate TLS TEST PSP process with durable state. It does not use a commercial PSP, a merchant account, real funds, staging or production. The two API compositions have separate pools and lifecycle instances in the same Node process; this is not proof of separately deployed API processes.

- The initially published PostgreSQL provider/rule percentages are 10000/5000. The pure domain decision for each real checkout matches both API instances' country discovery. Repeated requests retain eligibility across all seven presentation locales, route/configuration versions, amount and currency. The persisted GET_CAPABILITIES command retains the original English consent locale under the existing API language policy.
- An excluded checkout has empty country-free capabilities. Explicit-country requests and a forged known current capability are rejected with `409 CAPABILITY_UNAVAILABLE`; client `rolloutSeed` body/query fields are rejected with `400 INVALID_COMMAND`. No payment attempt or TEST PSP financial action is created.
- `payment-rollout-guard-proof.mjs` independently bypasses only the application read projection: real `beginCreate` still rejects the excluded checkout. A second case additionally overrides only the already-false SQL admission result; the original enabled deferred receipt constraint rejects COMMIT with SQLSTATE 23514. Each case proves unchanged canonical checkout/order/attempt/receipt/event/outbox state and unchanged PSP financial counts. The second case reaches `beginCompleted=1` and `deferredFailures=1`, so the result cannot be attributed solely to an earlier application rejection.
- Two real TLS capability failures on a partial-rollout route open the persisted circuit. Two lifecycle instances perform exactly one fenced GET_CAPABILITIES recovery query. The account becomes healthy without any financial action.
- An admitted CREATE_PAYMENT is accepted by the TEST PSP, but its TLS response is lost; the API preserves UNKNOWN. The normal replacement publication transaction creates version 2 with a new rule UUID, the same account, reviewed translations, fresh audit/outbox evidence and percentages 0/0. Historical published payload rows remain unchanged. A newly created checkout is unavailable and cannot create a payment even with the current version/rule identifiers.
- The original UNKNOWN replays under its original key through the second API instance after that replacement publication. Authenticated reconciliation restores REQUIRES_ACTION with the original provider account, rule UUID, configuration/rule versions, amount, currency, merchant reference and provider idempotency key. Final TEST PSP counts are **one payment, one create call, one reconcile call, zero captures**. No second create is issued.
- Twenty-four bounded health observations are persisted. Private message, display-name and email canaries are absent from health evidence and application logs. Safe failure files contain bounded stages/codes rather than raw provider errors. The owned fixture cleanup paths run on both failure and success.

## Execution history and reproducibility

Command, after the coordinating build:

```sh
mise exec node@24.20.0 -- node apps/api/scripts/payment-rollout-http.mjs
```

`rollout-http-static.log` records successful Prettier and ESLint checks for the new runner. The helper author separately verified both new helper files.

All failed execution logs are retained; they are test-harness corrections, not evidence that production code was intentionally made to fail:

1. `rollout-http-1.log`: the API package does not directly link the domain package. The runner now imports the built local domain entry explicitly; this launch did not create a fixture.
2. `rollout-http-2.log`: the replacement-publication helper tried to publish the new version before superseding the old one. The existing single-PUBLISHED unique index rejected it with 23505. The helper now orders those changes correctly within the same transaction.
3. `rollout-http-3.log`: the replacement-publication helper omitted the publication-head version increment. The existing head transition guard rejected it with 23514. The helper now increments the head version. Constraints and product code were not weakened.
4. `rollout-http-4.log`: the complete real integration passes after both precise helper corrections.

This evidence closes the combined partial-rollout/health integration question raised in `persistence-independent-review.md`. It does not replace the coordinator's full repository checks, operational runbooks, remaining plan gates, or eventual commercial merchant acceptance.

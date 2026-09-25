# P3-06 canonical persistence failure — independent review

- Reviewer: Codex `/root/error_fix_review`, non-author; 2026-09-16 17:02 UTC.
- Decision: **ACCEPT for the reviewed code and focused unit-test scope**. Coordinator retains responsibility for actual PostgreSQL, repository gates, final evidence and task status.
- Reviewed: `transaction-runner.ts`, its tests, `postgres-publication-read-failure-cases.mjs`, and its integration into the original publication runtime script. No source files changed by this reviewer; no build, PostgreSQL or browser processes started.

## Finding resolved before acceptance

The first five-line implementation added unguarded `instanceof` and read `error.failure` directly. An unknown driver error Proxy whose `getPrototypeOf` throws escaped as `RAW_PROVIDER_PROTOTYPE_TRAP`; a mutated canonical instance could likewise run a replacement failure getter. This regressed the existing classifier's fail-closed treatment of unknown provider objects. The reviewer reproduced the Proxy escape by transpiling the actual current source into memory, without modifying or rebuilding it.

The final implementation now bounds this inspection with `try/catch`, reads an own data descriptor, reuses the existing getter-free canonical JSON snapshot, and parses the established persistence contract before constructing a clean error. New tests cover throwing prototype inspection, revoked Proxy, replaced failure getter, nested payload getter and malformed payload. Existing and new tests passed after this correction. The resolved issue is not an outstanding finding.

## Correctness and scope

Nested canonical errors preserve their schema-defined code, recovery and retry delay. Rebuilding a fresh error discards attached adapter message/cause instead of carrying them across the port. Plain objects that only imitate a canonical error name/code remain on the SQLSTATE classifier path. Strict schema policy still associates `TRANSACTION_OUTCOME_UNKNOWN` with `RECONCILE_REQUIRED`; the patch neither invents retries nor catches an operational failure as success.

The helper is shared by content, cart, order access, media, notifications, authorization, payment-related repositories and transaction setup/rollback. Existing payment/resource wrappers that already parse canonical failures remain compatible. The dedicated COMMIT classifier was not changed: connection loss after COMMIT still requires reconciliation; a serialization failure proving abort remains retryable; failed cleanup still destroys the client. Callback rejection, rollback-only and tracked-operation behavior remain intact.

The new PostgreSQL helper is a substantive regression scenario: it takes a real lock on the published idol, reaches the existing nested preflight `FOR SHARE` query, and expects a genuine `55P03`. It distinguishes the public repository result from the transaction manager's first tracked error, then checks one rollback, an idle connection without an open transaction, successful reuse of the same pool connection and unchanged publication proof after contention ends. The failure and recovery checks do not synthesize successful content or weaken publication proof. The helper's timeouts and example media origin are confined to test code. Its source was reviewed; actual execution belongs to the coordinator's RED/GREEN evidence.

## Independent validation

```text
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test src/transaction-runner.test.ts src/errors.test.ts src/repository-savepoint.test.ts src/postgres-persistence.test.ts src/reliable-event-repositories.test.ts
```

Final independent run: exit 0, **5 files / 116 tests passed**, Vitest duration 1.53 seconds. This covers original commit ambiguity, abort, rollback/savepoint, persistence composition and reliable-event protections along with the new boundary tests. The earlier pre-correction independent run had 112 passing tests but omitted the newly exposed Proxy failure; it is not used as final acceptance evidence.

S.U.P.E.R checks 1–9 pass for the reviewed scope: one normalization responsibility, existing inward port dependency, no cycles, schema-defined serializable error payload, no production hardcoded configuration, no new dependencies, and no change to replaceable adapter contracts. Check 10 passes for the independent focused suite; full task verification remains the coordinator's responsibility.

## Evidence boundaries

This fixes demonstrated error reclassification. It does **not** establish the cause of the older naturally occurring HTTP 200 unavailable-content pages, improve measured LCP, satisfy the complete performance matrix, or supply real PSP/staging/phone acceptance. P3-06 and Phase 5 status must continue to reflect their recorded unmet gates.

Reviewed source SHA-256:

```text
29346fc81eab035341019d44b70c4bcdf00abf70ce0930f6be0b2bf09554ec99  packages/persistence-postgres/src/transaction-runner.ts
20a9a3002c72c3deafb9b4636875d7f9db4281de0edc45a2d3161d434410860c  packages/persistence-postgres/src/transaction-runner.test.ts
61e4fe28fdda950d36a728b3fcdc5ef540efb2cc0fda486ca91bc93ce0e087a2  packages/persistence-postgres/scripts/postgres-publication-read-failure-cases.mjs
94da9390409c32d1e44a0aff97d9a93163793481580a3ff6fb10e507e874541a  packages/persistence-postgres/scripts/postgres-publication-runtime.mjs
```

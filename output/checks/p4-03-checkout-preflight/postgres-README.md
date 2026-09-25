# P4-03 PostgreSQL checkout preflight evidence

This is the PostgreSQL author's scoped implementation record. It is not a claim that the complete HTTP checkout, shared browser gates or original workspace check has passed.

## Implementation

- `checkout-preflight-{content,current,data,repository,write}.ts` authenticates the cart, locks cart/item/intent records and runs the existing complete publication projectors before deriving four independently bound content/media snapshots. A private transaction-local consent witness prevents callers from supplying unverified facts to save or commit.
- The new SERIALIZABLE manager shares one PostgreSQL client among checkout, cart, inventory, idempotency and outbox repositories. Application computes the inventory plan and applies the existing reservation writer in this same transaction. Any failure rolls back the entire operation.
- Migration 0025 adds immutable observations, receipts and a separate checkout outbox; order-item version 2 supports actual daily-source provenance. The entire old version-1 validator remains unchanged behind the explicit dispatch. No payment attempt or paid status is created. Initial fulfillments are PENDING with real fulfillment-profile references.
- `checkout_outbox_events` persists PENDING events only. The old dispatcher does not claim this separate queue. No asynchronous delivery or downstream processing is claimed; current checkout reads use PostgreSQL directly.
- Down migration rejects any new observation or checkout history before removing schema. The rollback helper compares counts and hashes for 21 tables and returns no original or encrypted rows.
- Seven old harnesses now explicitly roll back empty 0025 before their historical checks, or update only the full-up endpoint. Historical target versions and destructive rollback assertions remain intact.

## Commands and results

All Node commands use `mise exec node@24.20.0 --`.

| Evidence                                                                                  | Result and scope                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres-boundary-red.log`                                                               | 3 effective failures before repository/manager implementation.                                                                                                                                                                                                |
| `postgres-migration-red.log`                                                              | 2 effective failures before migration implementation.                                                                                                                                                                                                         |
| `postgres-boundary-first-green.log`                                                       | 3 files / 5 tests passed.                                                                                                                                                                                                                                     |
| `migration-manifest-first.log`                                                            | Manifest generation passed.                                                                                                                                                                                                                                   |
| `migration-catalog-first.log`                                                             | Real PostgreSQL up/down/up catalog roundtrip: 25 migrations, 165 tables passed.                                                                                                                                                                               |
| `postgres-parameters-first.log`                                                           | 29 actual read statements and dynamically built write statements passed PostgreSQL PREPARE. Inputs are structural TEST data, never inserted. This verifies parameter inference and columns, not business foreign keys, proof validity or successful checkout. |
| `postgres-build-http-ready.log`                                                           | PostgreSQL package build passed before the first HTTP run.                                                                                                                                                                                                    |
| `postgres-tests-final.log`                                                                | Package invocation with `--` ran all 83 files / 507 tests, all passed.                                                                                                                                                                                        |
| `postgres-tests-scoped-corrected.log`                                                     | Correct scoped invocation: 3 files / 9 tests passed, including expired, locked, wrong-owner and version-conflict cart rejection before any content read.                                                                                                      |
| `postgres-lint-final.log`, `postgres-last-test-lint.log`, `postgres-test-lint-last.log`   | Scoped ESLint passed.                                                                                                                                                                                                                                         |
| `postgres-format-first.log`, `postgres-format-final.log`, `postgres-test-format-last.log` | Owned source/scripts formatted using existing Prettier configuration.                                                                                                                                                                                         |
| `postgres-typecheck-corrected.log`                                                        | Final typecheck, after test-only schema typing correction.                                                                                                                                                                                                    |

Historical setup failures are retained: `postgres-tests-scoped-final.log` used the wrong root and found no tests; `postgres-typecheck-last-tests.log` exposed test-only inferred/unbranded values after replacing a temporary RED-phase import. Neither is counted as an effective product RED. The first scoped lint failure was an equivalent regex-space spelling in the migration test; the validator assertion was preserved.

## Compatibility and review

`postgres-source-freeze.json` records the 27 owned implementation/test/script/catalog paths and SHA-256 for all 48 old migration SQL files. All migrations 0001–0024 remain byte-identical to HEAD. No dependency, original public schema root, locale list, old privacy guard or existing inventory algorithm was relaxed.

The non-author read agent reviewed the actual source and independently compared the restored legacy validator: ACCEPT, no blocking finding. This source review did not rerun PostgreSQL or substitute for real HTTP validation. The PostgreSQL author separately reviewed domain inventory selection/planning: stable shared targets, progressive balance versions, a single location per line and zero reservation for nontracked items; no blocking finding.

The complete HTTP workflow and data-bearing rollback proof were handed to the E2E owner after the above build. Their actual results and final workspace/P2 gates must be read from their own run evidence. No production deployment, payment execution, private message disclosure or checkout outbox consumption is claimed here.

## First HTTP failure and canonical observation correction

The first actual HTTP run (`run-2026-09-08T14-15-41.188Z`, `http-first.log`) reached request 13 VALIDATE and failed SQLSTATE 23514 at `checkout_preflight_observations_check2`. That exact constraint recomputes the consent hash. JS canonicalization normalizes `effectiveAt` to six fractional digits, while PostgreSQL canonicalization only serializes the supplied JSON values. Saving raw `JSON.stringify(observation)` therefore disagreed with the already canonical hash.

The production correction is one expression in `savePreflight`: persist `canonicalPublicationValue(observation)`. No hash algorithm, migration SQL, database check, publication permission or consent field changed. The repository still compares the transaction-private verified consent before saving.

- `postgres-canonical-save-red.log`: effective failure on the actual repository bind parameter; raw zero/three-fractional-digit policy time differed from the canonical JSON.
- `postgres-canonical-save-green.log`: 4 files / 10 tests passed after the correction.
- `postgres-canonical-actual-red.log`: the initial temporary-table setup omitted defaults and failed 23502 (fixture error, not the product cause); the corrected setup retained all original CHECKs and raw observation failed 23514. Both attempts are retained.
- `postgres-canonical-actual-green.log`: 32 PostgreSQL assertions passed: the prior 29 statement PREPARE checks plus canonical observation accepted, raw observation rejected by exact check2, and altered consent rejected by the same check. This temporary LIKE table retained defaults and CHECKs but had no business foreign keys or triggers; it proves serialization/hash compatibility only.
- `postgres-canonical-build.log` and `postgres-canonical-types.log`: exit 0. `postgres-canonical-static.log` retains initial test/probe lint findings followed by the final scoped Prettier/ESLint success; production code had no further change.

The first source-only review did not catch this serialization mismatch. The correction and bounded evidence were handed to the non-author reviewer and E2E owner; the second normal HTTP run is the remaining business integration check.

## CREATE outbox findings and creation-time correction

The second actual HTTP run passed observation writing and reached CREATE request 35, where the original `assert_fulfillment_event_outbox` rejected the missing initial fulfillment outbox messages. Root added Application orchestration through the existing same-transaction `repos.outbox.append`; PostgreSQL source and guards were unchanged for that correction. The helper's identity/version/status/request/correlation/receipt timestamp and failure propagation were independently reviewed: ACCEPT. This does not emit a false payment confirmation.

The third actual HTTP run executed those messages but failed the original `outbox_events_time_check`: the generic writer omitted `created_at`, whose transaction-start default preceded the actual later receipt/event time. The minimal adapter correction explicitly writes `GREATEST(clock_timestamp(), event.occurredAt::timestamptz)`. It changes neither occurredAt nor availableAt, source authorization, event immutability, retry behavior or SQL guards. It is an ordinary controlled sequencing defect; no natural wall-clock rollback is asserted as its cause.

`postgres-outbox-event-time.mjs` now runs immediately after the existing postgres-repositories command in `test:postgres`. All prior commands retain their relative order. The probe follows the established isolated source-fixture pattern (replica mode only while seeding unrelated synthetic order/fulfillment source history). Before using the actual repository it explicitly verifies origin mode; actual outbox constraints, status derivation and COMMIT authority checks are active. This is not a complete legitimate checkout fixture; the normal HTTP run provides that evidence.

- `outbox-time-red.log`: the final effective RED uses a real PostgreSQL event at least 20ms after BEGIN and observes SQLSTATE23514, exact `outbox_events_time_check`, from the actual old writer. Earlier import/export and timestamp-expression fixture mistakes remain in the file and are not counted as product evidence.
- `outbox-time-green.log`: final 4 scenarios / 19 assertions PASS. Post-BEGIN and historical events succeed; availableAt before occurredAt still fails the exact time CHECK and marks rollback; incorrect source-event time is rejected at COMMIT by the original authority guard and leaves no event. An earlier negative-case oracle incorrectly expected pre-validation INVALID_COMMAND; the real unchanged boundary rejects INTEGRITY_VIOLATION, and its exact SQLSTATE/constraint is now asserted.
- `outbox-time-unit.log`: 3 files / 16 existing repository/savepoint/status tests passed. `outbox-time-build.log` and `outbox-time-types.log`: exit0. `outbox-time-static.log`: final Prettier check and scoped ESLint passed.

The old outbox has no event-expiry TTL: legitimate past events may be delivered later. No new TTL or expiration rejection was invented. The fourth full HTTP run receives this rebuilt adapter; its result is recorded by the E2E owner.

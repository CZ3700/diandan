# Independent TEST authentication-clock review

Scope: read-only review of product code and TEST helpers, plus explicitly authorized disposable PostgreSQL diagnostics. No product source, migration, authorization rule, or credential lifetime was changed. No application server or build was started by this review.

## Causal evidence

- `admin-access-repository.ts` samples PostgreSQL `clock_timestamp()` for creation/completion and preserves all six fractional digits when formatting UTC text. `admin-session-repository.ts` independently samples PostgreSQL clock and retains `created_at <= now` and expiry checks.
- Actual PostgreSQL verification over 10,000 timestamps found an exact text/timestamp round trip and zero microseconds of drift: `storage-auth-clock-roundtrip.log`.
- The retained browser diagnostic showed a successfully issued, matching, active MFA session that was still 61,894 microseconds ahead of the later PostgreSQL wall-clock sample. This proves the observed ordering problem; no particular OS time-sync cause is inferred.
- A separate retained callback failure named `admin_login_challenges_check3`. The expected catalog defines that constraint as `completed_at IS NULL OR completed_at >= claimed_at`. Claim and completion each use independently sampled database time; neither value is adjusted by the new TEST fixture.

## Fixture boundary review

- The session gate is installed only for one `authenticate` scope and removed in `finally`. It matches both digests of the session and CSRF cookies actually issued by that callback, accepts only the first matching GET, and leaves pre-callback credentials, other credentials, non-GET requests, and later requests untouched.
- The token-response gate uses the one-time authorization code's original state, HMACs it with the original domain separator, and selects exactly that persisted challenge. It requires `CLAIMED`, a real `claimed_at`, and a live expiry. It never selects the latest challenge or modifies a stored field.
- Both positive fixture gates wait for PostgreSQL and Node clocks to reach the original persisted timestamp plus the existing 500 ms test-readiness margin. Polling uses `performance.now()`, a six-second deadline rechecked after each read, and 25 ms delays.
- Unknown, revoked, expired, inactive, non-MFA, or CSRF-mismatched sessions continue to the original server authorization. There is no retry of a 401, authorization result, callback, authorization code, or provider operation.
- Production OIDC, session/access repositories, admin authorization, BFF, and migration 0030 remain unchanged. The IdP hook is optional and exists in TEST support only; its TypeScript declaration is additive.

## Lifecycle review and retained negative proof

The nine-test candidate tracks pending response/header work and route handlers. Each handler has one `continue` call on its chosen path and at most one fallback `abort`; the original handler error survives a secondary abort error. The seven non-server session-helper tests were independently rerun and passed. The other two token tests were inspected; their actual TLS execution remains in the runtime owner's evidence.

Two cleanup-only gaps were independently reproduced against the actual helper using controlled route callbacks, without starting a server (`storage-auth-teardown-review-red.log`, exit 1):

1. An `unroute` failure replaces an earlier retained route failure because cleanup awaits `unroute` before throwing the retained error.
2. A final handler scheduled while `unroute` is pending can outlive cleanup because the current drain runs only before `unroute`.

The runtime owner subsequently retained the first `unroute` error with `failure ??= error` and added a final pending-task drain after removal. Its two targeted tests failed before that change and passed afterward (`output/checks/p5-03-finance/session-clock-uninstall-red.log` and `session-clock-uninstall-green.log`). Independent reinspection and rerun of all **nine non-server session-helper tests PASS** (`storage-auth-teardown-review-green.log`), closing both review findings. Together with the runtime owner's two token tests, the helper suite is now eleven tests. These changes affect teardown only; they do not alter clock eligibility, HTTP authorization, or credentials.

## Executed browser evidence

Independently read `output/checks/p5-03-finance/integration-2026-09-21T21-25-56.393Z/authentication-stress.json` and `run-result.json`: **42/42 logins PASS**, zero failures, all seven locales and Manager/Order Operator roles; run assertions **6005**, including **5763** setup and **242** scenario checks. This evidence applies to the nine-test helper candidate before the final cleanup-only fix.

The subsequent full run `integration-2026-09-21T21-28-29.829Z` **failed**, with 6517 assertions reached, during seven-language management browser authentication. The observed PostgreSQL `guard_admin_login_challenge` rejection occurred within login completion, so an external positive readiness wait cannot guarantee the database wall clock remains ordered inside that transaction. This review does not mark full UI acceptance complete.

## Independent guest-clock measurements

Root authorized disposable diagnostic PostgreSQL instances with no migrations or business writes. Only containers carrying the existing exact ownership labels were created and removed. No daemon, VM time configuration, existing container, or production guard was changed.

- `storage-auth-clock-environment.mjs` compares adjacent PostgreSQL `clock_timestamp()` samples, timestamps against the same transaction's start, cross-statement samples, and host Node `Date.now()`. Each SQL statement has 200,000 ordered samples. Guest clock source was `arch_sys_counter`.
- Default scheduling, 12 seconds / 32.2 million samples: cross-statement regression of **210,325 microseconds**, with samples **211,037 microseconds before their transaction start**.
- CPU 1 affinity, 12 seconds / 32 million samples: **two same-statement regressions**, worst **214,994 microseconds**. The first short CPU 0 run had no observed regression; that was not treated as proof of stability.
- CPU 0 affinity, 65 seconds / **167.8 million samples**: **same-statement regression of 213,814 microseconds**, plus two cross-statement regressions. Host Node had **52,086 samples and zero observed regressions**. Evidence: `storage-auth-clock-cpu0-long.log`.
- A simultaneous read-only Python process inside the VM sampled `CLOCK_REALTIME`, `CLOCK_MONOTONIC`, and `CLOCK_MONOTONIC_RAW` on CPU 1 for 65 seconds: **43,734 samples**, **six realtime regressions**, worst **216,142,162 nanoseconds**; monotonic and raw clocks had **zero regressions** and continued advancing at the same observations. Evidence: `storage-auth-clock-vm.log`.
- Read-only VM status reported NTP enabled/synchronized. One snapshot showed +301.625 ms offset and +500 ppm frequency; the time-service journal showed timeouts/reconnections. These observations do not identify which process performs the wall-clock adjustment.

The independent measurements reproduce a guest realtime clock step, including inside a single PostgreSQL statement. They rule out CPU affinity as a reliable workaround and do not justify widening an authorization tolerance, changing persisted timestamps, or retrying refused authentication. The exact process responsible remains unproven. Environment remediation is required before claiming stable full UI acceptance.

After measurement completed and owned containers were removed, the diagnostic script received explicit built-in imports and formatting only; ESLint and Prettier passed. Its query, sample sizes, durations, and measurements were unchanged. Reproduction: `mise exec node@24.20.0 -- node output/checks/p5-03-refund-operations/storage-auth-clock-environment.mjs --cpu0-only --long`.

## Independent native PostgreSQL 18.6 acceptance

Root supplied an independently version-probed native PostgreSQL **18.6** tool directory recorded in `native-postgres-environment.json`. This reviewer passed only its explicit `binDirectory` into the runtime owner's TEST-only `withNativeFinancePostgres`; no existing database, cluster, port, credential, global server, DYLD override, or share-directory override was selected.

Source inspection found a newly allocated private temporary directory, a random ownership marker, a random password held in a mode-0600 initialization file, mode-0700 directory permissions, loopback-only binding, a fresh port, SCRAM host authentication, and disabled Unix sockets. Child processes strip inherited PostgreSQL environment overrides. Cleanup verifies the exact marker, real directory type, and matching `postmaster.pid` data directory before stopping the owned server; it refuses ownership conflicts. Commands use argument arrays, and failures do not expose credentials or subprocess output.

The independent script `storage-native-postgres-review.mjs` exercised **three actual native clusters**, all successfully shut down and removed:

1. Normal callback and exact database/data-directory verification.
2. A callback that connected successfully and then deliberately threw an error containing its generated password; the public error remained redacted and cleanup completed.
3. An actual successful `pg_ctl start` followed by an injected lost start response; the operation callback was never invoked, and the partially started owned server was still stopped and removed.

During the first cluster, **15 seconds / 38,600,000 PostgreSQL samples / 193 transaction iterations** showed **zero adjacent clock regressions, zero samples earlier than their transaction start, and zero cross-statement regressions**. The corresponding host Node sample count was **12,081 with zero regressions**. Exact evidence: `storage-native-postgres-review.log`, status PASS. The native harness's five focused unit tests were independently rerun and passed (`storage-native-postgres-unit-review.log`).

This establishes the measured native TEST environment and lifecycle behavior, rather than a production availability claim or a substitute for the complete finance browser matrix. Runtime's final full HTTP/UI verification on this environment remains a separate required acceptance result.

Reproduction: `mise exec node@24.20.0 -- node output/checks/p5-03-refund-operations/storage-native-postgres-review.mjs`. All reviewer-owned output scripts were formatted and linted after these runs and are frozen for the root quality gate; only evidence prose may subsequently change.

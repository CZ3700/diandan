# 0022 compatibility for historical PostgreSQL harnesses

Scope: four TEST scripts only. No application, payment, migration SQL, transaction guards, fixture business data or acceptance budget changed. This is separate from the successful management runtime 13 and from the earlier webhook constraint failure.

## Failure and correction

- `postgres-content-draft-repositories.mjs`: its explicit 0017 historical seed remains unchanged; after unrestricted migration up, require the actual current head 0022 instead of 0021.
- `postgres-publication-validation-time-cases.mjs`: the 0017 historical source assertion remains unchanged; only the post-up current schema assertion becomes 0022. The actual event, publication, MFA and expiry checks remain intact.
- `postgres-admin-catalog.mjs`: assert current head 0022, perform real `down 0022`, require exact reverted versions/head `[["0022"], "0021"]`, and compare the existing admin/translation/publication history snapshot exactly apart from that version. Continue the original 0021 rollback and actual 0020 history-rejection probe unchanged.
- `postgres-publication-runtime.mjs`: assert current head 0022, perform real `down 0022` before the original SEO purge downgrade, require its exact result and every existing purge-job row unchanged. Original 0021 retry-path checks, later history downgrade protections and fixed 0018 catalog roundtrip remain unchanged.

All four original scripts actually failed in fresh PostgreSQL before the edits. Draft, admin and runtime logs identify their old head assertions directly. The first event-time log only exposed the outer `EphemeralPostgresError`; the separate diagnostic run wrapped `assert.deepEqual` to print only the two migration version strings for the exact current-schema check, then forwarded the original arguments to the original assertion. It confirmed actual 0022 / expected 0021. No query, clock, fixture value or assertion outcome was substituted.

RED evidence: `migration22-harness-{draft,time,admin,runtime}-red.log` and `migration22-harness-time-red-diagnostic.log`. The first generic event-time error alone is not treated as proof of its cause.

## Repeatable verification

Use the existing compiled persistence adapter and manifest, without a new build or browser:

```sh
mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/postgres-content-draft-repositories.mjs
mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/postgres-publication-event-time.mjs
mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/postgres-admin-catalog.mjs
mise exec node@24.20.0 -- node packages/persistence-postgres/scripts/postgres-publication-runtime.mjs
```

All four final runs exited 0, each against a fresh ephemeral PostgreSQL instance:

| Script                                               | Actual assertions | Evidence                                |
| ---------------------------------------------------- | ----------------: | --------------------------------------- |
| Content draft repositories                           |                64 | `migration22-harness-draft-green.log`   |
| Publication event time                               |                30 | `migration22-harness-time-green.log`    |
| Admin catalog                                        |               262 | `migration22-harness-admin-green.log`   |
| Publication runtime, including final empty roundtrip |               461 | `migration22-harness-runtime-green.log` |

Scoped Prettier and ESLint checks exited 0 (`migration22-harness-format.log`, `migration22-harness-lint.log`); `git diff --check` exited 0. The expected negative PostgreSQL guard diagnostics in the runtime log remain part of its adversarial coverage.

The bounded scan of PostgreSQL/API scripts found only these four and the separately owned `postgres-catalog-directory.mjs` with the same stale 0021/21 assumptions. Fixed historical target versions such as 0009/0012/0015/0016/0017 are intentional and were preserved. The general integration runner already derives its head dynamically. No API script had an additional matching stale current-head or downgrade-order assumption.

Code simplification review retained direct local checks instead of introducing a shared migration framework. Scope review: no new public contract or private data flow; test ordering follows the real migration runner; exact history comparisons and all previous assertions remain. This verifies these local PostgreSQL harnesses only; the final full repository check remains a separate root-owned result.

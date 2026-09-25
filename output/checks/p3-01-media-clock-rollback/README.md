# Media attempt clock rollback regression

The full checkpoint gate exposed an existing media-processing failure:
`media-processing:finish-attempt` returned SQLSTATE `23514` for
`media_processing_attempts_check`. The attempt row already satisfied the normal
processing constraints, and the completion statement changed only terminal
status, finish time and error fields. Its wall-clock finish timestamp had moved
before the persisted immutable start.

The production change is one SQL expression in `finishAttempt`:

```sql
finished_at=GREATEST(clock_timestamp(),started_at)
```

PostgreSQL preserves the complete timestamp precision and clamps only the
finish event to its causal lower bound. Migration 0012, lease validity, fencing,
backoff durations and processing transitions are unchanged.

## Evidence

| File                 | Result                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `postgres-red.log`   | Deterministically reproduced SQLSTATE `23514`; the failed completion rolled back and the attempt remained `PROCESSING` |
| `postgres-green.log` | **152 assertions passed**, including real lease expiry, normal triggers and synthetic output metadata                  |
| `unit-green.log`     | Existing 9 repository unit tests passed                                                                                |
| `typecheck.log`      | PostgreSQL package typecheck passed                                                                                    |
| `build.log`          | PostgreSQL package build passed                                                                                        |
| `lint.log`           | Scoped lint passed                                                                                                     |
| `format.log`         | Scoped Prettier check passed                                                                                           |

The real PostgreSQL regression intercepts only the marked attempt-completion
statement in the existing TEST pool wrapper. It substitutes its wall-clock
sample with `started_at - interval '1 second'`. It changes neither the system
clock nor any other SQL statement or constraint. The test asserts exactly one
injected statement for each case and queries the actual database to prove
terminal status, `finished_at >= started_at`, and exact equality at the
microsecond lower bound. It covers two successful completions, one failed
completion and final lease exhaustion (`EXPIRED`).

An exploratory SQL-string unit assertion recorded in `unit-red.log` was removed
after review because it mirrored the implementation. The durable behavioral
regression is the real PostgreSQL test; the original unit file is unchanged.

Commands, from the workspace root:

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres exec vitest run --config ../../vitest.config.ts --root . src/media-processing-repository.test.ts
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres typecheck
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres build
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres exec node ./scripts/postgres-media-processing.mjs
```

S.U.P.E.R review passes: the repository retains its existing responsibility,
dependency direction, contracts, configuration and dependencies. The fix uses
the locked database attempt's start and changes no public API. Tests exercise
the actual normal-trigger persistence behavior. This is local integration
evidence, not a production deployment or a new object-storage processing run.

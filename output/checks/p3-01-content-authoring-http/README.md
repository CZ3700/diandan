# P3-01 checkpoint 3B authoring HTTP evidence

The authoring transport is an additive TEST composition. It exposes POST
`/api/v1/admin/content-authoring/read`, `/create`, and `/copy`. Request JSON
retains `schemaVersion` and action-specific fields. The route injects the action,
session, CSRF token, request ID and mutation `Idempotency-Key`; callers cannot
supply trusted actor or timing fields. COPY appends an immutable revision and is
the editing operation.

## Scope

- Five base revision kinds: idol, gift, media metadata, homepage and policy.
- Exact revision/owner binding on reads, owner version conflicts, source hash
  binding, and canonical PostgreSQL authorization.
- Inherited approval proof for unchanged translations; Japanese edits reset
  their approval; English source edits invalidate inherited approvals.
- Copied alias and gift-detail extensions receive new bindings and draft reviews.
- Exact Origin, canonical opaque session cookie, CSRF and JSON required;
  duplicate credentials and all query strings rejected.
- Private no-store, noindex and no-referrer headers cover successes, failures,
  parser errors, body-limit errors and scoped 404 responses. Body limit: 16 MiB.
- Real HTTP fault injection uses a temporary normal audit trigger. It does not
  disable integrity triggers or change the system clock.

## Recorded checks

| Evidence                     | Result                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `routes-red.log`             | RED: authoring route module absent                                                                  |
| `openapi-red.log`            | RED: independent authoring OpenAPI module absent                                                    |
| `routes-green-attempt1.log`  | One fixture mutation key was shorter than the shared 16-character minimum; corrected to a valid key |
| `routes-green.log`           | 8 route tests passed                                                                                |
| `openapi-green.log`          | Authoring OpenAPI test passed                                                                       |
| `transport-lint.log`         | New transport, tests, OpenAPI and HTTP harness lint passed                                          |
| `transport-format.log`       | All five source files passed Prettier                                                               |
| `api-typecheck.log`          | API typecheck passed                                                                                |
| `api-tests.log`              | 56 API tests passed                                                                                 |
| `postgres-http-red.log`      | RED: new TEST composition had not been built                                                        |
| `postgres-http-attempt1.log` | RED: concurrent media COPY returned 503 from the idempotency begin port                             |
| `postgres-http-attempt2.log` | Stopped at migrations during the coordinated 0015 manifest refresh                                  |
| `postgres-http-attempt3.log` | Reproduced the concurrent failure with safe `TRANSACTION_ABORTED` diagnostic                        |
| `postgres-http-green.log`    | **909 assertions / 114 real HTTP requests passed**                                                  |
| `build.log`                  | All 18 API dependency builds passed                                                                 |

Commands run from the workspace root with Node 24.20.0:

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api exec vitest run --config ../../vitest.config.ts --root . src/admin-content-authoring-route.test.ts
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/contracts exec vitest run --config ../../vitest.config.ts --root . src/content-authoring-openapi.test.ts
mise exec node@24.20.0 -- corepack pnpm exec turbo run build --filter=@fan-support/api... --output-logs=errors-only
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api exec node ./scripts/postgres-admin-content-authoring-http.mjs
```

The HTTP harness uses fresh PostgreSQL databases and synthetic digest-only
session fixtures. Failure diagnostics allow only known operation names, enum
codes, SQLSTATE and fixed assertion labels; credentials, IDs, content, SQL
parameters and raw exceptions are never emitted.

The concurrent failure was a PostgreSQL serializable transaction abort returned
by the idempotency begin port. The Application authoring helper originally
mapped it to 503. Its focused regression now maps transaction/version conflicts
to 409 and preserves rollback. The HTTP harness requires exactly one successful
copy and one 409, then checks that PostgreSQL contains exactly one additional
revision. It waits for both requests to settle before resource cleanup; it does
not retry failed copies or accept a 503 as a concurrency result.

## Independent review

**ACCEPT for checkpoint 3B.** The transport author independently read the shared
authoring contract and port, TEST API composition, PostgreSQL composition,
migration 0015, canonical loader and authoring writes. Covered strict request
authority, explicit TEST activation, owner/source binding, serializable owner
locks, full snapshot hashing, original approval-chain evidence, source/payload
sealing, exact audit receipts, extension draft reset, microsecond causal time,
and transactional idempotency rollback. No remaining confirmed blocking issue
was found in those reviewed boundaries.

A read-only PostgreSQL probe confirmed that policy timestamps with more than six
fractional digits silently round, and offset values near years 0001/9999 can
normalize outside the read contract. The coordinating agent fixed the new
authoring-only policy timestamp schema to reject those inputs. Focal coordinates
also use the database's five-decimal precision. These checks preserve the old
public schemas.

The ten S.U.P.E.R checks pass within this scope: the new transport and OpenAPI
modules each have one purpose, dependencies point inward through serializable
schemas, configuration is injected, no dependencies were added, the old
extension route was not refactored, and targeted tests/build/typecheck/lint/format
plus real PostgreSQL HTTP verification passed. Code-simplifier review kept
explicit action/target switches and avoided unrelated cleanup.

This checkpoint does not enable production login, publishing, rollback, browser
authoring UI or public single-object HTTP projection. Existing extension routes
and their prior evidence remain separate. A caller receiving a 409 must reload
the canonical owner/source before preparing a changed command; this test result
does not claim a staging or production release.

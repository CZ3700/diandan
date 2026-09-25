# P3-01 4C-1 HTTP verification

Status: transport and actual PostgreSQL/HTTP verification PASS on the frozen implementation. Repository-wide checkpoint acceptance is recorded separately by the root coordinator.

The dedicated preflight route uses the current database session, MFA, `content.read`, all seven locale grants, exact Origin, and CSRF. Input contains only schemaVersion, target, and the action to evaluate; the JSON body limit is 64 KiB, with a safe HTTP 413 response for larger bodies. Reports are private and do not create a publication, update a lifecycle/head, or enqueue a purge.

Run from the repository root:

```sh
mise exec node@24.20.0 -- corepack pnpm exec turbo run build --filter=@fan-support/api... --output-logs=errors-only
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api exec vitest run --config ../../vitest.config.ts src/publication-preflight-route.test.ts
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/content exec vitest run --config ../../vitest.config.ts src/publication-preflight.test.ts src/publication-preflight-media.test.ts
mise exec node@24.20.0 -- node apps/api/scripts/publication-preflight-http.mjs
```

Current evidence:

- `route-red.log`: seven expected failures before installing the route.
- `route-green.log`: eight transport tests pass, including a successful report with blockers, response target/action binding, strict commands, safe errors, and existing parent-route coexistence.
- `transport-tests-final.log`: eight route and three TEST-composition tests pass, 11 total.
- `transport-build-final.log`: 20 dependency build tasks pass; 15 were cached in that run.
- `api-typecheck.log`, `transport-lint.log` and `transport-format.log`: API typecheck and targeted source lint/format checks pass.
- `independent-pure-tests.log`: independently rerun pure preflight tests pass, 150 total: 136 main gate and 14 media-lineage tests.
- `http-final.log`: 2595 assertions across 277 actual HTTP requests pass after the final dependency build. `http-fourth.log` records the preceding complete pass.
- `http-first.log`: actual PostgreSQL/HTTP identified a policy fixture whose old effective time preceded its new copied revision; the shared fixture is corrected without changing the policy gate.
- `http-second.log`: the harness required locale labels while legacy field paths omitted this optional field. The new report wrapper now derives labels from the actual canonical rows; final HTTP checks include exact missing/stale locale assertions.
- `http-third.log`: the harness reused an older draft after creating a newer one. The correct draft-pointer blocker was retained, and rights restoration is now checked against the current independently approved draft.

The HTTP harness uses normal PostgreSQL constraints and real Application/API compositions, shared authored/reviewed fixtures, and requests through 3A/3B/4A/4B interfaces. Before and after each preflight helper call it compares full-row digests of 28 tables, including all eight publication-head tables, lifecycle rows, publications/outbox, base and extension reviews, audit and idempotency records. The digests are regression comparisons, not a cryptographic integrity mechanism.

Coverage includes five kinds, all seven locales, missing/stale translations, independent base/extension review and self-review rejection, current rights, owner/revision binding, current role/locale revocation, session/MFA failures, strict authority fields, Origin/cookie/CSRF, malformed/oversize JSON and private errors. Restored rights and completed independent extension reviews return ready reports. Rollback of a never-published draft remains blocked; no actual rollback is performed. Credentials and body canaries are checked against captured server logs without printing their values.

No image or object-storage network calls are required for this read-only check; borrowed media ports reject unexpected calls. This is not new S3 upload/codec evidence, actual publication/rollback, CDN propagation, production login, staging, remote CI or release verification.

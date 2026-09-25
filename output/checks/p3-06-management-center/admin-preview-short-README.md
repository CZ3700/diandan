# Short-session preview HTTP fixture

Only `apps/api/scripts/postgres-admin-content-http.mjs` changed. Production authorization, preview TTL, SQL guards, all existing HTTP status expectations and all prior assertions remain unchanged.

## Evidence and cause boundary

The root-owned full-check attempt 3 failed at request 59: outer authorization succeeded, but `contentPreviews.issue` returned `FORBIDDEN` and HTTP 403 instead of the fixture's expected 200. The original fixture granted its positive issuance/read sequence only three seconds. Its zero authorization deltas compare the first authorization with itself and do not measure remaining session lifetime.

The unmodified standalone harness passed: **434 assertions / 68 actual HTTP requests**, in `admin-preview-short-unchanged-rerun.log`. Thus the natural failure is not assigned a measured expiry or clock-drift cause.

A controlled real PostgreSQL run reproduced the exact request-59 failure shape. A diagnostic wrapper captured the short fixture's session reference in memory and let the first real authorization SQL complete with one row. Before returning that same result to its caller, it waited until PostgreSQL reported the actual session expiry plus 50 milliseconds. All SQL, clock expressions, result rows and assertions were forwarded unchanged. The inner authorization then rejected the expired session and the unchanged positive HTTP assertion failed with 403. This proves the fixture can cross expiry between its two real authorizations; it does not prove that the original natural failure did so.

Valid controlled RED: `admin-preview-short-controlled-expiry-red.log`. The earlier `admin-preview-short-controlled-red.log` is only a wrapper setup failure (`pg` is not resolvable from the repository root), not a behavioral RED. The corrected wrapper ran from `apps/api`, using its existing dependency.

## Minimal fixture correction

- Give the positive issuance/read sequence a 15-second TEST session budget.
- Assert that the actual grant remains current and expires exactly at its actual session deadline. The requested preview TTL remains 60 seconds, so the session still limits the grant.
- After the positive preview read, wait for PostgreSQL itself to observe both real expiry times plus 250 milliseconds. Polling has a 20-second monotonic deadline and fails explicitly if expiry is not observed; no Node/database wall-clock subtraction is used.
- Preserve the subsequent real preview HTTP 404 and short-session HTTP 401 checks.

No retry of the failed positive request, manual session expiration, fabricated result or bypass of an authorization check was added.

## Verification

```sh
mise exec node@24.20.0 -- node apps/api/scripts/postgres-admin-content-http.mjs
mise exec node@24.20.0 -- corepack pnpm exec prettier --check apps/api/scripts/postgres-admin-content-http.mjs
mise exec node@24.20.0 -- corepack pnpm exec eslint apps/api/scripts/postgres-admin-content-http.mjs
```

The complete fresh PostgreSQL / real loopback HTTP run exited 0: **436 assertions / 68 requests** (`admin-preview-short-green.log`), retaining all original 434 assertions and adding the two timing assertions described above. Scoped ESLint, syntax and format checks passed; the initial format check required only a Prettier line wrap. No build or browser was started. Final full repository verification remains a separate root-owned result.

# P3-01 checkpoint 4B HTTP, TLS S3 and browser verification

Scope: independent `/api/v1/admin/resources` routes in an explicit TEST composition; no production administrator login, real operating content, publication or push.

## Repeatable commands

From the workspace root:

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:resource-management
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api typecheck
mise exec node@24.20.0 -- corepack pnpm exec eslint apps/api/src/resource-management-route.ts apps/api/src/resource-management-route.test.ts apps/api/scripts/resource-management-*.mjs
```

The HTTP script starts isolated PostgreSQL, a locked local Versity S3 container, temporary TLS proxy, two temporary page origins, and actual headless Chrome. Every owned resource is closed on completion. Credentials and grants exist only in memory or the existing protected temporary S3 config; no trace, HAR, screenshot, request-body or signed-URL logging is enabled.

Chrome pins the exact ephemeral leaf SPKI only; it does not disable web security or ignore all certificate errors. Node uses the temporary CA with `NODE_TLS_REJECT_UNAUTHORIZED=1` to independently verify the real TLS chain. The allowed page performs browser `fetch` with automatic Origin, Content-Length and preflight. The denied page uses a separate origin/context and a unique grant. Actual S3 HEAD proves an allowed upload's checksum/length and proves that the denied upload created no object. This is browser CORS evidence, beyond Node manually supplying Origin/OPTIONS.

## Coverage

- Ten POST routes: strict Origin/CSRF/opaque host cookie, trusted request ID, write idempotency keys, strict action-specific JSON and 64 KiB limit. No query credentials. Private/no-store/noindex/no-referrer on success, parser, size, authorization, unknown-route and safe infrastructure errors. Read responses bind to the requested policy/upload/asset/job. Only BEGIN returns its minimal provider-neutral capability.
- Four policy kinds register and read; new policy and uploaded-media metadata each go through authoring plus independent review in all seven locales using the existing 3B/4A routes in the same server.
- Actual signed PUT enforces no-overwrite, checksum, byte length and MIME. Full source decoder records encoded dimensions and EXIF orientation, rejects missing/invalid/mismatched content, and never inherits rights approval. Checksum dedup preserves source identity and original evidence.
- A session with 45 seconds plus 789 microseconds remaining precisely caps the reservation. Both the returned grant expiry and the actual `X-Amz-Date + X-Amz-Expires` signature deadline stay within session expiry. Expired immutable tickets are inserted with normal exact audit, without changing clocks or constraints.
- Signing failure recovers the committed reservation using the same key. Network signing/inspection holds no open database transaction. Revocation during inspection prevents final registration. A previously issued S3 capability remains usable until its expiry, while a revoked session cannot register the uploaded object.
- Real worker generates the master and twelve responsive variants; independent downloads verify stored bytes/checksum, dimensions and metadata stripping. Master is stored in the private SOURCE class; responsive variants use DERIVATIVE. Processing never approves rights or publishes content.
- Current source rights govern processed-master provenance through the shared actual PostgreSQL expression. HTTP revocation changes eligibility to false immediately; restoration changes it to true. Same-status evidence confirmations create separate versions, while exact-key replay does not.
- Concurrent rights CAS produces exactly one success and one 409. A real too-small image fails processing; manual retry creates generation 2 with the predecessor link while preserving the old failure and attempt history.
- Normal audit-trigger faults exercise policy registration, upload begin/complete, rights, enqueue and retry. Every failed request returns safe 503, all database resource/audit/idempotency counts remain unchanged, and the same key succeeds after removing the fault. The previously uploaded private S3 blob is retained for a later audited cleanup.
- Current role revocation precedes replay authorization. Structured API/worker logs and persisted idempotency rows are checked against actual in-memory credentials, capabilities and object keys. Public publication state remains unchanged.

## Evidence status

- `http-unit-red.log`: new route absent, then implemented against the frozen contract.
- `http-provider-neutral-red.log`: a legal non-S3 provider grant exposed excessive S3 knowledge in the route; that coupling was removed.
- `http-unit-green.log`: eight route tests and three TEST-composition tests.
- `http-session-cap-red.log`: real S3 rejected a valid session-clamped 45-second grant because the legacy upload minimum was 60 seconds. Root fixed upload minimum to one second and bound the signing instant; the download policy was initially unchanged.
- `http-worker-chain.log`: first complete real HTTP/S3/browser pass, 1797 assertions / 159 HTTP requests.
- `http-expired-history-red.log`: the strengthened permission-history constraint correctly rejected the old expired-ticket fixture (SQLSTATE 23514). The shared fixture now accepts a consistent historical resource permission/role/grant timestamp; this harness supplies actual DB time minus ten minutes.
- `source-inspection-download-window-red.log` / `source-inspection-download-window-green.log`: the inspector owner proved and corrected the internal GET 60-second boundary using the real S3 adapter with a one-millisecond boundary advance. Only internal GET validity changed to 120 seconds.
- `http-final.log`: final complete pass, **1798 assertions / 159 HTTP requests**, including the expiry fixes and distinct duplicate-upload rights evidence preservation.
- `http-build.log`: all 21 API/worker dependency builds passed. `http-typecheck.log`, `http-lint.log` and `http-format.log` record the related static checks.
- `independent-transport-review.md`: non-author quality review of Application, inspector, shared contracts/ports and TEST composition; ACCEPT for this local checkpoint scope.

Local evidence does not claim production identity-provider integration, staging deployment, release, external CI or production S3 CORS configuration. The immutable failed-upload blob cleanup and publication workflow remain separate checkpoints.

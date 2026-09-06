# Independent checkpoint review

Status: ACCEPT. Non-author specification and quality reviews, final full repository check (exit 0), and source fingerprint verification passed.

## Specification review

`content_review_audit` independently read root contracts/ports/OpenAPI/TEST composition and DB migration/resource repositories. The caller cannot supply internal identity, authority, private keys or trusted inspection receipts. Original asset rights references remain immutable, while typed rights evidence and retry generations retain history. No publication, admin login or CDN purge is claimed here.

Accepted fixes before final evidence:

- BEGIN idempotency documentation now states pending grant reissue and expired/registered STALE_VERSION behavior.
- Same-status rights confirmation may append evidence and advance the version; exact idempotency replay adds nothing.
- Database event times include canonical session/permission/history causal lower bounds. Reservation expiry may only shorten the requested limit; actual wall-clock expiry remains strict.
- Root's S3 upload change permits short session-capped signatures, pins signingDate before asynchronous credential resolution, and keeps the existing private download minimum. Independent read confirmed SDK forwarding and the 79 adapter assertions.
- Root's public loader requires explicit true provenance for every media row. False/null/missing proof rejects the publication snapshot, with 14 loader assertions. Actual PostgreSQL source-rights revocation is checked in the HTTP/worker chain.

## Quality review and evidence

- `content_review_audit` accepted root contracts/ports/OpenAPI/TEST composition, PostgreSQL migration/resource repositories, root S3 signing and public provenance loader changes.
- `auth_persistence_audit` accepted the Application and image inspector written by the content owner. Final nested conflict changes passed 41 affected unit/composition tests and 129 real PostgreSQL assertions; old 0012 media behavior passed 152 real PostgreSQL assertions.
- `admin_transport` accepted the Application, inspector, shared contracts/ports and TEST composition written by other owners. Its detailed report is `independent-transport-review.md`.
- Root reviewed the Application/inspector and each owner patch, including contract preservation and provider neutrality. Content-owner Application and image code is not counted as its author's independent review.
- The real HTTP/S3/browser final run passed **1798 assertions / 159 requests**. The internal GET expiry issue is closed: six deterministic real-adapter boundary assertions with stubbed network I/O prove a one-millisecond advance is safe with 120-second internal GET validity. The private download minimum, user authorization and codec/request budgets remain unchanged.
- Three nested persistence conflict RED cases now retain the normalized typed failure through rollback, preserving 409 for concurrent work rather than a false 503.

Code responsibilities were consolidated without changing frozen interfaces: shared full-pixel decoding serves inspection and processing, storage transfer takes only necessary source identity, and resource command/transaction/upload/idempotency logic has separate cohesive modules. No unrelated refactor was introduced.

The initial full check found an intermittent inherited 3A PostgreSQL authorization assertion failure. Twelve natural diagnostic runs passed without reproducing it. The database owner changed only that test harness: explicit complete-grant/time preconditions, a controlled locale-query clock boundary with two new assertions, and safe failure diagnostics. Root reviewed the diff and RED/GREEN evidence: 112 assertions pass, authorization is never retried unconditionally, and production authorization/TTL/DDL are unchanged. The controlled boundary proves a timing risk but does not establish the original intermittent failure's cause. `content_review_audit` independently accepted this fixture diff and its RED/GREEN evidence, explicitly preserving the unconfirmed-cause distinction. Final whole-check passed.

The second full check passed all real PostgreSQL/HTTP/S3/worker suites, then found three lint violations. Root made two type-only corrections: normal `import type` entries for the media inspection interface, and an explicitly typed Vitest mock without an unused implementation parameter. `content_review_audit` independently accepted both as unchanged runtime/API/test behavior. Full lint and a complete typecheck/test/build preflight passed (105 tasks). All browser renderer input hashes remain unchanged.

All owner code is frozen. Root's final whole-check exited 0: typecheck 56/56, tests 56/56, build 35/35, 31 package exports, and every real integration suite passed. Implementation/source and browser-renderer fingerprints were verified; final records accompany the local checkpoint commit. This acceptance does not attest to remote CI, production identity, cloud CDN or release.

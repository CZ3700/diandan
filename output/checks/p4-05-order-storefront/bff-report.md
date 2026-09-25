# P4-05 order BFF and browser transport

Scope: delegated subtask within root's registered P4-05 / Lane A checkpoint. No task-state changes, Git operations, dependencies, migrations, existing checkout files, or long integration runs were performed by this delegate.

## Delivered

- Four fixed Next route handlers forward only the corresponding order-access API operation. Unsupported methods also use the private failure handler.
- Exchange forwards no incoming Cookie or CSRF. Bootstrap forwards only cart Cookie and its explicit CSRF. Read/revoke forward only the order Cookie; only revoke forwards order CSRF. Origin and Fetch Metadata checks remain enforced; the fixed public reverse-proxy host tuple is supported without trusting forwarded visitor identity.
- BFF and browser validate the frozen contract, exact HTTP status, action, requested public order ID, response privacy headers, canonical order CSRF, and bounded integer Retry-After. Unknown/private fields fail closed. No upstream raw error is returned.
- BFF accepts exactly one canonical `__Host-fan-order` grant cookie with Path=/, Secure, HttpOnly, SameSite=Strict and an Expires value exactly matching the grant timestamp's HTTP-date. Revocation requires the same scope and Max-Age=0. Read and failure responses cannot set cookies; revoked/failure responses cannot expose CSRF.
- Request cap is 1,024 bytes. Response cap is 16 KiB for grants/revocation/failures on those operations and 32 MiB for archived reads, whose contract permits 500 lines and two 8,192-character media URLs per line. Both advertised and actual streamed size are checked. UTF-8 decoding is fatal; stalled or excessive streams are cancelled.
- BFF has a single 10-second deadline including inbound-body read, fetch and upstream-body read. Browser has a 15-second total deadline. Cancellation returns without a retry; an already-cancelled incoming request never dispatches upstream.
- `createOrderTransport(fetcher?)` exposes exchange, bootstrap, read, revoke and dispose. Order CSRF is memory-only and bound to a validated publicOrderId. Late responses cannot restore stale credentials after a newer operation or dispose. Dispose permanently disables that transport and aborts in-flight work.

## Verification

`bff-validation.json` records the final owned-file SHA256 map and exact command arrays, timestamps, durations and exit codes. All four recorded commands exit 0:

1. Targeted tests: 18/18 pass across BFF and browser transport.
2. Owned-file Prettier check.
3. Owned-file ESLint.
4. Storefront TypeScript check.

The full storefront unit suite at the integration state observed during this subtask passed 83 files / 587 tests in 4.35 seconds (`bff-storefront-suite.log`). This was concurrent development, not a final repository freeze or production build.

RED provenance is preserved: `bff-red.log` first exposed a test-fixture missing closing brace plus missing entry points; after correcting the fixture, `bff-red-valid.log` contains 15 failures specifically asserting the missing implementation. The first implementation passed all 15. A follow-up cancellation test then produced 17 PASS / 1 FAIL because an already-aborted request still dispatched; `bff-cancel-red.log` records this. The cancellation guard fixed that behavior; the final 18 tests pass. The initial TypeScript discriminator error is retained in `bff-typecheck-attempt1.log`; four separate operation variants restore correct narrowing.

## Integration limits and review

- A failed/unknown one-time exchange may have consumed its token. Do not automatically exchange the same token again. If the caller already knows a public order ID and the browser received its Cookie, it may attempt an authorized read for recovery; without that Cookie the BFF cannot undo or repeat issuance.
- The transport rejects stale response data but cannot undo a server mutation or a browser-applied Cookie. Controllers should serialize user mutations and preserve the existing explicit recovery flow.
- Browser screenshots, real PostgreSQL/S3/TEST PSP flow, full repository build/check and non-author final review are root's combined acceptance work. This subtask does not claim those results.
- S.U.P.E.R local review: modules separately own route parsing, credential forwarding, cookie validation, bounded I/O, response validation and client lifecycle; dependencies remain within the storefront adapter and frozen contracts; no new persistence, public DTO, dependency or environment hardcoding; all subtask tests/static gates pass. The ten items pass within this delegated scope.

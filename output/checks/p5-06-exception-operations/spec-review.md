# P5-06 non-author specification review

Reviewer: exception_ui. Read-only review of contracts, application and PostgreSQL implementation; the reviewer authored Admin UI/BFF, which is outside this independent review.

Decision: **ACCEPT within this non-author source review scope**. Final comparison of all 11 source hashes against `spec-review-inputs.json` found no changes after review. This decision does not turn an author UI review or another collaborator's integration execution into an independent test by this reviewer.

Snapshot: `spec-review-inputs.json`, with prior observations retained. The latest incremental review includes the storage collaborator's declared reviewable snapshot and the internal recovery result schema. Final acceptance must recheck any later changes.

## Findings

No confirmed blocking specification defect found in the inspected non-UI source snapshot.

- Four discriminated source targets and action matching prevent cross-source operations. DEAD_LETTER includes its consumer identity; mutation version is the canonical safe-state digest. List/detail DTOs have a strict allowlist and contain no raw payload, address, email, credential, message or private display name.
- Commands require current session/CSRF/MFA, exceptions.read and the action grant. Reconcile and notification paths retain orders.read plus their existing narrow grant. PostgreSQL locks current role grants and rechecks session lifetime after source locking. Mutation audit/receipt bindings are checked by deferred database constraints.
- Original webhook/outbox IDs remain unchanged. Worker claims carry matching source/job identities and a generation, digest and expiration fence; completion checks retained successful processing evidence. The existing processors retain their transactional business-effect de-duplication.
- Permanent receipts bind actor/action/key/request hash/source/version. Same-key recovery returns the original operation; another hash or source conflicts. Financial reconciliation delegates to the existing finance operation and notification retry delegates to the existing audited resend boundary, rather than introducing a new payment or raw email path.
- Notification UNKNOWN is blocked for investigation; already sent, superseded, in-progress or ineligible notifications do not receive a retry action. Browser-facing copy must describe controlled retry eligibility, without promising that an uncertain delivery can be resent.
- New schemas are isolated roots and no inspected change requires rewriting historical contracts. Full compatibility snapshots remain root-owned.

## Incremental review, 2026-09-22

No new blocking source-level defect was found in the reviewed revisions.

- Webhook projection gives either finance or order-payment application REVIEW precedence over processing success. Both receipt types now participate in the source hash, so a previously observed actionable version cannot silently authorize a newly review-blocked source.
- Database checks explicitly reject NULL consumer, lease and terminal reason loopholes. Both adapter settlement and the SQL operation guard require retained SUCCEEDED processing evidence for the exact webhook or outbox-plus-consumer source.
- Notification delegation binds a distinct audited resend to the failed/canceled base or exact previous resend sequence, rejects outstanding UNKNOWN evidence across the order, and includes sibling resend history in the version. The deferred version check excludes only the new delegated row.
- Notification OPEN filtering excludes ordinary pending deliveries and definite failures superseded by a terminal successor; UNKNOWN evidence remains visible. ALL preserves history. Payment OPEN scope remains UNKNOWN sources plus retained exception history, rather than all ordinary payment attempts.
- PAYMENT locking now follows the existing finance path's order of runtime operations, finance operations, order and target attempt. This is a source-level lock-order inspection, not a concurrency proof.
- `adminExceptionsRunResultSchema` validates serializable bounded counts and `scanned = succeeded + failed`; recovery parses it before returning. It adds an internal contract without changing browser commands or responses.

## Executed checks

- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/contracts test src/admin-exceptions.test.ts`: exit 0, 1 file / 5 tests.
- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/application test src/admin-exceptions.test.ts`: latest rerun exit 0, 1 file / 8 tests (earlier snapshot: 6 tests).

These checks verify contract parsing/correlation and application behavior with repository fixtures. This review did not execute actual PostgreSQL, concurrency, queue restart, TLS providers, or browser tests; those remain integration requirements and are not claimed passed here.

The final runtime/browser execution is separately recorded in `integration-2026-09-22T08-16-42.172Z`; the browser report is PASS with 708 assertions, 11 case groups, 89 screenshots and 89 clean axe scans. That external execution supplies integration evidence for final root acceptance, while this document's independently executed checks remain limited to the commands above. Historical failed fixture/browser attempts have not been relabeled as passed.

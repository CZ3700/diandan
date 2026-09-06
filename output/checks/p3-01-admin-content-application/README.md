# P3-01 checkpoint 3A Application verification

Scope: source-owned authorization/content orchestration, token digests, review checks, safe idempotent mutations and read-only preview use cases. Root owns contracts, exports, SQL/repositories, HTTP and combined integration evidence.

- `red.log`: initial executable stubs, 28 failing behavior tests. No draft/review/preview implementation existed at this point.
- `red-clock.log`: 3 failing regressions for advancing canonical database authorization/issuance timestamps; no timing tolerance was added.
- `red-review-reader.log`: assigned-language review reading rejected before the additive read action was implemented.
- `green.log`: initial integrated Application suite, 9 files / 131 tests passed (56 new tests, 75 existing tests).
- `red-wall-clock.log`: 4 failing regressions reproduce canonical wall-clock reversal for `READ_DRAFT`, `READ_REVIEW`, `APPROVE_REVIEW` and preview issuance using observed millisecond offsets (`.831` to `.656`, then issuance at `.665`).
- `green-wall-clock.log`: final Application suite after the wall-clock fix, 9 files / 137 tests passed (62 admin content tests, 75 existing tests). Identity/session/expiry consistency, expiration at either authorization instant, excessive TTL, and a preview exceeding its session expiry by 1 ms remain rejected.
- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/application typecheck`: exit 0.
- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/application build`: exit 0 after the wall-clock fix.
- `mise exec node@24.20.0 -- corepack pnpm exec eslint packages/application/src/admin-content*.ts`: exit 0.
- `mise exec node@24.20.0 -- corepack pnpm exec prettier --write packages/application/src/admin-content*.ts`: applied, followed by tests/typecheck/lint.
- `git diff --check -- packages/application/src/admin-content*.ts`: exit 0.

Policy: canonical authorization is repeated before review replay and before returning complete multilingual drafts. Assigned-language reviewers use `READ_REVIEW` to obtain the selected translation and real English source fields; other languages are excluded and both hashes are recomputed against the exact structure. Alias sets containing universal names or no aliases require all supported locale assignments. Revocation reduces the issuer's own existing preview access and intentionally requires current basic `content.preview` permission without retained language assignments; the repository enforces original issuer identity. Preview reads use only the scoped digest capability and delegate live issuer/session/MFA/permission/locale validation to persistence.

Canonical PostgreSQL wall-clock samples are not monotonic: real integration diagnostics observed time moving backward during sequential review requests. Application therefore compares neither successive authorization timestamps nor authorization time against later issuance time. It still requires an unchanged actor, session and session expiry, and verifies each authorization against that sample's expiry. Preview TTL is measured from actual issuance and cannot exceed session expiry. Locked database review history owns causal event ordering; this Application change adds no timing tolerance, sleep or retry.

Writes reserve and complete an existing idempotency record in the same transaction as content and audit. Rejected mutations throw a safe typed callback error so the transaction rolls back; successful replay returns only a resource reference. HMAC-SHA256 uses a 32-byte injected pepper and distinct admin-session, admin-csrf and content-preview purposes. Raw session/CSRF/preview tokens do not cross persistence ports.

S.U.P.E.R scope review: parsing, review validation, idempotency, token digests, safe failures and orchestration have distinct responsibilities. Application imports contracts/content/ports only. All port payloads and returned values are schema-bound JSON. No provider/SQL/UI dependencies, production IDs or services were added. Root supplies the existing Node type dependency and shared exports. Code-simplifier review retained explicit command branches and separate helpers. Full repository, real PostgreSQL and HTTP verification remain root integration responsibilities; these unit results alone are not a release conclusion.

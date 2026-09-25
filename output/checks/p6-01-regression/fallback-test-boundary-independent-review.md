# Fallback integration test layer move — independent review

2026-09-23, reviewer /root/regression_coverage_audit; author /root/regression_readiness. ACCEPT this bounded two-test organization change. No source edits, services, browser or database runs by this review.

The moved integration test body is byte-for-byte equal to the original added test in the preserved final-7 snapshot. It still loops over all six non-en locales, produces the same actual content-manifest fallback through the existing fictional fixture, and asserts both successful English fallback and rejection when the request locale does not match that persisted context. Only its package location and imports changed: the API outer layer uses the existing public application export and the existing private built content fixture. No production export, dependency, fixture implementation, or architecture rule was added or relaxed.

The remaining application unit test is byte-for-byte equal to HEAD and keeps the original invalid-query/no-I/O, NOT_FOUND, and safe unavailable-error assertions. Consequently this file is no longer a Git modification, even though it remains an owned review path.

Independent validation, all exit0:
- `mise exec node@24.20.0 -- node scripts/check-adapter-boundaries.mjs`: original actual adapter gate PASS.
- From apps/api, `mise exec node@24.20.0 -- corepack pnpm exec vitest run --config ../../vitest.config.ts --root . src/published-gift-commerce-fallback.test.ts src/published-gift-commerce-route.test.ts`: 2/2 PASS.
- From packages/application, same package-root Vitest invocation for src/published-gift-commerce.test.ts: 1/1 PASS.

Logs: fallback-test-boundary-independent-{gate,api,application}.txt. The candidate owned manifest currently has84 review paths, including this one restored unchanged application test; its actual modified/new source count is83. This is a scope/count note, not a staging or behavior defect. Root has been notified; no manifest or implementation was changed by this review. Full final-8 was still running when this conclusion was issued; no full-regression acceptance is asserted.

Bound SHA-256:
- `apps/api/src/published-gift-commerce-fallback.test.ts`: `00393a66e6d860cb663a46d2a716a066e236efd7ce2a57209bda6d811b30307f`
- `packages/application/src/published-gift-commerce.test.ts`: `174cae1afe0148c34458e165732fd82b75d0d1dc6e3b9db04f730e9d6f75efed`
- `scripts/check-adapter-boundaries.mjs`: `2219e570ff77c425da7a738ec96bb8737f429f78e1a86eba4c38e604eb55d97d`

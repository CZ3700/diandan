# P6-02 homepage gift browsing: contract/application/API author verification

Author: `/root/home_gift_audit`. Scope is the root-owned P6-02 task's explicitly requested homepage gift browsing change. This is author verification, not independent review of these backend changes.

## Result and boundary

- Added the separate read-only `/api/v1/gift-browse` endpoint. Public input is `schemaVersion: 1`, locale, bounded page/pageSize, optional category and idolId (HTTP `idol`). Public success returns catalogVersion, published gift views and pageInfo. No offer, price, inferred market/currency or shopping mutation is present.
- The application executes through the existing content read transaction port and projects `GiftDirectoryRecord` publication proof using the existing content projectors. It validates page completeness, duplicate identities, requested locale and category. Verified legacy English fallback requires a nonempty translation revision; direct operator content retains its actual source locale. Internal proof is not returned.
- Endpoint registration is part of the existing catalog directory composition/bootstrap. Successful anonymous reads are freshly revalidated before ETag/304; credential-bearing reads are private/no-store. Malformed queries/output and exceptions fail closed. No global catalog endpoint allowlist/rate-limit classifier was found in the API; existing order-access-specific rate limiting is unrelated and unchanged.
- Added four contract registry roots and a separate OpenAPI path. Existing `/gifts` query/response schemas and quoted commerce semantics are unchanged. Contract artifact generation is owned by the root agent.

## Commands and observed results

All commands ran from `/Users/mario/Desktop/下单` with `mise exec node@24.20.0 -- corepack pnpm`.

1. `--filter @fan-support/contracts exec vitest run --config ../../vitest.config.ts --root . src/gift-browse.test.ts`: initially failed because the new contract module did not exist; implementation passed 2 tests.
2. `--filter @fan-support/application exec vitest run --config ../../vitest.config.ts --root . src/gift-browse.test.ts`: initially failed because the use case did not exist. Final combined command adding `src/catalog-directory.test.ts` passed **2 files / 15 tests**. Covers actual legacy publication projection, proven English fallback, unapproved text, wrong locale/category, duplicate IDs, incomplete pages and infrastructure failures. A fixture conversion initially violated the required square gift primary image ratio; the fixture dimensions were corrected, with no production validation weakened.
3. `--filter @fan-support/api exec vitest run --config ../../vitest.config.ts --root . src/gift-browse-route.test.ts`: initially failed because the route module did not exist. Final command including `src/catalog-directory-route.e2e.test.ts src/catalog-directory-composition.test.ts src/catalog-directory-bootstrap.e2e.test.ts src/production-application.test.ts src/public-get-revalidation.test.ts src/published-content-route.test.ts` passed **7 files / 53 tests**.
4. `--filter @fan-support/contracts exec vitest run --config ../../vitest.config.ts --root . src/gift-browse.test.ts src/gift-browse-openapi.test.ts src/public-revalidation-openapi.test.ts src/catalog-directory-boundary.test.ts`: **4 files / 7 tests passed**. The new OpenAPI test was first run before its module existed and failed as expected.
5. `--filter @fan-support/contracts typecheck`, `--filter @fan-support/application typecheck`, `--filter @fan-support/api typecheck`: passed. Initial test fixture typing failures (unbranded variant ID and missing/new browse mock shapes) were corrected.
6. `--filter @fan-support/contracts build`, `--filter @fan-support/persistence-port build`, `--filter @fan-support/application build`, `--filter @fan-support/api build`: passed.
7. `exec prettier --write` on this author's exact new/changed files; `exec eslint packages/contracts/src/gift-browse*.ts packages/application/src/gift-browse*.ts packages/application/src/test-support/gift-browse-fixture.ts apps/api/src/gift-browse*.ts apps/api/src/catalog-directory-route.ts --max-warnings=0`: passed. Unused destructuring variables in the test fixture were replaced by an explicit field omission helper.
8. `git diff --check -- packages/contracts packages/application packages/persistence-port apps/api/src`: passed.

The early `artifact-documents.test.ts` run correctly reported generated artifacts stale after adding the new roots. Its separate expected-path ordering issue was corrected. Root owns final artifact generation/freshness and the combined quality gate; this report does not substitute for those results.

## Exact author-owned source files

New:

- `packages/contracts/src/gift-browse.ts`
- `packages/contracts/src/gift-browse-internal.ts`
- `packages/contracts/src/gift-browse.test.ts`
- `packages/contracts/src/gift-browse-openapi.ts`
- `packages/contracts/src/gift-browse-openapi.test.ts`
- `packages/application/src/gift-browse.ts`
- `packages/application/src/gift-browse.test.ts`
- `packages/application/src/test-support/gift-browse-fixture.ts`
- `apps/api/src/gift-browse-route.ts`
- `apps/api/src/gift-browse-route.test.ts`

Updated:

- `packages/contracts/src/index.ts`
- `packages/contracts/src/artifact-registry.ts`
- `packages/contracts/src/artifact-documents.ts`
- `packages/contracts/src/artifact-documents.test.ts`
- `packages/contracts/src/public-revalidation-openapi.test.ts`
- `packages/persistence-port/src/catalog-directory.ts`
- `packages/application/src/catalog-directory.ts`
- `packages/application/src/catalog-directory.test.ts`
- `apps/api/src/catalog-directory-route.ts`
- `apps/api/src/catalog-directory-route.e2e.test.ts`
- `apps/api/src/catalog-directory-bootstrap.e2e.test.ts`
- `apps/api/src/catalog-directory-composition.test.ts`
- `apps/api/src/production-application.test.ts`
- `apps/api/src/public-get-revalidation.test.ts`
- `apps/api/src/published-content-route.test.ts`

## S.U.P.E.R check

1–2: each new production module owns one query, projection or transport responsibility. 3–4: dependencies follow route → application → port → adapter; public contract modules do not load internal publication proof modules (tested). 5–6: cross-module inputs/results are versioned Zod DTOs and serialized before leaving the transaction. 7: no production domain/market/currency/entity/config value is invented. 8: no dependency or lockfile change. 9: the repository implementation remains replaceable behind the existing port. 10: affected author tests/types/builds pass; full integrated acceptance remains the root agent's responsibility.

Real PostgreSQL proof/transaction validation is the persistence agent's scope. Browser, seven-locale reflow/keyboard/zoom checks and full P6-02 acceptance are the root agent's scope. No production deployment, cloud apply, Git push, real payment or user data reset was performed.

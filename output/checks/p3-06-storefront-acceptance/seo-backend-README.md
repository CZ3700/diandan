# P3-06 backend SEO read chain

Author `/root/storefront_read`, delegated under root's P3-06 executor. No independent task claim, Git operations, migration changes, or old public projection changes.

The frozen three-operation contract is implemented end to end: ENTITY proves one current publication; INDEX hydrates at most 20 stable owner candidates in one SERIALIZABLE transaction; CATALOG enumerates up to 50 lightweight shard boundaries per page without body hydration. Its first INDEX cursor also binds the catalogue version. More catalogue pages are consumed explicitly, with no old directory-window cutoff. One loaded context is reused for all seven locale projections. Homepage additionally reuses the existing bounded aggregate to prove its required hero before returning the already-loaded home context.

The DTO permits a canonical ordered subset of 1–7 unique locales from one publication, with unique translation revisions and exact publication lastmod. Actual PostgreSQL projection remains the unchanged strong all-seven publication gate; no incident approval or fallback proof has been invented. Archived/draft owners are excluded by current identity/head enumeration; paused content remains visible. A listed candidate whose proof is unavailable fails the entire INDEX, rather than silently producing a successful partial or empty sitemap. SQL/transaction failures become generic 503 without private details.

Public API: `/api/v1/storefront-seo/entity`, `/index`, `/catalog`. Strict duplicate/unknown query fields, operation/locator matching, canonical operation/version/key cursor validation, explicit 400/404/409/503. Successful anonymous JSON uses root's revalidation helper (ETag, zero freshness, must-revalidate); every 304 occurs after a new complete use-case read. Cookie/Authorization requests are private no-store with no ETag/304, and failures remain no-store.

## Reproducible local validation

Use `mise exec node@24.20.0 -- corepack pnpm --filter <package> exec vitest run --maxWorkers=2 <files>`.

| Package | Files selected | Latest result |
|---|---|---|
| contracts | storefront-seo + storefront-seo-openapi | 2 files / 3 tests |
| content | storefront-seo + published-content + storefront-homepage | 3 files / 21 tests |
| application | storefront-seo | 1 file / 6 tests |
| persistence-postgres | storefront-seo-data + storefront-seo-transaction + postgres-persistence | 3 files / 23 tests |
| api | storefront-seo-route | 1 file / 4 tests |

All **57 tests passed** in `seo-{contract,content,application,pg,api}-final-tests.log`. The application tests include traversal beyond 50 descriptors (1,020 metadata candidates, 51 unique shards), no hydration during CATALOG, malformed/gapped/disordered windows, missing listed proofs, wrong locale/identity, version change and infrastructure error. Content tests use existing actual manifest fixture generation and real `EXPIRED` rights status; they preserve original strong projections.

RED logs are retained separately (`seo-contract-red`, `seo-contract-subset-red`, `seo-content-red`, `seo-application-red`, `seo-pg-red`, `seo-transaction-red`, `seo-api-red`, `seo-openapi-red`). Intermediate implementation/type errors are not hidden. A root-level combined Vitest attempt found no tests because this repository's include is package-relative (`src/**`); `seo-focused-final.log` records that invocation error, and the package-scoped commands above replace it as the execution evidence.

Contracts/content/application/persistence-postgres/API typechecks passed in `seo-*-types.log`. Owned files were formatted and linted (`seo-format*.log`, `seo-lint.log`). Root owns shared indexes, registry/OpenAPI combination, production/test API composition and the full build/check pipeline. Root reported backend build 2 and the 21-migration PostgreSQL roundtrip passed; this author did not rerun those gates. Actual populated PostgreSQL/API full enumeration and browser acceptance are still separately tracked in the main harness evidence, not claimed by these unit results.

## Limits and maintenance

The catalogue version scans compact identity/head and mutable proof-status metadata; it does not hydrate all bodies or use market/price data. It conservatively invalidates cursors when unrelated media or gift-variant status changes. Very large catalogue query cost is not benchmarked here. Validated INDEX windows remain small; response proof failures never masquerade as complete empty pages.

No actual CDN purge, staging deployment, production traffic or third-party approval is established by these checks. The original 378 contract roots remain root's exact compatibility gate. Production copy review and any genuine incident fallback authorization remain independent requirements.

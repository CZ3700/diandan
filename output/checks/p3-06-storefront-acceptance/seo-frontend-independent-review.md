# P3-06 frontend SEO independent review

Reviewer: `/root/storefront_read`, non-author, 2026-09-07. **ACCEPT for the reviewed source and focused unit scope after the two fixes below.** No frontend/API-helper source edits, Next build, browser run or full check performed by this reviewer.

Scope: `seo-identity`, `seo-metadata`, `browse-seo`, `gift-seo`, `seo-structured-data`, server SEO reader and sitemap, global/locale sitemap and robots routes, page/read factory integration, and API `public-revalidation-response`. The comparison is the current P3-06 working changes, not a claim against a final immutable source hash.

## Findings resolved during review

1. Artist SEO previously retained a syntactically valid but unavailable market/currency scope while advertising indexable canonical/alternates and a ProfilePage. The actual gift section would show region recovery. Root added `readCommerceContext` / `isMarketAvailable` to the scoped artist branch and a failing-then-passing test. The current source rejects unavailable or malformed scope from indexability/alternates/JSON-LD while preserving unscoped artist discovery.
2. The frontend SEO reader previously accepted a successful page for a different cursor version and could accept empty continuing pages. Root now verifies canonical cursor operation/version against the returned catalogue and rejects empty INDEX/CATALOG continuations. This supplements the backend application checks and prevents a malformed upstream traversal from appearing complete or looping without accumulating bounded entries.

## Confirmed behavior

- Canonical URLs carry only validated public identity. Unknown/private query fields, recipient selection, artist anchors and noncanonical filter projections force noindex and stay out of metadata/JSON-LD. Locale and explicit market/currency remain independent. A selected gift variant survives only a valid scoped identity and must match a real current offer before structured pricing is emitted.
- `provenSeoLocales` compares publication id, revision, manifest hash, publication time and the current translation revision. A fallback, missing locale or a race to a different publication emits no reciprocal cluster or structured entity. Current database evidence remains all-seven; injected partial clusters test DTO consumer behavior only.
- Page and metadata factories share request-scoped React cached reads using primitive keys. Artist/gift/policy not-found decisions occur before returning a streamed shell; error states do not create JSON-LD or indexable alternates. Existing dynamic HTML caching is retained.
- Unscoped gifts produce Product content without invented pricing. Scoped prices use actual offer minor units and currency precision, including zero-decimal currencies and safe integer bounds. Availability derives from the current offer. No tax/shipping/review/rating/availability facts are invented.
- JSON-LD serializes authored text as JSON and escapes `<`, U+2028 and U+2029 before the HTML parser. It does not interpolate executable JavaScript. Organization/site identity uses validated runtime presentation data, and media comes from existing public DTO readers.
- Global sitemap traverses all CATALOG pages, detects repeated cursors/shards and cross-page versions, and rejects the 50,000 sitemap-entry/50 MiB protocol limits explicitly. Individual locale shards use publication lastmod and actual locale membership, including reciprocal removal of a missing locale. Reads and validation occur before ETag comparison; an upstream failure yields noncacheable failure, not partial/empty success.
- Anonymous API/XML responses have zero freshness and mandatory revalidation. Conditional 304 executes a fresh read first. Cookie/Authorization requests have private no-store, no ETag and no 304; private/unknown sitemap query values are rejected without reflection. Nonproduction robots disallows crawling, while production robots names only the configured canonical sitemap and excludes private route families.

Independent focused verification: **7 frontend files / 45 tests PASS**, `seo-frontend-independent-final-tests.log`; **API revalidation helper 2 tests PASS**, `seo-revalidation-independent-tests.log`. Earlier frontend-only run is retained separately. The real populated PostgreSQL/HTTP/browser/performance matrix remains root/E2E evidence; this review does not assert it passed.

## Small code-convergence suggestions

Applied the code-simplifier review principles without editing source. The nested route-kind ternary in `createSeoIdentity` is a candidate for a small explicit switch if touched again; preserve its exact canonical paths and query rules. Keep the API and sitemap ETag parsers covered by the same edge-case expectations if either changes; a new cross-package abstraction is unnecessary for this stage. No broader refactor is required for acceptance.

Limits: this is local implementation acceptance, not production release. Production UI-copy approval, human operations UAT, staging and real CDN evidence remain independent gates. The current manifest still cannot authorize partial/fallback publication in PostgreSQL; no such approval is inferred from consumer tests. The large-catalog metadata query cost and cross-process traffic behavior are not benchmarked by this review.

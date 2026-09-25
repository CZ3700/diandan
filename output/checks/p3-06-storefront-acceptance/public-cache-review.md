# P3-06 existing public GET revalidation — scoped implementation evidence

Author: storefront_directory. Root owns the shared response helper and its independent identity tests. This document records local source and protocol verification, not a CDN deployment or complete P3-06 acceptance.

## Behavior and boundary

Existing content (idol, gift, homepage, policy, media metadata), composed homepage, gift-content classification, current gift offers, public commerce context, and both catalog directories call `sendRevalidatedPublicJson(request, reply, value, {resource, query})` only after the current application read, strict response-schema parsing and response-scope checks. The identity uses a fixed resource and the parsed command, including explicit locale and commerce context where that route requires them. The locale-neutral context operation has only its own schemaVersion command; no locale or commerce default is invented. Equivalent canonical query order/defaults retain the same ETag. Different empty directory locales/searches/market/currency/recipient queries cannot collide just because the body is empty.

Anonymous successful GET responses have exactly `public, max-age=0, s-maxage=0, must-revalidate` and a weak SHA-256 ETag. Matching conditional requests still execute the current proof read before 304. Cookie or Authorization presence forces `private, no-store`, no ETag, and a full successful 200. Failed anonymous requests retain `no-store`, no ETag and their existing typed status; failed credential-bearing requests are private/no-store. No Set-Cookie is added. Existing noindex/referrer headers survive the final send hook. The route onSend hooks now apply only those fixed security headers, so they cannot overwrite an explicitly validated success's cache headers. Failure paths reset cache and remove any ETag.

Catalog responses additionally meet the existing BFF scope checks before ETag generation: exact requested/resolved locale with no fallback, unique identities, idol requested limit, gift market/currency and page/pageSize, and exact item cardinality implied by the same response total. These checks reject schema-valid substituted scopes rather than caching them. No operation schema, Next HTML cache policy, BFF fetch behavior, runtime source of truth or positive TTL changed.

Zero shared TTL plus mandatory origin revalidation is the current correctness boundary. Existing publication purge paths cover locale HTML, sitemaps and the SEO API; the newly revalidated ordinary DTO routes do not yet have their own complete exact API purge mapping. A real CDN deployment must honor minimum TTL zero, complete scope keys, credential bypass and the appropriate API purge mapping. This work does not claim immediate revocation of already downloaded media bytes or a deployed CDN purge. Root explicitly accepted this bounded implementation rather than widening migration 0021 again.

## Test sequence

- `public-cache-red.log`: 19 failed / 7 passed against old routes. Failures were missing public ETag/revalidation, credential privacy, wrong directory scope accepted and price representation lacking an ETag; fixture schemas parsed successfully.
- `public-cache-green-initial.log`: 7 files / 32 tests PASS after implementation, including all five published-content kinds, six additional resource scenarios, conditional read counts, old proof failure, malformed output, credentials, empty-response identity partition, wrong scope and expired-price representation.
- `public-cache-api-tests.log`: full API test command, 40 files / 160 tests PASS (exit 0).
- `public-cache-format-verified.log`, `public-cache-lint-verified.log`, `public-cache-typecheck-verified.log`, `public-cache-api-build.log`, `public-cache-diff-check.log`: scoped checks/API tsc build PASS. Initial `public-cache-lint.log` preserves an import-before-shebang parse failure in two harness scripts; moving the import below the existing shebang fixed it before running either script. `public-cache-format-harness.log` records that formatting correction.
- `public-cache-catalog-http.log`: `mise exec node@24.20.0 -- node apps/api/scripts/postgres-catalog-http.mjs`, exit 0; real ephemeral PG, normal triggers, Nest/Fastify HTTP, 120 artists/120 gifts/seven locales, **331 assertions / 49 requests**. Includes actual conditional 304 and credential-bearing 200/no-ETag checks for both directory resources; original connectivity failure/recovery checks remain.
- `public-cache-publication-http.log`: `mise exec node@24.20.0 -- node apps/api/scripts/publication-runtime-http.mjs`, exit 0; real ephemeral PG, strict-TLS local object storage, actual HTTP publication/purge, **12,710 assertions / 1,451 requests**. Includes all five public kinds and seven locales, new conditional/privacy probes, and original authorization, version/idempotency, upload, rights and purge protections.

The protocol commands above ran the API tsc build from this subtask and the then-current prior PG dist. They prove the cache adapter behavior and preserved existing real persistence protections; they do not claim to verify root's subsequently authored public SHARE-lock fix. Both old runner entrypoints only console their summaries and use ephemeral service temp directories; their output was redirected into the two new P3-06 logs. They did not write or replace any historical output/checks JSON or screenshots.

The three existing storefront/gift protocol modules have been updated to the exact new cache contract, sharing a small HTTP-only assertion helper. They make one real conditional and two credential probes per resource family; failed requests with a previously successful identical URL reuse the old ETag to prove they stay failures. Their fresh integration run belongs to the final coordinated harness; no Next or browser was started by this cache subtask. No unsupported claim is made for home/gift protocol paths not yet executed with the new API process.

## S.U.P.E.R checks

1. Single purpose: each existing route adapts its existing operation; the new script helper asserts only public HTTP revalidation.
2. Function responsibility: privacy headers, conditional sending and domain projection stay separate; no business mutation was added.
3. Direction: Route → Application remains unchanged; the helper depends only on Fastify/Node crypto and has no persistence authority.
4. Cycles: routes import the standalone helper; no reverse import was introduced.
5. Contracts: unchanged parsed Zod commands/responses; the shared helper's identity interface was frozen before the route edits.
6. Serializable I/O: ETag input consists of schemaVersion, parsed identity and validated public JSON.
7. Configuration: no deployment origin, market, currency or locale is inferred or added; fake test identities and HTTP resource paths are bounded fixtures/route identifiers.
8. Dependencies: no package or dependency changes in this scope.
9. Replacement: transport revalidation can be changed in the helper without changing domain/application schemas; existing readers remain valid 200 consumers.
10. Verification: scoped tests, all API tests, formatting/lint/typecheck/build and the two directed real protocols passed. Combined final repository/browser/CDN gates remain root-owned and are not asserted by this scoped evidence.

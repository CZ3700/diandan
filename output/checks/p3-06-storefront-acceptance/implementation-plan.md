# P3-06 implementation and acceptance plan

Registered task: P3-06, sole Lane D executor root. Base 6eacb83; branch codex/p3-06-storefront-acceptance. User preference: local commits; defer bulk GitHub push.

## Frozen URL and publication rules

- A published gift's unscoped URL is indexable content; market and currency are never inferred from locale. A valid explicit price scope has its own canonical URL. The actual selected variant may be retained; selected recipient and transactional/unknown context are noindex and excluded from alternate clusters.
- Normal gift pagination has a self canonical; page=1 and default sort/availability are normalized away. Search, anchor, filters, custom page size and alternative sorting are noindex. Invalid, duplicate or unknown parameters never enter canonical metadata.
- Metadata, hreflang and sitemap must share real current publication proof. Failure does not become an empty successful sitemap. Current immutable seven-language publication proofs are not weakened or forged to simulate an incident; fallback projection tests are labelled separately from PostgreSQL proof.
- Product markup uses the exact visible selected variant and current price scope. Minor amounts are formatted exactly. No price without a real quote, no AggregateOffer used for variant sets, no invented reviews, ratings or legal organization details.
- Shared caching is not enabled by stripping private query fields from its key. Existing pages retain query context in links; unknown/private context must bypass the entire shared representation. Next HTML/RSC variants and actual durable invalidation need explicit evidence.

## Parallel ownership

- Backend delegate: new storefront-seo contracts/domain/application/port/PostgreSQL/API files and tests; root integrates shared exports, registries, server composition and generated schemas.
- Frontend delegate: home/artist factory split, shared reads/shell, seven artist entry imports and tests. Root adds SEO metadata after handoff.
- Acceptance delegate: new storefront-acceptance helpers and runner. Root owns package/lockfile and heavyweight check scheduling.
- Root: SEO identity, metadata, structured data, sitemap handlers, cache integration, integration review, final checks, progress records and Git.

After independent review, the original public GET routes are also receiving mandatory fresh revalidation. Root owns the shared response helper and SEO call site; the directory delegate owns the five existing public route adapters and their affected assertions. ETags hash the canonical parsed resource/query scope as well as the full validated representation, including empty-directory locale/market/currency separation. Existing Next HTML and BFF reads remain no-store. No positive shared TTL is introduced.

The backend delegate additionally owns new `storefront-operations-uat*.mjs` preparation tools. These reuse the existing TEST Admin runtime with isolated role contexts and human-operated timing cards, without creating the target gift in advance or substituting automation duration for a nondeveloper result. No additional task or Phase is claimed.

## Evidence sequence

1. RED tests; targeted tests after implementation. Contract compatibility against 378 prior roots.
2. Real PostgreSQL/API/media publication protocol, including current-head loss/rollback, keyset traversal and failure propagation.
3. Compiled Next with real TEST data; seven locales at 390x844 and 1440x900; SEO snapshots, keyboard/IME, image decode, reduced motion and errors.
4. Serial cold mobile Lighthouse and resource budgets; actual VoiceOver smoke if observable via native tools. Laboratory evidence is not RUM.
5. Full format/lint/typecheck/tests/build, source provenance, S.U.P.E.R review and concrete operator review kit. Actual nondeveloper 3/5/8-minute tasks remain human evidence; no fabricated timing or translation approval.

Official references checked 2026-09-07: installed Next 16.3.4 CDN caching, generateMetadata, generateSitemaps and JSON-LD guides; Google Search Central localized versions, pagination and product snippet documentation.

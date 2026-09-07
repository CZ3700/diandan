# P3-04 final independent frontend wiring review

Reviewer: `/root/storefront_directory`. Result: **ACCEPT for the reviewed root-owned changes**. No new implementation changes were made during this review.

This is a non-author review of root's production copy wiring, directory query/link adaptation, and corrections to homepage, artist page and route states. The reviewer authored the underlying directory and image components and the i18n approval implementation; those authored parts require root/E2E's separate review and are not represented here as independently accepted by their author.

## Verified wiring

- `src/server/storefront-copy.ts` is server-only and obtains the deployment tier from the validated runtime configuration. It passes `requireApproved: true` only for production and does not catch or downgrade an approval failure.
- Both page content and generated metadata in `page-factory.tsx`, plus loading and not-found rendering in `route-states.tsx`, call this server loader. The client-facing `storefront/copy.ts` exports only the erased `StorefrontCopy` type. A source search found no unchecked runtime loader usage in public page implementation; the direct loader in `pages.test.tsx` is test-only.
- `prepareDirectoryQuery` is used by both homepage and `/idols`, including metadata. It rejects duplicate/malformed anchors instead of silently reverting to the start. A valid initial anchor is passed through to the directory.
- `directoryContextQuery` removes obsolete q/after/anchorId values, then adds the actual accepted state anchor while preserving all other parameters and duplicate commerce values. `ArtistDirectory` now uses that result for card detail links. The reducer retains the old accepted anchor during pending/failed requests and changes it only after a successful replacement containing the target. The resulting detail URL carries the accepted anchor into the artist page's existing back-to-directory link.
- The homepage hero artist caption now sets `lang` from that artist's own locale context, independently of homepage copy.

## Earlier findings rechecked

- The homepage renders the real searchable/continuously paged directory and consumes actual featured artist slots as separate shortcuts.
- Homepage metadata considers fallback on every available hydrated slot as well as homepage copy; catalog failures also produce noindex.
- Biography markup is revalidated against the shared controlled vocabulary before HTML rendering. Attribute injection is rejected by the focused test.
- Unavailable routes use `other` navigation state without incorrectly marking Orders current.
- The public brand name is read from formal runtime configuration rather than a component literal; `.env.example` includes its local TEST example.
- Published POLICY_LINK slots and labels are consumed into localized policy paths; these reach the explicitly unavailable P3-04 route boundary. Real policy content remains P3-05 work.
- Current presentation copy and independently resolved dynamic text have appropriate local language boundaries in the reviewed headline, subtitle, caption and biography changes.

## Fresh verification

From `apps/storefront`:

`mise exec node@24.20.0 -- corepack pnpm exec vitest run --config ../../vitest.config.ts --root . src/server/storefront-copy.test.ts src/storefront/directory-query.test.ts src/storefront/artist-directory.test.tsx src/storefront/content-safety.test.tsx`

Exit 0: 4 files / 8 tests. Output: `final-independent-frontend-tests.log`. Reviewed-file diff whitespace checks also passed.

This acceptance covers the read wiring and focused verification above. It does not replace the combined actual PostgreSQL/S3/API/Next/browser, all-seven-locale, viewport, keyboard, error/reduced-motion, performance and production-build acceptance owned by root and E2E. Runtime fallback behavior remains bounded by the backend's actual publication rules; synthetic fallback tests are not asserted as real publication fallback evidence. Current human copy records remain DRAFT, so this review does not authorize a production release.

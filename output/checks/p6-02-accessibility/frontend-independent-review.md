# P6-02 homepage gift browsing: independent frontend review

Reviewer: `/root/home_gift_audit`, non-author of all storefront changes reviewed here. Backend changes authored by this reviewer are excluded from this independent review verdict.

## Verdict

**No blocking frontend findings identified in the reviewed implementation.** Source inspection and affected tests support the homepage/direct-browsing behavior. This verdict does not claim real browser, screen-reader, physical-device or complete P6-02 accessibility acceptance.

## Reviewed scope

Reviewed the full current storefront diff plus new `public-gift-browse.ts`, its tests, `gift-browse-query.ts`, `gift-browse-section.tsx`, `gift-browse.tsx`, `gift-browse.test.tsx`, its fixture and extracted `gift-pagination.tsx`. Also inspected the existing navigation builder, storefront shell, artist embedding, gift detail/context components, gift stylesheet and all public locale layout stylesheet imports.

## Findings checked

- Homepage starts the published gift content request independently of artist-directory loading, injects the gift section immediately after the artist section, and does not depend on manual FEATURED_GIFT slots. The gift section is retained when homepage content returns an unavailable response.
- The homepage SSR gift section and `/gifts` without market/currency display actual content without rendering a region chooser. The latter does not await the commerce context before rendering its directory. Gift detail already permits content-only inspection and defers transaction context to purchase controls.
- New BFF reads use the fixed `/api/v1/gift-browse` path, validated input/output, omitted credentials, error redirects, no-store caching and a bounded request timeout. Page, item count, duplicate identity, locale and category mismatches fail closed. Proven legacy fallback requires a nonblank translation revision; original-language operator content retains its actual language.
- Gift links preserve existing navigation context and clear stale variant selection via the existing `giftDetailHref`. Pagination preserves explicit market/currency and repeated unrelated context; category form reset is limited to browse/filter fields, retains the shopper context and resets to page one. Nothing mutates carts, prices, currency or payment attempts.
- Numbered pagination keeps the existing 1,000-page ceiling, real total and same-context retry/out-of-range recovery. The extraction preserves the old priced directory behavior and has existing regression coverage.
- Main section/card heading levels are h2/h3 on the homepage and h1/h2 on the gift page. Native labels/select/button/links remain keyboard-operable; active page has `aria-current`; loading uses status/busy semantics. Source `lang` and explicit legacy fallback notice are retained. New styles use established tokens, wrap controls/text, preserve image containment, and add no motion. All public locale layouts already import the gift stylesheet.
- No new screenshot/log pipeline or private shopper message/name surface was introduced. The new GET form retains the existing URL context rather than adding private data.

## Independent verification

Command:

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/storefront exec vitest run --config ../../vitest.config.ts --root . src/server/public-gift-browse.test.ts src/storefront/gift-browse.test.tsx src/storefront/page-factory.test.tsx src/storefront/gift-directory-page-entry.test.tsx src/storefront/gift-directory.test.tsx src/storefront/gift-query.test.ts
```

Result: **6 test files / 95 tests passed**. Includes all seven homepage locale cases, unavailable poster recovery, no commerce-context wait, malformed response/locale/category/provenance rejection, context preservation, original priced directory pagination and price query behavior.

An initial invocation incorrectly referenced a package-local `vitest.config.ts`; it failed at test startup without running tests. The command above uses the repository's actual configuration and passed.

## Remaining verification boundary

Real production-browser rendering at 390×844, 1440×900 and 320 CSS pixels, 200% zoom, category form submit/fragment navigation, keyboard focus, axe/reduced motion and seven-language visual evidence must be supplied by root's browser gate. Source review alone cannot establish those results. The homepage still waits for the existing homepage content request before rendering its composed content; independent gift request scheduling avoids a fetch waterfall but is not a claim that a stalled homepage response cannot delay the initial shell.

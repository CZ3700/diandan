# P3-04 responsive published-image evidence

Owner: `/root/storefront_directory`, bounded image implementation under root's P3-04 Lane B task. No contract, business DTO, content projection, dependency, shared UI primitive, task state or Git commit changed here.

## Implementation

- `PublishedImage` uses installed Next 16.3.4's public `getImageProps` API and the existing `Media` error/recovery and framing primitive. It preserves intrinsic dimensions, focal point, localized informative alt and silent decorative images.
- The API generates the configured width candidates from the exact published READY source URL. The component removes candidates greater than the verified source width, sets `src` to the largest remaining candidate, and applies the actual display `sizes`. A source smaller than the smallest optimizer width retains its actual URL and actual width; no fabricated path or enlarged descriptor is introduced.
- Configured widths: 32, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1600, 1920, 2400. Quality is restricted to 75. Supported output is AVIF, then WebP, negotiated from Accept.
- The default card `sizes` matches the existing 78vw / 21rem track. The optional component `sizes` prop lets other layouts state their actual width without changing the published DTO.
- Hero mobile and desktop remain separate published compositions, selected at 48rem. Each has its own bounded `srcset`. Two responsive preload links have mutually exclusive viewport queries; the image uses eager/high loading. Below-fold cards and gallery images remain lazy.
- `next.config.ts` loads only `FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN` and deployment tier for image policy. The origin must be canonical HTTPS with an exact host and port. Host patterns, credentials, paths, queries, fragments and ambiguous URL spelling fail closed. Missing origin denies all remote images rather than inventing an origin.
- Only `/processed/v1/*/*.avif`, `.webp`, `.jpg` is allowed; local optimization, source uploads, PNG masters, SVG, other hosts/ports/protocols, queries and redirects are denied. `dangerouslyAllowLocalIP` is true only for explicit development/test; preview/staging/production and an absent tier retain Next's private-IP protection. Unknown tiers are invalid.

## Test-first verification

Commands use `mise exec node@24.20.0 -- corepack pnpm`.

1. `exec vitest run --config ../../vitest.config.ts --root . src/storefront/published-image.test.tsx src/server/image-config.test.ts` from `apps/storefront`: `image-red.log`, exit 1. Four expected rendering failures and the missing config helper proved the absent behavior.
2. Same command after implementation: first 26 tests passed.
3. Added responsive-preload and minimum-cache assertions: `image-preload-red.log`, exit 1 with two expected failures. Added the preload links and TTL setting, then corrected the HTML test reader to decode escaped `<` attributes.
4. Same command plus `src/storefront/artist-directory.test.tsx`: `image-green.log`, exit 0, 3 files / 29 tests.
5. Scoped Prettier and ESLint passed. Lint output: `image-lint.log`.
6. Storefront typecheck: `image-typecheck.log`; implementation has no reported type errors, but the shared generated `.next/types/validator.ts` references disagree with concurrently generated `.next/dev/types/routes` about internal route encoding. Root owns the final clean production build and generated-type verification. This is not recorded as a passing typecheck.
7. `--filter @fan-support/storefront test`: `image-storefront-tests.log`, exit 0, all 26 files / 169 tests passed after image integration.

## Installed primary-source checks

Read `apps/storefront/node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`: sizes, getImageProps, art direction, remotePatterns, localPatterns, qualities, maximumRedirects, dangerouslyAllowLocalIP, dangerouslyAllowSVG and cache settings.

Verified the installed implementation in `next/dist/server/image-optimizer.js`:

- The HTTP optimizer calls `optimizeImage` with width and no height (around line 1144).
- That path calls Sharp `resize(width, undefined, { withoutEnlargement: true })` (around line 884). The component also trims advertised widths, avoiding misleading larger `w` descriptors even when the optimizer would keep smaller bytes.
- TTL is `Math.max(minimumCacheTTL, upstream Cache-Control max-age)` (around line 1081); the default would otherwise be 14,400 seconds.

## Cache and integration boundaries

`minimumCacheTTL` is 60 seconds, not a maximum. A longer upstream Cache-Control value wins, and Next can serve/revalidate cached optimized bytes. Published variants use immutable checksum-derived URLs; publishing a new photograph produces a different URL, so changed content does not depend on overwriting or immediately expiring an old image cache entry.

Rights withdrawal prevents future public projection, but it does not recall bytes already downloaded or guarantee immediate removal of an old URL from browser/CDN/optimizer caches. Any rights-removal runbook must account for the media gateway/CDN and optimizer caches separately. This implementation does not claim a new purge protocol or immediate byte revocation.

Real source membership, strict Node TLS/private CA and exact test DNS mapping, real optimizer downloads and decoded dimensions, error recovery, all seven locales and viewport screenshots belong to `/root/storefront_e2e`'s combined PostgreSQL/S3/API/Next/browser harness. That harness must inject its seeded gateway origin before building. Compiled artifact under a legitimate TEST runtime is local integration evidence, not proof of staging/production deployment.

An upstream gateway failure can be hidden by an existing successful optimizer cache entry. Browser transport-failure tests should fail the actual same-origin optimizer request; a separate uncached/strict-TLS gateway probe can prove the real upstream failure. Do not clear another process's shared `.next` directory or disable global TLS verification.

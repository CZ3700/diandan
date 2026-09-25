# Root performance changes: independent read-only review

Reviewer: storefront_e2e. Recorded at 2026-09-07T17:45:56.865931+00:00.

## Disposition

No blocking product defect found in the reviewed scheduling, loading-font or stacking changes. The precise test-evidence correction has been resolved: separate omitted-query and empty-string-invalid cases now exist, and all four independent reads have unexpected-rejection/no-shell cases. These changes were re-read after the author update. Final source freeze, affected tests and the new compiled browser/performance matrix remain pending. No build, test command, browser sampling or product edit was performed during this review.

## Business scope and data boundaries

- `readGiftDetailPage` starts only the existing published gift, scoped offer and public artist directory reads. It does not write commerce data, select a production market, infer currency from locale, introduce stock, cart or PSP behavior, or fabricate a price. The helper remains server-only.
- The route parses its handle with the canonical slug schema before any gift request. The current helper signature uses `StorefrontGiftReadCommand["handle"]`, preserving the branded validated type rather than accepting an arbitrary string.
- `parseGiftSelection` remains the sole market/currency/idol/variant parser. Only VALID selection issues the scoped commerce read. Missing context and malformed context remain distinct in the domain parser; neither is converted into an invented offer.
- Valid locale, handle, market, currency and recipient are passed unchanged to the existing readers. A selected variant remains a renderer choice from actual API offers. TRACKED/on-demand/preorder semantics and the disabled checkout boundary are untouched.

## 404, error and concurrency behavior

- Canonical gift and scoped gift NOT_FOUND results are checked before returning any page shell. Invalid gift handles fail before gift/commerce reads. Only gifts-directory and region entry kinds use the outer loading Suspense; gift detail and policy do not acquire a streaming boundary before existence checks.
- `Promise.all` changes scheduling, not response validation. The configured commerce and catalog readers already catch transport, timeout, malformed-body and runtime-config failures and return their typed unavailable variants. Their status/locale/scope schema checks, eight-second deadline and no-store server fetch policy remain unchanged.
- All independent promise branches are registered in the same aggregate. An unexpected rejection propagates before page output; no detached promise or partial successful shell is introduced. This was inspected and now has four explicit mock rejection cases; this reviewer did not execute the tests.
- The original page branches for invalid query, content unavailable, recoverable MARKET_UNAVAILABLE and actual scoped success are preserved. Artist-directory failure remains a recoverable recipient-picker state when the canonical gift is valid.
- The new helper may perform a bounded public artist/scoped read for a gift that ultimately proves missing or malformed in another read. This is additional parallel read work, not a change in visible business results or a bypass of validation. No cancellation, retry or proof weakening was introduced.

## UI and accessibility effects

- Loading-only inline fontFamily reads the existing design-token runtime default (`system-ui, sans-serif`). It does not edit final page locale fonts or copy approval logic. The loading heading/status semantics remain unchanged. This review does not assert a measured performance gain or final layout score.
- `.storefront { isolation: isolate; }` creates a local stacking context for the sticky storefront header. It does not set a new z-index, transform, clipping boundary or fixed-position containing block, and it does not change shared UI rules. Portal overlays can paint above the storefront context.
- The separately executed actual Chrome overlay regression retains the same DOM and compiled shared CSS. Both 390×844 and 1440×900 were RED before the single declaration and GREEN afterwards (18 painted hit points;26 assertions). `overlay-hit-test-red-green-proof.json` proves that removing only the declaration recreates the original CSS hash. The full application matrix now contains that observation/assertion hook before the original Tab/guard/Escape checks.
- Original axe incomplete findings and first63 Lighthouse failures remain unchanged. The isolated stacking regression does not certify VoiceOver, physical devices, every contrast node or the new full compiled application.

## Test scope and resolved correction

The scheduling tests meaningfully block context, canonical gift or scoped commerce one at a time and prove all independent readers have started. They also exercise canonical/scoped NOT_FOUND and invalid handles. Their small mocked SUCCESS objects are suitable for scheduling assertions; mocked child components mean these tests do not validate full gift DTO rendering or HTTP status on a real Next server.

The initial correction request distinguished malformed empty-string parameters from actually omitted parameters. The author added both cases and a four-read mockRejectedValue matrix; the updated source was independently re-read and is accepted. Tests are being executed by the author, so this review does not independently claim their execution result. No production workaround was needed.

## Read input hashes

These hashes identify the reviewed snapshot; concurrent author follow-ups require re-reading changed files.

- `apps/storefront/src/storefront/gift-detail-page-reads.ts`: `7f771b7b3ace7b3b3c4e42660bc868efa07724b7337848d2422030d85051a63b`
- `apps/storefront/src/storefront/gift-page-factory.tsx`: `fa929c07b75ee4e863793e53a3533f9fa73a992d973b73e417e17fd2a5607cda`
- `apps/storefront/src/storefront/gift-page-scheduling.test.tsx`: `11a13159a16928d427d0b235ad3b1be819a97658bf94833d36d0f0e96390ab95`
- `apps/storefront/src/storefront/route-states.tsx`: `9417198ea589ae53a8cdcf7247c4f3b06c49e2e8786b28a4d7a53ac489fe1641`
- `apps/storefront/src/storefront/storefront.css`: `0702860f81200bdf43e06ebb0ecbecf83bde2e03a09e41dd4c1eb5e76a233caf`

Final read-only disposition after test update at 2026-09-07T17:46:35.532876+00:00: **ACCEPT for the reviewed source scope**. New compiled browser/HTTP status and performance evidence remain required.

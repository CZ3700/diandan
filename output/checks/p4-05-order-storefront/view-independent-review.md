# Independent review: historical order view and browser evidence design

Reviewer: `/root/order_bff`, not the author of the reviewed view or browser harness. Read-only source review; no source changes and no long protocol/browser run. Reviewed-source hashes are recorded in `view-independent-review-source.json`.

**Decision:** ACCEPT the historical view/status/CSS/message implementation within its current scope. The browser evidence design needs the two narrow changes below before its result supports the full stated acceptance claims.

## Actionable findings

### P2 — The failure screenshot bypasses the privacy check

Location: `apps/api/scripts/order-storefront-browser.mjs:475` through the failure screenshot at line 482.

The normal `capture()` first checks body text against all private/token canaries. If that check fails, the outer catch takes an unconditional full-page `failure.png`, masking only input and textarea elements. A regression that exposes a token, name or private message in rendered text would therefore be rejected and then copied into the evidence image. Use the same privacy predicate before the failure screenshot and skip the image if it is unsafe or the predicate cannot run; record only a boolean/reason category. Verify with a synthetic outside-input canary that the unsafe screenshot path is suppressed. This is an evidence-path defect, not a claim that the present product view exposes private data.

### P2 — Different-language orders do not test switching one order's interface language

Location: `apps/api/scripts/order-storefront-browser.mjs:314` (each matrix entry uses that order's presentation locale), lines 331–338 (direct navigation in the same locale), and lines 396–400 (a DAILY order is opened directly in Portuguese).

These are useful seven-language render and cross-language DAILY tests, but no current browser step activates the language control on an already-open order. They cannot prove that the actual language switch preserves the equivalent detail/thank-you route, public order ID, Cookie authority, original content/quantity/currency/minor amount and payment attempt without another bootstrap/exchange. Add one real switch sequence on the same authorized order, assert the route/ID and immutable data after each switch, and assert that grant-operation counts and the financial/attempt fingerprint remain unchanged. The existing all-seven-locale view unit test proves formatting/data purity, not browser navigation behavior.

## Accepted implementation observations

- `OrderDetail` uses only the supplied authorized historical DTO. No catalog read, current price lookup, private fan field or API write exists in this view.
- Artist/gift names and images preserve their original data and four independent resolved languages. DAILY originals are explicitly identified; approved fallback/saved languages are labelled when relevant. Null historical variant labels render no invented option.
- Integer minor amounts and currency feed the shared `Price` component. Line unit/total amounts and the order subtotal/tax/shipping/fee/discount/total are preserved. Zero optional adjustments are omitted; amounts are not recomputed from current product data or shell locale.
- Payment, fulfillment, dispute and order statuses remain four independent axes. The only `<time>` is recorded `createdAt`, explicitly rendered in UTC. There is no guessed payment/preparation/delivery timestamp, duration estimate, email-delivery claim or milestone completion inferred from `updatedAt`.
- ON_HOLD uses review wording; it is not rendered as preparing or delivered. Preparation guidance describes the studio handover process. Delivered guidance explicitly says the studio recorded delivery to the artist.
- Existing shared `Media` receives each snapshot URL/alt/lang and a stable square presentation frame with `contain`; horizontal/vertical composition is preserved. CSS uses existing tokens, flexible/wrapping columns and visible focus, with no new motion requiring an additional reduced-motion branch.
- The seven catalogs add matching typed keys and ICU variables. All seven review manifests remain DRAFT with null reviewer/approvedCommit and current hashes; this review does not replace native-speaker approval. The Japanese CLOSED wording was checked against the existing order state machine, where OPEN → CLOSED is authorized by FULFILLMENT_COMPLETED; it was not treated as an invented delivery timestamp.
- Browser fixture creation uses normal catalog/checkout/TEST PSP evidence/application flows. Current-content mutation uses authenticated publication, while business fingerprints compare financial/inventory/fulfillment/notification state. Body-loss injection and actual bfcache status are explicitly distinguished from a physical network failure or an assumed bfcache restoration.

## Independent verification

Executed against the current shared workspace, both with actual exit 0:

- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/storefront exec vitest run --config ../../vitest.config.ts --root . src/storefront/order-detail.test.tsx`: 10/10 pass, 619 ms.
- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/i18n test`: 6 files / 28 tests pass, 887 ms.

The browser's first run was still owned by root during this review. No completed browser, real PostgreSQL, full combined build, native-speaker, physical-device, merchant or production result is asserted here.

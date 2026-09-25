# Gift purchase client boundary — independent review

Reviewer: storefront_directory. Conclusion: ACCEPT for the bounded source change; fresh production bundle and real browser behavior remain pending root's coordinated run.

Reviewed `gift-purchase.tsx`, `gift-quantity.tsx`, `gift-selection.ts`, `gift-selection-values.ts`, `gift-recipient.tsx`, and their purchase/selection tests. No source edits in this scope.

- `GiftPurchase` is explicitly server-only and its only runtime consumer is the server `gift-detail.tsx`. Existing offer selection, variant anchors, real price, inventory policy/availability messages and disabled checkout branches remain intact.
- The only interactive purchase island is `GiftQuantity`, receiving exactly one numeric ceiling and three strings. The existing Quantity component still owns integer/minimum/maximum behavior. Offer identity/ceiling/recipient-kind keys preserve reset behavior.
- Tracked, preorder and procure-on-demand presentation stays distinct. Missing price, unavailable offers and required-but-missing recipient do not become editable quantities; explicit unknown variants are not silently substituted.
- Independent TypeScript AST extraction from HEAD and current source found `giftSelectionHref`, `giftCanonicalPath` and `selectGiftOffer` function declarations exactly equal. The legacy module re-exports the same functions; raw query and recovery validators remain in the original module. Recipient only changes the pure link import.
- The new pure selection module still calls shared navigation; its own schema imports are removed, but this review does not claim every transitive/shared Zod dependency disappears.

Independent executed coverage includes the actual purchase SSR tests in `directory-lazy-tests-green.log` (8 files / 70 tests overall, PASS) and current storefront typecheck in `directory-lazy-types-green.log` (PASS). Author selection tests explicitly compare the legacy export surface and object identity; they were read, not separately re-executed by this reviewer. No build/Next/browser was run.

This is a source boundary and compatibility conclusion, not a measured JavaScript-byte, LCP, or first-interaction improvement claim. Fresh browser quantity interaction, recipient selection and all seven locale presentation still belong to the coordinated acceptance run.

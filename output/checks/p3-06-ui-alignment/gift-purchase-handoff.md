# P3-06 gift detail presentation subtask

Scope: four owned files only (`gift-detail.tsx`, `gift-purchase.tsx`, `gift-detail.css`, `gift-purchase.test.tsx`). No runtime lifecycle, browser, contract, locale copy, token, transaction, or database changes.

## Result

- GiftPurchase retains the single `selectGiftOffer` result and presents its existing Price before the original recipient section. The same selected offer controls variant selection, inventory and add eligibility. The existing data-gift-offer price containment is retained for integration consumers.
- The recipient section is composed through a server-only child slot. Missing-market presentation continues through the original recipient and market chooser; it never invents a price.
- A sole valid selected variant is read-only text, eliminating a redundant navigation. Multiple variants remain named, keyboard-accessible links. An unknown requested variant still displays recovery links and does not substitute a price or enable add.
- Reduced mobile breadcrumb/image-text/recipient spacing; desktop layout uses the existing 1200 px content token and 1.1:1 product/purchase columns. Controls retain existing 48 px minima, DOM and visual order match, price and long recipient-control text may wrap. No new animations.

## Verification

1. RED: gift-purchase-red.txt, 14 pass / 3 expected fail, exit 1. Missing recipient composition/order and single-selected-variant simplification reproduce the requested changes.
2. GREEN: gift-purchase-green.txt, 5 files / 85 tests pass, exit 0. Covers purchase, canonical offer selection, seven-locale streamed detail and missing/invalid market, content, context-preserving selection.
3. Exact-file prettier check passes: gift-purchase-format.txt.
4. Exact TS/TSX ESLint --max-warnings=0 passes: gift-purchase-lint.txt (empty success output).
5. Exact-file git diff --check passes.

S.U.P.E.R: all ten checks pass within this subtask: presentation-only single-purpose components; one-way server composition; no cycles; existing canonical contracts retained; React slot remains internal to server rendering, no business/network serialization changed; no new production literals, configuration or dependencies; existing view replaceability retained; all affected tests pass.

Root owns final typecheck/build, actual seven-language two-viewport screenshots, keyboard/axe/reduced-motion integration, progress documentation and Git. This note does not claim these final gates or the full P3-06 task complete.

## Browser harness follow-up

Owned follow-up files: `apps/api/scripts/gift-storefront-browser.mjs`, `storefront-acceptance-matrix.mjs`, `storefront-acceptance-lazy-validation.mjs`.

- Desktop toolbar sorting first proves selection alone leaves the URL unchanged, then explicitly submits through data-gift-toolbar-apply, waits for actual navigation, and proves page reset plus actual market/currency preservation. Advanced amount entry first opens the disclosure.
- History now has a separate sort entry: both new intermediate Back to descending page 1 and original Back to ascending page 2 are asserted. Existing canonical card/amount, invalid range, JPY, mobile focus/cancellation and recipient checks remain.
- Lazy-validation suite starts from an actual applied PRICE_DESC URL. Desktop advances the amount draft instead of using the removed embedded sort; mobile keeps its embedded sort. Cancellation, lazy failure/recovery, exact 200 minor units, applied sort and TEST market assertions remain. Reloading the recovery URL reopens desktop disclosure before editing.
- Exact prettier/eslint checks pass (`gift-tool-format.txt`, `gift-tool-lint.txt`), all three Node syntax checks pass and exact diff check passes. These harnesses have no corresponding unit test files; actual browser execution remains root-owned and is not claimed here.
- Multiple-variant fixture now passes the complete new response through its canonical schema rather than assigning raw values into branded fields. Purchase tests re-run: 17/17 (`gift-purchase-brand-types.txt`).
- Root took ownership of `gift-detail.css` for screenshot-driven final font sizing after the first handoff; no further CSS edits by this subagent.

## Explicit-submit accessibility revision

The two full browser tools now select PRICE_DESC, assert the exact pre-selection URL is unchanged, then click the explicit toolbar submit control before waiting for navigation. Final PRICE_DESC, page 1, market/currency, advanced exact amounts and both history entries remain asserted. Lazy-validation does not operate the toolbar and retains its existing real applied-sort setup; its explanatory comment was updated. Exact prettier/eslint, all three syntax checks and diff checks passed (`gift-tool-explicit-submit-format.txt`, `gift-tool-explicit-submit-lint.txt`). No browser was run by this subagent.

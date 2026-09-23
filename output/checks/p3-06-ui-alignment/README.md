# P3-06 UI alignment after local user acceptance

Scope: user-requested correction against approved ADR-008 V2, baseline `75c255fa`, branch `codex/p3-06-ui-alignment`. Keep all seven public locales, the actual catalog/commerce source, continuous artist search, price/inventory/payment and admin workflows. No new business scope or production release.

## Observed changes

- At 390×844 the homepage photo frame was 487.5px high; approved V2 used approximately 40svh. Restored 337.594px with existing responsive media/focal positioning, keeping the primary action visible.
- At 1440×900 the always-expanded gift filters pushed the first product near y750. Compact sorting and an optional advanced disclosure bring it near y486. Desktop returns to three columns and mobile retains two; actual title/price are adjacent, description remains on the detail page.
- Detail price is selected once from the actual offer, before recipient selection. Single variants are readable static text; multi-variant and invalid-variant recovery remain links. Typography and spacing separate title, price and purchase actions.
- Homepage shows one artist browsing directory, preserving featured links when no directory exists. The admin's simple upload flows were visually checked and required no changes.

## Evidence and reproducibility

- `before/`: fresh read-only screenshots of this user's accepted local TEST instance.
- `candidate/` and `intermediate/`: intermediate candidates, not final release evidence. The intermediate 61 cases / 398 checks / 56 axe scans passed with 0 violations, 7 incomplete focus-guard findings retained. Its immediate-sort interaction was rejected in independent review and is superseded by explicit submission.
- `hero-red.txt`, `home-red.txt`, agent `*-red.txt`: pre-change failing checks. Corresponding green logs verify implemented corrections.
- `audit.mjs`, `hero-budget.mjs`, `verify.mjs`: bounded read-only local browser tools. They load the private existing local config without printing it, reuse the exact TEST certificate pin and isolated browser DNS, and never change system trust/hosts. No order/payment or content mutation.
- Initial browser tool failures are preserved: a generic h1 matched both streamed loading and real content, and premature keyboard focus during streaming was lost. The verifier now waits for the specific real page and settled navigation before keyboard interaction, consistent with existing repository browser tests; no product timing or security checks were relaxed.
- `initial-untracked.json`: original 6144 untracked file hashes retained for protection.

Independent review found that changing a select must not silently trigger full-page navigation; sorting now requires an explicit apply action. Reference: [W3C F36](https://www.w3.org/WAI/WCAG22/Techniques/failures/F36). The discarded intermediate is not claimed to satisfy this requirement.

Final verification and S.U.P.E.R are recorded below after execution. This UI correction does not replace physical-device, human screen-reader, translation approval, production-performance or real-merchant gates.

The first isolated legacy gift suite reached 16338 actual protocol assertions but then timed out on a P3-only deleted checkout placeholder. Its failed result is preserved under `isolated-gift-storefront-legacy-failure/`. The tool now asserts the real current add-form/submit/quantity gates and imports the existing cart quantity bound, retaining stock and recipient cases. No product behavior was changed for this failure. `run-isolated-gifts.mjs` changes only the original harness output directory in a temporary sibling entry, preserving all fixture setup and browser budgets, and removes its own temporary entry in `finally`. Original harness source and executed source hashes are recorded.

Final capture tooling correction: mutating `img.loading` to `eager` before hydration caused the dev-only lazy/eager attribute warning visible in intermediate screenshots. The corrected verifier uses actual scrolling and image decode without changing attributes and also requires zero browser console errors. The prior matrix and its failure are retained under `matrix-tool-diagnostics/`. An extra exploratory whole-page JavaScript-disabled probe found hidden streamed content, so native GET markup is not claimed to make the entire existing Next streaming page usable without JavaScript. This is recorded as a separate existing-page limitation, not a relaxed sorting or supported-browser acceptance check.

## Final result

- Final `check:dev` exit 0: typecheck/test 64/64, build 36/36; 63/63/35 cached. Adapter boundaries and 32 actual Node package imports passed. The later capture-tool changes passed exact ESLint/format; product and reusable browser-tool source SHA remained frozen.
- Isolated actual PostgreSQL + TLS S3 + production-compiled storefront: **21898 assertions, 8 cases, 55 screenshots, 10 axe scans, zero violations/incomplete/page errors**. This suite checks real purchase availability/quantity controls, not a new successful cart mutation or payment.
- Final existing local TEST instance: **581 checks, 61 cases, 61 screenshots, 56 axe scans, zero violations/page errors/console errors**. Seven locales at 390×844 / 1440×900, 320px reflow, error focus, empty result, applied conditions, Enter submission, native history, reduced motion and Escape verified. Seven original aria-hidden-focus incomplete findings retained; 168 forward/reverse Tab steps stay in the drawer and Escape restores focus. This is not human screen-reader certification.
- Separate JavaScript-disabled probe confirmed the select is inside hidden Next streaming container `S:4`; the unchanged page-factory source establishes the existing page-level dependency. No complete no-JavaScript experience is claimed.
- Root inspected final Chinese/mobile and desktop detail plus Portuguese long-label and populated isolated catalog screenshots. Accepted local instance restarted and opened; prior content/orders retained.
- 6144 original untracked hashes and 18 frozen source hashes remain unchanged; S.U.P.E.R and independent review recorded in `final-review.md`. Final staged secret scan is recorded in `final-verification.json`.

Re-run product checks with `mise exec node@24.20.0 -- corepack pnpm check:dev` while the local instance is stopped; use `run-isolated-gifts.mjs` for the original isolated gift suite without overwriting prior evidence. Start the existing instance and run `verify.mjs` for read-only visual and interaction checks. Never reset the user's instance to run this review.

Log policy: raw `.log` output remains local and untracked. Committed `.txt` copies only normalize CR/trailing whitespace and final blank lines; `log-normalization.json` records raw hashes. Initial staging refused `.log` files under the approved secret-scan boundary; corrected without changing scanner policy.

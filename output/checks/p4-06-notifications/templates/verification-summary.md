# Updated unpublished P4-06 template verification

This supersedes the initial candidate results in `verification.md`. The initial
logs and browser directory are preserved. See `unpublished-version-change.md`
for the authorized, pre-release version changes.

- `summary-red.log`: two new large-order/summary tests failed as expected.
- `summary-events-red.log`: summary plus historical-event semantics failed before
  the implementation/copy correction.
- `summary-green.log`: all 9 i18n test files / 44 tests passed.
- `summary-types.log`, `summary-build.log`, `summary-lint.log`, and
  `summary-format-check.log`: exit 0.
- Worst legal 500-line payload with three 1000-character names containing HTML
  escaping characters succeeds in every locale. Only the first ten items render;
  490 remaining items are explicit, the full order total remains unchanged, and
  the output fits the existing provider HTML/text bounds.
- Ten or fewer lines omit the remainder; eleven lines use the correct singular.
  All seven ICU parameter and plural branch sets are checked.
- Payment/preparation/delivery copy states historical facts and directs the user
  to the current order state, without settlement claims or invented timestamps.
- All 21 reviews remain DRAFT with null reviewer and approval commit.
- `browser-2026-09-16T02-03-48-973Z/report.json`: original 42-case matrix repeated,
  plus a 500-item long-order case at both sizes: 44 cases, 842 assertions,
  44 screenshots, 44 axe scans with 0 violations and 0 incomplete findings.
- Screenshot inspection of the long Spanish mobile order confirms wrapping,
  visible ten-item limit, 490-item remainder, complete 500.00 USD total and usable
  CTA. Normal Spanish desktop preparation copy remains aligned and legible.
- Only the single credential-bearing href is replaced before browser preview;
  hashes relate original and safe preview HTML. No real email/PII is used.
- `source-manifest-summary.json` pins all 15 owned source/package files.

S.U.P.E.R checks 1–10 remain satisfied for this scoped implementation. Full
integration, independent source review, manual translation approval, actual mail
provider/domain validation and inbox-client acceptance remain root/release gates.

# P4-06 templates — local verification

Scope: `packages/i18n/src/notifications/**` and the `./notifications` package
export. No contracts, lockfile, worker, persistence, route or progress changes.

## Evidence

- `red.log`: 8 expected assertions failed because the renderer did not exist;
  the 28 pre-existing i18n tests passed.
- `version-red.log`: missing 21-entry draft review manifest and archived identity
  fixture failed as expected; the remaining 38 tests passed.
- `history-red.log`: missing independent historical render fixture failed as
  expected; the remaining 40 tests passed.
- `green.log`: 9 files / 41 tests passed. This includes 21 immutable historical
  message digests rendered in three worker time zones, exact minor amounts,
  escaping, all ICU parameters, draft/stale review rejection, whole-message
  fallback, fixed replay identity and URL/order matching.
- `types.log`, `build.log`, `lint.log`, `format-check.log`: passed with exit 0.
- Browser command: `mise exec node@24.20.0 -- node
  output/checks/p4-06-notifications/templates/verify-browser.mjs`.
- `browser-2026-09-16T01-52-34-383Z/report.json`: 42 cases, 798 assertions,
  42 screenshots, 42 axe scans with zero violations and zero incomplete results.
  All three events × seven locales × 390×844 and 1440×900. Keyboard focus and
  activation, at least 44px target, no horizontal overflow, reduced motion,
  source-language labels and historical amounts passed.
- Visual inspection: Chinese payment mobile, Thai payment desktop and Portuguese
  preparing mobile show legible type, clear gold CTA, thin separators and no
  clipping. Other matrix screenshots are retained for independent review.
- `source-manifest.json` records hashes for all 14 owned source/package files.

The browser receives sanitized HTML only: a single credential-bearing href is
replaced by a safe preview target before files are written or navigation starts.
Original/preview hashes are reported; original renders match the fixed archive
digests. All shown names are synthetic fixtures. No real email was sent.

## S.U.P.E.R self-review

1. Identity, rendering, review gate, composition and draft copy are separate.
2. Each function has one rendering, validation or selection responsibility.
3. Data flows contracts → i18n renderer; no application/adapter dependency.
4. No circular imports.
5. All cross-module inputs/outputs use the frozen root contracts.
6. Inputs/outputs are serializable; credentials remain transient render input.
7. Site name/origin are caller data. Version-local email styles are explicitly
   frozen existing token values for reproducible historical mail.
8. No dependencies or lockfile changes; Node crypto and existing ICU formatter.
9. The factory structurally implements the existing template port.
10. Affected test/type/build/lint/format checks passed; root runs integration.

## Limits and remaining gates

- All 21 review records remain DRAFT with null reviewer/approval commit.
  `APPROVED` cannot construct until actual exact-version review evidence exists.
- Fallback metadata is returned; root application is responsible for durable
  selection and incident observability.
- Chromium HTML preview is not Gmail/Outlook inbox acceptance or real sender
  delivery evidence. Provider/domain configuration remains outside this scope.
- No preparation/delivery times, SLA or PSP settlement claims are fabricated.
- Historical byte replay is tested under the pinned Node/ICU runtime; runtime
  upgrades must preserve these fixtures or retain the release runtime.

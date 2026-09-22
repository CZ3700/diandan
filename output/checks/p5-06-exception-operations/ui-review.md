# P5-06 Admin UI / BFF review

Owner: exception_ui. This is an author review; independent contract/application/storage review is recorded separately in `spec-review.md`.

Decision: **ACCEPT within the local Admin UI/BFF scope**. Production UI is frozen. The final real-browser report is PASS; previous failed attempts remain retained below.

## Delivered scope

- One permission-gated management-center entry, with four exception categories, server pagination, OPEN/ALL filtering, safe details and explicit next steps.
- Four schema-defined actions require a fixed reason code and explicit confirmation. Unsupported, uncertain and read-only sources expose an explanation without a mutation control.
- Browser and BFF both validate response correlation against the original command. No raw payload, email, private message, credentials or provider secrets are rendered or retained.
- Same-actor session storage retains one unresolved original command. The command is schema-validated, written and read back before network execution. Reload recovery preserves its key and body. Uncertain responses and access loss retain the pending slot; access loss hides the details and recovery control until authority is re-established.
- English source and six translation files have matching keys and SHA-256 review metadata. All seven remain DRAFT, without invented reviewer approval.
- A real-browser runner covers the management UI through its BFF and the real API fixture, with no fabricated business responses.

## Executed checks

Initial absent-module failures and later targeted RED/GREEN failures were observed before implementation. A final read-error wording regression test verifies that read failures do not tell an operator to recover a nonexistent mutation.

Latest local verification, 2026-09-22:

- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/admin test src/management-exceptions src/management-center/access.test.ts src/server/admin-exceptions-operations.test.ts src/server/admin-bff.test.ts`: exit 0, 7 files / 17 tests.
- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/admin test`: latest rerun exit 0, 62 files / 219 tests.
- `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/admin typecheck`: exit 0.
- ESLint over the owned UI, minimal hub/BFF wiring and `admin-exceptions-browser.mjs`, with `--max-warnings=0`: exit 0.
- Prettier `--check` over the same owned scope: exit 0.

## Final real-browser evidence

`integration-2026-09-22T08-16-42.172Z/browser-exceptions/report.json`: **PASS**, Chrome 153.0.8010.53, 708/708 browser assertions, 11 case groups, 89 PNG screenshots and 89 axe scans. There are zero browser/asynchronous errors, zero axe violations and zero incomplete axe checks.

The real UI → BFF → API run covered all seven locales at 390×844 and 1440×900 for the list and all four source details; category/status filters and real server pagination; all seven locales with WEBHOOK mutation read-only access; no-access role; blocked UNKNOWN notification; keyboard navigation and reduced motion; failed list read and retry; browser response loss and actual API accepted-response loss with original key/body recovery after reload; pending-response loss followed by access revocation/restoration; payment reconciliation and controlled notification retry; a genuinely empty OPEN payment list after recovery; live revocation and restoration to the exact original detail. The read-only claim is deliberately scoped to WEBHOOK mutation, not all grants held by the fixture role.

Author visually inspected the final Chinese mobile dead-letter detail, Portuguese mobile notification detail, English desktop list, Thai mobile payment detail, Vietnamese mobile notification detail and restored-access detail. Text, identifiers and actions remain within the controls and viewport; the unrelated discovery error is absent; restored access shows the original completed event and its operation history. Automated scans and layout assertions cover all 89 captured states; translation approval remains DRAFT.

The runtime agent supplied and executed the isolated infrastructure fixture and economic/receipt/notification side-effect checks. This author inspected the browser report and screenshots rather than claiming independent authorship of those backend assertions. `ui-review-inputs.json` binds the final owned source files and browser report hashes.

## Retained failed attempts

The first browser attempt produced two English mobile screenshots before a navigation wait timed out; it is retained at `integration-2026-09-22T07-53-58.021Z/browser-exceptions`. Earlier fixture attempts did not reach the browser. No complete browser or accessibility pass is claimed for these failed runs.

Review of that first real screenshot found an unrelated workspace-discovery error above a healthy exceptions detail. A new failing test now verifies that a valid current section context suppresses another section's discovery error; the fix passed 5 affected files / 11 tests, typecheck and scoped ESLint. The runner now waits for the back-navigation list before selecting filters, handles click/response promises together, checks filter category, and retains a safe failure screenshot/list summary. Healthy captures also assert that the unrelated discovery error is absent. Status labels were corrected across all seven locales, with DRAFT hashes updated and view tests passing.

The next complete attempt, `integration-2026-09-22T08-06-12.690Z`, completed 88 axe scans with zero violations and zero incomplete checks, but failed its last immediate restored-detail count (700/701 assertions passed). Its transport recorded restored context/detail 200 and its failure screenshot already showed the correct original detail. The runner now waits for the actual response on every healthy refresh, open and recovery mutation and requires a visible original target after restored access. That failed attempt remains FAIL; the later complete rerun above is the acceptance evidence.

## S.U.P.E.R review

1. Modules separate localized copy, presentation, API transport, pending persistence and state classification.
2. Filters were extracted from workspace during the final simplification pass; views do not own transport or persistence.
3. Dependencies follow browser → BFF → existing API; UI does not import application repositories.
4. No reverse/circular imports were introduced in the owned modules; TypeScript and ESLint pass.
5. Every API and retained command boundary uses the shared strict schemas, including response correlation.
6. Commands and responses are serializable; storage contains only schema-defined safe identifiers and operation metadata.
7. Production origins, secrets, actors and source IDs are not hardcoded. BFF operation route names are explicit contract mappings.
8. No dependencies were added.
9. Injected API/storage interfaces and separate views preserve replaceability.
10. Affected tests, Admin's 219 tests, owned static checks and the final real-browser run pass. Combined repository gates are root-owned and are not represented as independently executed by this collaborator.

## Limits

No production deployment, real PSP credentials, customer email delivery or physical-device test was performed. The runtime fixture uses isolated local PostgreSQL, TLS OIDC and TEST provider implementations. No commit or push was made by this UI collaborator.

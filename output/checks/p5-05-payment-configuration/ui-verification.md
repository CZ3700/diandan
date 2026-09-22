# P5-05 UI verification — accepted local browser candidate

The management center has a payment settings entry independent of content/order permissions. Operators choose existing deployed accounts and fill structured channel/rule forms, review seven-language customer text, inspect before/after values, and confirm publication/restoration. No operator JSON, UUID entry, credential entry or executable adapter upload is exposed.

Pending command recovery is stored in tab sessionStorage under the authenticated actor identity. SAVE/SUBMIT/APPROVE/PUBLISH/ROLLBACK retain one canonical schema-parsed payload and idempotency key before network I/O. Uncertain results block a new mutation and offer recovery after reload. The store contains only public configuration text and command fields, never credentials or private fan data.

All seven UI copy sets have fixed version/hash manifests with DRAFT status and null human reviewer/approved commit. Customer-facing payment configuration text is governed separately by actual server review records; unchanged approved text from a published source may retain genuine review evidence.

## Observed local checks

- Initial client/BFF/model RED: `ui-red.log`; GREEN: `ui-client-green.log`.
- Review/confirmation/copy RED: `ui-view-red.log`; GREEN: `ui-view-green.log`.
- Structured field serialization RED: `ui-editor-red.log`; GREEN: `ui-editor-green.log`.
- Millisecond health precision RED: `ui-health-precision-red.log`; later green included in `ui-tests-second.log`.
- Independent management access RED/GREEN: `ui-access-red.log`, `ui-access-green.log`.
- Permission/lifecycle RED/GREEN: `ui-authority-red.log`, `ui-authority-green.log`.
- Publication receipt semantics RED/GREEN: `ui-receipt-red.log`, `ui-receipt-green.log`.
- Heading hierarchy RED/GREEN: `ui-heading-red.log`, `ui-heading-green.log` (5 view tests).
- Final affected candidate: **21 files / 68 tests** (`ui-navigation-tests.log`), including management-center, management-payments and BFF registration tests. Admin typecheck, owned ESLint and formatting pass (`ui-navigation-*.log`). Root owns combined repository/production-build gates.
- Source review found that leaving and re-entering payment settings could reuse the Hub's original workspace. Selecting the section now refetches the existing context/read requests. There is no mounted component harness in this repository; this navigation fix does not claim a fabricated RED unit result. The actual browser runner requires the newly saved draft in history and the latest published head after return navigation.

## Accepted complete browser run

`integration-2026-09-22T06-40-07.476Z` completed with exit 0 after the final source freeze and root production build. This reviewer independently read the raw result files and recomputed **466 passing browser assertions, 8 cases, 65 screenshots / 65 axe analyses, zero violations, zero incomplete checks, zero page errors**. HTTP protocol313 also passed; the combined runner records 6,660 checks = 5,763 setup + 897 scenario. These counters have distinct scopes and must not be added together. Runtime owner confirms cleanup completed. `ui-browser-summary.json` preserves this independent aggregation.

Both accepted PUBLISH and ROLLBACK lost-response flows replayed the original key and payload after reload and returned the original receipt. Their two-node observations converged in about 51ms and 102ms, respectively. Return navigation saw the newly saved history and latest publication. Seven independent TEST reviewer identities approved their own language, including English; routing-only edits retained actual server review evidence. This is test acceptance, not human approval of UI translations.

Root `check-dev-final.log` passes 64/64 typecheck tasks, 64/64 test tasks and 36/36 builds (62/62/34 cached). `protection-final.json` records an unchanged 2,530-file candidate since the final gate and unchanged prior contract/schema and migration prefixes. Production build and actual Next development browser execution are separate evidence.

### Preserved first-run defect

The first full HTTP + browser run (`integration-2026-09-22T06-32-26.607Z`) passed HTTP313, then stopped at `es-390-settings`: 32 screenshots, 172 browser assertions, zero page errors or axe violations, **one axe incomplete** (`color-contrast` / `elmPartiallyObscured`). Its original results remain intact. The actual Manrope text extended 2.266 pixels beyond the old fixed three-column mobile navigation button. A focused Chrome reproduction with the real stylesheet and font reproduced that incomplete result. Changing only the mobile grid to auto-fit columns with the existing 128px minimum produced a 177px button at 390px, contained text, and zero violations/incomplete (`ui-nav-layout-diagnostic.json`, `ui-nav-wrap-green.log`). The accepted complete rerun above subsequently passed the original matrix and the added navigation text-boundary assertions; the focused result was not used as a replacement.

Every complete-run screenshot now also asserts that every rendered navigation text line lies within its button. The mobile fix passed the same 21 files / 68 affected tests, owned lint and formatting (`ui-nav-wrap-*.log`).

`apps/api/scripts/admin-payment-config-browser.mjs` exports `verifyAdminPaymentConfigurationBrowser(context)` for the runtime owner's real fixture. The accepted run covers:

- Seven locales at 390×844 and 1440×900: settings, blocked publication validation, structured editor.
- Seven-locale read-only boundaries and seven independent language reviewers including English.
- Keyboard focus, reduced motion, HTTP read failure and recovery.
- Real browser authored draft/save, publication, routing-only edit with preserved genuine review, and restoration.
- Return through the Orders section after saving and publishing, with a fresh read of draft history and the current publication.
- Lost PUBLISH and ROLLBACK responses after server acceptance, reload, exact original key/payload replay, and two independent node observations within 60 seconds.
- Every screenshot checks horizontal overflow, axe violations and axe incomplete results. Raw cookies, credentials, private fan data, HAR and traces are not written.

Runtime: isolated native PostgreSQL 18.6, actual TLS OIDC and TEST PSP, Next **development** server. Physical phone and real merchant/staging evidence remain outside this local run.

## S.U.P.E.R checklist (source review)

1. Single-purpose API, pending store, authority/model, editor fields, review/diff/publish views and workspace controller: pass.
2. Complex form parsing and summaries separated from network coordination: pass.
3. Browser → BFF → application/domain/port/adapter direction: pass.
4. No reverse/circular imports introduced in owned modules: source review and final root gates pass.
5. Cross-boundary commands/responses use the frozen Zod contracts: pass.
6. Persisted command payloads and responses are serializable: pass.
7. No hardcoded production account, country, market, currency, secret or provider endpoint: pass. UI durations/amounts come from explicit fields or actual deployed policy.
8. No new dependency installed: pass.
9. New management-payments directory has a small API and workspace integration boundary: pass.
10. Affected checks, complete local browser/HTTP and final root gates pass. Production merchant/staging, physical phone and human critical-copy review remain separate scope.

## Visual review of actual screenshots

The UI author inspected the final Chinese mobile settings, Thai mobile editor, Spanish mobile editor, Portuguese desktop settings, Vietnamese desktop editor, Japanese mobile read-only view, English uncertain publication and English restoration confirmation. Root independently inspected Spanish mobile settings, Chinese mobile editor and English desktop settings. The fixed Spanish navigation keeps complete words within the button; labels, fields, review states, uncertainty recovery and the 50% → 100% restoration diff are visible without clipping or overlap. The confirmation requires a reason and explicit checkbox; uncertain status clearly offers recovery while new edits are disabled. All 65 images independently pass the unchanged axe rules and explicit navigation/document overflow assertions. Screenshots live in the accepted run's `browser-payment-configuration/` directory.

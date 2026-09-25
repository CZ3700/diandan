# Header language menu: bounded loading experiment

Status: minimal implementation and scoped tests are green; non-author review and the compiled browser experiment remain pending. The baseline build/smoke and six Lighthouse samples belong to root/E2E. This change has not run Next build or a browser and does not yet claim a bundle or LCP improvement.

## Evidence and bounded benefit

- `apps/storefront/src/storefront/site-header.tsx:5` statically imports both Drawer and LanguageControl. LanguageControl is rendered at line 56, including the mobile drawer copy at line 118.
- `packages/ui/src/selection-controls.tsx:10,33` calls the shared Menu. `packages/ui/src/menu.tsx:3` imports Base UI Menu; the current wrapper accepts only label/options/value/onValueChange and owns open state internally. Existing LanguageControl has no controlled opening/ref contract.
- Drawer already accepts open/onOpenChange (`packages/ui/src/overlay.tsx:8-16`). It remains an initial dependency in Header, gift filters and gift recipient selection. This experiment will not change Drawer.
- The previous production inspection proved that Menu and Dialog/common Base UI code remain initial dependencies after the schema/purchase changes. The older Menu mixed chunk was 32,396 gzip bytes, with another 24,909-byte common block. These are historical inventory figures, not savings predicted for fd19144 or the new baseline. Common Dialog/focus/positioning code will remain, and the interactions barrel may still affect bundling. Only the new compiled manifest plus actual fetched chunks can establish a reduction.
- The new source test follows selected static imports through Header-owned files. It intentionally does not count every export from the shared interactions barrel as downloaded. It is a source-boundary regression, not a bundler simulator.

## Frozen scope and proposed interface

Initial test files:

- `apps/storefront/src/storefront/site-header-lazy-boundary.test.tsx`: actual static LanguageControl import gave one effective failure; seven-language SSR compatibility checks compare existing trigger content/CSS/SVG and native button/menu semantics, availability and preserved commerce navigation.
- `packages/ui/src/menu-controlled.test.tsx`: render existing Menu/LanguageControl with `open: true`; observing props forwarded unchanged to the real Base UI Root proved the wrappers supplied false. Both controlled cases failed, while the existing default/closed case passed.

The first two logs included an invalid SSR assumption: Base UI omits aria-expanded until its trigger registers on the client. That is not a product failure. The test now compares actual legacy SSR attributes, and the controlled tests observe the actual Root boundary while forwarding every original prop into the real primitive. Those initial logs remain preserved; effective RED is specifically `header-boundary-valid-red.log` (1 FAIL / 7 PASS) and `header-menu-controlled-valid-red.log` (2 FAIL / 1 PASS).

Root authorized implementation after the baseline samples finished and those effective RED tests:

- `packages/ui/src/menu.tsx`: optional `open?: boolean`, `onOpenChange?: (open: boolean) => void`, `triggerRef?: Ref<HTMLButtonElement>` (and, if required by the real first-arrow behavior, an explicitly reviewed first/last opening-focus hint). Uncontrolled defaults, option validation, modal behavior, touchmove cancellation, radio selection and close-on-select remain unchanged.
- `packages/ui/src/selection-controls.tsx`: only forwards the optional controlled/ref fields; canonical locale options remain the same source and same bindings.
- Proposed private storefront facade `site-header-language.tsx`: receives locale, language/loading/error/retry labels, onValueChange and a visibility/cancellation signal. It owns the lightweight SSR trigger and asynchronous module state. It does not receive or import a full dictionary. `site-header.tsx` keeps its current URL/cookie/navigation callback and Drawer behavior.
- Proposed deferred `site-header-language-menu.tsx`: consumes the existing LanguageControl through the public interactions entry. Loading is invoked from the actual activation handler with `import()`, not module evaluation, render, mount, hover or idle. The promise has a catch path; a rejected promise is not retained as a permanent cached result.

The first controlled render must associate the actual trigger with Base UI. Existing Base UI 1.7.0 types expose Root open/triggerId/onOpenChange and Popup finalFocus; a mere lazy component replacement does not transfer the original keyboard intent. The final implementation must verify this in the browser instead of dispatching a synthetic keyboard event and treating it as the original trusted action.

## Interaction state and cancellation

1. **Idle:** server-render the existing fs-menu__trigger structure, label, canonical native language name and chevron. Preserve type=button, aria-haspopup=menu, aria-expanded=false and focus styles. The menu module is not requested. The mounted trigger must remain visually identical through loading, with no disabled state that strands keyboard focus.
2. **Loading:** actual click/Enter/Space/ArrowDown/ArrowUp creates a sequence and records the initiating trigger and opening intent. Announce the existing localized loading label and aria-busy. Suppress duplicate requests while keeping cancellation available. ArrowDown requests first enabled item, ArrowUp last; click/Enter/Space preserve the existing Menu opening behavior.
3. **Cancel:** Escape, focus moving to another control, an outside action, page navigation/pagehide, hidden/closed parent Drawer, newer activation, locale change or unmount invalidates the pending sequence. An import cannot itself be aborted, but late completion may only populate the reusable module; it must not open a menu, navigate, write a cookie or restore focus.
4. **Ready/open:** commit the loaded control with a stable trigger ID/ref. Only apply the pending open/focus if the sequence is still current and the user still owns the initiating focus. If replacing the trigger temporarily leaves body focused, allow transfer only when the old trigger was removed by this same commit and no intervening focus change occurred. Never use an unconditional delayed focus. Recheck ownership when effects/callbacks run, not only when import resolves.
5. **Close:** use existing Menu dismissal and focus semantics. Escape/selection closes normally. Outside focus movement and navigation must not be followed by forced focus restoration. Closing the outer mobile Drawer invalidates any language-menu opening request; no late portal may appear outside it.
6. **Failure:** expose a localized visible/status error and a real retry control; no unhandled rejection or silent failure. Retry starts a new sequence. If the browser/bundler cannot recover a failed chunk in the same document, retain a same-page reload link preserving locale and commerce query as an explicit recovery. Do not assume the previous directory chunk's recovery result guarantees this module's behavior.

## Verification required after authorization

Run only the two new tests first during a non-Lighthouse phase, retaining the actual failure output. No production edit precedes effective RED. Scope formatting/types and existing UI interaction tests follow implementation, not this plan.

Then add behavior tests against the actual facade/controlled callbacks: no load initially; first Enter/Space/ArrowDown/ArrowUp; deferred completion after Tab/outside focus/Escape/parent close/pagehide/unmount; rejection, retry and second rejection; simultaneous desktop/mobile triggers; no delayed focus after the user moves away; unchanged locale URL/cookie scope. No placeholder test that merely mirrors an unimplemented state machine is counted as evidence.

The final actual compiled Chrome regression must delay/fail the identified real menu chunk, preserve the existing menu/Drawer keyboard and reduced-motion gates, verify all seven SSR triggers at both widths, and inspect current focus before and after delayed completion. Stable selectors are `[data-storefront-language]`, its `data-language-state` values idle/loading/error/ready/open, and the existing `.fs-menu__trigger`; the deferred module exports HeaderLanguageMenu. Root will compare the compiled entry/chunk and same-condition resource/LCP evidence; no 150KB or LCP success is promised.

## Scoped implementation evidence

- Header now renders a lightweight trigger with the original content/CSS/SVG. Closed SSR follows the prior primitive's omitted aria-expanded; hydration sets false. Actual activation imports the deferred module; successful completion and the replacement-trigger commit each check sequence and current focus. Body is accepted only when that initiating button was removed and no earlier cancellation occurred. The mobile Drawer's existing close callback synchronously cancels its child request before setting closed state.
- Menu/LanguageControl retain default uncontrolled behavior and forward optional controlled open/onOpenChange/triggerRef. The optional first/last hint schedules one bounded popup focus attempt, canceled by another key/pointer action, close, detach or unmount, and only while focus still belongs to the trigger/popup. No synthetic keyboard event is sent.
- `site-header-lazy-loading.test.tsx` drives actual component closures and deferred import with controlled React hook/DOM observation. Twelve cases cover no initial load, click/arrow opening intent, seven cancellation paths, focus change between import and commit, visible first failure and second-failure full-page recovery preserving the actual URL. It is not a browser or React commit-timing substitute.
- Frontend new tests: 2 files / 20 PASS (`header-storefront-tests-green.log`). UI controlled plus existing interactions: 2 files / 10 PASS (`header-menu-controlled-first-green.log`). Scoped ESLint: exit 0 (`header-lint-green.log`). UI typecheck and storefront typecheck exited 0; UI's isolated TypeScript build exited 0 after an initial explicit ref-parameter type correction (`header-ui-build-green.log`). No Next output was touched.
- Initial SSR fixture-assumption failures and the first UI implicit-ref type error remain in their original logs. No original browser assertion, performance budget, locale/cookie rule, Drawer, font, token or business schema was changed by this work.

## Local version references

Read `apps/storefront/AGENTS.md` and the installed Next 16.3.4 `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`. It distinguishes a rendered dynamic component (loads immediately) from conditionally rendered/on-interaction imports, and notes that a Server Component dynamically importing a Client Component does not currently provide automatic client code splitting. This plan therefore keeps the boundary in the client interaction, with an independently SSR-rendered trigger.

Read installed Base UI 1.7.0 menu root/popup/trigger types and the current repository wrappers. No dependency, Drawer, global copy, token, business schema or production permission change is proposed.

## Cancellation review correction

Independent review identified a real focus loss: Escape cancelled the pending request, but its late import still replaced the focused native trigger. The effective new regression (`header-cancel-focus-red.log`, 1 FAIL / 12 PASS) observed focus falling to body. The implementation now only commits the loaded component for the still-current activation; a cancelled successful import remains cached by the module loader and the native button stays connected. A subsequent genuine activation can use that cached download. Tab/outside/parent-close/unmount cancellation still cannot reopen or reclaim focus.

Current scope is 2 Header files / 21 tests PASS (`header-cancel-focus-green.log`) and 2 UI files / 10 tests PASS (`header-menu-final-green.log`); scoped format/lint and full storefront types all exit 0 (`header-scope-final-*`). The UI build was refreshed only with standalone TypeScript, not Next. The initial incorrectly located command did not add the case; its passing pre-case output is explicitly retained as `header-cancel-focus-before-case.log`, not RED evidence.

The existing static interaction guard rejected the new optional controlled-open fallback (and a redundant provider-name string in this test). The test now leaves direct provider ownership to that existing dedicated guard; root delegated a precise guard adaptation to the independent reviewer. `header-controlled-gate-red.log` preserves the failure. No guard is weakened by the Header implementation.

Real Chrome must still verify initial ArrowUp/ArrowDown popup focus. Root identified that the inline Popup ref could be cancelled by a rerender before its queued frame; this is a hypothesis pending actual compiled cold-menu verification. No assertion, sampling budget, or implementation change has been made solely from that hypothesis.

The same cancellation review covered the interval after import resolution but before React commit. `header-cancel-commit-red.log` records a second effective 1 FAIL / 13 PASS result. Cancelling an existing pending activation now also clears its queued component state; already-open menus have no pending activation and keep their mounted control. This retains the focused native button even in that interval. Final Header tests are 2 files / 22 PASS (`header-cancel-commit-green.log`), with scoped format/lint and full storefront types exit 0.

## Compiled browser outcome

The root-provided generation 3 completed the dedicated actual Chrome regression: 11 cases / 67 assertions / 11 PNG PASS. Cold ArrowUp and ArrowDown reached the last and first canonical options, including the mobile first-arrow case. The inline Popup ref hypothesis did not reproduce, so no speculative refactor was added. Exact source, chunk, timing, cancellation/failure evidence and post-run provenance-only harness changes are recorded in `header-browser-README.md`. This does not claim Lighthouse or total-bundle acceptance; root is measuring that separately.

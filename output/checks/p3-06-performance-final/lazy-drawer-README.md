# Storefront Drawer deferred loading

Scope: the three existing storefront consumers now share one local LazyDrawer facade. The shared Drawer keeps its original modal portal, focus trap, scroll lock, dismissal, side, content and animation behavior. No new dependency, dictionary, font, token, business schema, budget or checker modification.

Read-only production-generation-3 evidence showed all three client references include `1evwncke1zjvt.js` (70,655 raw bytes / 23,795 transferred bytes). AST module tracing across the actual English gift's nine initial scripts found that this chunk's 30 Base UI/floating/focus modules have exactly one external importing module: `71578` in `2sfcuzf9iedj9.js`, exporting Dialog/Drawer and their components. That module is 11,587 raw bytes. Removing only its text from the mixed chunk changes local gzip size by about 3,778 bytes; this is a rough decomposition, not a build or promise of savings. All three eager consumers must be removed for the common dependency to become deferrable. Actual new chunk/request/total-byte evidence is pending the next compiled browser.

The original native trigger's class, content, button semantics and closed SSR ARIA are retained. Unlike Menu, the original Drawer does include aria-expanded=false in SSR; a real comparison caught and corrected that difference. Loading starts only on activation, preserves a focusable native trigger, and has visible existing localized failure/retry controls. Cancellation invalidates the sequence and queued replacement, including the interval after import resolution and before commit. Externally closing before first commit keeps the same native button. After successful first commit, the original primitive stays mounted for subsequent controlled open/close cycles.

The UI extension is limited to optional triggerRef and initialFocus='popup'. Trigger ref plus matching controlled Root/Trigger ID is needed to associate the replacement with the original user focus; the former wrapper dropped both. Touch uses the popup to preserve the installed primitive's no-soft-keyboard default. Installed Base UI `utils/popups/popupStoreUtils.js:45` explicitly implements interactionType==='touch' ? popupRef.current : true; pen/keyboard/mouse continue using its original default. No synthetic keyboard event is dispatched.

Effective RED evidence:

- `lazy-drawer-boundary-red.log`: three real eager runtime imports fail.
- `lazy-drawer-overlay-red.log`: two required prop bindings missing, one legacy-default case passes.
- `lazy-drawer-loading-valid-red.log`: external close after resolved import loses focus, and two rejected downloads never expose fallback because the counter was reset; 2 FAIL / 11 PASS. Initial `lazy-drawer-loading-red.log` also had two test-harness duplicate-import-count failures, corrected by awaiting the existing controlled module-completion signal without adding another import. Those are fixture mistakes, not product regressions. `lazy-drawer-loading-before-fixture-correction.log` retains the repeat before the fix.
- `lazy-drawer-ssr.log`: one actual SSR aria-expanded mismatch, three boundary cases pass.

Current scoped validation:

- `lazy-drawer-scope-tests.log`: seven storefront files / 62 tests PASS, including existing Header, gift filter cancellation/presentation and purchase checks.
- `lazy-drawer-overlay-green.log`: two UI files / 10 tests PASS.
- UI typecheck and standalone UI TypeScript build exit 0; full storefront typecheck exit 0 after refreshing only the isolated UI dist. The initial stale-dist missing-prop failure is preserved in `lazy-drawer-storefront-types.log`.
- Scoped formatter and ESLint exit 0. Independent read-only review accepted the cancellation/controlled/legacy-default boundaries. Exact six owned product hashes are in `lazy-drawer-source-freeze.json`.

The closure tests use controlled hook/DOM observation and real deferred import behavior. They do not substitute for browser commit timing, touch, focus trapping, real download retry or performance. Root owns the next Next build; the separate browser harness will verify real compiled cold click/touch/keyboard, repeated cycles, cancellation, consecutive failures and all three surfaces before any acceptance claim.

## Actual compiled outcome

The final generation-5 product completed Drawer 23/153 and Header 11/67 actual Chrome assertions, with all 34 final screenshots retained. `drawer-browser-README.md` gives exact source/chunk hashes and explicitly preserves the first 21/23 report, where the new immediate reverse-Tab check sampled the original Base UI inside focus guard before its next animation frame. The corrected harness uses the existing P2 bounded 500ms wait and still requires actual modal containment. No product change or LCP success claim was made.

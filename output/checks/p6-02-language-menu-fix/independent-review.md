# P6-02 language-menu feedback — independent review

Reviewer: `/root/scrolled_menu_audit`, non-author of the reviewed product and harness changes. Baseline `1ec464c2`, branch `codex/fix-scrolled-language-menu`. Date: 2026-09-24 Asia/Bangkok.

## Current disposition

**Final local implementation and targeted browser acceptance: ACCEPT.** The final body-only CSS repair, revised structural gate, existing shared Drawer navigation change, and fourteen-cell browser matrix have been independently reviewed. Final 92-test gate was rerun independently and passed. Whole-workspace checks and the broader shared P2-03 browser gate remain root's separate delivery gates; this report does not claim they are already complete. Earlier rejected approaches and their FAIL evidence are preserved below as history.

## Initial root-only repair review — superseded

The repair removes only the `body` member from the menu scroll-lock selector. Root remains locked while the menu is open. The existing reference-counted `useMenuScrollLock`, outside-touch cancellation, listener cleanup, Base UI modal semantics, lazy loading, and focus restoration are unchanged. A newly created scrolling ancestor on `body` was the most direct source-based hypothesis; root's browser evidence independently records the sticky header moving from top 0 to -1100 while `window.scrollY` stays 1100, with the menu outside the viewport. The single-variable live CSS experiment restores the header position without changing the scroll offset. Its existing open menu position remains stale until reopening, so that experiment alone is not a complete pass; the clean post-fix browser run supplies the separate reopen evidence.

Completely deleting the custom lock would change established touch behavior: the installed Base UI 1.7 `useAnchoredPopupScrollLock` intentionally permits touch-opened page scrolling except for nearly full-width popups. Keeping the current root lock is a smaller fix that preserves the existing product contract. Nested Drawers retain their own Base UI lock; the menu removes only its own attribute on close and does not rewrite parent inline styles.

`check-ui-interactions.mjs` now requires root locking and rejects the original explicit body lock. The added negative test reintroduces the original selector and checks that it is rejected. This checker recognizes the project's precise selector/declaration conventions; it is not a general CSS cascade proof. Actual sticky-anchor browser measurements remain necessary.

## Order-lookup placement

The author report records the user's choice to move lookup into the menu. The home hero already has no order-lookup action, so no published home content is changed. `SiteHeader` now excludes lookup from its desktop top-link list and includes it once in the existing Drawer. That same Drawer trigger is visible on desktop and mobile. The existing compatibility class remains for earlier acceptance selectors; CSS uses the new descriptive class.

There is one Drawer instance, one shared navigation renderer, and the existing localized `copy.navOrders` and `storefrontHref` helper. The drawer-language cancellation ref is renamed to describe its expanded use; its behavior is unchanged. Route locale, market and currency remain passed through existing navigation construction. No new dependency, API, data mutation, order authorization, or checkout behavior was introduced.

## Independent verification performed

- Ran `mise exec node@24.20.0 -- node --test ./scripts/check-ui-interactions.test.mjs`: exit 0, **92 passed / 0 failed**. Raw output: `independent-tools.txt`.
- Read the author's actual `banner-regression.txt`: **7 files / 91 tests passed**, including the new seven-locale navigation test, lazy-menu and lazy-drawer checks, cart-header restoration, and page factory. These are author-run results, not reviewer reruns.
- Read author typecheck, formatting/lint results and the precise affected source diff. The seven-locale SSR test exposes the real header's passed Drawer content through a narrow mock; it correctly makes no browser visibility or focus claim.
- Ran `git diff --check` on the five modified tracked source files: exit 0.
- Read root's actual reproduction, single-variable experiment, initial GREEN partial run, and matrix-1 JSON/logs. Did not start a browser, service, or build, modify product code, or inspect private configuration contents.

## Browser harness assessment

`verify-storefront-header-browser.mjs` reads a schema-validated local config, checks workspace ownership, connects to local HTTPS using the existing public certificate pin, and creates isolated fresh browser contexts. It only visits public home pages, opens menus, and changes that disposable context's presentation-locale cookie. It does not submit content, create carts/orders, reset an instance, alter service state, or copy the private config into evidence.

The regression scrolls the actual homepage before its first lazy menu activation, asserts viewport containment and a stable scroll offset, checks Escape focus restoration, confirms scrolling resumes, checks lookup inside the actual Drawer, then reopens the language menu and activates a visible target using coordinates. `toBeInViewport` and `boundingBox` are read-only checks; the selected locale click cannot silently scroll an offscreen popup into view. This directly addresses the previous false-negative risk from locator auto-scrolling. Keyboard `focus()` occurs only after the first measured scroll-stability check and remains separate from the coordinate language selection.

The new browser navigation assertion preserves `?page=1`. It does **not** independently establish complete market/currency/hash/cart/attempt preservation; the unchanged locale helper and the existing tests cover the broader contract. Likewise, this script does not currently claim outside-press dismissal, real physical iOS behavior, manual screen-reader testing, or production/cloud verification. Its mobile contexts exercise touch and reduced motion; desktop exercises normal motion.

At review time, matrix-1 has eight PASS cells and a retained FAIL on Japanese desktop's second menu opening: measured ratio approximately 0.985876 rather than 1. First opening, Escape restoration, and lookup Drawer checks passed for that cell. The ratio must not be weakened to make the report green; inspect the geometry/transition/scroll release evidence and rerun the whole matrix after resolving the cause.

## Follow-up: confirmed lock-order race

Root's retained `reopen-timeline.json` supplies the decisive runtime evidence. Frame 0 shows `scrollY=1300`, root overflow visible, body **inline** overflow hidden, header top 0, and no Drawer. Frame 1 shows root hidden as well, header top -1300, and menu approximately -1214. Frame 2 then shows programmatic scrolling to 95, header top -95, and menu approximately -9; the menu later settles at top -5. This independently corroborates the matrix-1 failure and rules out treating it as harmless viewport rounding.

The installed Base UI `useScrollLock` schedules actual locking with a zero-delay timer from its layout effect. The project currently establishes its root lock in a passive `useEffect`. If Base UI's timer runs first, it locks body; the later author effect locks root too, recreating the bad scroll chain even after the body CSS selector is removed. The unfenced menu-item `.focus()` can then scroll the page to bring the displaced menu into view. This is a source-based explanation supported by the recorded order of actual DOM states; this reviewer did not run the browser itself.

An initial follow-up suggestion was to establish the author lock in `useLayoutEffect`. Further independent source review rejects that as a sufficient repair: a previous Drawer can release the shared Base UI lock, schedule `timeoutUnlock(0)`, and have a new menu acquire it before the timer runs. Because `lockCount` is then nonzero, `unlock()` deliberately retains the already-existing body lock. A newly established author root lock would still conflict. The timeline does not distinguish that carry-over from a new lock acquisition, and no claim is made about which timer produced its first frame.

The smaller sufficient direction for this repository is to retain the original **body-only** selector and remove the original root selector. The root attribute continues to identify/count the menu lock, but only body receives overflow styles, matching Base UI's current viewport-scroller choice. This reviewer checked RootLayout, storefront global CSS, all directly imported UI/foundation styles, and Tailwind 4.3.3's preflight: none establishes an independent overflow container on html. No production storefront/UI source writes a different html overflow style. Admin does not import this interaction stylesheet. No global scroll-container strategy or JavaScript focus policy needs to change.

Root's `body-only-experiment.json` contains 20 consecutive actual opens at `scrollY=1300`, each with root visible, body hidden, header top 0, and menu top approximately 85.84. The first retains Base UI's inline body lock and the remaining 19 have only the author CSS lock. This supplies runtime evidence for the selected single-container direction. The final structural checker should require body locking and reject a second root lock. Full seven-locale/desktop/mobile acceptance remains required after that final source delta.

## Initial reviewed source SHA-256 — superseded

```text
5953acfe297c40242762874ce73cbce6d9430ba12f3c7bb670faadebd3354c05  packages/ui/styles/interactions.css
8149a010c963a2ab00de660bd18dc9db874fca0e6fb543a3c3ba84ae836f987b  scripts/check-ui-interactions.mjs
0c40553fe3ee33a5c420b705d9c0df72294d9d3573034a585aabbc7cbb1eee40  scripts/check-ui-interactions.test.mjs
c7c6b0f7fc5749f5b0c6ae6d4eb5d4c333cf7e00dad36197164ce1af35b903af  scripts/verify-storefront-header-browser.mjs
582ae0a33c6bf920f3e567898f8e90e830ee68533373bb84e3ed4c83e2053354  apps/storefront/src/storefront/site-header.tsx
0a81598bcbc036506de30f4fac2e8971a443d5dac8ee07f26b139fb1ea42aed5  apps/storefront/src/storefront/storefront.css
cfaa1b75d9ec5433287ae266a565f09c182f2d6c203e0b602d76e06cbb95c80f  apps/storefront/src/storefront/site-header-navigation.test.tsx
```

## Final independent acceptance

The final diff from baseline now deletes only the original root selector and keeps `:root[data-fs-menu-scroll-lock] body`, plus an explanatory comment. There is no JavaScript menu, focus, lifecycle, cookie, or navigation-helper change. The marker stays on html for existing reference counting; only body receives the menu overflow lock. The checker requires that body lock and rejects the original second root lock, and its new negative test reintroduces the original dual selector. This matches the established viewport-scroller configuration and the 20-cycle body-only experiment reviewed above.

Independent verification was repeated **after** the final body-only change: `mise exec node@24.20.0 -- node --test ./scripts/check-ui-interactions.test.mjs` exited 0 with **92 passed / 0 failed**. The final log is `independent-tools-final.txt`; the earlier `independent-tools.txt` belongs to the rejected root-only intermediate version and is not substituted for this result. Final tracked source `git diff --check` also exited 0.

The final `matrix-final/report.json` is PASS with all **14 unique expected cells**: seven canonical locales, each at desktop 1440×900 and touch mobile 390×844. I programmatically checked there are neither missing nor duplicate cells, that every case is PASS with `escapeRestoresFocusAndScroll`, `lookupInDrawer`, and `queryPreserved` true, and that each actual target locale is the next canonical locale. All 14 menu rectangles are fully inside their corresponding viewport, all 14 screenshots exist, and `pageErrors` is empty. Browser version is Chrome 153.0.8010.53. The actual screenshot samples for Japanese desktop and Portuguese mobile were visually inspected: the desktop sticky header and full menu are visible, while the mobile menu remains within the existing Drawer. The retained original bug and the root-only matrix failure were not overwritten or relabeled.

The final harness preserves ratio **1** and the coordinate activation requirement. New diagnostics record only scroll offset, root/body inline styles and overflow, header/menu rectangles, and Drawer closing state. Optional single-locale diagnosis validates its input against the canonical locale list; the accepted final report contains all seven locales, not a diagnostic subset. Only local schema-validated config is read and its workspace origin is checked; no private config is copied into evidence or browser output. Public navigation changes a fresh disposable context's presentation cookie; it does not submit orders or content, change database state, or reset services.

The accepted new browser proof preserves exactly `?page=1`; broader market/currency navigation preservation is established by the unchanged helper and the separate seven-locale navigation test within the author's 91-test run. This distinction remains explicit. Evidence and final source hashes are additionally recorded in `independent-final-evidence.json`.

No remaining blocker was found in the reviewed final local implementation. Physical-device Safari, manual screen-reader use, real payments, and production/cloud validation are outside this feedback fix and are not claimed.

### Final source SHA-256

```text
e7cc8ffddf80503480a83b09192266dfe990b93885f88e1c28850f8d40813c5e  packages/ui/styles/interactions.css
d5f6a82047193721e9bf8bda2649259abd3928547c5056527503473d464cde45  scripts/check-ui-interactions.mjs
73b665ac5cc062848458ba31ad337ccbd53213d13f433daaa33abb176ca7e8d2  scripts/check-ui-interactions.test.mjs
cd335c4b0c90eba4d49f901fc2a08ae231a863e141d50c2bfe9ae5d198ce26a3  scripts/verify-storefront-header-browser.mjs
582ae0a33c6bf920f3e567898f8e90e830ee68533373bb84e3ed4c83e2053354  apps/storefront/src/storefront/site-header.tsx
0a81598bcbc036506de30f4fac2e8971a443d5dac8ee07f26b139fb1ea42aed5  apps/storefront/src/storefront/storefront.css
cfaa1b75d9ec5433287ae266a565f09c182f2d6c203e0b602d76e06cbb95c80f  apps/storefront/src/storefront/site-header-navigation.test.tsx
```

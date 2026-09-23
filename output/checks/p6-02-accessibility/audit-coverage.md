# P6-02 browser coverage audit

Read-only audit of baseline `40854787`, 2026-09-24. No browser run, source edit, user-instance mutation, or completion claim was made by this audit.

## Existing evidence that can be reused as implementation patterns

| Concern | Existing entry | Actual scope / limitation |
| --- | --- | --- |
| Real seven-locale purchase | `apps/api/scripts/regression-journey.mjs`, `regression-journey-browser.mjs`, `regression-journey-state.mjs` | 7 locales × 390/1440, real published media/PG, independent TEST PSP, signed confirmation and protected order/mail. Most actions are `click` / `fill`; this is not an all-keyboard proof. Journey screenshots mask private fields. |
| Isolated lifecycle | `scripts/verify-regression-journey.mjs`, `scripts/regression-journey-lifecycle.mjs` | New owned TEST instance, production web build, stop/reset only after full success, preserve failure data. Reuse lifecycle patterns; do not point an a11y destructive fixture run at the user's existing acceptance instance. |
| Real native browser zoom | exported `createNativeZoomProfilePreferences`, `createNativeZoomLaunchOptions`, `assessNativeZoomMeasurements` in `scripts/verify-ui-primitives-browser.mjs` | Chrome HostZoomMap temporary profile with `viewport: null`, headed browser. Baseline/200% check stable outer window, halved inner dimensions, doubled DPR, visual viewport scale 1. Existing runner is bound to Portuguese component fixtures, not production core pages. |
| Page axe / overflow | `apps/api/scripts/storefront-browser.mjs`, `gift-storefront-browser.mjs`, `cart-storefront-browser.mjs`, `payment-runtime-browser.mjs`, `order-storefront-browser.mjs` | Existing production surface checks mostly 390/1440. Storefront 320/720 checks only PT home, TH directory, JA artist; gift 320/640 detail is EN. Narrow viewport labelled equivalent zoom is not native browser zoom. |
| Modal keyboard | `gift-storefront-browser.mjs:451`, `cart-storefront-browser.mjs:541`, `storefront-browser.mjs:668` | Filter/cart modal tab containment, Escape and trigger restoration already have working patterns. Some start from `.focus()`; this verifies subsequent interaction, not reachability from route start. |
| Admin | `admin-access-browser.mjs`, `admin-orders-browser.mjs`, `management-center-browser.mjs` and finance/config/exceptions verifiers | Existing seven-locale dual-viewport scans and targeted keyboard/error checks. Need actual 320 and native 200% production checks. Login/management upload flows are reusable, but capturing populated private review panels must remain prohibited. |
| Privacy-safe capture | `local-experience-browser.mjs:353` and `regression-journey.mjs:118` | First rejects populated sensitive inputs/panels, second masks them. Store only stable selectors, rule IDs, counts and numeric geometry. Do not store full DOM, request payloads, cookies, signed URLs, config or email/token text. |

## Smallest maintainable implementation shape

1. Add a focused P6-02 runner beside existing API browser scripts, with a small testable matrix/evidence contract. Use a dedicated TEST instance and the existing real admin content setup or explicit `contentFacts`; assert its `instanceId` before use. The lifecycle wrapper should reuse existing start/stop/cleanup semantics without changing P6-01's fixed 14-case contract.
2. Put shared `inspectPage`, sequential-keyboard reach/activate and dialog-containment helpers in one small browser utility module. `inspectPage` should return safe axe summaries (including incomplete), document/body overflow, visible text/control clipping candidates, computed reduced-motion state and a privacy-safe screenshot. Use DOM geometry as a candidate signal: an intentional artist scroller or table is not itself page overflow.
3. Reuse the exported native-zoom preference constructor and measurement validator. The component-only screenshot-marker probe should not be copied into business pages; use route `html.lang`, expected landmark/entity and physical screenshot dimensions. Keep default Chrome scale and no `deviceScaleFactor`, `setViewportSize`, CSS `zoom`, `Emulation.setPageScaleFactor`, or device metrics during native passes. Close/reopen the same isolated profile between baseline and 200% preferences. Include the TLS pin/host mapping used by the local journey. Clean the temporary browser profile.
4. Do not enlarge every existing full finance/payment regression just to obtain 320px coverage. A production accessibility runner can reuse safely seeded/readable state and inspect relevant rendered screens while targeted existing suites cover business invariants after actual source changes.

## Recommended explicit matrix

Run all seven locales on actual production pages at 390×844 and 1440×900, and also 320 CSS px plus genuine native 200%. Record normal and reduced-motion coverage as dimensions, not a single global claim.

| Core surface | Necessary additional interaction evidence |
| --- | --- |
| Home with inline gifts | Fresh no-query/no-cookie visit displays published gift cards immediately below artists. No browse or region action precedes visibility. Tab reaches gift links; images, readable titles, amount/context presentation and no blocking market prompt. Artist search remains usable. |
| Gift section / directory | Category/sort/page controls usable by keyboard; query remains consistent; mobile filter containment, Escape/restore; long category/price labels visible; empty/error/retry rendered and announced. |
| Gift detail | Recipient selection, quantity and customization reachable and labelled; required validation associated with fields; a valid keyboard add yields live confirmation and correct cart. No private text in saved diagnostics. |
| Cart / drawer | Open from keyboard, contain both Tab directions, close/restore, edit validation, update/remove and empty recovery; focus after removal stays meaningful. |
| Checkout / hosted handoff / return | Policies, email validation and chosen payment reachable; keyboard submit/continue; invalid fields named and announced; runtime/error/recovery and protected order readable at narrow/zoom. TEST PSP boundaries labelled explicitly. |
| Order lookup / order detail | Keyboard lookup request and safe access, meaningful success/error/status timeline; no possession token persisted in page URL evidence. |
| Admin login / management / orders | Keyboard login; upload/name/description/price/category and publish status; errors/focus restoration; order filtering/detail/prepare/send. Privacy panel closed or safely masked before captures. Other existing finance/config/exceptions pages at least reflow/axe/keyboard reachability. |

For full keyboard-path claims, use Tab/Shift+Tab from page entry and Enter/Space activation. `.focus()`, `.fill()`, `.selectOption()` and `.click()` may prepare fixture state but must not be counted as proof of keyboard reachability or native key behavior. Each focus sample should demonstrate a visible ring and a target not entirely obscured by sticky headers, drawers or the viewport.

Text-spacing and nested clipping checks can expose loss that document `scrollWidth` misses. Inspect long ES/PT, Thai break behavior, CJK and Vietnamese diacritics at the same matrix cells. Preserve screenshots for actual visual review; automated dimensions do not prove semantic translation quality.

## User's new homepage requirement: regression traps

- Baseline `HomeContent` renders only explicitly assigned `FEATURED_GIFT` publication slots. A newly published gift with no homepage slot leaves the home section empty even though `/gifts` can sell it.
- Baseline `GiftDirectorySection` responds to missing market/currency with `MarketChoices`, so simply embedding it unchanged into the home page would recreate the exact friction the user rejected.
- Existing journey starts with `facts.commerceContext` in the homepage URL. Keep that economic-context regression, but add a separate fresh homepage with **no query and no existing cookie** so the new requirement cannot pass only because the test preselected the market.
- Include at least two configured contexts in resolver/contract tests: no guessed hardcoded country/currency, explicit or retained valid selection takes precedence, locale switch does not change economics, invalid/empty context has an intelligible recoverable state, and service error is not silently disguised as empty catalog.
- A previously published gift should appear under artists without editing the poster/homepage slots. Pagination/filter should work there when the catalog grows, consistent with prior user requirements.

## Completion boundaries

Automated axe, synthetic keyboard, computed reduced motion, Chrome zoom and visual review may support local P6-02 acceptance. They do not prove human VoiceOver/NVDA task completion, native phone assistive technology, actual translator sign-off, or real merchant PSP accessibility. Keep these explicit remaining gates; never mark all WCAG 2.2 AA complete solely because axe has zero critical/serious findings.

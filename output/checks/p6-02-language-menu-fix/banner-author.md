# Header order-lookup placement — author verification

Date: 2026-09-24 Asia/Bangkok. Task: P6-02 user-feedback repair, coordinated by root on `codex/fix-scrolled-language-menu`, baseline `1ec464c2`.

## Scope and user choice

Read-only inspection found that `HomeContent`'s hero already contains only its published artist CTA and artist caption; the visible order lookup is in the shared header. Root obtained the user's explicit choice: put order lookup inside the menu, without occupying the top navigation. No homepage content or published user data was changed.

The desktop top navigation now contains Home / Artists / Gifts. The existing single navigation Drawer contains those links plus order lookup, uses the existing localized `copy.navOrders`, and preserves `locale`, `market`, and `currency` through `storefrontHref`. Its existing trigger is visible on desktop as well as mobile. There is no second drawer or new footer link. Language controls retain the existing lazy-loading/cancel behavior; local variable names now describe the shared drawer.

The semantic wrapper class is `storefront-navigation-menu`; `storefront-mobile-menu` remains a compatibility class because six existing browser acceptance locators use it. CSS uses the new class and no longer hides the trigger on desktop. Tokens, breakpoints, header layout rules, and drawer implementation are unchanged.

Owned source files:

- `apps/storefront/src/storefront/site-header.tsx`
- `apps/storefront/src/storefront/storefront.css`
- `apps/storefront/src/storefront/site-header-navigation.test.tsx`

No build, service restart, database operation, Git staging, or Git commit was performed by this subtask. Root owns the scroll-language fix, combined verification, and final commit.

## Verification

All commands run from repository root with `mise exec node@24.20.0 -- corepack pnpm`.

1. New navigation behavior test before implementation: `--filter @fan-support/storefront test src/storefront/site-header-navigation.test.tsx`; exit **1**, seven locale tests fail precisely because `/orders/lookup` is present in the desktop top navigation. Raw: `banner-red.txt`.
2. First targeted test after implementation: navigation, lazy header, and drawer-boundary files; exit **0**, **4 files / 33 tests**. One supplied `lazy-drawer.test.tsx` filter has no corresponding file; it is not counted as executed. Raw exact command and result: `banner-green.txt`.
3. Complete affected regression: `--filter @fan-support/storefront test src/storefront/site-header-navigation.test.tsx src/storefront/site-header-lazy-boundary.test.tsx src/storefront/site-header-lazy-loading.test.tsx src/storefront/lazy-drawer-loading.test.tsx src/storefront/lazy-drawer-boundary.test.tsx src/storefront/cart-header-restoration.test.tsx src/storefront/page-factory.test.tsx`; exit **0**, **7 files / 91 tests**. Raw: `banner-regression.txt`.
4. `--filter @fan-support/storefront typecheck`; exit **0**. Raw: `banner-typecheck.txt`.
5. `exec prettier --check apps/storefront/src/storefront/site-header.tsx apps/storefront/src/storefront/storefront.css apps/storefront/src/storefront/site-header-navigation.test.tsx`; exit **0**. Raw: `banner-format.txt`.
6. `exec eslint apps/storefront/src/storefront/site-header.tsx apps/storefront/src/storefront/site-header-navigation.test.tsx --max-warnings=0`; exit **0**. Raw: `banner-lint.txt`.
7. `git diff --check -- apps/storefront/src/storefront/site-header.tsx apps/storefront/src/storefront/storefront.css apps/storefront/src/storefront/site-header-navigation.test.tsx`; exit **0**.

The new seven-locale test renders the real `SiteHeader` and only exposes the lazy drawer children through a test adapter, verifying the navigation passed into it. It does not claim browser visibility, focus trapping, responsive layout, or CSS correctness. Root must verify those on real desktop/mobile browsers, including language controls and the new desktop menu trigger, before accepting the combined change.

## S.U.P.E.R local review

1. Single-purpose header rendering / navigation regression; no new product module.
2. Navigation rendering remains one conceptual responsibility.
3. Props flow into rendering; no reverse business dependency.
4. No imports/dependencies added to production code; no cycles.
5. Existing typed component props and existing locale contract unchanged.
6. Existing serializable locale/context fields unchanged; no new cross-module I/O.
7. Existing route helper and message copy reused; no production hostname/market/currency/identity hardcoded.
8. No new dependency.
9. Existing Drawer primitive remains replaceable at its original boundary.
10. Affected 91 tests, typecheck, format/lint PASS. Full build and actual browser acceptance are delegated to root and not claimed here.

## Source hashes after author checks

```text
582ae0a33c6bf920f3e567898f8e90e830ee68533373bb84e3ed4c83e2053354  apps/storefront/src/storefront/site-header.tsx
0a81598bcbc036506de30f4fac2e8971a443d5dac8ee07f26b139fb1ea42aed5  apps/storefront/src/storefront/storefront.css
cfaa1b75d9ec5433287ae266a565f09c182f2d6c203e0b602d76e06cbb95c80f  apps/storefront/src/storefront/site-header-navigation.test.tsx
```

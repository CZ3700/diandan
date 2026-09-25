# P3-04 exact public font route validation

Bounded owner: `/root/storefront_directory`. Source scope: `scripts/check-design-foundations.mjs` and its existing test file only.

The checker now validates two exact route roots: the existing `%5Finternal/design-foundations` root and the new `(public)` root. Each canonical profile must provide its exact group `layout.tsx`, importing only that profile's exported font stylesheet. This does not permit font imports in arbitrary public components, pages, nested layouts, unknown profiles or the public root layout.

All seven public homepage files are required under their canonical profile/locale path. An AST check binds their default page and exported metadata to the actual storefront page-factory module and to the unchanged locale plus `home` kind. Incorrect locale/kind, nested decoy calls, wrong public profile placement, missing pages and a publicly exposed `en-XA` homepage are rejected. The existing internal `en-XA` specimen remains required and accepted.

Existing font-license, remote-font, token, CSS dimensions/color/motion and exhaustive canonical-locale checks remain active.

## Verification

Commands use `mise exec node@24.20.0 --`.

- `node --test scripts/check-design-foundations.test.mjs`: `design-font-route-red.log`, exit 1 before implementation. Valid public layouts were rejected and missing/wrong public homepage bindings were not caught.
- Same command after implementation: `design-font-route-green.log`, exit 0, 28 tests.
- `corepack pnpm check:design-foundations`: `design-font-route-check.log`, exit 0, all 31 tests including font-loading policy plus the real repository validation passed.
- Scoped Prettier and ESLint passed (`design-font-route-lint.log`).

This is a static source/configuration check. Actual downloaded fonts, rendered glyphs and browser performance remain covered by the combined frontend browser evidence.

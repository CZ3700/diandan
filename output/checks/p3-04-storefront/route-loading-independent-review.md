# Independent review — scoped loading and non-streamed detail 404

Reviewer: storefront_directory. Decision: **ACCEPT for source structure and retained copy approval boundary**. Final seven-locale HTTP status evidence belongs to the E2E rerun; this review does not substitute a component test for actual HTTP semantics.

- `createStorefrontPage` wraps only `home` and `artists` in the local Suspense boundary. The `artist` branch returns the async page directly, validates its handle, awaits the public read, and throws `notFound()` before returning its body when the catalog reports NOT_FOUND.
- The seven locale-level `loading.tsx` files are absent. No remaining app-level loading file or Suspense wrapper in the root/public font layouts surrounds artist detail. The root layout awaits locale headers and the public font layouts return their children.
- All seven locale `not-found.tsx` entries remain and bind the matching supported locale. `createStorefrontNotFound` and `createStorefrontLoading` still import the server copy wrapper, which obtains the validated deployment environment and passes `requireApproved: true` only for production. The page body and metadata also retain this wrapper. Removing broad loading did not bypass the English-source/requested-locale approval gate.
- The loading fallback is a sibling alternative to the whole page tree, not a nested second main inside an already-rendered main.
- The installed Next documentation at `apps/storefront/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md` explicitly distinguishes streamed 200 from non-streamed 404. Its sibling `loading.md` describes loading-file Suspense behavior. The correction follows that documented boundary rather than attempting to change status after a response body is committed.

Fresh independent command:

`mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/storefront test src/server/storefront-copy.test.ts src/storefront/pages.test.tsx`

Result: 2 files, 2 tests passed. Log: `route-loading-independent-unit.log`. These tests verify the copy-tier wiring and affected page projection, not the HTTP status itself.

No source modifications were made during this review. The separate mobile visual acceptance is recorded in `mobile-composition-independent-review.md`.

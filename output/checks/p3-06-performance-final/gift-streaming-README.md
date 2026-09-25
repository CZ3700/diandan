# Gift detail streaming — bounded implementation evidence

Scope: `/Users/mario/Desktop/下单/.turbo/p3-06-performance-worktree`, base commit `fd19144d9b19c6fe7752b635dbc99cef117660b3`. This is root's delegated P3-06 performance slice; it does not mark the phase complete. No backend, PostgreSQL, business contract, shared configuration, main-worktree source, preview service, or Next build was changed by this slice.

The final seven owned file hashes are in `gift-streaming-source-final.json`; aggregate SHA-256 of that file's ordered `files` array is `7acd704d7f9b6252ad6347bc555d33ce8776fa85e1ac04713075276a4e29143e`. The earlier `gift-streaming-source.json` snapshot (`69ed21e9…`) is retained as pre-review history. These are module snapshots, not whole-repository or compiled-browser provenance.

## Behavior and preserved boundaries

- Gift and scoped-commerce reads begin independently and remain awaited before returning any gift shell. Invalid handles and either canonical/scoped `NOT_FOUND` retain the pre-shell `notFound()` path. Unknown/invalid scope never invents an offer.
- The artists read starts alongside those proofs but remains a server-local promise. A delayed directory no longer holds the gift image, title, content or validated offer. Its completed DTO reaches the existing client picker only after server resolution.
- Current scoped recipient and offer remain authoritative. A later directory response cannot replace a paused/unavailable recipient or re-enable quantity. Without a market, the chosen artist's display waits for the directory, while gift content can already stream; no price is invented.
- Only the gift page defers commerce context. Market choices and policy links resolve the same promise in small server Suspense regions. Gift listing, region and policy page bodies keep their previous context dependency; metadata functions and SEO components are unchanged.
- Unexpected noncritical read rejections become the existing `CATALOG_UNAVAILABLE` / `COMMERCE_UNAVAILABLE` public failure shapes. They cannot leak exception text or turn into successful empty directories. Critical read exceptions still prevent the gift shell. There is no request retry or longer timeout.
- Locale, source-language provenance and market/currency/idol/variant/cart query behavior use the existing DTOs and URL helpers. No translation, price, inventory amount, eligibility or market list is synthesized.

## Test-first record

After root confirmed its original compiled baseline and the six baseline Lighthouse runs had finished, the unchanged product failed the new controlled tests in `gift-streaming-red.log`: **16 failed / 12 passed**. Fourteen seven-locale SSR cases received no gift HTML while artists/context were deliberately unresolved; two missing-gift cases still waited for a noncritical promise before throwing `NEXT_NOT_FOUND`. Positive critical-proof gating already passed. These are React server streaming tests with actual gift presentation and schema-parsed synthetic DTOs, not a browser timing claim or a replacement for real API proof validation.

The first production split passed all 28 tests (`gift-streaming-green-first.log`). Further regression cases cover unexpected noncritical rejection, paused scoped-recipient authority over a later active directory, unavailable market, and actual Chinese single-source content on English/Chinese presentation routes. The final scheduling file contains **34 tests**.

Final affected test command, exit 0, **7 files / 101 tests** (`gift-streaming-verified.log`):

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/storefront test src/storefront/gift-page-scheduling.test.tsx src/storefront/gift-purchase.test.tsx src/storefront/gift-selection.test.ts src/storefront/commerce-context.test.tsx src/storefront/gift-seo.test.tsx src/storefront/page-factory.test.tsx src/storefront/browse-seo.test.ts
```

Scoped ESLint, Prettier check and `git diff --check` passed. Logs: `gift-streaming-lint-verified.log`, `gift-streaming-format-verified.log`. Formatting touched only the seven owned files.

Type-check history is retained precisely: `gift-streaming-types.log` found one test-only union-return `.catch` error; wrapping it in `Promise.resolve` produced the complete storefront PASS in `gift-streaming-types-final.log`. A subsequent run, `gift-streaming-types-verified.log`, exited 2 only in concurrently added `site-header-language.tsx:114`: the shared UI compiled declaration had not yet received the new controlled-menu props. The gift slice reported no error in that diagnostic. After shared UI integration and the review correction below, the complete storefront type check passed in `gift-streaming-context-rejection-types.log`.

## Layout, review and limits

Read the installed Next 16.3.4 streaming guide and storefront `AGENTS.md`. The existing root/body boundary is retained so required 404 checks occur before a Suspense response commits. Promise resolution remains within `server-only` modules; no promise, authorization data or database context is passed to a client component.

New CSS is confined to `gift-detail.css`: recipient status/control and market/policy region minimum block sizes use existing spacing tokens. The pending picker uses the same `fs-overlay-trigger` class and localized label as its completed drawer trigger. Market fallback renders the real localized heading/body and loading text, not fabricated options. Final content is never truncated or clipped. Minimum sizes reserve the expected region, but unusually long configured market/policy lists can exceed it; zero CLS at every cardinality cannot be established by a source test. The changed compiled page still needs 390×844/1440×900 browser, keyboard, seven-locale and CLS/LCP checks. Baseline budget failure remains separate evidence; no performance success is claimed here.

Code-simplifier review kept the existing market/policy renderer and picker instead of introducing a generic deferred-data framework. It preserved critical-read dispatch before the artist read, restricted the private market wrapper to its actual h2 usage, and kept non-gift footers on their existing renderer. Independent review is delegated to the directory agent; this README is the author's execution record.

| S.U.P.E.R item                               | Result and scope                                                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Single module responsibility              | PASS: recipient rendering and deferred context rendering are separate private modules.                                                                                        |
| 2. Single conceptual function responsibility | PASS: read scheduling, recipient resolution, display and individual Suspense boundaries remain small functions.                                                               |
| 3. One-way flow                              | PASS: existing readers → server sections → existing client picker/quantity.                                                                                                   |
| 4. No circular imports                       | PASS by owned-module inspection; sections do not import page factories.                                                                                                       |
| 5. Typed/schema contracts                    | PASS: unchanged public response types and strict existing readers; synthetic tests parse public schemas.                                                                      |
| 6. Serializable business I/O                 | PASS: only completed public DTO/scalar props cross client boundaries; promises are internal server scheduling.                                                                |
| 7. No new hardcoded configuration            | PASS: locale/copy/query values and CSS tokens are reused; no configured identity, market, currency or URL is added to product source.                                         |
| 8. Dependencies declared                     | PASS: no new dependency.                                                                                                                                                      |
| 9. Replaceable parts                         | PASS: private presentation wrappers reuse existing renderers and preserve their DTO boundary.                                                                                 |
| 10. Full verification                        | PARTIAL: final affected 102 tests/lint/format and complete storefront type-check passed; compiled browser/performance and whole-repository checks are root-owned and pending. |

## Independent-review correction and final freeze

Directory and root independently identified a non-gift regression in the first split: a context promise could reject while slow copy was still pending, leaving the rethrown promise without its previous immediate `Promise.all` consumer. `gift-streaming-context-rejection-red.log` records a controlled, effective **1 FAIL**: the policy page had not propagated the context rejection while copy remained unresolved. The test drains microtasks and releases copy in `finally`, so it proves delayed rejection handling without deliberately crashing the process or manufacturing an unhandled-rejection event.

The one-line production correction includes `kind === "gift" ? undefined : contextRead` in the initial `Promise.all`. Non-gift pages regain immediate rejection handling; gift context remains independent. Final verification: **7 files / 102 tests PASS**, including **35 scheduling tests**, in `gift-streaming-context-rejection-green.log`; complete storefront type-check PASS in `gift-streaming-context-rejection-types.log`; scoped lint/format PASS in `gift-streaming-context-rejection-lint.log` and `gift-streaming-context-rejection-format-check.log`. The final seven-file snapshot above supersedes the earlier author freeze. No Next build, browser or performance run was executed by this subtask.

# Artist directory deferred validation

Scope: P3-06, delegated to storefront_directory. Source is frozen in `directory-lazy-source-freeze.json` (six product modules and four test files). No contracts, public schema roots, dependencies, shared UI, locale/header, gift modules, Git state, Next build or browser service were changed by this implementation.

## Change and preserved boundaries

- `directory-request.ts` is a transport facade with type-only static imports. Its real browse/search calls load the private `directory-validation.ts`, which retains the original `artistSearchTermSchema`, `idolDiscoveryQuerySchema` and `idolDirectoryResponseSchema` validation. Query validation still precedes fetch; strict DTO parsing, HTTP status, window and exact locale checks still precede accepted responses.
- Initial directory models/links do not initialize their schema modules. Server `prepareDirectoryQuery` still parses raw URL anchors. Parsed anchors and actual response IDs remain branded `IdolId` through props, reducer state and links. The old `directoryContextQuery` export remains available from the server query module and delegates to its pure implementation.
- The browse component omits `limit`; the existing query schema supplies the unchanged default 12. No schema rule or catalog limit was copied into the component.
- Search still skips closed, empty and IME states, and starts only after the existing 250 ms debounce. It now validates after the module loads. Therefore the invalid-input message appears after debounce plus module loading; accepted text and error categories are unchanged. The component's sequence/latest-wins and abort checks remain in place.
- The facade checks cancellation before and after the import and after the network result. Import failures and late/cancelled results become the existing safe `CATALOG_UNAVAILABLE` response. No rejected import promise is retained by application code. A browser may have its own module failure cache; actual failed-chunk recovery is explicitly pending real-browser verification, not proven by the unit retry test.
- The original reducer's catalog-version, anchor-presence, duplicate-card and stale-response guards remain intact. UI error/retry, focus/keyboard handlers, history mutation, SSR cards and DOM markers are preserved.

## Evidence

Effective RED: `directory-lazy-red.log`, 6 failures on the prior implementation (four actual initial static dependency edges, two cancelled-request results). This did not fail because a new implementation file was absent.

GREEN: `directory-lazy-final-tests-green.log`, 8 files / 70 tests PASS after final cleanup. Includes existing directory/query/model, artist SSR, page composition and purchase SSR coverage, plus deferred module load/cancel/failure/retry tests and full query/response adversarial validation. The loading tests use controlled module promises and `vi.importActual` for the real validator; they are unit evidence, not browser evidence.

Executed test command:

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/storefront exec vitest run --config ../../vitest.config.ts --root . src/storefront/directory-loading.test.ts src/storefront/directory-request.test.ts src/storefront/directory-model.test.ts src/storefront/directory-lazy.test.ts src/storefront/directory-query.test.ts src/storefront/artist-directory.test.tsx src/storefront/page-factory.test.tsx src/storefront/gift-purchase.test.tsx --maxWorkers=2
```

- `directory-lazy-final-types-green.log`: storefront `tsc -p tsconfig.build.json` PASS.
- `directory-lazy-lint-green.log` / `directory-lazy-format-green.log`: complete owned scope PASS; the final two-file type placement cleanup was rechecked in `directory-lazy-cleanup-lint.log` / `directory-lazy-cleanup-format.log`.
- Earlier lint rejected `import()` type annotations in a new test; that log remains `directory-lazy-lint.log`. Replaced with an erased namespace type import and reran the checks.
- Non-author review: `directory-lazy-independent-review.md` and `directory-lazy-independent-tests.log`; 3 files / 14 tests PASS, ACCEPT. The final cleanup only moves the query type definition to the validation module and has no runtime effect.

## S.U.P.E.R and limits

1. PASS: facade owns lazy transport; validation owns the existing validated request; model owns pure browse state/links.
2. PASS: functions retain explicit browse, search, validation and reducer responsibilities; no generic loader abstraction was added.
3. PASS: component → facade → validator → existing BFF, with the original application/data boundary unchanged.
4. PASS: no runtime or type import cycle after the final minimal type placement cleanup.
5. PASS: existing schema-defined query/response and branded IDs; no trusted boolean or unchecked external DTO bypass.
6. PASS: request/response payloads and SSR props remain serializable; existing local fetch/signal capabilities are not payloads.
7. PASS: only the existing same-origin API path is used; no domain, identity, locale array or catalog limit configuration is duplicated.
8. PASS: no new dependencies.
9. PASS: private validation can be replaced behind the existing transport facade within this directory.
10. Scoped PASS: affected tests, typecheck, lint and formatting above passed. Coordinated Next build, real seven-locale browser interaction, chunk-load failure recovery and performance remain pending.

The AST gate covers the owned artist/directory static dependency graph, not unrelated shared navigation/UI or every page. This change does not claim all Zod is absent from the initial application, a particular byte saving, the 150 KB recommendation, or an LCP improvement. Those conclusions require root's fresh compiled artifact and real measurements.

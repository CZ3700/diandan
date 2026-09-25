# P3-04 artist directory implementation evidence

Owner: `/root/storefront_directory`, within root's P3-04 / Lane B task.

Owned source: `apps/storefront/src/storefront/artist-directory*`, `artist-search*`, `artist-track*`, `directory-*`. No shared contracts, database migration, package dependencies or progress state changed by this subtask.

## Behavior

- Initial public directory response renders on the server. Real bounded pages append through the same-origin BFF; no duplicate carousel cards or eager loading of the complete catalog.
- Search uses the existing `q` contract (six suggestions), waits 250 ms after input, suppresses requests and selection during composition, and supports Arrow Up / Down, Enter, Escape, pointer selection and a named combobox/listbox. Suggestions render text, not additional photographs.
- Search selection requests a full-directory window by stable `anchorId` (without `q` or `after`), then focuses its real artist detail link. The PostgreSQL window begins with that target; it does not claim a centered window.
- The URL keeps unrelated market/currency/gift parameters and fragment. The explicit new selection replaces artist search/cursor navigation parameters. Locale and browser navigation continue through root's navigation/route adapters.
- Append failure preserves existing cards. Changed/invalid cursor explicitly offers reload instead of merging snapshots. Missing targets retain existing cards and offer recovery. An explicit start action returns to the directory beginning.
- Paused artists retain their crawlable detail links and show their actual accepting status. This component has no add-to-cart or payment behavior.
- Native scroll/snap and previous/next controls share the same real items. The track supports Arrow Left / Right and Home / End. Reduced motion disables snap and has no animated scrolling. Portrait layout is fixed 4:5.

## Test-first evidence

Commands use `mise exec node@24.20.0 -- corepack pnpm`.

1. `--filter @fan-support/storefront test`: `directory-red.log`, exit 1 with seven expected missing-model/transport assertion failures; 119 existing tests passed.
2. Same command: `directory-ui-red.log`, exit 1 with two expected missing-component assertion failures; 126 tests passed. An initial TSX typo was corrected before this recorded behavioral RED.
3. Same command: `directory-bounds-red.log`, exit 1 at the new requested-window overflow assertion; 135 tests passed. The transport then rejected responses that exceed the requested limit or claim a next page without filling that window.
4. Same command: `directory-tests-green.log`, exit 0, 23 files / 136 tests passed. Eleven tests belong to this subtask: five state/query tests, three transport tests, three server-rendering tests.
5. Scoped Prettier completed. Scoped ESLint found no code errors (the explicitly included CSS glob was ignored by the JS-only ESLint configuration).

The behavior assertions cover late append suppression after a new anchor request, no mixed catalog versions, no duplicate IDs, target membership, retained cards across failures, Unicode/IME query preparation, bounded requests, safe malformed-response errors, cross-locale rejection, and SSR empty/error/paused states with query-preserving links.

## Integration boundary

This evidence is unit/SSR evidence only. Real PostgreSQL/media/API/Next/browser verification, request races during live composition, measured viewport behavior, axe and performance belong to the root's combined P3-04 browser harness. Do not substitute these tests for that acceptance gate. No new physical-device, production, PSP, cloud or remote CI conclusion is made here.

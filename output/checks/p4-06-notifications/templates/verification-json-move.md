# Locale source ownership correction

The seven-locale copy object moved from `v1/copy.ts` to adjacent `copy.json`.
TypeScript now imports it with a JSON import attribute and applies the existing
type. Copy text, keys, insertion order and all three immutable template hashes
were unchanged by this source-only correction. No locale ownership gate was
relaxed.

- `json-move-green.log`: 9 files / 44 tests passed.
- `json-move-build.log`: build passed.
- `json-move-browser.log`: 44 browser cases / 842 assertions passed.
- Browser evidence: `browser-2026-09-16T02-15-16-780Z`.
- Exact source inventory: `source-manifest-json-move.json`.

This records that candidate honestly. The later real integration review found
that its email URL used an unimplemented route. The subsequent route correction
changes the immutable refinement material and unpublished DRAFT identities;
it supersedes this candidate for acceptance. The old artifacts remain intact.

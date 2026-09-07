# Compiled public client boundaries — read-only review

Conclusion: ACCEPT for removal of schema initialization from public initial client entries in the inspected build. Build ID: `HGuRRR3zAhvpvHAfD9TYO`. Root identified this as the compiled 7f4695db source snapshot with 1,539 inputs; the local build ID, manifests, emitted code and file hashes were independently read. No source edits, build, tests, browser or services were run during the active Lighthouse sampling.

`client-boundary-compiled-review.json` records all 63 public manifests (seven locales × nine routes), their client modules, static chunk references/entry lists, root bootstrap/polyfill files and inspected hashes. The union of public manifest entries has eight unique JS chunks; this is an inventory, not a count of actual scripts fetched by an individual page. No bundle-byte sum is reported.

## Three implementation boundaries

1. **Artist directory/search:** initial components contain the pure model and request facade. The emitted asynchronous loader module `37388` invokes `loadChunk` only inside its callback, loading `3uj1ol0m8neth.js`, `066uch4wt2mh4.js` and `17ukiawqd9x62.js`, then retrieving validation module `47180`. Its original search/query/response schema parsing remains in the deferred code. These chunks are absent from every public static reference and entry list.
2. **Gift filters:** initial `GiftFiltersClient` contains form state and the submit handler. The emitted asynchronous loader `65410` loads `1fmu990k9ls3p.js` plus the same Zod/contracts chunks, then retrieves validator `94324`. Initial draft formatting, hint and reset/recovery href construction belong to the server wrapper. The three validation chunks are likewise absent from public static entries.
3. **Gift purchase:** public manifests now refer to `gift-quantity.tsx`, not the old `gift-purchase.tsx` client entry. Offer selection, price/stock ICU and variant presentation remain in the server component; Quantity receives the scalar ceiling and labels. Recipient links use the pure selection module. The earlier independent source/AST review is in `gift-purchase-boundary-independent-review.md`.

The shared enabler is the canonical locale pure-value check: header/navigation no longer requires locale schemas. The prior public DTO/internal-proof contract split is also retained; no validation was replaced with a type assertion or a reduced schema.

## Remaining code and limitations

- Zod is present in emitted `066uch4wt2mh4.js`, as expected for later interaction. It is not present in the public initial chunk lists. Every public initial chunk plus root bootstrap/polyfill was inspected for `ZodError`, `_zod`, `safeParse` and the previously observed internal-proof markers; there were zero hits. The actual deferred loader functions were read to distinguish a callback-held chunk URL from an eager load.
- The old `current policy publication` and `import approval evidence` markers do not appear in these public initial chunks. Server SSR mapping entries are server execution files and were not counted as browser dependencies.
- Policy and region manifests still declare lightweight gift filter/quantity/recipient client entries through the shared factory. They no longer pull the schema chunks statically, but this remains a possible future composition refinement; the review does not claim that every unused client component has disappeared.
- Base UI Menu/Drawer and the normal React/Next runtime remain initial dependencies. Their presence is intentional here; no interaction gate or performance threshold was changed.
- Maintenance risks: a future runtime schema import in navigation/pure link/model files, server formatter imports in a client entry, or executing a dynamic loader at module/render time can reintroduce initial work. Keep AST dependency tests, strict full network parsing, canonical membership/error semantics, cancel/latest-wins and failed-download recovery tests intact.
- Actual fetched resource counts, transferred bytes, first-interaction chunk failure recovery and LCP belong to E2E's current browser/Lighthouse results. This compiled-boundary review alone does not prove the 150 KB SHOULD recommendation, an LCP budget, or production readiness.

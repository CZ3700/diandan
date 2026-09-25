# Independent purchase and context presentation verification

Reviewer/test author: storefront_directory; implementation author: root.
No root implementation was changed during this bounded review.

`gift-purchase.test.tsx` and `commerce-context.test.tsx` contain 17 passing tests;
all business fixtures pass the actual storefront contract schemas before rendering.
The 17 tests cover TRACKED/PROCURE_ON_DEMAND/PREORDER independently from gift type,
real maximum quantities, recipient-required and paused/incompatible states,
sold-out with a known price, missing price with no fabricated zero, explicit unknown
variant without substitution, case-insensitive variant selection, and a truly
disabled checkout button in every tested state. Context tests cover exact configured
market/currency pairs, empty/failure without default invention, gift/artist/context
preservation when changing market, clearing old price filters/variant/page, actual
policy keys, and HTML escaping.

Evidence: `purchase-context-independent-green.log` (2 files / 17 PASS),
`purchase-context-independent-lint.log` (exit 0, empty), and
`purchase-context-independent-format.log` (PASS). The first attempted test collection
in `purchase-context-independent-first.log` had a test-only Unicode-regex escape
error and no tests executed; it is not a behavioral RED or implementation failure.

SSR result: ACCEPT for the specified purchase/context behavior. These tests do not
prove live inventory, actual publication rights, browser event behavior or a release.
Those remain the separate PG/S3/browser harness and production approval boundaries.

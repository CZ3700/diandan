# P3-05 — gift storefront

## Presentation

Visual thesis: retain the approved original-color charcoal and soft-gold surface. Large, uncropped gift photography is the main visual anchor; quiet typography, open spacing and fine separators organize the commerce information.

Content plan: gift directory with clear count, filter/sort and real pagination; detail with gallery, recipient, variant, actual price and inventory policy, followed by published descriptions and studio handover/policy information. Market and currency selection stays independent from language. All published content comes from PostgreSQL.

Interaction thesis: URLs restore filters, pagination, recipient and market. Mobile filtering uses the existing accessible drawer; variant/quantity selection gives immediate feedback. No decorative motion expansion; reduced-motion behavior remains supported. Checkout is explicitly unavailable until Phase 4 and no private message is collected here.

## Frozen ownership

- root: shared exports/registry/generated artifacts, seven-locale copy, page composition, detail and policy/region views, source checkpoints and Git.
- storefront_directory: new gift-directory/card/filters/query/css modules and related tests only; existing directory response remains unchanged.
- storefront_read: additive public commerce contracts and read-only API/Application/Port/PostgreSQL chain plus strict storefront server reader; no shared exports/generated files.
- storefront_e2e: independent gift-storefront fixture and real browser/HTTP harness; never overwrite P3-04 evidence.

## Sequence and verification

1. Fail meaningful query, contract, rendering and transport tests before implementation.
2. Implement additive public read projection with current effective prices, recipient eligibility and inventory policy. Preserve all 373 historical contract roots.
3. Connect directory, detail, policies and explicit database-backed market choices in all seven locale routes.
4. Run affected unit/PG/API checks, format/lint/type/build, then actual compiled storefront with PostgreSQL/API/TLS object storage and Chrome at 390×844 and 1440×900; cover all seven languages, keyboard, failures, reduced motion and narrow reflow/accessibility.
5. Independent review, S.U.P.E.R, source/evidence capture, verify the 261 prior untracked files remain unchanged, update task status only on passing evidence, local commit only.

# P4-02 Cart Storefront Implementation Plan

> **For agentic workers:** Use the subagent-driven-development workflow with explicit ownership below. Existing agents retain useful repository context; root integrates and a non-author reviews each scope. This is one P4-02 task, not additional phase tasks.

**Goal:** Connect the gift purchase flow to a real anonymous cart, with independent recipient lines, quantity changes, removal and private message editing.

**Architecture:** Reuse the established PostgreSQL cart and KMS session boundary. Add independent edit contracts and a transaction manager without changing stored v1 schemas. Browsers use a fixed-path same-origin BFF; only an explicitly opened private editor may receive decrypted fields, with database authorization and an audit before decryption, followed by version and authorization revalidation.

**Tech Stack:** Existing Node 24.20.0, pnpm 11.25.0, Next App Router, React, Zod, PostgreSQL and repository KMS adapter. No new runtime dependency.

## 1. Contracts and persistence — storefront_directory

Files: `packages/contracts/src/cart-edit*.ts`, `packages/persistence-port/src/cart-edit.ts`, `packages/persistence-postgres/src/cart-edit*.ts`, migration 0024 and its explicit catalog; minimal current-cart filtering in the existing repository.

- [x] Write and run missing-behavior tests before implementation: invalid quantity/version, private display-mode consistency, same-cart ownership, canceled line filtering, safe receipt replay and audited editor access.
- [x] Freeze `UPDATE_CART_ITEM` / `REMOVE_CART_ITEM` / private editor read commands and safe responses. Quantity carries the observed price and cart/item versions; personalization replaces only private fields and language. Recipient/variant ownership cannot change.
- [x] Keep old schemas decodable. A replay of an already removed ADD returns the new explicit `CART_ITEM_REMOVED` failure, never recreates a removed line.
- [x] Write quantity/item/cart version and intent changes, immutable mutation receipt and ID-only durable outbox together. Removal cancels the intent and retains original item/history. Personalization resets moderation and its evidence.
- [x] Prove actual PostgreSQL up/down/up, current binding and history protection, and reject unsafe rollback without deleting data.

## 2. Application — root

Files: `packages/application/src/cart-runtime-view.ts`, `cart-edit*.ts`, tests, shared contract/port/application exports and generated JSON Schema/OpenAPI.

- [x] Run the old cart Application suite, then write failing shared projection tests and extract current publication-based view construction without changing behavior.
- [x] Add mutation tests: authenticate first, replay before version checks, reject mismatched hash, reject stale cart/item versions, current price/stock checks, empty anonymous privacy, unknown commit and exact retry.
- [x] Keep KMS outside database transactions. For personalization, roll back any preliminary idempotency claim before encryption, then reauthenticate/recheck both versions in the final atomic write.
- [x] For private editor read, persist authorized access audit before KMS, decrypt only the selected intent, and recheck authorization/expiry/versions before returning. No plaintext in general cart response or receipts/events.
- [x] Register only new contracts and verify all baseline roots remain unchanged.

## 3. API/BFF and actual protocol — storefront_e2e

Files: API `cart-edit-route*.ts`, existing cart composition/bootstrap; storefront fixed cart proxy/route handlers and tests; dedicated protocol/browser fixture under existing scripts.

- [x] Run red tests for PATCH/DELETE/editor POST, missing cookie/CSRF/origin, malformed paths/body/headers, version and idempotency requirements; implement and pass.
- [x] BFF paths: `/api/storefront/cart` GET/POST, `/items` POST, `/items/:itemId` PATCH/DELETE, `/items/:itemId/editor` POST. Forward only the fixed operation, restricted Cookie/CSRF/Idempotency headers and validated JSON, using configured site and internal API origins.
- [x] Apply private no-store/noindex/no-referrer to all responses, including errors; do not relay arbitrary destinations, upstream internals or cookies.
- [x] Reuse actual cart PG/TLS S3/KMS fixture with a write-aware gateway. Exercise cross-session denial, version conflicts, concurrent and lost-response replay, three normal new-gift adds, and editor access with no sensitive evidence output.

## 4. Frontend — storefront_read

Files: storefront `cart-*`, cart CSS/page factories, gift purchase/quantity, site header/page shell, seven cart routes, seven locale copy catalogs and tests. No shared UI primitive or token definition changes. Original design checks require regenerating the existing Chinese/Japanese font subsets from the expanded copy; cart CSS consumes the existing layout and spacing tokens.

- [x] RED: a current eligible priced offer has an enabled add form; unavailable/recipientless offers remain guarded. Implement gift quantity and optional private message/signature form using real canonical IDs.
- [x] Small cart provider holds only safe DTO, CSRF and exact pending command in memory; no cart token/private localStorage/sessionStorage. Keep critical gift content server-rendered and editor/drawer on-demand.
- [x] Build restrained cart rows with independent artist/gift/media language, real prices or explicit unavailable state, quantity/delete/message controls. Use plain names rather than an incorrect detail URL that loses recipient/variant.
- [x] Provide cart drawer and `/:locale/cart`; live add confirmation in 220–320ms without stealing focus. Reuse drawer/quantity/media primitives, focus return and reduced motion.
- [x] Quantity feedback is optimistic and definite failures roll back. Unknown results retain exact body/key for explicit same-key recovery; conflicts refresh facts and keep unsaved draft for explicit confirmation.
- [x] Clear private editor data on close/unmount and ignore late responses. Full saved contents appear only after explicit protected editor read. No plaintext in screenshot, console or analytics evidence.
- [x] Keep checkout unavailable until P4-03; show accurate current-stage state and continue-browsing action.

## 5. Integration and local checkpoint — root + non-author review

- [x] Run affected tests, then `mise exec node@24.20.0 -- corepack pnpm check:dev`.
- [x] Real browser: seven locales at 390×844 and 1440×900, add → open cart → quantity → private edit → remove; independent recipients, reload and locale switching; empty/loading/error/image fallback, keyboard and reduced motion. Use synthetic private input, clear it before evidence screenshots.
- [x] Refresh only invalidated original shared UI proof with original collectors. Freeze implementation inputs, then run the unchanged full repository `pnpm check` gate, secret scan and high dependency audit. Original full-check failure and the exact same-source original continuation are explicitly preserved in gate-coverage.json; no single full exit-zero claim.
- [x] Review spec coverage first, then code quality/S.U.P.E.R ten checks. Preserve all failures and actual environment/production limits.
- [x] Record commands/results/paths in Phase 4 and MASTER; DONE only after acceptance, then unlock P4-03 and create a local commit. No push or production release.

# PostgreSQL compatibility checkpoint

This checkpoint introduces migration 0027. Migrations 0001–0026 remain unchanged. Old full-up harnesses previously assumed head 0026; they would reject the new real head or try to downgrade a non-head migration. The following nine existing TEST files now check head 0027 and/or first run the real empty 0027 downgrade to 0026 before their original historical sequence:

- `postgres-catalog-directory.mjs`
- `postgres-content-draft-repositories.mjs`
- `postgres-publication-validation-time-cases.mjs`
- `postgres-admin-catalog.mjs`
- `postgres-publication-runtime.mjs`
- `cart-runtime-rollback-proof.mjs`
- `cart-edit-rollback-proof.mjs`
- `checkout-preflight-rollback-proof.mjs`
- `payment-runtime-rollback-proof.mjs`

All paths are under `packages/persistence-postgres/scripts/`. Original historical target versions, refusal assertions, original jobs/admin history/cart/intent/payment count and hash comparisons remain. Full re-up returns 0027. The old payment rollback proof compares history at its original 0026 stage, then restores 0027; it does not claim the original 0026 guard is a 0027 guard. Fixed historical migration fixtures retain their original targets.

The new `postgres-order-payment-parameters.mjs` is registered immediately after the existing payment-runtime parameter probe; no original command is removed or reordered. The old parameter probe only gains a fixed source-template binding for the new canonical column branch.

Validation at this checkpoint: scoped format/lint pass; actual latest PostgreSQL 27-migration/170-table up/down/up catalog round-trip and 30 source SQL PREPARE statements pass. The nine complete historical suites remain part of root's original full gate; these scoped checks are not presented as nine fresh integration runs. Full financial behavior, dual-source capture, late success and unknown commit evidence are reported separately by the real HTTP/PSP protocol.

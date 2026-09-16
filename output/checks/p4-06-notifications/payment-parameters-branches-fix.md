# Payment SQL probe branch coverage

Root full check RED: `check-full.log` lines 416–429 records `ReferenceError: restoresNonterminal is not defined` in the AST SQL renderer. Product recovery SQL now has two source-owned branches; the validation script had not supplied the conditional variable.

Only tracked change: `packages/persistence-postgres/scripts/postgres-payment-runtime-parameters.mjs`. The renderer inventories both `restoresNonterminal=false` and `true`, verifies the quote/reservation predicates occur only in the guarded branch, and sends both complete statements through actual migrated PostgreSQL PREPARE. It reads `pg_prepared_statements` and verifies all 11 parameters resolve and both branches have the same type contract. All prior query inventory and route/guard checks remain.

Validation (Node 24.20.0 via mise):

- `node packages/persistence-postgres/scripts/postgres-payment-runtime-parameters.mjs`: PASS, 45 assertions, 38 prepared statements. Both branches infer `uuid,text,text,uuid,uuid,timestamptz,text,bytea,bytea,text,timestamptz`. Evidence: `payment-parameters-branches-green.log`.
- `node packages/persistence-postgres/scripts/postgres-payment-runtime-action-guard.mjs`: PASS, 10 assertions. This script uses static SQL and the original mutation trigger, so it does not require an AST fix and remains unchanged. Evidence: `payment-action-guard-green.log`.
- `corepack pnpm exec prettier --check packages/persistence-postgres/scripts/postgres-payment-runtime-parameters.mjs`: exit 0. Evidence: `payment-parameters-branches-format.log`.
- `corepack pnpm exec eslint packages/persistence-postgres/scripts/postgres-payment-runtime-parameters.mjs --max-warnings=0`: exit 0. Evidence: `payment-parameters-branches-lint.log`.

No product code or shared build changed. No complete checkout/PSP claim is made by these two isolated probes; those have separate P4-06 protocol evidence. All agent file creation/writes freeze again after this report.

# Independent catalog event-time repair review

Reviewer: `/root/storefront_directory`. Author: `/root/storefront_read`. Result: **ACCEPT** for the bounded three-file repair. No source was changed by this review.

Reviewed: `packages/persistence-postgres/src/admin-catalog-data.ts`, `admin-catalog-data.test.ts`, and `packages/persistence-postgres/scripts/postgres-admin-catalog-time.mjs`, with the unchanged authorizer, write/application call chain and migration 0019 as controlling context.

## Reasoning

- The event timestamp no longer promotes an independently sampled wall clock into a persisted causal lower bound. It uses stable transaction time, the exact prior identity timestamp, session creation and relevant effective grant history.
- `min(GREATEST(ar.granted_at, rp.granted_at))` selects the earliest currently effective complete `content.edit` authority path. One permission path is sufficient for the unchanged SQL EXISTS/PERFORM authority requirement; unrelated/later paths need not force the identity event forward.
- In contrast, every supported locale grant is required for identity writes. The maximum of current unrevoked effective locale grant times is therefore the necessary lower bound for all required locale scopes. The unchanged application requests the full canonical locale set and locks it with the session/permission authority before writing.
- No principal-provided `authorizedAt` or JavaScript Date rounding is introduced. `prior.updated_at` is passed unchanged, and the database returns the exact microsecond timestamp through the existing serialization/schema path.
- The unchanged migration 0019 guard still rechecks actual wall-clock session start/expiry, MFA, active identity, revocation, current permission, locale scopes, event ordering and exact audit/receipt/redirect ties at commit. The repair does not extend expiry, bypass an authorization check, disable a trigger or weaken a migration.

## Independent verification

Commands use `mise exec node@24.20.0 --`.

- Focused source tests via Vitest: `time-independent-unit-review.log`, exit 0, 2 tests. These cover exact microsecond/prior forwarding and failure for a missing canonical session.
- Fresh real ephemeral PostgreSQL execution: `node packages/persistence-postgres/scripts/postgres-admin-catalog-time.mjs`, `time-independent-postgres-review.log`, exit 0, 10 assertions. This independently reproduced the valid create/rename path, the controlled historical-clock regression check, actual grants effective after BEGIN with exact microseconds, and real session expiry at COMMIT with complete rollback.
- Read the author's expected RED evidence: only the event upper-bound predicate failed while the eight remaining session predicates held. Also inspected the author's unchanged catalog regression run: 258 assertions passed (`catalog-regression-green.log`). That 258-assertion run was inspected, not independently rerun here.
- Reviewed-file diff whitespace checks passed.

The controlled clock probe is an isolated SQL fault injection tied to the old event expression; it does not alter real database guards. This acceptance covers local PostgreSQL behavior and the reviewed source change, not operating-system clock infrastructure, staging or production deployment.

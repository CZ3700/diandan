# Base content HTTP verification

Scope: additive five administrator commands and one scoped preview read endpoint. Existing 3A/3B roots and production identity login remain unchanged.

- `http-unit-red.log`: pre-implementation missing route failure.
- `http-unit-green.log`: eight transport tests plus three TEST composition tests passed; includes duplicate credentials, trusted request authority, full target binding, strict JSON, 64 KiB parser limits and private errors.
- `http-postgres-attempt1.log`: first real PostgreSQL pass, 3727 assertions / 374 real loopback requests.
- `http-postgres-green.log`: expanded pass before the deterministic microsecond fixture, 3846 assertions / 388 real loopback requests.
- `http-session-microseconds-red.log`: normal session expiry forced to a nonzero 789-microsecond remainder; issue returned 503 after both authorization and issuance ports succeeded.
- `http-session-microseconds-green.log`: final pass after preserving PostgreSQL authorization timestamps, 3847 assertions / 388 real loopback requests, including exact session expiry clamping and database-observed real expiry.
- `http-typecheck.log`, `http-lint.log`, `http-final-format.log`, `http-build.log`: scoped tooling evidence.

The real HTTP harness creates authoring receipts through the 3B API, then reviews and previews five content kinds in seven locales. It proves Japanese-only access with actual English source, independent approval, exact content/English/sequence guards, idempotent replay, one concurrent approval winner, atomic rollback after a deterministic normal audit-trigger failure and same-key recovery, exact preview owner/revision/locale, domain-separated tokens, no locale fallback, session TTL clamping and actual database-observed expiry, already elapsed normal grants, live session/RBAC/locale revocation, old extension API coexistence, and private error/log boundaries. It never disables constraints, changes system clocks, or logs credentials or content. No publication or production login is activated.

Run: `mise exec node@24.20.0 -- node apps/api/scripts/base-content-http.mjs` after API dependency build and current migration-manifest generation.

Independent review: root-authored base-content contracts, OpenAPI, TEST composition and optional bootstrap wiring ACCEPT. Exact owner/revision/locale, strict authoritative inputs, canonical private response limits and lifecycle wiring match transport and the real HTTP evidence. Preview references remain data only; rendering and actual publication are outside this checkpoint.

Timestamp review: authorization adapter now projects expires_at and authorizedAt as UTC text with six fractional digits and validates them without Date conversion. Original effective-session, MFA, permission, locale and row-lock predicates are unchanged. Independent review ACCEPT restored after the exact previously failing real HTTP fixture passed.

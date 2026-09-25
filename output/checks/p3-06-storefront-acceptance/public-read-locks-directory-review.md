# Public read lock correction — independent review

Reviewer: storefront_directory; author: root. Read-only review of `content-authoring-data.ts`, `publication-preflight-data.ts`, `publication-preflight-repository.ts`, `publication-preflight-evidence.ts`, `published-content-repository.ts`, and `publication-read-locks.test.ts`.

**ACCEPT within the stated public read/read scope.** The sole public content adapter explicitly selects SHARE. The option propagates through owner locks, the homepage transaction advisory lock, current revision and translation rows, every referenced media metadata snapshot, and copied-translation evidence's original revision. Existing media assets/processing evidence, publication heads, price evidence and candidate facts already use shared reads. The alias/detail draft read helpers introduce no hidden FOR UPDATE path. The snapshot-self media case reuses the already shared-locked root snapshot. No projection, proof identity, rights or timestamp checks were removed.

The existing preflight/write factory and `publication-runtime-load.ts` omit the optional argument and therefore retain UPDATE; all new optional argument defaults remain UPDATE. The raw lock keyword comes only from the internal TypeScript UPDATE/SHARE union, not an HTTP/operation field. No new retry, swallowed SQL error, proof bypass or relaxed isolation was introduced.

Independent command: `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test src/publication-read-locks.test.ts src/publication-preflight-repository.test.ts src/published-content-repository.test.ts` — exit 0, 3 files / 16 tests. Evidence: `public-read-locks-directory-independent.log`.

This static and unit review verifies propagation and preservation of writer defaults. It does not independently claim real PostgreSQL concurrency or general deadlock freedom for arbitrary simultaneous writes. Root/E2E own the naturally observed failure, controlled conflicting-read reproduction and same-fixture real concurrent GREEN evidence. No source edits were made by this reviewer.

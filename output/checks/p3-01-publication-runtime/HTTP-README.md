# P3-01 4C-2 HTTP publication validation

Status: final integrated HTTP verification passed (`http-final.log`) against the frozen migration proof guards and final built sources. This file records scoped evidence; it is not a release approval.

## Owned transport and composition evidence

- `route-red.log`: six newly specified management route tests fail against the absent endpoint implementation.
- `public-route-red.log`: five public route tests fail against absent endpoints.
- `route-first-green.log`: coexistence test exposed a duplicate Fastify not-found scope shared with the old preflight route; the new routes now each use a distinct endpoint scope.
- `api-unit-green.log`: 15 route/composition tests pass, including all five public kinds across seven explicit locales, wrong-object/locale rejection, strict response schema, private fields, current session envelope, CSRF/Origin, duplicate headers/cookies, parser/body limit, safe errors, and old directory/preflight coexistence.
- `openapi-red.log` and `openapi-green.log`: the ten additive documented paths were tested before implementation.
- `composition-red.log` and `composition-green.log`: four tests verify explicit TEST-only administration, anonymous production public composition, configuration validation and shared persistence closure.
- `cache-provider-green.log`: actual loopback HTTP cache/provider smoke proves stale values survive PENDING and are refreshed only after completed path invalidation; terminal denial uses the port error schema.
- `independent-media-fixture-green.log`: a separate historical media asset is inserted through normal constraints, authored and independently reviewed in all seven languages, with no fabricated publication. The original referenced media remains available for the separate supersession regression.
- `http-final.log`: final integration exits zero with 10,448 assertions and 1,332 HTTP requests, including the final log-privacy check. Counts include STATUS observations and vary with real worker timing. The observer reads at 100 ms; worker scheduling remains unchanged.
- `http-build-final.log`: all 22 API/worker dependency builds passed before the final HTTP run. `api-unit-final.log` retains 15 passing route/composition tests; `openapi-final.log` retains the additive-path test; `lint.log` passes for every owned new source and harness file.

## Repeatable commands

Run from repository root with the pinned Node runtime:

```sh
mise exec node@24.20.0 -- corepack pnpm exec turbo run build --filter=@fan-support/api... --filter=@fan-support/worker...
mise exec node@24.20.0 -- node apps/api/scripts/publication-runtime-http.mjs
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api exec vitest run --config ../../vitest.config.ts src/publication-runtime-route.test.ts src/published-content-route.test.ts src/publication-runtime-composition.test.ts src/published-content-composition.test.ts
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/contracts exec vitest run --config ../../vitest.config.ts src/publication-runtime-openapi.test.ts
```

The main HTTP script uses ephemeral PostgreSQL, real TLS S3, and the actual Application/PG/API/worker packages. It seeds historical normal-trigger fixtures under migration 0017 and then upgrades to 0018 before invoking any new publication command. It never synthesizes a version-two publication record or disables database constraints.

## Integrated scope

Five base kinds are validated, published, copied, published again and rolled back; all seven public locales must resolve the current manifest. Tests cover current authorization, version and idempotency conflicts, audit-trigger failure rollback and same-key recovery, seven durable purge jobs, failed history plus explicit retry generations, current locale revocation before idempotency replay, and actual local HTTP cache visibility after completed purge.

The actual worker uses its default scheduler with the production composition's 1,000 ms idle interval; production code drains recorded work after 10 ms. STATUS observation does not drive the worker or alter persisted retry times. Tests retain the 60-second completion and publication-to-cache-visibility limits, stop after a persisted SUBMITTED result, restart a new worker against the same PostgreSQL jobs and provider references, and prove there is no duplicate submission. Unrelated commerce outbox rows and dispatch attempts remain unchanged.

The historical media regression publishes a newer metadata revision after the parent page is already live. Existing parent GETs remain successful in all seven languages while a new parent draft pinning that superseded metadata is blocked from publication.

Actual integration exposed and retained evidence for two production issues: manifest canonicalization reordered an ordered review-field tuple (`http-second.log`), and lifecycle hashing used a different timestamp serialization from the canonical PostgreSQL snapshot (`http-third.log`, `http-race-diagnostic.log`). Their owners fixed the implementations. The harness requires the VALIDATE receipt hash to exactly match the next canonical snapshot and passes that same hash to PUBLISH. It does not replace mismatched hashes or retry away conflicts.

The independent media chain performs real TLS signed PUT with checksum binding, source inspection, source rights approval, actual durable image worker processing, separate master rights approval, seven-language metadata review, version-two metadata publication, public safe-media selection, and real TLS GET of the selected derivative with checksum/geometry/metadata verification. Byte retrieval uses the same derivative object's private read grant; the public media host is a synthetic fixture origin, so this does not prove a deployed production CDN.

No production administrator login, OIDC/session issuance, real CloudFront credentials, browser management UI or production release is enabled. The local purge provider implements the provider port over real HTTP, including PENDING/COMPLETED/failure and cache invalidation, while production CloudFront behavior remains separately scoped to its existing adapter evidence. Raw session credentials, upload/download grants and S3 credentials stay in memory or the protected ephemeral runner configuration and are not written to diagnostic logs.

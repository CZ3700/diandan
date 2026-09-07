# Public GET revalidation — independent implementation review

2026-09-07, reviewer `/root/storefront_read`; route author `/root/storefront_directory`, shared response helper author root.

**ACCEPT for the actual route behavior.** Read all five changed route families and `public-revalidation-response.ts`: existing published content, gift classification content, homepage aggregate, scoped commerce/context and artist/gift directory.

Every success parses the complete response and verifies its request identity/locale/market/currency/recipient before calling the helper. Gift directory additionally binds page/size/exact item cardinality and rejects duplicate IDs; artist directory checks window size, ID uniqueness and current locale. The ETag includes canonical resource/query plus the whole current response, so empty responses for different valid queries do not share a validator. The helper runs only after a fresh use case read. Failed proof, thrown infrastructure errors and malformed DTOs cannot return an old 304; failures remove ETag and use no-store. Cookie or Authorization requests always use private, no-store without ETag/304, including failures in these five families. onSend retains security headers without overwriting successful zero-TTL headers.

Independent targeted command: `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api exec vitest run --config ../../vitest.config.ts --root . src/public-get-revalidation.test.ts src/public-revalidation-response.test.ts src/published-content-route.test.ts --maxWorkers=2` — 3 files / 24 tests PASS, 876 ms. Evidence: `public-get-independent-tests.log`. No heavy runtime was started by this review. The other author's actual PostgreSQL/HTTP evidence is separate.

Review found one actionable documentation gap: the five old OpenAPI path definitions still declared 200 no-store and omitted 304. Root assigned this reviewer the minimal documentation correction. Thus the following documentation changes are author implementation, **not an independent self-approval**; directory agent supplies the separate review.

# OpenAPI documentation correction

Only HTTP documentation changes: optional If-None-Match header; anonymous success zero-TTL with ETag; credentialed 200 private,no-store without ETag; 304 anonymous zero-TTL with no body; existing public failure variants no-store/private,no-store without ETag. The existing SEO definition also shares the 200/304/failure declarations after root separately made its credentialed failures private,no-store (anonymous failures remain no-store). All 18 private publication/commerce operations retain their existing private,no-store headers, required Origin/idempotency/session rules and body schemas. No request/query business schema, response JSON schema/ref, registry, generated artifact or public contract root was edited here.

An internal `public-revalidation-openapi.ts` shares these documentation declarations without package-index exports or a new schema root. The eleven old public read operations intentionally change their HTTP documentation; **do not claim old operations are byte-identical**. Root separately verifies all old 378 business roots and regenerates artifacts.

Test first: `public-openapi-revalidation-red.log` proves missing public conditional declarations. GREEN: six targeted files / eight tests in `public-openapi-revalidation-all-green.log`; contracts typecheck, owned ESLint and Prettier passed in `public-openapi-revalidation-{types,lint,format}.log`. Tests retain private body/authority checks and validate public 200/304/error cache classes, empty 304 body, unchanged response body reference and optional header placement. No timeout, assertion or business proof gate was weakened.

# Public revalidation OpenAPI — independent review

Reviewer: storefront_directory; author: storefront_read, with root owning the response helper and SEO route. **ACCEPT** for the current source declarations.

The five existing OpenAPI factories document all eleven existing public GET operations with optional `If-None-Match` only in the HTTP header. Existing body/query/path contracts and success/failure component references remain unchanged. Anonymous successful 200 responses document exact zero-TTL mandatory revalidation, while credential-bearing 200 documents private/no-store and absent ETag. 304 is bodyless, anonymous only, with exact zero-TTL headers and the weak hash validator. Failures never document ETag or 304 and allow anonymous no-store versus credential-bearing private/no-store. Existing private POST status sets, body references, security declarations and private/no-store headers remain intact; no private POST acquires a 304 response.

The internal documentation helper is not exported through the package index and is not registered as a business artifact/schema root. It does not alter any request/response operation schema. Root owns artifact regeneration and the final exact comparison of legacy business roots; those generated-output checks are not claimed by this source review.

Independent command: `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/contracts test src/public-revalidation-openapi.test.ts src/publication-runtime-openapi.test.ts src/gift-commerce-openapi.test.ts src/storefront-homepage-openapi.test.ts src/storefront-commerce-openapi.test.ts src/storefront-seo-openapi.test.ts` — exit 0, six files/eight tests PASS, `public-openapi-directory-independent.log`.

After that run, the author reported root's additional SEO credential-failure privacy fix. The reviewer directly re-read the current `storefront-seo-route.ts` failure function and `storefront-seo-openapi.ts`: both now use anonymous no-store and credential-bearing private/no-store, with no ETag. This latest source alignment is accepted; the author separately retains its targeted RED/GREEN evidence. No source or generated artifact was changed by this reviewer.

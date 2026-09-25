# P3-04 non-author review by storefront_directory

## Review scope

Read-only review of root's Storefront server reader, page factory, home and artist content, shell/navigation, media and CSS, proxy and locale layouts; followed by the `storefront_read` agent's new homepage contracts, Content projection, Application, persistence port/PostgreSQL repository, HTTP route and production/TEST composition wiring.

No root-owned or backend source was edited by this reviewer.

## Frontend findings delivered to root

1. Homepage initially had only a static featured grid, so it did not meet the explicitly required homepage search/continuous track. Root accepted adding the actual directory while retaining published featured slots.
2. The first server reader accepted a schema-valid response for another requested locale. The transport owner is adding request/response locale checks; this must be independently verified after its final patch.
3. Homepage metadata initially checked only the homepage object's fallback flag, omitting artist/gift slots. Root accepted checking every rendered object. This is defensive behavior, not proof of actual runtime fallback support.
4. Artist `fullBio` permits a restricted rich-text grammar. The first renderer escaped valid tags as visible text. Root accepted a controlled renderer and tests.
5. All temporary unavailable routes initially marked order lookup as current navigation. Root accepted correcting active-state ownership.
6. The site-name environment input needs the normal configuration/docs/sample boundary, beyond being set only by the browser fixture.
7. Published homepage `POLICY_LINK` slots/labels need to reach the shell/footer. The policy body implementation may follow P3-05, but published link editing must not silently have no effect.
8. Object-level English `lang` containers initially enclosed current-locale UI copy and, on the homepage, independently localized hero-artist content. Root accepted narrowing language scopes.

The final visual composition also needs actual browser review: the initial desktop hero placed a wide published composition in a tall half-screen frame, while the initial mobile hero cropped its independent 4:5 composition into 40svh. Header overlay behavior should be checked against the approved visual and specification rather than assumed from static CSS.

## Backend source review conclusion

No new high-priority transaction, object substitution, publication-proof, rights or privacy defect was found in the new homepage chain as read.

- Public contracts bind the exact published slot order, stable key, kind, referenced identity, available object identity and requested locale. A required hero must be available; unknown fields are rejected.
- Application owns one transaction and checks request locale before projection. PostgreSQL is the only content source.
- PostgreSQL reads bounded references from the current published homepage, batches stable identity-to-handle discovery, caches duplicate object hydration within the transaction, and uses the existing SERIALIZABLE transaction runner.
- Every available child uses the existing published-content loader/projection and its immutable publication/manifest, current media-rights and gift-profile checks. This implementation does not bypass older publication gates.
- Public DTOs omit canonical source, review records, internal media object keys and rights records. Errors are bounded and public HTTP responses do not cache viewer state.
- Production and explicit TEST compositions use the same homepage use case and persistence port; lifecycle cleanup remains attached to the existing persistence owner.

The source review does not replace real PostgreSQL/HTTP evidence for optional unavailable references, duplicate-reference hydration, paused/archived artists, changed handles/publication heads or maximum configured references and performance. The backend author and E2E owner were notified of these coverage requirements.

## Fallback limitation

The current new homepage route and pre-existing published-content route explicitly reject successful fallback DTOs; the existing proof projection creates `fallbackUsed=false`. Therefore a working frontend fallback branch or synthetic fallback snapshot does not prove a reachable real API fallback. Root was advised to preserve the strict proof checks and either implement a separately justified safe presentation fallback or retain this as an explicit P3-05 boundary. Revoked rights, invalid manifests or missing proof must never be converted into a permissive English fallback.

## Directory cleanup

Within this reviewer's previously assigned directory files only, the code-simplifier skill was applied to remove nested state-message and keyboard-index ternaries. Public interfaces, user-visible output and request timing remain unchanged. Scoped Prettier and ESLint passed; the three dedicated test files passed all 11 tests (`directory-simplifier-green.log`). The directory's actual browser acceptance remains owned by root/E2E, not its author.

Overall: backend source review acceptable with the evidence boundary above. Frontend findings await the root's final patches and combined browser verification; this document does not mark P3-04 DONE.

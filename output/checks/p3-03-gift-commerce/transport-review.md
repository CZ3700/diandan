# Gift commerce transport review

Status: implementation review accepted and the final combined HTTP/browser workflow passed. Whole-repository acceptance is recorded by the coordinating task.

## Independent review

Carver independently reviewed the new Application orchestration, content authorization, receipt validation and PostgreSQL authorization modules. ACCEPT: every command verifies the current session, MFA and permission before the idempotency lookup; content changes additionally compute the real affected locale scope from the canonical source. Replay remains actor-bound, exact source strings are not Unicode-normalized, and business/receipt/idempotency failures throw through the transaction boundary. PostgreSQL serialization failures remain explicit conflicts.

As a non-author, the transport implementer reviewed the additive public gift classification contract, Application, projector, PostgreSQL loader and public route written by root, plus Carver's profile helper. ACCEPT: classification binds the current publication, revision and unchanged manifest; new profile-version 2 records require the exact publication/profile proof, and legacy is accepted only from the explicit historical revision marker or a pinned pre-0020 integration schema. Ordinary public content validation still checks the real publication and media proof. The public response contains the safe gift view and classification, without private authorship, storage keys, sessions or preview capabilities. Route query validation requires the single explicit locale and exact handle; failure responses keep private transport metadata out.

Carver also independently accepted the final two-line Application time fix and three regression tests. The content authorization calls still execute before idempotency, including current permission, actual locale scope and exact actor/session/expiry checks. The original commerce principal supplies the stable persistence timestamp. The real App-to-PostgreSQL probe changes only the returned authorization time observation; it does not alter authorization predicates, constraints or the system clock.

## Self-review

The private route injects action and request identity, accepts only the fixed endpoint body, requires Origin/JSON/CSRF and a current opaque session cookie, and extracts mutation idempotency solely from its header. BFF routing uses an explicit 13-operation map and strict request/response schemas. No production administration is implicitly installed. The new TEST composition owns and closes its PostgreSQL pool exactly once, including construction failure; adapter-specific storage information does not enter the Application contract.

Code-simplifier review retained the existing architecture and extracted content scope/response validation from the orchestration. New application action selection uses explicit switches. The new integration scenario reuses the existing workspace fixture, TLS storage, media worker, publication worker and Next startup through four optional hooks; the old entry point is preserved by a direct-execution guard.

## S.U.P.E.R review

1–2. Production modules each own orchestration, content scope, result validation, authorization, HTTP projection or TEST composition. Integration modules own the fixture scenario, browser scenario and executable launcher.
3–4. Dependencies remain Route/BFF → Application → Domain/Port → PostgreSQL. The domain tests use no external service.
5–6. All new request, response, authorization, receipt and repository boundaries use serializable versioned schemas. Raw browser credentials are reduced to digests before persistence.
7–8. Production dependencies/origins are injected; synthetic fixture identities, market configuration and local URLs are confined to test modules. The browser harness declares its i18n dependency and imports the public package entry. 9. Repositories and current authorization remain injected ports. Replacing persistence does not require changing domain or transport semantics. 10. The 68 affected unit tests and six affected package typechecks pass. The final full UI workflow passed 1703 assertions with 512 setup API requests; all 18 screenshots and accessibility JSON correspond to that successful run. The coordinating task owns the separate whole-repository gate and release status.

## Limits

This is local development with explicit TEST identities, an ephemeral PostgreSQL database, local TLS S3-compatible storage and a real Next development server. It proves operational catalog offers and configuration changes, not a checkout reservation, payment, real stockroom operation, production SSO or production release. Interface translations still require human approval. All 18 screenshots now come from the final successful run and show synthetic artist/gift data only. The 200% evidence is explicitly equivalent CSS reflow, not native zoom; axe covers four English screens and is separate from the seven-language layout captures.

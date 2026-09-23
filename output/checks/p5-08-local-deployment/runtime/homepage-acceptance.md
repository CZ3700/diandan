# P5-08 local homepage and strict media acceptance

Scope: LOCAL_TEST only. No production gates, contracts, migrations, current homepage publication, or existing media heads were relaxed or overwritten.

The first homepage now uses two independent TEST canvases built from the repository's fictional artwork. A separate outer matte preserves every decoded source photograph pixel. The independent desktop/mobile original checksums pass actual signed S3 upload, source inspection, normal authoring, seven-language independent review, the generic media Worker, rights approval, master metadata publication, and the strict homepage publication gate. Earlier incomplete fixture assets and revision identities remain in local bootstrap history.

The current running `test-p508` instance has two matching original-to-master PG chains with `SUCCEEDED` jobs and two `proof_version=2` master publication records. All seven actual homepage HTTP responses return successful available heroes. Reopening keeps the existing homepage head byte for byte.

## Validation

- `mise exec node@24.20.0 -- node --test apps/api/scripts/local-experience-homepage*.test.mjs`: 10/10 PASS. New independent-original test initially failed before implementation, then passed.
- `mise exec node@24.20.0 -- corepack pnpm exec eslint apps/api/scripts/local-experience-homepage*.mjs apps/api/scripts/local-experience-worker.mjs`: PASS.
- `mise exec node@24.20.0 -- corepack pnpm exec prettier --check apps/api/scripts/local-experience-homepage*.mjs apps/api/scripts/local-experience-worker.mjs`: PASS.
- `NODE_EXTRA_CA_CERTS="$PWD/node_modules/.cache/fan-support-local-experience/test-p508/tls/ca.crt" mise exec node@24.20.0 -- node apps/api/scripts/local-experience-homepage-integration.mjs test-p508`: 23 assertions PASS; actual PG/HTTP/S3 and Worker provenance, seven locales, independent review, temporary-session cleanup, existing-head preservation.
- `mise exec node@24.20.0 -- node apps/api/scripts/local-experience-homepage-recovery.mjs test-p508`: first execution 8 assertions PASS; reopen 5 assertions PASS. The first execution simulated loss after an actual HTTP author commit and after the third actual locale approval. PG receipt recovery recovered the same revision and completed all seven approvals without duplicating it. Temporary sessions were revoked after both injected failures. This creates only an unpublished TEST source metadata revision and leaves all published homepage/media heads unchanged.

Detailed safe outputs: `homepage-unit.txt`, `homepage-http.txt`, `homepage-recovery.txt`. The recovery script records its own resumable TEST state in `local_experience.homepage_recovery`; a completed run verifies it without creating new revisions.

## Review boundaries

Each new module has one responsibility; dependency flow stays in the local composition/verification layer and uses existing application APIs. Persistent plan/recovery shapes use strict Zod schemas, are serializable and store no session credentials. No new package dependency or production configuration is introduced. The Worker uses the existing generic media processing composition with the same actual PG and S3 configuration. Swappable TEST configuration and owned cleanup remain outside domain code. Local affected checks pass; combined repository gates and process restart/browser acceptance are the root executor's separate checks.

These results do not establish real cloud object storage, staging, formal rights or translation approval, merchant sandbox, or production readiness. P5-08 remains IN_PROGRESS for external acceptance.

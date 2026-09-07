# Storefront copy approval gate

Bounded owner: `/root/storefront_directory`, under root's P3-04 task.

## Behavior

`loadStorefrontCopy(locale, { requireApproved: true })` verifies both the English source and requested locale before returning the requested copy. Each review must have schema version 1, namespace `storefront`, its exact locale, `APPROVED` status, a nonblank reviewer, and a full lowercase 40-hex Git commit. The loader recomputes SHA-256 over UTF-8 `JSON.stringify(actualCopy)`, requiring each source hash to match the current English dictionary and each translation hash to match the actual requested dictionary. The English record must match current English bytes in both hash fields.

Changed English text invalidates every dependent translation review. Changed translated text invalidates that locale's review. Merely changing status or retaining an old hash cannot approve changed bytes.

The option defaults to false for existing local/TEST callers. Root owns passing `requireApproved` at every production page, metadata and route-state boundary. Current records remain DRAFT with null reviewer and commit; no human approval or translation bytes were invented or changed.

Only the requested dictionary and, when needed for approval, the English source dictionary are imported. Web Crypto performs runtime hashing, avoiding a Node-only crypto dependency in the shared i18n entry point. Tests use an independent Node SHA-256 calculation as an oracle.

## Verification

All commands use `mise exec node@24.20.0 -- corepack pnpm`.

- `--filter @fan-support/i18n test`: `copy-review-red.log`, exit 1, 17 expected approval/changed-byte failures before implementation.
- Same command after implementation: `copy-review-green.log`, exit 0, all 4 files / 25 tests pass. This includes all seven real DRAFT manifests, successful synthetic approved records, approval/status/reviewer/commit/locale/namespace/schema/hash mismatches, and actual English/Japanese byte changes with unchanged review hashes.
- `--filter @fan-support/i18n typecheck`: `copy-review-typecheck.log`, exit 0.
- `--filter @fan-support/i18n build`: `copy-review-build.log`, exit 0.
- Scoped Prettier and ESLint passed (`copy-review-lint.log`).

Synthetic approved test records are fixtures only. Commit/reviewer strings in source evidence remain operational review attestations; this gate checks their structure and exact content binding, not remote Git existence, account identity or a cryptographic signature. Human review and release provenance remain separate production requirements.

The separate directory CSS cleanup replaced only available border, focus, body text, underline, stacking and spacing tokens, preserving the track geometry. Scoped Prettier and diff checks passed; root/E2E own final rendered verification.

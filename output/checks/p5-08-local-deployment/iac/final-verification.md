# P5-08 IaC local verification

Scope: reusable ADR-007 AWS definitions and guarded offline checks only. No AWS CLI/API/account read, live cloud plan/apply, cloud credentials, pushed images, remote state, real funds, staging or production deployment was performed. `cloudEvidence=false` throughout. P5-08 cannot become DONE from this evidence.

## Delivered

- Three roots: protected state bootstrap; four immutable ECR repositories established before pushing image digests; reusable staging/production stack composing network/data/media/compute/edge/operations modules.
- At least two supported AZ IDs (current CloudFront exclusion `use1-az3` is rejected); private applications/internal HTTPS ALB/VPC origin; isolated private Multi-AZ PostgreSQL, managed master secret reference, TLS/KMS/35-day PITR and encrypted cross-region automated backups.
- Four digest-pinned Fargate services with two tasks each, no Worker inbound load balancer, per-app task/execution IAM and secrets ARN references; scoped OIDC release role, protection against mutable images/plaintext secret inputs/wildcard KMS grants.
- Two private versioned encrypted S3 buckets with derivative-only OAC; immutable upload headers/CORS; no-store dynamic and error paths, host-isolated Next static cache, canonical aliases, ACM/Route53 and WAF count-before-block.
- Encrypted CloudWatch/SNS, service/ALB/RDS/Fargate usage alarms, account budget and anomaly notifications. Reference-only schemaVersion 1 manifest and cloud handoff runbook.

## Current validation

`node scripts/check-infrastructure.mjs --tofu /Users/mario/Desktop/下单/output/checks/p5-08-local-deployment/iac/toolchain/tofu` → exit 0, **PASS**, 21 copied and hashed inputs. `offline-results.json` records every exact command/exit and input SHA256. Three isolated backend-disabled inits, three validates, formatting, and 10 explicit non-refreshing mock plans passed (bootstrap 1, registry 1, stack 8). `14-stack-test.txt` includes staging, production/WAF enforcement and six rejected-input scenarios. No real cloud plan is represented by these mock plans.

`node --test scripts/check-infrastructure.test.mjs` → 5 tests passed. RED before implementation is preserved in `checker-red.txt`; final `checker-green.txt` covers forbidden command options, implicit apply/live providers/unmapped aliases, malformed manifests, inherited cloud/CLI environment, executable/dynamic provider sources.

`corepack pnpm exec eslint scripts/check-infrastructure.mjs scripts/check-infrastructure.test.mjs --max-warnings=0` → exit 0. Targeted Prettier check and `git diff --check` pass. Root owns the combined workspace typecheck/build/integration/secret/history gates; this subtask did not run or claim them.

`source-manifest.json` and `authored-files.txt` list all owned source/doc files and their SHA256. The OpenTofu archive SHA256 is locked in `infra/opentofu/toolchain.json`; installed provider 6.66.0 was verified by OpenTofu with developer signature key ID `0C0AF313E5FD9F80`. `.terraform.lock.hcl` files contain signed provider package hashes.

## Independent review corrections

Root identified three compatibility faults. `review-regressions-red.txt` demonstrates the prior failures; `review-regressions-green.txt` and the final full entrypoint demonstrate their correction:

1. ALB now forwards only `/api/v1/*` to Nest, leaving `/api/admin/session`, `/api/cart` and other Next BFF paths on the proper frontends. Existing BFFs append `/api/v1/...` to the internal API origin.
2. Source CORS permits `if-none-match` and `x-amz-checksum-sha256`, matching immutable `PutObject` grants in the actual S3 adapter.
3. Envelope IAM includes `GenerateDataKeyWithoutPlaintext` plus `GenerateDataKey/Decrypt`; independent HMAC references only grant `GenerateMac`, matching the actual KMS adapter. It does not call VerifyMac, so no unused permission was added. Wildcard/other-account/other-region key grants and frontend envelope/HMAC grants are rejected.

Initial fmt/mock-shape failures remain in historical logs (`fmt-initial`, `test-initial`, `test-second`); they are not accepted results. The provider cache only speeds repeat init; read-only provider locks still verify it. No provider binaries, downloaded archives, `.terraform`, tfvars, state or secret values belong in Git.

## S.U.P.E.R (owned scope)

1. Each root/module/checker has one responsibility: PASS.
2. Resource composition and small guard functions remain separated: PASS.
3. Inputs → typed modules → serializable outputs; no application/domain import: PASS.
4. Real validate/mock plan resolve the complete graph without cycles: PASS.
5. Typed HCL inputs and versioned deployment JSON Schema: PASS.
6. Outputs contain serializable references, never secrets: PASS.
7. Business domains/accounts/images/secret references supplied explicitly; only accepted ADR regions and AWS protocol/port requirements fixed: PASS.
8. Exact OpenTofu/provider versions, release archive checksum and provider locks: PASS.
9. Each AWS module is replaced behind explicit inputs/outputs; no business contracts changed: PASS.
10. Owned affected checks above pass; combined repository verification remains root's gate: PASS within scope.

## Remaining cloud gates

Formal account/DNS/cost/identity/merchant/mail choices and cloud authorization; bootstrap local-state protection/migration/concurrent lock verification; initial registry creation and actual digest push; production business composition (not TEST/LOCAL substitutes); actual RDS engine/CA/DB-role compatibility, service/worker smoke and cross-AZ placement; presign/checksum/CORS/OAC/origin protection/cache/purge≤60s; real IAM/KMS/secret rotation/WAF webhook/callback behavior; notification subscription confirmation and alert delivery, account monitor ownership/import, price/quotas; clean staging real plan/apply/smoke/re-apply; P6 restore/RPO/RTO and rollback; P7 PSP/UAT/gray release. Nonroot containers use ephemeral writable root for current image cache/tmp compatibility; read-only hardening requires a separately verified image/volume contract. Public dynamic CDN caching is deliberately disabled until real locale/market/currency cache-isolation evidence exists.

Runbook and verified primary-source references: `docs/runbooks/infrastructure-offline.md`.

Public `.txt` copies preserve the selected original command output; only trailing whitespace or extra empty EOF lines are normalized where needed for the Git whitespace gate. `../root/transcript-normalization.json` records original and normalized hashes. Raw logs and generated provider/tool binaries remain outside the commit.

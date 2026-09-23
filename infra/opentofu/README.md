# ADR-007 AWS infrastructure

Read [the offline runbook](../../docs/runbooks/infrastructure-offline.md) before changing or using this directory. Current authorization is local validation only.

`bootstrap` creates state protection; `registry` creates immutable ECR foundations before image publishing; `stack` composes six reusable AWS modules for staging/production. They have separate state keys. No secret values, cloud state, account credentials, external modules or executable provisioners belong here.

Run `node scripts/check-infrastructure.mjs --tofu /absolute/path/to/tofu` from the repository root. This verifies the pinned toolchain and runs only isolated backend-disabled validation and mocked, non-refreshing plans. Static-only checks report `STATIC_ONLY`, never deployment acceptance. Real plan/apply, production composition, staging smoke/re-apply, actual IAM/KMS/WAF/alert/restore evidence and release approval remain separate gates.

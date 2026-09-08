# Resource HTTP small-image negative fixture

Only two lines changed in `apps/api/scripts/resource-management-http.mjs`: the small-image job now explicitly requests `fit: "COVER"`, and its assertion label names that mode. The shared successful large-image command remains CONTAIN. No production code, image dimensions, processing guard, expected failure code, retry behavior or historical-evidence assertion changed.

## Actual failure and interpretation

Full-check attempt 4 failed at resource request 153. An independent unmodified run reproduced the same failure (`resource-small-contain-red.log`, exit 1): the fixture expected the small image to fail with `SOURCE_TOO_SMALL`.

The fixture is a valid 50×40 JPEG with EXIF orientation 6. It inherited CONTAIN from the shared enqueue command. The current framing behavior intentionally preserves small CONTAIN images at their original pixel size, centered on the fixed neutral canvas; the existing domain and real-pixel pipeline tests cover this behavior. Therefore this input no longer satisfies the original negative scenario's premise.

COVER still requires filling the fixed role canvas without enlarging source pixels. Explicit COVER preserves the original test intent: an undersized image must fail safely with `SOURCE_TOO_SMALL`. The existing manual-retry successor generation, duplicate-retry conflict, old failed-job immutability, privacy and no-publication assertions remain unchanged. A bounded scan of API/package script negative cases found no other matching inherited-CONTAIN small-image failure expectation.

## Verification

```sh
mise exec node@24.20.0 -- node apps/api/scripts/resource-management-http.mjs
mise exec node@24.20.0 -- corepack pnpm exec prettier --check apps/api/scripts/resource-management-http.mjs
mise exec node@24.20.0 -- corepack pnpm exec eslint apps/api/scripts/resource-management-http.mjs
```

The complete corrected harness exited 0: **1,798 assertions / 159 HTTP requests** (`resource-small-cover-green.log`). This actually exercised fresh PostgreSQL, S3-compatible storage, Chromium automatic OPTIONS/PUT, denied-origin object absence, strict Node TLS, private source inspection, seven-language review, image processing, concurrent rights changes, audit rollback and retry history. No Next process or production service was started. The harness completed its owned worker/API/browser cleanup normally.

Scoped formatting, lint and diff-whitespace checks passed (`resource-small-cover-format.log`, `resource-small-cover-lint.log`). Final source SHA-256: `58b84ccd3085b789a1c68e83f1f9601a5455a5636f0744035fe708b5453830c6`.

The original full-check failure and independent RED remain preserved. This is a local TEST fixture compatibility correction; final full repository verification and production acceptance remain separate root-owned results.

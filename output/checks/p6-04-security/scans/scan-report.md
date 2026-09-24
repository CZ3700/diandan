# P6-04 scanner evidence — baseline and bounded triage

Recorded 2026-09-24, branch `codex/p6-04-security`, baseline `e65c9ffde4e9651c7c3b6e86df6426db05fbf410`. This is a local source/dependency scan report, not a production security sign-off. Source snapshot inventory and SHA256 are in `source-baseline-manifest.json`. Later root-owned fixes require the final refresh recorded separately.

## Observed results

| Check | Actual result | Evidence |
| --- | --- | --- |
| Existing `corepack pnpm audit --registry=https://registry.npmjs.org --audit-level=high --json` | Node 24.20.0 / pnpm 11.25.0; exit 0; 628 dependencies; all reported severities 0. Official Next.js advisory independently contradicts a blanket clean-dependency claim. | `pnpm-audit-baseline*.json`, stderr TXT |
| Original `corepack pnpm security:secrets` | Original scanner/policy unchanged; exit 0, 63.65 seconds. Repository tree and tracked boundary checks ran. No secret finding or value displayed. | `secret-scan-baseline-command.json`, `secret-scan-baseline-log.txt` |
| Semgrep 1.157.0 OSS | Valid run 3: 2,530 source files plus owned `.semgrepignore`; 494 selected security rules, engine reports 482 run; 130 candidates: 4 ERROR, 113 WARNING, 13 INFO. 11 partial-parsing errors covering 15 unique line positions; engine reports approximately 99.9% parsed lines. | `semgrep-run-3*.json`, `semgrep-run-3-log.txt`, `semgrep-coverage.json` |
| TEST mail GCM tag reproducer | Node 24.20.0 accepts correct tag prefixes of 4/8/12/15 bytes in the original helper; no service or database touched. | `gcm-local-mail-reproduction.json` |
| TEST mail GCM fix | Four new rejection cases fail on original implementation; only decryption adds `{ authTagLength: 16 }`. Nine affected tests then pass including 16-byte format, altered IV/tag/ciphertext rejection, other identity/key rejection, and existing mail-reading regression. | `gcm-tag-test-red*`, `gcm-tag-test-green*` |

Semgrep ERROR/WARNING are rule levels, not CVSS High/Critical. None of the matched rule metadata declares High/Critical impact, but that alone does not prove the application has no High/Critical vulnerability. Candidate disposition and independent application review must be combined. The raw 130 findings remain intact.

## Dependency advisory reconciliation

Official [Next.js security release](https://nextjs.org/blog/nextjs-security-update-september-22-2026) and [GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) identify a Critical, CVSS 9.5 issue in `next >=16.2.0 <16.3.6`. Baseline admin/storefront lock 16.3.4. The triggering surface is Node `ImageResponse` from `next/og`, with attacker-controlled values in generated SVG. No `ImageResponse`, `next/og`, or `satori` call site was found in the 2,530 selected technical sources. Existing storefront SEO metadata references published media URLs (`seo-metadata.ts:54–96`), rather than generating images. This is evidence against current source reachability, not a substitute for patching the affected dependency. Root owns the minimal patch and final regression. Official 16.3.6 package metadata is saved in `next-patched-release-metadata.json`.

The [September 23 advance notice](https://nextjs.org/blog/upcoming-nextjs-security-release-september-2026) plans a September 30 release (16.3.7/15.5.27) for one Critical, two High, five Medium and one Low issue. Details and affected ranges are not published at this check time. They cannot be classified as absent, fixed, or reachable from the advance notice; re-evaluate when published and before deployment. No unpublished version is installed by this agent. Full baseline assessment: `next-official-advisory-assessment.json`.

## Privacy, provenance and reproducibility

- No application code uploaded; no login, Semgrep CI/cloud service, remote target scan or secret validation endpoint used. `--metrics=off`, `--disable-version-check`, isolated `SEMGREP_SETTINGS_FILE` and `SEMGREP_LOG_FILE` were used. The final verbose log confirms registry usage false/login false/metrics off. Official [metrics documentation](https://docs.semgrep.dev/metrics) was checked.
- Official public rules downloaded from `https://github.com/semgrep/semgrep-rules` commit `a84ff9cc2453ca91d581380de4b8b3f272f6f4be`; archive SHA and URL in `rules-download.json`. Selected only `metadata.category: security` from javascript/typescript/dockerfile/terraform/yaml, excluding rule repository `.test.yaml` fixtures. Rule bodies unchanged, IDs prefixed by upstream file path to avoid collisions. `rules-manifest-v2.json` records every rule, original ID/path/SHA, metadata and combined config hash.
- Installed Pro engine was explicitly checked and missing (exit 2); no license/config read or installation attempted. OSS has no cross-file taint proof. Scanner binary and original secret-scanner/config hashes: `tool-versions.json`.
- Target is an isolated byte copy of Git-tracked selected technical files under apps/packages/scripts/infra/.github/database/provider-fixtures; includes application test sources. Build output, dependencies, private `.env` and user settings, symlinks, media, Git history, untracked source and non-selected root configs are outside this SAST scope. Existing secret scanner uses its original independent policy, rather than this SAST scope.
- Rule download and runtime/source copies live under `node_modules/.cache/p6-04-security-tools`; no tracked dependency or suppression was added. Evidence uses JSON/MD/TXT. User persistent service, database and private configuration were not touched.
- To reproduce, obtain Semgrep 1.157.0, fetch the exact official commit, select security rules from the five named folders excluding `.test.yaml`, preserve each rule body and assign the recorded prefixed ID, and match `rules-manifest-v2.json` SHA. Copy exactly `source-baseline-manifest.json` inputs, write an empty-comment `.semgrepignore`, then run the full command in `semgrep-run-3-command.json` with its explicit project root and isolated settings. Do not treat paths under node_modules as automatically scanned without checking nonzero actual targets.

## Preserved tool failures and limits

1. Initial auxiliary Python selection attempted PyYAML, which is absent from the installed Semgrep environment. Selection then used the repository's existing YAML parser; no package was installed.
2. First YAML selection attempted a single document on upstream multi-document rule test data. Corrected parsing to all documents. The initial helper process used default Node 26; all actual pnpm audit/secret and GCM regression commands use pinned Node 24.20.0.
3. First Semgrep invocation (`semgrep-baseline-command.json`) exited 7 before scanning: selection included 25 intentionally malformed upstream rule-test entries. Failure log preserved; valid selection excludes rule tests, not application tests.
4. Second invocation exited 0 but scanned zero targets because project-root discovery inherited the repository node_modules exclusion. `semgrep-run-2` is INVALID_ZERO_TARGETS, never accepted. Third invocation fixes only target root discovery using documented `--project-root`.
5. Valid run still has partial parsing. CI line 62 uses GitHub's `${{ matrix.suite }}` syntax, which the two embedded Bash patterns cannot parse. `packages/persistence-port/src/index.ts` affected lines are type-only re-exports, manually inspected. Remaining affected lines are JSX test literals containing ampersand query parameters. Those exact spans are not claimed as AST-scanned; locations are preserved in `semgrep-coverage.json`.
6. First direct ESLint attempt after the GCM fix exited 2 because root's concurrent dependency update temporarily removed `@next/eslint-plugin-next`. Formatting passed. That attempt is not a successful lint result; final lint/recheck is recorded later. See `gcm-format-lint-initial.json`.

No automatic dependency upgrade, autofix, cloud apply, service restart, Git push, or scanner-policy weakening was performed by this scan worker. The two TEST mail files were subsequently changed only after root explicitly delegated the proven tag-length fix.

## Post-install mail validation refresh

After the parent completed the official frozen dependency install, the affected TEST mail files passed ESLint and Prettier under Node 24.20.0. The local-experience-services and regression-journey-state suites passed all 9 tests. See `gcm-final-checks.json` and `gcm-final-check-{1,2,3}-log.txt`; the earlier installation-window ESLint failure remains retained above.

## Frozen-source final refresh

The completed current-source results, exact coverage, manually inspected parse locations and residual deployment gates are in `scan-final-report.md` and `final-scan-summary.json`. Baseline evidence above remains unchanged.

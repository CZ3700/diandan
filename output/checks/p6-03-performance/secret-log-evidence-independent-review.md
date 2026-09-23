# Inherited tracked-log gate — independent review

Reviewer: `/root/performance_catalog_audit`. Decision: **ACCEPT the proposed four-file evidence representation repair, conditional on the unchanged original full secret scan passing afterwards.** This is not a secret-scan PASS. The original `secrets-final.txt` exit 1 remains valid failed evidence.

## Verified facts

The active HEAD and the four files' last modifying commit are `b7df340030dc6fff1912a4155f270b7765c7a9e6`. All four originals under `output/checks/p6-02-language-menu-fix/shared-ui/logs/` are regular, non-symlink 0644 files. Their worktree, index, HEAD and explicit `b7df3400` bytes are identical:

| Original | Bytes | SHA-256 |
| --- | ---: | --- |
| `build-storefront-closure.log` | 15341 | `02150f3c90d6944a1f9e59cb99af89b6a56aa61254a2632e43a74b1a0c0805cd` |
| `server-preview.log` | 292 | `db139e186ff37bfd5497b140376fa39d71bec3e63a9cc7611c19c020b28cd507` |
| `server-production.log` | 294 | `57cf31422b3a15c48740a098ab1371974c841998e294766f9c112d16bbf6ef80` |
| `server-staging.log` | 292 | `439e666e0c39c5cdb30131b3d4c3b2f421164d3d35f4c85884615a0aa0c4e894` |

The coordinator's prepared `.log.txt` files are byte-identical regular files, currently untracked, not ignored by Git, and absent from the original 8457-file protected-untracked inventory. The mirror creation therefore does not overwrite a protected user file. No original, index, policy, report or product source was edited by this reviewer.

`scripts/scan-secrets.mjs` refuses tracked paths with any segment ending `.log` before starting Secretlint. `.secretlintignore` excludes `*.log`, while the actual scanner invocation uses `--no-gitignore **/*`. The `.log.txt` mirrors match neither the generated-path refusal nor the `.log` exclusion; they enter the unchanged content scanner. Renaming the tracked representation to `.log.txt` therefore exposes the exact old log bytes to scanning rather than hiding them.

The four old names are referenced by the preserved `shared-ui-archive-manifest.json`. That manifest must remain unchanged. The new ledger supplements its historical meaning rather than reissuing or editing the old evidence.

## Minimal complete repair

Keep the existing original `.log` files at their old local paths. Remove only their Git index entries, add the four exact `.log.txt` mirrors, and add a new mapping ledger identifying old commit/path/blob or SHA, new path/SHA/size, unchanged bytes, and reference/reconstruction boundaries. Use exact paths and normal index safety checks, without force, broad resets, changing scanner rules or adding suppressions.

Fresh checkout will contain the scan-friendly mirrors. The ledger must state that historical path-based verification requires restoring the four original names from the verified mirrors, or obtaining them from the named old commit. Restoration should be explicit and non-overwriting; reconstructed `.log` files remain untracked/ignored. The repair must not claim that a fresh checkout already contains the original names.

Merely untracking the old files would lose current-checkout archival content; merely adding mirrors would leave the tracked-log refusal; changing the ignore/refusal policy would weaken the gate; rewriting old manifests would alter historical evidence. Under the stated preservation requirements, no smaller complete repair was found.

## Required closure

1. Verify staged changes are limited to the four path representations plus the new ledger; old `.log` working files and all old report/manifest bytes remain intact.
2. Re-run the **original full** `scan-secrets.mjs` entry point and retain a new PASS/FAIL log. The four-path refusal is not a finding that contents are secret-free; full content scanning remains mandatory.
3. Keep `secrets-final.txt` unchanged as the inherited gate failure. Attribute the repair to evidence packaging inherited from the previous commit, not to a business-source or scanner-rule change.
4. Include the ledger and final scan result in the final aggregate acceptance/protection evidence. Production executable source and the original 8457 protected untracked files must remain unaffected.

# P3-06 font cascade change — shared UI verification plan

Status: **PLAN ONLY, 2026-09-16.** `/root/order_bff` has not created a checkout, run a build, launched Chrome or executed a verification command for this step. Root owns the implementation commit and releases the exclusive browser window after final P3/cart/warm-font and quality checks. Font implementation and semantic coverage tests remain owned by the assigned agents; this reviewer will not change them.

## Why the original shared gates must be refreshed

The font profiles in `packages/design-tokens` affect all internal specimens as well as public storefront pages. P2-04 and P2-05 source fingerprints explicitly cover that package, so their old evidence cannot satisfy the current-source checks. P2-03 does not provide the same current-source fingerprint check, but its text layout, clipping, focus visibility and native-zoom evidence also depend on the changed font cascade; refresh its original browser matrix rather than claiming old screenshots prove the new source.

Read references: current `output/playwright/p2-03/README.md`, `p2-04/README.md`, `p2-05/README.md`; their original collectors; `docs/progress/phase-2-design-system.md`; `docs/plan/development-cadence.md`; and the earlier clean-checkout runbook at `output/checks/p3-06-performance-final/shared-ui/README.md`.

| Gate | Original command, run from the isolated checkout | Expected scope, not a result for this run |
| --- | --- | --- |
| P2-03 interactions | `mise exec node@24.20.0 -- node scripts/verify-ui-interactions-browser.mjs` | 13 scenarios, 15 PNG, 8 axe scans; keyboard/focus/ESC/scroll release, touch, RTL, reduced motion; six viewport baselines, 320px stress and native Chrome 200% zoom. |
| P2-04 composites | `mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs` | 16 scenarios, 18 PNG, 10 axe scans; six composites and loading/empty/error/image failure, long/multiscript text, breakpoints, native 200% zoom. |
| P2-05 motion | `mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs` | Eight locale scenarios plus motion-specific cases, 22 PNG, 3 axe scans, reduced-motion behavior, runtime font/CSSOM/computed-stack checks and optional display policy. |

All three retain preview fixture 200 and staging/production fixture 404 gates, with health 200. These are local standalone configuration checks, not actual staging or production deployments. Preserve non-blocking/incomplete axe findings in raw output; only report zero findings when the actual report supports it.

## Clean-checkout preparation after root releases execution

1. Obtain the exact final local implementation commit from root. Confirm it contains all new font generator, generated fallback CSS, profile imports, manifest/test/checker changes and cart hint code. Do not build from an earlier commit or copy pending source edits into the checkout.
2. Create a uniquely named detached checkout at that commit under a dedicated ignored `.turbo` location, following the previous runbook. Do not reuse a directory with existing files or alter the user's checkout. Record the commit and absolute checkout path in the outer evidence directory.
3. Use the pinned Node 24.20.0 and pnpm 11.25.0. Run `mise exec node@24.20.0 -- corepack pnpm install --offline --frozen-lockfile` there. If the offline store lacks an input, report the failed attempt; an ordinary frozen-lockfile install may be considered, without changing the lockfile. Do not symlink the original checkout's node_modules or copy its dist/.next artifacts.
4. Confirm `git status --porcelain=v1 --untracked-files=all` is empty after installation. Inspect the original runner prerequisites and installed Google Chrome version; use its existing isolated profile mechanism. Do not modify the user's normal Chrome profile.
5. Freeze this checkout for the whole collection. No source, documentation, test, manifest, HEAD or additional output-file changes while a collector runs. Keep wrapper logs, timestamps and result JSON outside the isolated checkout, under this turn's outer evidence directory.

## Required serial order and collector constraints

Run **P2-03 → P2-04 → P2-05**, with exclusive Chrome/build ownership and no concurrent Lighthouse, public-page browser test or font probe.

- P2-03 captures the full Git status and requires a clean committed checkout before and after collection. It ignores only its own temporary candidate during the ending check. New wrapper logs or unrelated report files inside the checkout can therefore invalidate an otherwise passing run.
- P2-03 deliberately deletes `apps/*/dist`, `packages/*/dist` and storefront `.next` in its checkout, then invokes a forced Turbo build of the complete Storefront dependency closure. This is why it must run in the dedicated checkout, and why it must precede the other two collectors.
- P2-04 and P2-05 build UI and Storefront themselves; in this sequence they inherit the correctly built dependency closure from P2-03. Their SHA, source input hashes/file lists, and normalized full Git status must match before and after. Outputs from already-completed earlier collectors can remain as stable pre-existing changes; do not rewrite them during a later collector.
- Do not weaken clean-state/fingerprint guards, change a timeout or remove an assertion to obtain a pass. A failure is recorded with its exact stage and original output before deciding whether a targeted correction/retry is justified.
- The collectors use installed Google Chrome and temporary profiles for native 200% page zoom. Viewport or CDP scale emulation must not be substituted for that native-zoom evidence.

## Final font source review checklist

Review the frozen final diff before acceptance; this list does not pre-approve an implementation still in progress.

1. For both Japanese and Simplified Chinese, original fallback faces advertise `original range minus exact current UI corpus`. The UI face advertises the full existing UI corpus. Their intersection is empty and their union exactly preserves the original supported coverage; no arbitrary per-page or first-screen sample may substitute for the complete corpus.
2. Each surviving fallback face retains its original relative order, font file identity/bytes and family/style/weight/display/format descriptors. Empty residual faces can be omitted; do not keep an empty/malformed unicode-range that the browser interprets as all Unicode.
3. Every non-UI codepoint still selects the same original source as before. Preserve overlapping fallback order where the original faces overlap; merely proving the combined union is insufficient. This protects freely entered artist names and gift descriptions outside the static UI dictionary.
4. Keep the existing subset WOFF2 and original Fontsource WOFF2 bytes, font metrics, variable axes, shaping features and licenses unchanged unless an explicitly reviewed regeneration requires otherwise. Generated CSS/manifest must be deterministic, repo-owned and free of absolute machine paths or remote runtime URLs. Clean installation/build must resolve its font URLs correctly.
5. Preserve `font-display: optional`, the existing profile/family names, language-to-profile mapping and Thai/Vietnamese/Latin coverage. No new locale-to-market coupling or locale-specific product behavior is introduced.
6. The new semantic coverage guard must detect overlap, dropped/extra UI characters, missing non-UI coverage, reordered original winners, altered font identities/descriptors and malformed ranges. Read its actual RED/GREEN evidence. Existing artifact/hash and corpus-drift checks remain effective; changing two old literal expectations alone does not prove the new behavior.
7. Root owns the two `check-design-foundations` constant changes and their RED/GREEN evidence. Review their final semantics against the generated cascade; do not overwrite them or add a competing implementation.
8. Inspect final warm-font browser evidence for actual rendered faces and representative UI plus non-UI content, not only `document.fonts.check()` or the static request model. Compare line wrapping, punctuation, mixed scripts and combining marks; retain the original font proof scope and do not claim every continuous weight/platform was exhaustively checked.
9. Compare fresh P3 observations using the same navigation/content/error validation and measurement conditions. A reduction in downloaded font resources is not itself an LCP pass; report measured results and any regressions, keeping failed samples.

## Evidence collection and import

- Capture command, UTC start/end, exit code, wall time, installed tool/browser versions and exact implementation commit per attempt. Keep failed logs and do not relabel a later successful retry as the first attempt.
- After successful collection, read each original `browser-results.json` and README. Verify reported scenario/axe/screenshot counts, production build and runtime-gate checks, P2-03 clean SHA proof, and P2-04/05 before/after fingerprint/file-list equality.
- Verify every listed screenshot hash and copy complete evidence directories to this turn's `shared-ui/imported-evidence/p2-0{3,4,5}`. Compare all copied files against their source hashes. Do not overwrite canonical `output/playwright/p2-*` in the main checkout; root owns archival and canonical import.
- Once collection ends, inspect the screenshots relevant to CJK and mixed-script layout, long text, 320px and zoom, including any changed wrapping or missing glyphs. Keep scope-specific raw axe findings intact.
- Confirm the runners have released their own Chrome profiles, child processes and loopback ports. Inspect owned resources only; do not terminate unrelated processes. Preserve the checkout until root accepts the imported evidence.
- Root then runs the original current-evidence static gates against the final source and imported evidence, plus the combined quality checks required for this checkpoint. Commit provenance and content fingerprints have distinct purposes; do not rewrite the captured implementation SHA to the later evidence-import commit.

## Explicit limits

No result is claimed by this plan. The old P2-03/04/05 timings and counts are reference scope, not fresh results. This desktop rerun provides no new physical-phone recording, human screen-reader/translation approval, field INP/RUM or production deployment evidence. Existing historical phone/visual approvals keep their original provenance and do not automatically certify changed font rendering. P3-06 remains subject to its outstanding performance and manual acceptance gates; Phase 5 remains locked.

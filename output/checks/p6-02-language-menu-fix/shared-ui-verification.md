# Shared UI interaction browser regression

Result: **PASS**. The unchanged original `pnpm verify:ui-interactions:browser` command exited **0** in a newly created source-only workspace. No root workspace build, original `output/playwright/p2-03` replacement, user-service operation, or user-data operation was performed.

## Reproduction and source

- Owned workspace: `/Users/mario/Desktop/.fan-support-regression/b9a86054-d232-45f1-9f60-f92be360ac09/workspace`.
- Source manifest: `shared-ui-source.json`, 2,868 files, executable source hash `34e9e6c36b8a286501a1ae4de55b54e39ce07786b307c52ef957c03ef5a5df1c`.
- Preparation used the repository's `readRegressionInventory` / `createRegressionWorkspace`, `regressionSuiteEnvironment` to remove ambient Git/business selectors, a Git commit only in this owned copy, and `pnpm install --offline --frozen-lockfile`. Commands/results are in `shared-ui-prepare-{0,1,2,3}.txt` and `shared-ui-preparation.json`.
- Root authorized browser execution only after its combined `check:dev` completed. Original command: `mise exec node@24.20.0 -- corepack pnpm verify:ui-interactions:browser`, with the same sanitized environment and the owned workspace as cwd. Full original stdout/stderr: `shared-ui-run.txt`; timestamps and exit code: `shared-ui-command.json`.
- Original runner clean-source check passed, HEAD `6a1a34918e04bd5e808823074ec7b526e5cabacd`. All 2,868 copied files still match their manifest; current root executable files still match the same manifest. Documentation updates in root are excluded from executable comparison as in the original workspace helper.

## Observed coverage

- **13 scenarios / 15 screenshots**, six baseline viewport sizes, seven public locales plus pseudo locale, narrow/RTL/reduced-motion/touch and keyboard coverage, dialog/drawer/menu/toast, and language-region isolation.
- Additional headed Chrome native **200% zoom** passed, with physical window stable at 1710×929, CSS viewport 1710×842 → 855×421, DPR 2 → 4; both screenshots are 3420×1684. Real HostZoomMap preferences were used; no device-metrics substitute.
- **8 axe scans; 0 blocking violations**. Accurately retained: **one moderate `region` finding** for the menu portal outside a landmark, plus **five incomplete results**. Their per-scan counts match the existing root P2-03 report. This is not a zero-findings or human-screen-reader acceptance claim.
- Preview fixture access is open as expected; staging/production configuration gates return fixture 404 while health stays 200. These are local configured runtime checks, not cloud staging or production deployment evidence.
- Native zoom confirms both body scroll locking and subsequent release, while document overflow remains visible. Dialog/menu focus return, traps, menu keys, and language item layout passed their original checks.
- Actual versions: Chrome 153.0.8010.53, Next 16.3.4, Node 24.20.0, Playwright 1.62.1, pnpm 11.25.0, React 19.2.8, axe 4.13.0.

The Thai open-menu screenshot and Portuguese native-200% screenshot were visually inspected: no clipped text, misplaced popup, or horizontal overflow was observed in these samples. Storefront-specific banner/navigation validation is covered separately by root's actual application regression.

## Archive and cleanup

- The complete original evidence tree was copied to `shared-ui/`: **30 files / 3,893,585 bytes**, including every report, log, axe original, and all 15 PNGs. Every copied file is byte-identical to its owned-copy original; SHA-256/size inventory: `shared-ui-archive-manifest.json`.
- Original runner exited normally and reports native temporary profiles removed. A subsequent real TCP connection check confirms all three owned server ports (51544 / 51754 / 51769) are closed. No service was stopped outside this run.
- Post-run source Git state is unchanged. Only the runner's own `output/playwright/p2-03` evidence is untracked. An initial additional bare `git status` assertion rejected that expected generated output; detailed status corrected this post-check assumption without changing files, the original runner, or its already-passing result. This distinction is preserved in `shared-ui-status.json`.
- Source snapshot and its evidence remain available for inspection. No cleanup removed user files, root's original P2-03 evidence, or the owned original acceptance artifacts.

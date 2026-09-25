# P3-06 resumed shared UI refresh

Independent executor: `/root/order_bff`. Collected 2026-09-16 from detached commit `0dabba96e88d421d4679f6891e9e237efc3ef24d` in `/Users/mario/Desktop/下单/.turbo/p3-06-shared-ui-0dabba9-20260916`. No product source, assertion, collector or gate was changed for this run. Main checkout canonical evidence was imported separately by root; this executor wrote only the outer evidence and the isolated checkout's original collector output.

## Outcome and exact scope

| Original collector | First attempt UTC | Exit / wall time | Actual evidence |
| --- | --- | --- | --- |
| `scripts/verify-ui-interactions-browser.mjs` | 08:28:45.226–08:29:57.986 | 0 / 72.761 s | `passed`; 13/13 scenarios, 15 PNG, 8 axe scans; native Chrome 200% zoom |
| `scripts/verify-ui-composites-browser.mjs` | 08:30:13.029–08:30:43.990 | 0 / 30.962 s | `passed`; 16/16 scenarios, 18 PNG, 10 axe scans; native Chrome 200% zoom |
| `scripts/verify-ui-motion-browser.mjs` | 08:31:01.232–08:31:39.756 | 0 / 38.524 s | **`passed-with-physical-device-gate`**; 8/8 locale scenarios plus motion/reduced-motion cases, 22 PNG, 3 axe scans |

All three original automatic commands passed on the first attempt. No failed browser run was discarded. P2-05 explicitly retains real mobile-device recording and frame-rate evidence. Its local desktop interaction timings are not field INP. These gates do not resolve P3-06's formal page-performance or manual acceptance requirements, and do not unlock Phase 5.

## Reproducible preparation and source provenance

The checkout was newly created at the exact implementation SHA. `mise exec node@24.20.0 -- corepack pnpm install --offline --frozen-lockfile` exited 0 in 4.703 s. No node_modules, dist or Next output was copied from the main checkout. Installed versions: Node v24.20.0, pnpm 11.25.0, Next 16.3.4, React 19.2.8, Playwright 1.62.1, axe 4.13.0, Google Chrome 152.0.7977.84.

Installation left full tracked/untracked Git status empty. P2-03 ran first, removed only this checkout's generated build output, forced the Storefront dependency closure build and recorded `dirty:false`, `status:[]`, `rechecked:true`. The subsequent collectors retained stable earlier evidence:

- P2-04: SHA unchanged; 352 render inputs, `p2-04-render-inputs-v1` SHA-256 `7bc50168f25c722bf9e827c65880ffeee52b8772cdb8455592fd37450cd3187a`; before/after Git records identical, including the 15 pre-existing evidence status lines.
- P2-05: SHA unchanged; 780 render inputs, `p2-05-render-inputs-v1` SHA-256 `5f653b29fdf70594da2a3e563518f6ed70e5c811daac62bcc1558cda5f9b0050`; before/after Git records identical, including the 30 pre-existing evidence status lines.
- Ending full Git status contained only the three original evidence directories; **zero non-evidence source changes**. Detached checkout is retained for root's acceptance.

Run each original command with `mise exec node@24.20.0 -- node <script>` from the detached checkout, in the order above. Detailed commands, timestamps, durations and exit codes are preserved in `*-attempt-1-result.json`; complete command output is in matching `.log` files. Preparation is in `worktree-add-result.json`, `install-1-result.json` and `preparation.json`.

## Runtime, accessibility and visual evidence

All three used a real local production build and standalone Next server. Each checked eight fixture locales: preview routes returned 200, staging/production configuration routes returned 404, and health returned 200. These are local configuration checks, not deployments to actual staging or production. P2-03/04 used isolated native Chrome profiles for 200% page zoom; P2-03 explicitly records the isolated profile removed. After all collectors ended, all nine recorded loopback ports refused connections and no process containing this checkout path remained (`independent-verification.json`). Unrelated processes were neither inspected in detail nor terminated.

P2-05 checked 244 production font faces with `font-display: optional`, all five expected font families, and document.fonts/CSSOM/computed-stack agreement for eight locale scenarios. This validates the loaded production cascade, not every dynamic codepoint, variable weight or operating system.

The automatic gate permits no **confirmed critical/serious violations**. Do not describe the raw axe results as universally zero:

- P2-03: one moderate `region` violation in the menu scan. Five incomplete rule entries remain across dialog/drawer/menu/toast, including `aria-hidden-focus`, `color-contrast` and `aria-valid-attr-value`.
- P2-04: no confirmed violations; four scans retain incomplete `color-contrast` findings over image-backed content.
- P2-05: each of its three scans has one moderate `heading-order` violation and one incomplete `color-contrast` entry.

The finding rule IDs, impacts and affected-node counts exactly match root's archived previous canonical evidence (`axe-comparison.json`). This establishes no change in that signature, not manual resolution. Original exclusions and raw JSON are unchanged.

Representative PNGs were actually opened: P2-03 Chinese 1024px and Japanese dialog 1440px; P2-04 Japanese 1440px, Thai 768px and native Portuguese 200% zoom; P2-05 Chinese 1024px, Vietnamese 390px and long Portuguese 320px. Visible text and controls in these samples show no new missing-glyph or horizontal-cutoff issue. The P2-04 320px full-page preview was also opened, but its 13,457px height was heavily downscaled by the viewer, so it is not claimed as a legibility inspection. Automated geometry/overflow assertions and the readable P2-05 320px sample provide the narrower supporting evidence. This is not professional translation review or physical-device/assistive-technology acceptance.

## Import integrity and auxiliary-tool corrections

`imported-evidence/p2-03`, `p2-04` and `p2-05` contain complete original evidence directories: **30 + 36 + 36 = 102 files**, including **15 + 18 + 22 = 55 PNGs**. Every listed screenshot SHA-256 was independently verified against its bytes. Every copied file's path, bytes and SHA-256 were compared with its source (`import-verification.json`). Root's separately imported main canonical directories also matched these copies byte-for-byte at inspection. Root preserved the previous canonical directories and owns all canonical writes.

Two auxiliary copy-wrapper attempts failed before final completion; neither was an original browser failure: the first wrongly assumed every screenshot entry has a `bytes` field (P2-04 does not), and the second wrongly assumed every gate result string is exactly `passed` (P2-05 retains its physical-device gate). Both are recorded in `import-attempt-1-failure.json` and `import-attempt-2-failure.json`. The completed import uses the actual original formats and does not rewrite them. An initial auxiliary axe extraction read the wrapper root rather than its nested `result`; it is retained as `independent-verification-initial-incomplete.json` and explicitly superseded by `independent-verification.json`, which asserts each extracted count equals the collector summary. **Only the latter is the final review record.**

## Remaining boundaries

This result refreshes the shared UI automatic evidence for implementation commit `0dabba96…`. It does not erase the retained formal P3-06 performance failures or the separate warm-font strict-comparison failure, claim a passed whole-repository check, validate a real payment provider, approve production release, or replace the outstanding physical-phone, screen-reader, multilingual human review and operator-task acceptance. Root owns the full repository gate and progress status.

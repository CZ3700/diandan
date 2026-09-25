# ASCII fallback implementation — independent review

Reviewer: `scheduler_audit`; 2026-09-21. Read-only implementation review; no tests, browser sessions, builds or measurement programs were run by this reviewer. Only this report was written. Verdict: **ACCEPT for the narrow implementation and candidate validation; no blocking code finding.** This is not P3-06 completion or full performance acceptance.

## Scope and correctness

- Reviewed the generator, both test diffs, Japanese/Chinese generated CSS, fallback manifest, font README, comparison plan/driver, existing cmap audit and GREEN log. The generator's new exclusion set contains only U+0020–007E points whose original last matching face is a different face. It retains the existing UI exclusion separately. No non-ASCII point can enter the new exclusion set.
- `selectFace` returns an original face object; the owner comparison therefore uses the same objects traversed by generation. Source order is retained. All current faces have the pinned normal style and 100–900 variable weight. The source-order model is appropriately limited to these existing profiles.
- Preserving all original non-UI, non-ASCII advertisements is necessary: the full-range cmap audit disproved the broad last-advertised-face approach. The ASCII audit records all 95 selected owners having actual glyphs for both profiles, with zero missing owner glyphs. This report inspected those recorded results; it did not rerun FontTools. Generation still verifies pinned package versions and original shard SHA values. A future Fontsource upgrade or wider normalization requires a fresh actual-cmap audit, as the README states.
- The semantic tests retain exact per-face non-ASCII coverage, the complete repertoire union, UI exclusivity, source order, resource identity/bytes, descriptors and selected resource for every non-UI character. New mixed dynamic CJK cases compare every original fallback advertisement in order, not merely the last advertised match. The overlap-only assertions are complemented by these coverage checks; they do not alone prove glyph presence.
- Generated CSS changes remove earlier duplicate printable ASCII advertisements and reflow lines. Manifest changes are limited to the two generated CSS SHA values; original resources, UI hashes and face counts are unchanged (Japanese 124, Chinese 101). WOFF2 data, font imports, family, weight, style and display policy are outside this change.
- Existing `font-ascii-range-green.log` records 23 passed, zero failed/skipped/cancelled tests, including deterministic regeneration and rejection of stale or modified inputs. `check-dev-result.json`, `adapter-boundaries-result.json` and `build-artifacts-result.json` record exit 0. These are executor-run results, not an independent rerun.

The small owner-map addition is proportionate and understandable. No extra abstraction or unrelated cleanup is warranted under code-simplifier review.

## Initial captured-result cross-check

Read `run-2026-09-21T15-55-54-248Z/browser-attempt-{1,2}` under the storefront acceptance output: both viewer snapshots, all six original Lighthouse JSON reports, stage metadata and trace-result aggregates. The two groups use the same H2 viewer origin and the original read implementation in both groups; BUILD_ID changes from `3WTDj0_BVW_V64jNfGnEh` to `8IsWdSZK_uDXvf5ZznP2-` correspond to the required candidate rebuild. Server slices are contiguous (0–81, then 81–156), with zero active/overflow records at both snapshots and actual `2.0`/`h2` server observations.

| Observed item | Baseline, 3 samples | Candidate, 3 samples |
| --- | --- | --- |
| Font requests in every original LHR | 9, all H2/200 | 7, all H2/200 |
| Font resource bytes per navigation | 553,700 | 412,348 |
| Simulated LCP, recorded order (ms) | 4968.4245 / 2405.4873 / 1955.1059 | 4275.773 / 1955.0864 / 2256.0191 |
| LCP median (ms) | 2405.4873 | 2256.0191 |

The removed resources are SC 108 (64,552 bytes) and SC 119 (76,800 bytes): 141,352 resource bytes, approximately 25.5%. All seven surviving font paths, server SHA values and byte lengths match. Resource bytes are not HTTP transfer bytes; varying header overhead in the LHR is not counted as font content reduction.

Both three-sample medians meet this diagnostic budget, but both groups retain a slow first sample. Cache/order/model effects remain; these six samples do not establish a stable LCP speedup or real-user p75. The baseline viewer also retains two `CLIENT_ABORTED` auxiliary image records (IDs 26/27, zero bytes, 16:00:41.422–41.602 UTC); candidate has none. They must remain separately reported and must not be silently relabelled as a fully successful transport run. This review has not independently replayed or rehashed all raw captures and does not extend the earlier transport experiment's FAIL into a PASS.

## Remaining acceptance

Full seven-language UI and controlled loaded-font pixel/metric validation are still pending at this review point; the latter must include ASCII, dynamic CJK and the non-ASCII fallback characters that invalidated the broader proposal. The UI stage intentionally uses the original direct fixture origin, separate from H2 performance measurement. Final evidence/source protection, cleanup and scoped S.U.P.E.R closeout remain the executor's responsibility. Original formal performance, field p75/INP and real-device gates remain open.

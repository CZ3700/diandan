# Isolated CJK font overlap diagnosis

2026-09-16, Chrome 152.0.7977.84. No production file, WOFF2 bytes, website fixture, build, Lighthouse budget or original evidence changed. Root exclusively provided the Chrome window; the owned browser/server closed at 07:15:36.217Z.

## Confirmed website evidence

The current SC and JP catalog source hashes match `generated/manifest.json`. Every static catalog character is included. Compiled UI WOFF2 hashes match source bytes; each compiled UI face follows the complete original family with matching normal style/100–900 weight/optional display. The initial route loading page explicitly uses system-ui. A stale subset, missing current static translation, reversed CSS order and font decoding/network failure do not explain the additional requests.

The baseline trace `baseline-trace/attempt-2026-09-16T07-01-52.292Z-49494db2/zh-CN-home-mobile-1` requests Latin + UI + original SC117/112/116 first. The latter three serve legitimate editable homepage content: 传/递 in the subtitle and 识 in the CTA. The artist track renders names and availability, not biographies. Homepage static/catalog content otherwise cannot account for the subsequent SC107/108/110/114/115/118/119 requests. The UI RemoteFontLoaded event is at 4982531995053 μs; that second group begins approximately 3.6 ms afterwards. This timing alone does not establish the internal browser algorithm.

The original nine-sample Chinese homepage downloads 15 font files / 908,723 transfer bytes; the artist page still downloads 14 / 846,899 bytes despite its much lower simulated LCP. Its fonts simply do not terminate that sample's LCP dependency graph. In `baseline-repeat/attempt-2026-09-16T07-04-10.806Z-db2a7fd0`, all three Chinese home samples again have 15 fonts / 908,723 bytes, and all three Japanese home samples have 22 / 542,931 bytes. Simulated LCP varies; no sample was omitted or replaced.

## Controlled result

Run command: `mise exec node@24.20.0 -- node output/checks/p3-06-performance-resume/font-overlap-probe/run.mjs --run`.

Evidence: `attempt-2026-09-16T07-15-30.127Z/results.json`, all 16 individual case JSON files, viewport PNGs and glyph canvas PNGs. All HTML cases and asset-to-source paths are retained alongside the script. Inputs are the complete current static catalogs, original pinned Fontsource WOFF2 files, current generated UI WOFF2 files, and eight deterministic arbitrary non-UI CJK characters selected across the complete original repertoire. No fixture-specific character subset was created. No network throttling, performance score or production claim is made.

| Dataset                     | Original complete fonts | Current overlapping UI face | Disjoint original ranges + UI | Separate UI family alias |
| --------------------------- | ----------------------: | --------------------------: | ----------------------------: | -----------------------: |
| Japanese static UI          |                      28 |                          29 |                             1 |                       29 |
| Japanese UI + arbitrary CJK |                      36 |                          37 |                             9 |                       37 |
| Chinese static UI           |                      15 |                          16 |                             1 |                       16 |
| Chinese UI + arbitrary CJK  |                      22 |                          23 |                             9 |                       23 |

Only changing the original faces' unicode-range to exclude exactly the already-covered UI points removes the redundant font requests in this controlled Chrome experiment. Changing the family name alone does not. The script asserts that the full Unicode union remains exactly equal to the complete original family, that original ranges and UI points become disjoint, and that arbitrary non-UI text still requests original shards. Every requested font returns 200 and reaches loaded status. One original Japanese case records an unrelated automatic favicon 404; it is retained.

This establishes a reproducible browser-level overlap counterexample without identifying a specific Blink implementation function or proving a production performance improvement.

## Shape limitation and next validation

Every comparison preserves DOM width/height and all measured text widths. However, CDP `CSS.getPlatformFontsForNode` shows system fonts on most cold optional-display pages even after `document.fonts.ready`. Equality there is evidence for the cold fallback display only, not proof that the two Noto representations shape identically. Chinese mixed original rendering partially selected Noto while the other cases selected system fallback; its canvas pixels and strict bounding metrics differ. The raw comparison remains false and is not waived.

Before a production font change: preserve all original assets, generate only deterministic disjoint CSS from the existing UI corpus, prove union equality against every original range, inspect compiled CSS ranges, then verify actual custom-font selection on controlled warm/preloaded pages and compare glyph pixels/metrics at relevant weights. Retain a cold optional-display check. Finally run actual compiled seven-language UI and unmodified Lighthouse gates. The previous general source-order model alone is insufficient to prove browser request behavior.

## Tool validity / freeze

`probe-support.test.mjs`: effective RED two assertion failures with the unchanged-range implementation (`support-red.log`); GREEN two tests including all 256 small-domain partitions (`support-green.log`). Prettier and ESLint `--no-ignore` exit 0 (`format.log`, `lint.log`). Browser command exit 0, all 16 requested cases retained in 6.1 seconds (`run.log`). No claim that every pixel/strict-metric comparison passed.

The runner intentionally creates its retained HTML/input files with exclusive writes. It must be run in a fresh evidence directory at the same nesting depth for a new attempt: copy only its three `.mjs` files into that fresh sibling directory, then run that copy. Do not overwrite or remove this attempt's evidence. Preparation without `--run` writes the HTML/input evidence and starts no browser; subsequently execute from a fresh sibling directory if a browser run is desired.

S.U.P.E.R review: helper performs only range subtraction, runner only isolated evidence collection; data flows from pinned local inputs to a local HTTP renderer and serialized results; no business API, database, credential or new dependency; exact repertoire invariant and browser request differential verified. The complete custom-font shape and production acceptance checks remain pending, explicitly outside this diagnostic completion claim.

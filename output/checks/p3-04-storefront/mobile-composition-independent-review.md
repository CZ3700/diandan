# Independent review — mobile composition and directory headings

Reviewer: storefront_directory (read-only review of the final root-authored fixes).

Decision: **ACCEPT** for the mobile Hero ratio and contextual directory heading fixes. No additional source change is requested. This is local evidence from a production-compiled artifact running under explicit TEST configuration; it is not production release evidence.

## Cause and implementation

- The published mobile image contains the complete head and adequate headroom. The previous mobile frame was 390 × 337.59375 px while the independent published source is 1080 × 1350 (4:5). `object-fit: cover` with the correct stored 50% / 45% focal point consequently removed about 67 px from the top. This was a generic container crop, not a reason to rewrite the fixture focal point or force every image to `top`.
- `PublishedHeroImage` now emits `--hero-mobile-aspect` from validated mobile width / height. The mobile CSS uses that aspect ratio with automatic block size. Existing independent desktop/mobile source sets, focal points, optimizer constraints, and error-frame wrapper remain intact; the desktop rule is unchanged.
- Homepage directory cards follow the containing h2 with h3. The standalone directory passes heading level 1 and renders its cards and empty state as h2. The shared card selector covers both heading tags, preserving the visual size and line height.

## Fresh independent checks

Command: `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/storefront test src/storefront/published-image.test.tsx src/storefront/artist-directory.test.tsx`

Result: 2 files, 8 tests passed. Log: `mobile-composition-independent-unit.log`.

After the E2E author confirmed that the new build and screenshots contained the final aspect fix, the reviewer viewed:

- `output/playwright/p3-04-storefront/zh-CN-390-home.png`
- `output/playwright/p3-04-storefront/pt-390-detail.png`
- `output/playwright/p3-04-storefront/en-390-directory.png`

Both mobile Hero screenshots show the complete head and face with headroom. The directory card remains visually consistent with the homepage card.

Read-only Chrome inspection of the same final local service (`http://localhost:49488/en`, viewport 390 × 844) measured:

| Property | Result |
| --- | --- |
| Hero frame | x=0, y=65, width=390, height=487.5 |
| Computed aspect ratio | 1080 / 1350 |
| Image | complete; object-fit cover; object-position 50% 45% |
| Homepage first card heading | H3; 21.6 px; weight 500; line-height 28.08 px |
| Directory first card heading | H2; 21.6 px; weight 500; line-height 28.08 px |
| Standalone directory heading outline | H1 followed by H2 cards |
| Standalone directory document overflow | none at 390 px |

The review tab was closed and the viewport override reset after inspection. The E2E author separately reports CLS 0 and ten axe scans with zero violations; those assertions belong to the E2E report rather than this read-only manual inspection.

## Contrast follow-up boundary

The final browser uses title text `#f6f3ee` and status text `#aaa6a0` on the solid `#0a0a0c` canvas. Transparent intermediate ancestors have opacity 1 and no background image. Relative-luminance contrast ratios are 17.87:1 and 8.17:1 respectively. Both exceed the normal-text AA minimum.

At the track's initial position exactly 22 title/status nodes (11 cards) are partially or fully outside its horizontal clip; the first card's two text nodes are fully visible. This matches the reported incomplete count, but the current axe report retained only rule/count, not node targets or failure summaries. Therefore clipping is a plausible explanation, not yet an exact attribution. The E2E author will retain raw incomplete targets/failure summaries in the next report. No color change is justified by the independently observed foreground/background values.

Final artifact follow-up: the completed `output/playwright/p3-04-storefront/accessibility.json` now retains raw targets and failure summaries. All ten axe runs report zero violations. Nine runs each retain 22 color-contrast incomplete nodes (198 observations total); every target is a directory card `figcaption` heading or availability line, and every reported reason is an obscured/undetermined background. These targets match the clipped cards inspected above, resolving the earlier attribution uncertainty. This remains a manual contrast completion using the measured solid backgrounds and ratios; it is not an assertion that axe itself automatically passed those incomplete nodes. All 51 screenshot paths in that final report exist, and the final Chinese homepage and Portuguese detail screenshots were viewed again with the full head and face visible.

## Scope

This acceptance concerns the final root-authored mobile layout and heading fixes only. The separate unknown-artist HTTP streaming status correction remains with root and E2E. No source file was modified during this review.

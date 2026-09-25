# P3-05 screenshot review

Root inspected actual emitted PNG files with the local image viewer. No image generation, cropping, re-coloring or screenshot editing was applied to the evidence.

Current source: `5f995f4c7995f45ead97a45fc7d9a1a1236c8411a383734e25b17716003331f7` (1428 inputs). Actual compiled browser output directory: `output/playwright/p3-05-gift-storefront/run-2026-09-07T07-23-22-566Z/browser-attempt-3/`.

Files inspected: `zh-CN-390-detail.png`, `th-390-directory.png`, `vi-390-detail.png`, `pt-1440-directory.png`, `es-390-detail.png`, `ja-1440-policy.png`. Earlier English mobile/desktop smoke was inspected separately and does not replace this source's complete matrix.

Observed: approved charcoal/gold surfaces retain original gift colors; full gift compositions remain visible with contain framing; mobile directory has two columns, desktop four; long Thai/Vietnamese/Spanish/Portuguese text and variant controls wrap without overlap or clipping in these images. Chinese and Japanese headings remain legible. Detail and policy hierarchy, pagination, unavailable gift and disabled checkout explanations are visible. Screenshot width is CSS viewport emulation; full-page height naturally exceeds the viewport.

This is visual inspection, not formal linguistic or legal approval, screen-reader certification, physical-phone validation, or a performance-budget claim. Exact automated reflow/axe/media/interaction scope and pass status remain in the final browser result.

After the isolated native-history fix, root also inspected `browser-attempt-5/th-390-directory.png` and `browser-attempt-5/pt-1440-detail.png`, under the same run directory. These belong to final implementation input hash `69a48bef96956a27946a12da7468acc71880bcbef594eb50184a2de3aadd9bb5`. The only change from the earlier visual review was the filter history-restoration effect; these current captures retain the same composition, color and responsive layout. Full interactive pass status is still read from the final successful matrix, not inferred from these screenshots.

Final successful matrix: `browser-attempt-6`, source `fc27375c3ef3340299e1d2ec71cbe0ea517ed442cfe72e221ebd6f59f4766ae1`. Root inspected its `zh-CN-390-detail.png` and `en-gift-state-4.png` directly; the latter shows an actual selected artist and PREORDER quantity presentation. Previous visual/product inputs are unchanged; only the focus-guard oracle changed after attempt 5. The final matrix reports 8 successful case groups, 55 screenshots, 10 axe scans with zero violations/incomplete, 44 reflow checks, 33 decoded responsive-image records, and zero uncaught page errors.

Final test-maintenance rerun: `browser-attempt-7` is a full PASS against `689ca8596cac257223c7b3f0445314aebd5c00a34ed48d7bfdad22a05e1a8122`. Root additionally viewed `pt-mobile-filter-applied.png`: eight actual matching gifts, localized prices, two-column layout and one-page controls render correctly. Changes since attempt 6 were limited to a test-script format fix and contract test maintenance/worker configuration; all product rendering inputs remain unchanged. The final delivery references attempt 7 (8 groups, 55 PNGs, 10 axe with zero violations/incomplete).

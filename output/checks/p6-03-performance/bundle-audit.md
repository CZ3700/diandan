# P6-03 short initial JavaScript audit

Read-only audit of the baseline source snapshot `34e9e6c36b8a286501a1ae4de55b54e39ce07786b307c52ef957c03ef5a5df1c`, its actual compiled chunks, and the three Chinese 390×844 diagnostic resource captures. No build, browser, dependency or product change was made. This was a bounded short audit, not a full bundle optimization project.

Evidence: `/Users/mario/Desktop/.fan-support-regression/533549cb-7a34-4aea-8fcd-8524cdda9fa2/workspace/output/checks/p3-06-storefront-acceptance/run-2026-09-23T19-53-45-049Z/browser-attempt-1/six-screen/results.json`; compiled sources under that snapshot's `apps/storefront/.next/static/chunks/`.

## Actual attribution

| Shared initial chunk | Measured gzip bytes | Identifiable contents |
| --- | ---: | --- |
| `2p07cckado7sy.js` | 73,278 | React DOM, Next app bootstrap and runtime |
| `2c4nlk_2vrv0p.js` | 47,193 | Next app router, RSC/navigation and router error handling |
| `1eb2a8tunus1g.js` | 5,545 | React and React DOM shared/runtime helpers |
| `turbopack-264kn-mbs3jz9.js` | 3,832 | Turbopack runtime |
| `3rrddfj_zf4lv.js` | 3,661 | Next client page/segment and layout/error/router helpers |
| `2qun_6obf6abx.js` | 415 | Small shared bootstrap entry |
| `0vr1nvt889nvo.js` | 12,788 | Header, cart session, existing lazy boundaries, published images, Next image helpers, media and icon primitives |

These total **146,712 bytes** before each route-specific chunk. Homepage adds `0khagzihg94ls.js` **5,681 bytes** (artist directory, search and keyboard/scroll interactions), artist adds `2ee_u3chpifz5.js` **4,032 bytes** (gift filters and controls), gift adds `0vvvbuvfpgllo.js` **7,300 bytes** (recipient search, gift add, personalization and quantity controls). Totals exactly reproduce **152,393 / 150,744 / 154,012 bytes**. The 150,000-byte SHOULD gaps are **2,393 / 744 / 4,012 bytes**, respectively. These are baseline observations; a later candidate containing new RUM code needs its own actual measurement.

## Candidate assessment

No clearly safe, isolated 2–5 KB removal was established within this audit. Retain the measured SHOULD gap rather than claim a speculative saving.

The most concrete future investigation is `apps/storefront/src/storefront/published-image.tsx`: its client import of the public `getImageProps` API from `next/image` brings the Next image implementation into the shared chunk. The compiled module for `getImgProps` is 4,859 raw bytes / 2,314 independently gzipped bytes, and `Image` is 3,556 raw / 1,683 independently gzipped bytes; related image helpers also exist. **Independent module gzip sizes are not additive savings** because the actual chunk shares a compression dictionary and dependency graph.

This is not a safe one-line defer: responsive image sources are required during SSR/initial hydration, including the hero preload and art direction. `artist-track.tsx` also renders `PublishedImage` for newly fetched client-side pages. Moving source generation to the server therefore needs an explicit initial/paginated-image boundary and regression coverage for source-width caps, focal points, fallback, responsive preload and seven languages. Importing Next internal implementation paths or duplicating its URL/image configuration to force tree shaking is not recommended. A simple lazy import during initial render could instead delay the hero or cause hydration differences.

Existing `CartPanel`, drawer contents and language menu are already deferred and were not counted as new opportunities. The compiled cart-session/provider group is only 3,327 raw / 1,438 independently gzipped bytes in total; moving its editor/mutation portion cannot demonstrate a 2–5 KB saving and touches concurrency, restoration and CSRF behavior. Header navigation/focus/error handling and visible artist/filter/purchase controls serve immediate interaction and should not be delayed solely to cross this small recommendation gap.

Recommendation: keep the current narrow scope and complete the actual candidate matrix. Preserve these SHOULD deviations explicitly if the final candidate remains above 150,000 bytes, while continuing to evaluate mandatory LCP/CLS/interaction and functional gates on their own evidence. Any later image-source boundary change should be a separately measured, regression-tested optimization.

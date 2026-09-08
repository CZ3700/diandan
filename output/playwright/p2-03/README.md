# P2-03 UI interaction browser verification

Generated at 2026-09-08T03:15:33.695Z.

## Provenance

- Git SHA: `7db722b4f5480ffb78eb19f5e2eec7675e50b1bd`
- dirty: false
- clean checkout rechecked after run: true
- Node `v24.20.0`
- pnpm `11.25.0`
- Next.js `16.3.4`
- React `19.2.8`
- Playwright `1.62.1`
- axe `4.13.0`
- Browser `Google Chrome 152.0.7977.82`

## Re-run

```sh
mise exec node@24.20.0 -- node scripts/verify-ui-interactions-browser.mjs
```

## Runtime gates

- preview: fixture 200, healthz 200, all 8 preview locales verified
- staging: fixture 404, healthz 200, all 8 preview locales verified
- production: fixture 404, healthz 200, all 8 preview locales verified

## Native Google Chrome zoom

- Method: Chrome HostZoomMap default zoom preference loaded from an isolated temporary profile; no device-metrics, page-scale, or viewport emulation.
- Zoom: 200%.
- CSS viewport: 1710×842 → 855×421.
- DPR: 2 → 4.
- Isolated profile removed: true.

## Scenario results

- `viewport-360x800-en`: PASS
- `viewport-390x844-vi`: PASS
- `viewport-768x1024-th`: PASS
- `viewport-1024x768-zh-cn`: PASS
- `viewport-1440x900-ja`: PASS
- `viewport-1920x1080-es`: PASS
- `stress-320x800-en-xa`: PASS
- `stress-320x800-pt`: PASS
- `interaction-390x844-en-to-ja`: PASS
- `touch-menu-390x844-en`: PASS
- `rtl-1440x900-en`: PASS
- `reduced-motion-390x844-en`: PASS
- `reduced-motion-1440x900-pt`: PASS

## axe results

- `base-mobile`: critical/serious 0, full result `axe-results/base-mobile.json`
- `base-desktop`: critical/serious 0, full result `axe-results/base-desktop.json`
- `pseudo-320`: critical/serious 0, full result `axe-results/pseudo-320.json`
- `dialog`: critical/serious 0, full result `axe-results/dialog.json`
- `drawer`: critical/serious 0, full result `axe-results/drawer.json`
- `menu`: critical/serious 0, full result `axe-results/menu.json`
- `toast`: critical/serious 0, full result `axe-results/toast.json`
- `reduced-motion`: critical/serious 0, full result `axe-results/reduced-motion.json`

## axe exclusions

- `[data-base-ui-focus-guard]`: Base UI focus guards are aria-hidden sentinels that immediately redirect focus; component focus containment is verified separately ([upstream](https://github.com/mui/base-ui/issues/4845))

## Screenshot SHA-256

| Evidence | SHA-256 |
|:--|:--|
| `viewports/360x800-en.png` | `27ae8548e42ee4b9311137f4e2b9eed437dacd741ff76e842b4c4cec6189f76d` |
| `viewports/390x844-vi-drawer.png` | `f59d0dcad638d01c66cc7cbab1bb02132483b898000ea619591859c718829308` |
| `viewports/768x1024-th-menu.png` | `1130bf5f92f7a08a493854f2500846dfdc2d94571e204f3071aa6f37d4c29cc1` |
| `viewports/1024x768-zh-CN.png` | `ba99f13810a29e168b7e89d4f2b7ab6fb28f7c8d19f89780012af34a41e7ef9d` |
| `viewports/1440x900-ja-dialog.png` | `ae95933a439109ec542c214955f22a7d9bb673d2d6ff8171d58920fd98d94b23` |
| `viewports/1920x1080-es.png` | `3f5f8e6b89627f9cbe28a5125ceb74d47ea54c3d0a5a5aab0fd989b3225d91a4` |
| `stress/320x800-en-XA-menu.png` | `3f3e857437099d5fd3e5da2b2a7be6b6a6d3fe9f8dbd53558d93c74b7872e9bd` |
| `stress/320x800-pt-long.png` | `22deb3759a0e7f1c2ef38407a7e063f514637f9e3db7cc48a9394cba6925f142` |
| `interactions/390x844-ja-after-isolation.png` | `515cb3617745d76da6d730be90e2ae37b8b6a0c4f2025c3389d93526be0eff69` |
| `interactions/390x844-en-touch-menu.png` | `e5cffc0bcdccc0f3dac88ea50755e46b43bbc4371ac348fba52d2e704397925b` |
| `rtl/1440x900-en-menu.png` | `8ccc5672c668093a5aba0686d7dcf5d81efec06dbc403c98ab76ef2edc814d17` |
| `reduced-motion/390x844-en-dialog.png` | `31e9d6a280dd645617bd91672c8d59afa001937c1e71b292f5d33013e9ba3d71` |
| `reduced-motion/1440x900-pt-drawer.png` | `7a980dda6fce61b22a5c4d98fbdca45abe0de2de14901ddf45cee404edcccf04` |
| `zoom/google-chrome-baseline-pt.png` | `fbd28789c856b9fce449ace1a34644c6869ed90eaee56cc79b46510cc893267e` |
| `zoom/google-chrome-200-percent-pt.png` | `639efdc5c8d3aacd779aa7fa43f1cb3c634d307ea3c57af4a91596a6e48099d5` |

This is local production-build evidence under the preview gate. It is not staging or production deployment evidence, formal brand approval, or real-device performance evidence.

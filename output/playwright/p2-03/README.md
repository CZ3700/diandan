# P2-03 UI interaction browser verification

Generated at 2026-09-04T12:23:38.303Z.

## Provenance

- Git SHA: `0f86e6c16e9f44bd3c9096e2d8d02a9a3e7aa1b8`
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
| `viewports/360x800-en.png` | `558955d39406b19e2ddcb6df90accaa21e9b374e2bf02e31f783a6c44cccf340` |
| `viewports/390x844-vi-drawer.png` | `f59d0dcad638d01c66cc7cbab1bb02132483b898000ea619591859c718829308` |
| `viewports/768x1024-th-menu.png` | `8cb9c298dec9a4b4e4d1dfa2d582a062cbb478c45110a1afa5c35ef792cabdd4` |
| `viewports/1024x768-zh-CN.png` | `5eff1775a9385908df44e85dc06ff1b6ae6febb4267864f8595a7bf22ddf93bd` |
| `viewports/1440x900-ja-dialog.png` | `fb74b8e39d80b0742766e7ce7fb1d1975c2b93b52083fdd453257da19a69a933` |
| `viewports/1920x1080-es.png` | `3f5f8e6b89627f9cbe28a5125ceb74d47ea54c3d0a5a5aab0fd989b3225d91a4` |
| `stress/320x800-en-XA-menu.png` | `7f8028dd39ae212830461e0893af53cee8346aaeee53145471d6d37037808e8b` |
| `stress/320x800-pt-long.png` | `c7921ea72910e309c4206d528d77be8f2fa3fb7cbab7d530e2c7733f85a43c9b` |
| `interactions/390x844-ja-after-isolation.png` | `e26c97d2311258e8c067a96e504cf8d61a25dbbd5195ab8748bdc1a2c52a8ab4` |
| `interactions/390x844-en-touch-menu.png` | `a93f26beedb147a9a125df27567c9c403a833fd525782dadbfc4269b0e882698` |
| `rtl/1440x900-en-menu.png` | `8ccc5672c668093a5aba0686d7dcf5d81efec06dbc403c98ab76ef2edc814d17` |
| `reduced-motion/390x844-en-dialog.png` | `31e9d6a280dd645617bd91672c8d59afa001937c1e71b292f5d33013e9ba3d71` |
| `reduced-motion/1440x900-pt-drawer.png` | `7a980dda6fce61b22a5c4d98fbdca45abe0de2de14901ddf45cee404edcccf04` |
| `zoom/google-chrome-baseline-pt.png` | `679907dd714248587c0c0ed5bb93e88b2f6bf2197b59eb5a4703627589cd29ff` |
| `zoom/google-chrome-200-percent-pt.png` | `604555b369c475e18b2b93ce75462d1394e58354cb75c8e8e8bc7caf48becabf` |

This is local production-build evidence under the preview gate. It is not staging or production deployment evidence, formal brand approval, or real-device performance evidence.

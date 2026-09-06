# P2-02 UI primitive browser verification

Generated at 2026-09-04T22:45:58.792Z.

## Provenance

- Git SHA: `674ef5b4a57a6bb9ada6be5bf63670df9105ced4`
- dirty: true
- Node `v24.20.0`
- pnpm `11.25.0`
- Next.js `16.3.4`
- React `19.2.8`
- Playwright `1.62.1`
- axe `4.13.0`
- Browser `Google Chrome 152.0.7977.82`

## Re-run

```sh
mise exec node@24.20.0 -- node scripts/verify-ui-primitives-browser.mjs
```

## Runtime gates

- preview: fixture 200, healthz 200
- staging: fixture 404, healthz 200
- production: fixture 404, healthz 200

## Native Google Chrome zoom

- Method: Chrome HostZoomMap default zoom preference loaded from an isolated temporary profile before navigation; no device-metrics, page-scale, or viewport emulation.
- Zoom: 200%.
- Baseline CSS viewport 1710×842; zoomed CSS viewport 855×421.
- DPR 2 → 4; outer window 1710×929 → 1710×929.
- The isolated temporary profile was removed: true.

## Scenario results

- `viewport-360x800-en`: PASS
- `viewport-390x844-vi`: PASS
- `viewport-768x1024-th`: PASS
- `viewport-1024x768-zh-cn`: PASS
- `viewport-1440x900-ja`: PASS
- `viewport-1920x1080-es`: PASS
- `stress-320x800-en-xa`: PASS
- `stress-320x800-pt`: PASS
- `interaction-390x844-en`: PASS
- `hover-1440x900-en`: PASS
- `rtl-390x844-en`: PASS
- `reduced-motion-390x844-en`: PASS
- `reduced-motion-1440x900-en`: PASS

## axe results

- `default-mobile`: critical/serious 0, full result `axe-results/default-mobile.json`
- `default-desktop`: critical/serious 0, full result `axe-results/default-desktop.json`
- `pseudo-320`: critical/serious 0, full result `axe-results/pseudo-320.json`
- `error`: critical/serious 0, full result `axe-results/error.json`
- `loading`: critical/serious 0, full result `axe-results/loading.json`
- `rtl`: critical/serious 0, full result `axe-results/rtl.json`

## Screenshot SHA-256

| Evidence | SHA-256 |
|:--|:--|
| `viewports/360x800-en.png` | `7a458596d7fd46a06cb01762b79b306451972b4628806be2a001da5dbe3f8f9a` |
| `viewports/390x844-vi.png` | `7b3b1d0e5198087ae8973bcaaffc00b20aa584807c6a8cb9727cf5ca3cbf202a` |
| `viewports/768x1024-th.png` | `3db8fe25feae30c687b59f2a85f1e79a83d28598b137b9157932271b7ede5bef` |
| `viewports/1024x768-zh-CN.png` | `454fa35f7407f561eda42f39fbdc600976d09d35a9108b8c2c65e074fd0108d1` |
| `viewports/1440x900-ja.png` | `6048e37c8aad79042c30082d1d12b24b14bebf2e4021feee19487a6f4ce5bae4` |
| `viewports/1920x1080-es.png` | `8f5d6c40c7b1df813321419616dd8db7dc6ddf3e3903aa77500248889404d16f` |
| `stress/320x800-en-XA.png` | `d2b4612b1996c2ddbc9395c4d4d392a5742adadb94022b2c9b93c95324cadf29` |
| `stress/320x800-pt-long.png` | `4e75c6894709e717311bd71e928b84b1290bfc2869e72fba1ea4a8ac504b8aeb` |
| `interactions/390x844-en-keyboard.png` | `ffc9e2d8d33c5a6bc010f53af1036c465b32b1ea03de893f812609ba1d74f2d6` |
| `interactions/1440x900-en-hover.png` | `300c65c3b3b7b2153466c89cea820be0624c86c9a75375368b2d79e9959b3c8f` |
| `rtl/390x844-en-rtl.png` | `62adbe6cc045c4b62129b66f5df467006c576a9ac3e11cbbe70bbcaa760c1849` |
| `reduced-motion/390x844-en-reduce.png` | `e2ca4d910b97a16347203ad93b59032a7d05432f9bf4d32985b30534f38003de` |
| `reduced-motion/1440x900-en-reduce.png` | `7a2cd357ecd7a9deb5491d513114174221ed7d44307a185fd46a1f2bbf935270` |
| `zoom/google-chrome-baseline-pt.png` | `3fab0eb04b73ae153f30392a4650de9817546158ebe4af335fadeb33db7681a6` |
| `zoom/google-chrome-200-percent-pt.png` | `c9598951f0ed6f9185777b3a68e2738abe03d7fac5c0b82e6d5ba8d24c8c493f` |

This is local production-build evidence under the preview gate. It is not staging, production deployment, formal brand approval, or real-device performance evidence.

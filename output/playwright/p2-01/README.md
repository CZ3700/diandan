# P2-01 browser verification

Verified on 2026-09-04 (Asia/Shanghai) against the production build served with `FAN_SUPPORT_DEPLOYMENT_ENV=preview`. The primary matrix used Playwright Chromium 152.0.7977.82; the browser-zoom check used the installed Google Chrome 152.0.7977.82.

## Acceptance results

- All eight internal specimen routes returned HTTP 200 in preview: `en`, `es`, `pt`, `vi`, `th`, `zh-CN`, `ja`, and the internal-only pseudo-locale `en-XA`.
- Every route reported `document.fonts.status === "loaded"`, the expected `lang` and font-profile marker, `noindex,nofollow`, zero horizontal overflow, zero detected text clipping, and no replacement glyph.
- Console warnings/errors, page errors, and failed requests: 0 across the route matrix.
- Font inspection confirmed local Fontsource faces: Manrope for Latin, Latin Extended, and Vietnamese; Noto Sans Thai for Thai; Noto Sans SC for Simplified Chinese; and Noto Sans JP for Japanese. No remote font request was observed.
- Extra 320 px checks for the long Portuguese copy and `en-XA` had zero horizontal overflow and zero detected clipping.
- Keyboard-only navigation reached the `Runtime health` link with a visible 3 px solid focus outline, and the focused target remained inside the viewport.
- With `prefers-reduced-motion: reduce`, the fast, control, layout, and hero motion durations all computed to `0s`; scroll behavior computed to `auto`.
- Real Chrome zoom was tested at 200% through Chrome's persisted HostZoomMap preference in an isolated profile, without CDP device-metrics or page-scale emulation. Device pixel ratio changed from 2 to 4 and the CSS viewport from 1710×842 to 855×421 while the outer window stayed 1710×929. Horizontal overflow and detected text clipping remained 0; the isolated Chrome processes were then closed without touching the user's normal profile.
- Runtime gate checks against the production build: preview returned 200; staging returned 404; production returned 404. `/healthz` remained 200 in staging and production.

## Screenshot matrix

| Evidence                                 | Viewport / condition                             | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `viewports/360x800-en.png`               | 360x800, English                                 | `247ef7f9aff40f3aad4f9377f67a5cb8ab747bce2b06c8c9cfe8bd7865713177` |
| `viewports/390x844-vi.png`               | 390x844, Vietnamese                              | `421e0982610da944469f09f15c4cb78e05c5e2ae3f7faa696bd6a927919db209` |
| `viewports/768x1024-th.png`              | 768x1024, Thai                                   | `efc286ad43176fbe678e66c1a8ad5ffd5dcb3ae0a780b7003df87083bee51ac5` |
| `viewports/1024x768-zh-CN.png`           | 1024x768, Simplified Chinese                     | `9926f0d9574899f485538cfe89ab98cdcd58306056a99e3e5b2e3d65dc215360` |
| `viewports/1440x900-ja.png`              | 1440x900, Japanese                               | `4699632fe6f7901a2bc42c6578443c870adefa5a779524c6f136083a04d5edac` |
| `viewports/1920x1080-es.png`             | 1920x1080, Spanish                               | `631d532fdcf058077298b396cfc92573c4dccb34cc22f520fa19e6a6928b60b2` |
| `scripts/390x844-pt-long.png`            | 390x844, long Portuguese copy                    | `5c4e2a19808dab6804715f9a0c907f367114901eece3ff8847c51b84cd06556f` |
| `scripts/390x844-en-XA.png`              | 390x844, internal pseudo-locale                  | `5899e8654bf945fbc46c7f87436d7451a057f0b8142f46529ff2b93020c5cbd5` |
| `reduced-motion/390x844-en-reduce.png`   | 390x844, reduced motion                          | `5e141e790701ba644f0f895f413388dbff6d68b4d238542dd132c983b4fca8e8` |
| `reduced-motion/1440x900-en-reduce.png`  | 1440x900, reduced motion                         | `1036d2eb9293080fd49aafc5755980a362abf843ade23d51cc890dba35d0ce79` |
| `zoom/855x421-es-chrome-200-percent.png` | Chrome at real 200% zoom; 3420×1684 physical PNG | `9db456b34972d4ca38d2ffdffac78b4a4257a01f849bb68a28a3fcc98a6d7ef7` |
| `storefront-root-390x844.png`            | Storefront root, 390x844                         | `bd93687722098d5fe8faba84725ab1bc79f55146a4f8dc8eb3f8960fa1ad7357` |
| `storefront-root-1440x900.png`           | Storefront root, 1440x900                        | `c886447a344af627c7bb6bfcf491714ba66812474c57ed6574cdc989ebe9ab04` |
| `admin-root-390x844.png`                 | Admin root, 390x844                              | `5e53f0409043ca03bcd6ab7ea7c24c9e06338f6c585bd02301980693b15d8726` |
| `admin-root-1440x900.png`                | Admin root, 1440x900                             | `bd263426eeea7dc2f165194cf27b402107c3bc7776369e54e6a948268928b6b4` |

The screenshots are technical design-foundation evidence only. Formal brand approval remains in P2-06. The complete all-script × all-condition accessibility matrix and real-device performance testing remain Phase 2/P6-02 gates; this P2-01 evidence does not claim to satisfy them early.

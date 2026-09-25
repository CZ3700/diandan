# P2-05 signature motion browser verification

Generated: 2026-09-08T03:18:11.842Z

## Outcome

- Production build: true
- Locale scenarios: 8/8
- Screenshots: 22
- Axe scans: 3; critical/serious blocking findings: 0
- Font loading: 244 production font faces use optional; verified families: 5/5
- Runtime font sets: 8/8 locale scenarios prove document.fonts, CSSOM and computed-stack parity
- Source fingerprint: f8b460699de81e8aef6a493c47b6b500c4a1d1b69010a4f4cfedaeba5bab7383 (p2-05-render-inputs-v1)
- Physical device evidence: false

## Remaining gate

Real mobile-device recording and frame-rate evidence is still required.
Desktop Chrome viewport/touch emulation is intentionally not described as physical-device proof.
LCP, PerformanceEventTiming interaction latency, rAF pacing, and JavaScript transfer bytes are local desktop Chrome proxies; the interaction measurement is not field INP.

## Screenshot SHA-256

- viewports/360x800-en.png (ae673b3d372584ff556365b15d9b127e5f2bca1a7cc519be706cbe465aa3c776)
- viewports/390x844-vi.png (ba91c7eb3947a2d20458d6d7fc41992c4d6ffe651aee67b35dc1439bd1ac8e13)
- viewports/768x1024-th.png (4c74ed2577b828e445d2c45f45628fe03a575257f5a8eee8b41e70d707cec237)
- viewports/1024x768-zh-CN.png (f7d662d97f6a3f271a7d552cab142b0320309f8aa0f163c910a2ac1a3bfb5d94)
- viewports/1440x900-ja.png (6e9ecaa969ce06c0fd8453b60bf839f887da08b0a11b031dc443734239a30e5e)
- viewports/1920x1080-es.png (c380e2653a579e027e684d4fb1fc73106f22f0fe7db2e2201503d35689ac09fa)
- stress/320x800-en-XA.png (d2d1c42cadf0af8bea9f5323f77ad4b672fc2d9a98b2a296ed921a3127100e14)
- stress/320x800-pt-long.png (88669082c576ba8410dc519a9d06ae2864a30371e03581e7dd40e7d61fd98c38)
- hero/390x844-start.png (5067429ab8295478a8ac2eda5c7301b3312a0e8e09d9e6d6e73211897af98072)
- hero/390x844-mid.png (fa2e6920549801fae73e19420b477337f98930ed5971b3ea6fd52a5bc94655b5)
- hero/390x844-end.png (383055592a2da62f334728ae66f6102c08b07fb5ac23bf8260cc33a1f73d2ac9)
- hero/1440x900-start.png (d2e45cf35def194737948bfaca425432ba7b810808956c58036e2f29afa56027)
- hero/1440x900-mid.png (1d525f7b8290e09a85fd44860b2b15b5621ffae142139ff6b1b642c8bba3abbf)
- hero/1440x900-end.png (1ecad14a71380baf2eda1982cb3b0f154ea1fa6a987eba6294816bb558b9a6f2)
- motion/idol-mouse-spatial-1440.png (746a52afd251366363a4f09d2d9843f216d8b28435e56ee67c7747c44f62f8cd)
- motion/idol-keyboard-instant-1440.png (cb8395cd745e6904970cbb4b9694ec31d7e27ae134b35d322f46e07349d21705)
- motion/idol-latest-wins-1440.png (33bc3807c961700fcac4df65c82b2bc1d4e078d15582a3741dc55bdbe3407beb)
- motion/success-end-1440.png (1164816cb1e3a13dc5136d2867880a1595eb2bb2f0052aa46681f25b21ac9f03)
- motion/idol-touch-opacity-390.png (963e42c50b839ef2c0562e42f039901e0ac4876e0f0db95288d28b4d5a47cee4)
- motion/add-confirmed-390.png (6eabb2a204f7ec173a9c62108a9307b2c12b896ee5023613b7722c67571000e1)
- reduced-motion/390x844.png (6ffc7a0f84f5f46e683d0b336fc298d2750ecb51b05d08fee3fecbf8f169e8a8)
- reduced-motion/1440x900.png (97aaca202347f51bc64c6a7f52fb18aad12c6e5299f60211b59746e1763e85a9)

Rerun: `mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs`

This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, production release evidence, or physical-device performance evidence.

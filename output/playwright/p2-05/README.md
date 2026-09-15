# P2-05 signature motion browser verification

Generated: 2026-09-15T13:16:21.467Z

## Outcome

- Production build: true
- Locale scenarios: 8/8
- Screenshots: 22
- Axe scans: 3; critical/serious blocking findings: 0
- Font loading: 244 production font faces use optional; verified families: 5/5
- Runtime font sets: 8/8 locale scenarios prove document.fonts, CSSOM and computed-stack parity
- Source fingerprint: 37da1c2d5aaed61f1ea1c29ebf5ab15962b4912e22cef98b9a2e7d535b348d21 (p2-05-render-inputs-v1)
- Physical device evidence: false

## Remaining gate

Real mobile-device recording and frame-rate evidence is still required.
Desktop Chrome viewport/touch emulation is intentionally not described as physical-device proof.
LCP, PerformanceEventTiming interaction latency, rAF pacing, and JavaScript transfer bytes are local desktop Chrome proxies; the interaction measurement is not field INP.

## Screenshot SHA-256

- viewports/360x800-en.png (aed65a6e0846cc3d770caa151b35a0c1611c36dc04a2d4ef0c0879860f47c7bf)
- viewports/390x844-vi.png (ba91c7eb3947a2d20458d6d7fc41992c4d6ffe651aee67b35dc1439bd1ac8e13)
- viewports/768x1024-th.png (4c74ed2577b828e445d2c45f45628fe03a575257f5a8eee8b41e70d707cec237)
- viewports/1024x768-zh-CN.png (07724b9bdcde0bacf151f36f52b9d44015447e0eb9414f908fd74d5f2020093d)
- viewports/1440x900-ja.png (862b804fb02fc3ee8bbdbea0ea479770061fe18f568c62cb2003d046cd5cd213)
- viewports/1920x1080-es.png (c380e2653a579e027e684d4fb1fc73106f22f0fe7db2e2201503d35689ac09fa)
- stress/320x800-en-XA.png (d2d1c42cadf0af8bea9f5323f77ad4b672fc2d9a98b2a296ed921a3127100e14)
- stress/320x800-pt-long.png (88669082c576ba8410dc519a9d06ae2864a30371e03581e7dd40e7d61fd98c38)
- hero/390x844-start.png (5067429ab8295478a8ac2eda5c7301b3312a0e8e09d9e6d6e73211897af98072)
- hero/390x844-mid.png (a2f5e5547a7332eb71189ab07e0aa0784f7daf50bbaa7625a8e241f4f95755b5)
- hero/390x844-end.png (383055592a2da62f334728ae66f6102c08b07fb5ac23bf8260cc33a1f73d2ac9)
- hero/1440x900-start.png (ce716e9d593c5f9a8bd7cd8f5afd6b33d8d3b656d5b5cacf270cf4bf42bc8cb8)
- hero/1440x900-mid.png (9ed6c16abc8adf723d54f2635644ce7d075dbd30c24dde723b4ad241e652f78a)
- hero/1440x900-end.png (575af8798fb1100c478fc172d9efe81cb9f0a91b86fce07ecfede19a81d2cae0)
- motion/idol-mouse-spatial-1440.png (0bd7a996bee6926626b03ea17bc70083662df1ccd2af6215741f413966774e33)
- motion/idol-keyboard-instant-1440.png (7ad1ab49b562b41eef5ff35ab152f7179f13bb2fdce1c09f97a6488146cc2616)
- motion/idol-latest-wins-1440.png (1ff8e78d3bd54ae7d6f60bbc70aba3960e7eb8c7112cf1fec5a99e2b4b8aeca0)
- motion/success-end-1440.png (fe03e4379ae0b1f159c210572b6e16e16566097553e3298a9c4d0ebbb8687d60)
- motion/idol-touch-opacity-390.png (963e42c50b839ef2c0562e42f039901e0ac4876e0f0db95288d28b4d5a47cee4)
- motion/add-confirmed-390.png (6eabb2a204f7ec173a9c62108a9307b2c12b896ee5023613b7722c67571000e1)
- reduced-motion/390x844.png (60357115086f715982bd75e4a6d4ae771e5aae2d5ded8a841ac0a519c05a1de4)
- reduced-motion/1440x900.png (97aaca202347f51bc64c6a7f52fb18aad12c6e5299f60211b59746e1763e85a9)

Rerun: `mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs`

This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, production release evidence, or physical-device performance evidence.

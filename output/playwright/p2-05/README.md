# P2-05 signature motion browser verification

Generated: 2026-09-07T22:57:36.034Z

## Outcome

- Production build: true
- Locale scenarios: 8/8
- Screenshots: 22
- Axe scans: 3; critical/serious blocking findings: 0
- Font loading: 242 production font faces use optional; verified families: 5/5
- Runtime font sets: 8/8 locale scenarios prove document.fonts, CSSOM and computed-stack parity
- Source fingerprint: e98f655c0950280b8578cfa9562e7bcf2563dde44af558436df540cb34d5a671 (p2-05-render-inputs-v1)
- Physical device evidence: false

## Remaining gate

Real mobile-device recording and frame-rate evidence is still required.
Desktop Chrome viewport/touch emulation is intentionally not described as physical-device proof.
LCP, PerformanceEventTiming interaction latency, rAF pacing, and JavaScript transfer bytes are local desktop Chrome proxies; the interaction measurement is not field INP.

## Screenshot SHA-256

- viewports/360x800-en.png (ae673b3d372584ff556365b15d9b127e5f2bca1a7cc519be706cbe465aa3c776)
- viewports/390x844-vi.png (51d35e6dae454aefd2e4970e675fe5ebd796bd518e12ce7e84f00942777628f4)
- viewports/768x1024-th.png (e09f759ad25319d8899a5d64189bd324c396fe2dc89b56e2e9e470a41d0ec697)
- viewports/1024x768-zh-CN.png (33598a779eeed11642c37f39848e33a75f65df50fdd3c19d3fcaff43768d56e1)
- viewports/1440x900-ja.png (8e61d9980d32bf8ec8b7a42e4a0d677a02e4e3812ee97a0eb7b8e5c0c67b7197)
- viewports/1920x1080-es.png (d36a9becbd9951b1dbfb975003b442bf19de5a231f17594da0031c8b806177a7)
- stress/320x800-en-XA.png (d2d1c42cadf0af8bea9f5323f77ad4b672fc2d9a98b2a296ed921a3127100e14)
- stress/320x800-pt-long.png (88669082c576ba8410dc519a9d06ae2864a30371e03581e7dd40e7d61fd98c38)
- hero/390x844-start.png (5067429ab8295478a8ac2eda5c7301b3312a0e8e09d9e6d6e73211897af98072)
- hero/390x844-mid.png (a2f5e5547a7332eb71189ab07e0aa0784f7daf50bbaa7625a8e241f4f95755b5)
- hero/390x844-end.png (383055592a2da62f334728ae66f6102c08b07fb5ac23bf8260cc33a1f73d2ac9)
- hero/1440x900-start.png (ce716e9d593c5f9a8bd7cd8f5afd6b33d8d3b656d5b5cacf270cf4bf42bc8cb8)
- hero/1440x900-mid.png (9ed6c16abc8adf723d54f2635644ce7d075dbd30c24dde723b4ad241e652f78a)
- hero/1440x900-end.png (575af8798fb1100c478fc172d9efe81cb9f0a91b86fce07ecfede19a81d2cae0)
- motion/idol-mouse-spatial-1440.png (0bd7a996bee6926626b03ea17bc70083662df1ccd2af6215741f413966774e33)
- motion/idol-keyboard-instant-1440.png (32da896b16ddb55039c52d75f1d2a0a7c456ecf5fcad152267eebb19f28b357e)
- motion/idol-latest-wins-1440.png (261191bf7c68a0a865aa71cdc9eacf63a25b112d01d1fe590fc7162d43dda86e)
- motion/success-end-1440.png (fe03e4379ae0b1f159c210572b6e16e16566097553e3298a9c4d0ebbb8687d60)
- motion/idol-touch-opacity-390.png (84e66060476d9c738363f04c33bb28f643efabbff8b6427fc6c40968e36d1aaa)
- motion/add-confirmed-390.png (bb12e022473d29a537b63942eb3507d2e86751940d4517278b3b25bbd3910ce9)
- reduced-motion/390x844.png (60357115086f715982bd75e4a6d4ae771e5aae2d5ded8a841ac0a519c05a1de4)
- reduced-motion/1440x900.png (97aaca202347f51bc64c6a7f52fb18aad12c6e5299f60211b59746e1763e85a9)

Rerun: `mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs`

This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, production release evidence, or physical-device performance evidence.

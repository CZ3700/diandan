# P2-05 signature motion browser verification

Generated: 2026-09-06T10:12:17.504Z

## Outcome

- Production build: true
- Locale scenarios: 8/8
- Screenshots: 22
- Axe scans: 3; critical/serious blocking findings: 0
- Font loading: 242 production font faces use optional; verified families: 5/5
- Runtime font sets: 8/8 locale scenarios prove document.fonts, CSSOM and computed-stack parity
- Source fingerprint: 399edd2e8d46725213e301f7e39fb4a501e02f9447944f0512a896cd19f65f27 (p2-05-render-inputs-v1)
- Physical device evidence: false

## Remaining gate

Real mobile-device recording and frame-rate evidence is still required.
Desktop Chrome viewport/touch emulation is intentionally not described as physical-device proof.
LCP, PerformanceEventTiming interaction latency, rAF pacing, and JavaScript transfer bytes are local desktop Chrome proxies; the interaction measurement is not field INP.

## Screenshot SHA-256

- viewports/360x800-en.png (ae673b3d372584ff556365b15d9b127e5f2bca1a7cc519be706cbe465aa3c776)
- viewports/390x844-vi.png (ba91c7eb3947a2d20458d6d7fc41992c4d6ffe651aee67b35dc1439bd1ac8e13)
- viewports/768x1024-th.png (4c74ed2577b828e445d2c45f45628fe03a575257f5a8eee8b41e70d707cec237)
- viewports/1024x768-zh-CN.png (bdb424a962ea591968a5ad917193f38228e843e919d516bfbfc673de938143a4)
- viewports/1440x900-ja.png (6e9ecaa969ce06c0fd8453b60bf839f887da08b0a11b031dc443734239a30e5e)
- viewports/1920x1080-es.png (d36a9becbd9951b1dbfb975003b442bf19de5a231f17594da0031c8b806177a7)
- stress/320x800-en-XA.png (d2d1c42cadf0af8bea9f5323f77ad4b672fc2d9a98b2a296ed921a3127100e14)
- stress/320x800-pt-long.png (7f8c0261e6a00531b435dfdf5ec9963dfbf066035d917ed2a69f024e84132c31)
- hero/390x844-start.png (5067429ab8295478a8ac2eda5c7301b3312a0e8e09d9e6d6e73211897af98072)
- hero/390x844-mid.png (f8f862a92aa998338fec85a9471a0a5b06618e48d6f745ea19162cc3c05cb3e5)
- hero/390x844-end.png (277f3bb5bdfab76b5e56545e348e421dd8d8689ab9cf0b8b98040d4f7aa32044)
- hero/1440x900-start.png (ce716e9d593c5f9a8bd7cd8f5afd6b33d8d3b656d5b5cacf270cf4bf42bc8cb8)
- hero/1440x900-mid.png (9ed6c16abc8adf723d54f2635644ce7d075dbd30c24dde723b4ad241e652f78a)
- hero/1440x900-end.png (575af8798fb1100c478fc172d9efe81cb9f0a91b86fce07ecfede19a81d2cae0)
- motion/idol-mouse-spatial-1440.png (0bd7a996bee6926626b03ea17bc70083662df1ccd2af6215741f413966774e33)
- motion/idol-keyboard-instant-1440.png (fa811b95ce6a09c5a2a217f1314aedd71d2ef45f84f75960ef06b3f42b5bad5c)
- motion/idol-latest-wins-1440.png (2ca409bc7a1f2a4bdf40c297199b3406d1a5c0af24fc32173027a920087db4b1)
- motion/success-end-1440.png (1164816cb1e3a13dc5136d2867880a1595eb2bb2f0052aa46681f25b21ac9f03)
- motion/idol-touch-opacity-390.png (84e66060476d9c738363f04c33bb28f643efabbff8b6427fc6c40968e36d1aaa)
- motion/add-confirmed-390.png (bb12e022473d29a537b63942eb3507d2e86751940d4517278b3b25bbd3910ce9)
- reduced-motion/390x844.png (60357115086f715982bd75e4a6d4ae771e5aae2d5ded8a841ac0a519c05a1de4)
- reduced-motion/1440x900.png (2732cfbf59719753fb35dcb3b29bc1aede8d4396fc11d2de68084a972ea9eb02)

Rerun: `mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs`

This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, production release evidence, or physical-device performance evidence.

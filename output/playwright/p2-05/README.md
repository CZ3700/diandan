# P2-05 signature motion browser verification

Generated: 2026-09-06T21:18:33.288Z

## Outcome

- Production build: true
- Locale scenarios: 8/8
- Screenshots: 22
- Axe scans: 3; critical/serious blocking findings: 0
- Font loading: 242 production font faces use optional; verified families: 5/5
- Runtime font sets: 8/8 locale scenarios prove document.fonts, CSSOM and computed-stack parity
- Source fingerprint: ea0d73b2f17e5df34c3aa2b36d2fb98768726e9530fcc06a69e5582165474b43 (p2-05-render-inputs-v1)
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
- viewports/1440x900-ja.png (6e9ecaa969ce06c0fd8453b60bf839f887da08b0a11b031dc443734239a30e5e)
- viewports/1920x1080-es.png (d36a9becbd9951b1dbfb975003b442bf19de5a231f17594da0031c8b806177a7)
- stress/320x800-en-XA.png (b55b05c0566221c7d0c882f699882fa86857895fcc6b247b5aaaf9d81e397568)
- stress/320x800-pt-long.png (7f8c0261e6a00531b435dfdf5ec9963dfbf066035d917ed2a69f024e84132c31)
- hero/390x844-start.png (5067429ab8295478a8ac2eda5c7301b3312a0e8e09d9e6d6e73211897af98072)
- hero/390x844-mid.png (a2f5e5547a7332eb71189ab07e0aa0784f7daf50bbaa7625a8e241f4f95755b5)
- hero/390x844-end.png (383055592a2da62f334728ae66f6102c08b07fb5ac23bf8260cc33a1f73d2ac9)
- hero/1440x900-start.png (ce716e9d593c5f9a8bd7cd8f5afd6b33d8d3b656d5b5cacf270cf4bf42bc8cb8)
- hero/1440x900-mid.png (9ed6c16abc8adf723d54f2635644ce7d075dbd30c24dde723b4ad241e652f78a)
- hero/1440x900-end.png (575af8798fb1100c478fc172d9efe81cb9f0a91b86fce07ecfede19a81d2cae0)
- motion/idol-mouse-spatial-1440.png (0bd7a996bee6926626b03ea17bc70083662df1ccd2af6215741f413966774e33)
- motion/idol-keyboard-instant-1440.png (fa811b95ce6a09c5a2a217f1314aedd71d2ef45f84f75960ef06b3f42b5bad5c)
- motion/idol-latest-wins-1440.png (82e6639d3137b9cc0e65c79cc9fda646b3d67ad98e81dc9b94dbd441d13442ff)
- motion/success-end-1440.png (fe03e4379ae0b1f159c210572b6e16e16566097553e3298a9c4d0ebbb8687d60)
- motion/idol-touch-opacity-390.png (963e42c50b839ef2c0562e42f039901e0ac4876e0f0db95288d28b4d5a47cee4)
- motion/add-confirmed-390.png (6eabb2a204f7ec173a9c62108a9307b2c12b896ee5023613b7722c67571000e1)
- reduced-motion/390x844.png (60357115086f715982bd75e4a6d4ae771e5aae2d5ded8a841ac0a519c05a1de4)
- reduced-motion/1440x900.png (2732cfbf59719753fb35dcb3b29bc1aede8d4396fc11d2de68084a972ea9eb02)

Rerun: `mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs`

This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, production release evidence, or physical-device performance evidence.

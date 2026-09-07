# P2-05 signature motion browser verification

Generated: 2026-09-06T23:48:26.678Z

## Outcome

- Production build: true
- Locale scenarios: 8/8
- Screenshots: 22
- Axe scans: 3; critical/serious blocking findings: 0
- Font loading: 242 production font faces use optional; verified families: 5/5
- Runtime font sets: 8/8 locale scenarios prove document.fonts, CSSOM and computed-stack parity
- Source fingerprint: b4fd4cae61825c31b07f89d08a51ffd487889ce5d9663d42f4bd25b68a6f2fff (p2-05-render-inputs-v1)
- Physical device evidence: false

## Remaining gate

Real mobile-device recording and frame-rate evidence is still required.
Desktop Chrome viewport/touch emulation is intentionally not described as physical-device proof.
LCP, PerformanceEventTiming interaction latency, rAF pacing, and JavaScript transfer bytes are local desktop Chrome proxies; the interaction measurement is not field INP.

## Screenshot SHA-256

- viewports/360x800-en.png (ae673b3d372584ff556365b15d9b127e5f2bca1a7cc519be706cbe465aa3c776)
- viewports/390x844-vi.png (51d35e6dae454aefd2e4970e675fe5ebd796bd518e12ce7e84f00942777628f4)
- viewports/768x1024-th.png (e09f759ad25319d8899a5d64189bd324c396fe2dc89b56e2e9e470a41d0ec697)
- viewports/1024x768-zh-CN.png (bdb424a962ea591968a5ad917193f38228e843e919d516bfbfc673de938143a4)
- viewports/1440x900-ja.png (6e9ecaa969ce06c0fd8453b60bf839f887da08b0a11b031dc443734239a30e5e)
- viewports/1920x1080-es.png (d36a9becbd9951b1dbfb975003b442bf19de5a231f17594da0031c8b806177a7)
- stress/320x800-en-XA.png (b55b05c0566221c7d0c882f699882fa86857895fcc6b247b5aaaf9d81e397568)
- stress/320x800-pt-long.png (7f8c0261e6a00531b435dfdf5ec9963dfbf066035d917ed2a69f024e84132c31)
- hero/390x844-start.png (5067429ab8295478a8ac2eda5c7301b3312a0e8e09d9e6d6e73211897af98072)
- hero/390x844-mid.png (079b335af5187d1780e0528e79a33cd78be3314fd31ef5e9016ec75074246482)
- hero/390x844-end.png (277f3bb5bdfab76b5e56545e348e421dd8d8689ab9cf0b8b98040d4f7aa32044)
- hero/1440x900-start.png (d2e45cf35def194737948bfaca425432ba7b810808956c58036e2f29afa56027)
- hero/1440x900-mid.png (1d525f7b8290e09a85fd44860b2b15b5621ffae142139ff6b1b642c8bba3abbf)
- hero/1440x900-end.png (1ecad14a71380baf2eda1982cb3b0f154ea1fa6a987eba6294816bb558b9a6f2)
- motion/idol-mouse-spatial-1440.png (0bd7a996bee6926626b03ea17bc70083662df1ccd2af6215741f413966774e33)
- motion/idol-keyboard-instant-1440.png (32da896b16ddb55039c52d75f1d2a0a7c456ecf5fcad152267eebb19f28b357e)
- motion/idol-latest-wins-1440.png (08207f4d347d5ce46dd97f8005e8a9329401a7a9fcbff07276b2eba4d837b77a)
- motion/success-end-1440.png (fe03e4379ae0b1f159c210572b6e16e16566097553e3298a9c4d0ebbb8687d60)
- motion/idol-touch-opacity-390.png (963e42c50b839ef2c0562e42f039901e0ac4876e0f0db95288d28b4d5a47cee4)
- motion/add-confirmed-390.png (6eabb2a204f7ec173a9c62108a9307b2c12b896ee5023613b7722c67571000e1)
- reduced-motion/390x844.png (60357115086f715982bd75e4a6d4ae771e5aae2d5ded8a841ac0a519c05a1de4)
- reduced-motion/1440x900.png (2732cfbf59719753fb35dcb3b29bc1aede8d4396fc11d2de68084a972ea9eb02)

Rerun: `mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs`

This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, production release evidence, or physical-device performance evidence.

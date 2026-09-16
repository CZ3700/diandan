# P2-05 signature motion browser verification

Generated: 2026-09-16T08:31:38.941Z

## Outcome

- Production build: true
- Locale scenarios: 8/8
- Screenshots: 22
- Axe scans: 3; critical/serious blocking findings: 0
- Font loading: 244 production font faces use optional; verified families: 5/5
- Runtime font sets: 8/8 locale scenarios prove document.fonts, CSSOM and computed-stack parity
- Source fingerprint: 5f653b29fdf70594da2a3e563518f6ed70e5c811daac62bcc1558cda5f9b0050 (p2-05-render-inputs-v1)
- Physical device evidence: false

## Remaining gate

Real mobile-device recording and frame-rate evidence is still required.
Desktop Chrome viewport/touch emulation is intentionally not described as physical-device proof.
LCP, PerformanceEventTiming interaction latency, rAF pacing, and JavaScript transfer bytes are local desktop Chrome proxies; the interaction measurement is not field INP.

## Screenshot SHA-256

- viewports/360x800-en.png (ae673b3d372584ff556365b15d9b127e5f2bca1a7cc519be706cbe465aa3c776)
- viewports/390x844-vi.png (ba91c7eb3947a2d20458d6d7fc41992c4d6ffe651aee67b35dc1439bd1ac8e13)
- viewports/768x1024-th.png (e09f759ad25319d8899a5d64189bd324c396fe2dc89b56e2e9e470a41d0ec697)
- viewports/1024x768-zh-CN.png (1f08ab666ae00b1d7af7e23971c19be01790ff4bf746e455b68ba478e984423d)
- viewports/1440x900-ja.png (6e9ecaa969ce06c0fd8453b60bf839f887da08b0a11b031dc443734239a30e5e)
- viewports/1920x1080-es.png (d36a9becbd9951b1dbfb975003b442bf19de5a231f17594da0031c8b806177a7)
- stress/320x800-en-XA.png (b55b05c0566221c7d0c882f699882fa86857895fcc6b247b5aaaf9d81e397568)
- stress/320x800-pt-long.png (88669082c576ba8410dc519a9d06ae2864a30371e03581e7dd40e7d61fd98c38)
- hero/390x844-start.png (5067429ab8295478a8ac2eda5c7301b3312a0e8e09d9e6d6e73211897af98072)
- hero/390x844-mid.png (f8f862a92aa998338fec85a9471a0a5b06618e48d6f745ea19162cc3c05cb3e5)
- hero/390x844-end.png (277f3bb5bdfab76b5e56545e348e421dd8d8689ab9cf0b8b98040d4f7aa32044)
- hero/1440x900-start.png (d2e45cf35def194737948bfaca425432ba7b810808956c58036e2f29afa56027)
- hero/1440x900-mid.png (1d525f7b8290e09a85fd44860b2b15b5621ffae142139ff6b1b642c8bba3abbf)
- hero/1440x900-end.png (1ecad14a71380baf2eda1982cb3b0f154ea1fa6a987eba6294816bb558b9a6f2)
- motion/idol-mouse-spatial-1440.png (0bd7a996bee6926626b03ea17bc70083662df1ccd2af6215741f413966774e33)
- motion/idol-keyboard-instant-1440.png (94d94c78facbda3d99a90d6317830462e8dd738e20823a909c2b277b5efffe36)
- motion/idol-latest-wins-1440.png (d3c43c7d32c4dfd4c9dcfdb85315e4cc11130c2a45f4c1dc4408ec557f5178b5)
- motion/success-end-1440.png (fe03e4379ae0b1f159c210572b6e16e16566097553e3298a9c4d0ebbb8687d60)
- motion/idol-touch-opacity-390.png (84e66060476d9c738363f04c33bb28f643efabbff8b6427fc6c40968e36d1aaa)
- motion/add-confirmed-390.png (bb12e022473d29a537b63942eb3507d2e86751940d4517278b3b25bbd3910ce9)
- reduced-motion/390x844.png (6ffc7a0f84f5f46e683d0b336fc298d2750ecb51b05d08fee3fecbf8f169e8a8)
- reduced-motion/1440x900.png (2732cfbf59719753fb35dcb3b29bc1aede8d4396fc11d2de68084a972ea9eb02)

Rerun: `mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs`

This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, production release evidence, or physical-device performance evidence.

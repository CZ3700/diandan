# P2-05 signature motion browser verification

Generated: 2026-09-06T11:56:39.031Z

## Outcome

- Production build: true
- Locale scenarios: 8/8
- Screenshots: 22
- Axe scans: 3; critical/serious blocking findings: 0
- Font loading: 242 production font faces use optional; verified families: 5/5
- Runtime font sets: 8/8 locale scenarios prove document.fonts, CSSOM and computed-stack parity
- Source fingerprint: 75d54d356e504679152738f8216b657873d3f563ce1c7646e41bcb00896368df (p2-05-render-inputs-v1)
- Physical device evidence: false

## Remaining gate

Real mobile-device recording and frame-rate evidence is still required.
Desktop Chrome viewport/touch emulation is intentionally not described as physical-device proof.
LCP, PerformanceEventTiming interaction latency, rAF pacing, and JavaScript transfer bytes are local desktop Chrome proxies; the interaction measurement is not field INP.

## Screenshot SHA-256

- viewports/360x800-en.png (ae673b3d372584ff556365b15d9b127e5f2bca1a7cc519be706cbe465aa3c776)
- viewports/390x844-vi.png (ba91c7eb3947a2d20458d6d7fc41992c4d6ffe651aee67b35dc1439bd1ac8e13)
- viewports/768x1024-th.png (4c74ed2577b828e445d2c45f45628fe03a575257f5a8eee8b41e70d707cec237)
- viewports/1024x768-zh-CN.png (33598a779eeed11642c37f39848e33a75f65df50fdd3c19d3fcaff43768d56e1)
- viewports/1440x900-ja.png (6e9ecaa969ce06c0fd8453b60bf839f887da08b0a11b031dc443734239a30e5e)
- viewports/1920x1080-es.png (c380e2653a579e027e684d4fb1fc73106f22f0fe7db2e2201503d35689ac09fa)
- stress/320x800-en-XA.png (b55b05c0566221c7d0c882f699882fa86857895fcc6b247b5aaaf9d81e397568)
- stress/320x800-pt-long.png (88669082c576ba8410dc519a9d06ae2864a30371e03581e7dd40e7d61fd98c38)
- hero/390x844-start.png (5067429ab8295478a8ac2eda5c7301b3312a0e8e09d9e6d6e73211897af98072)
- hero/390x844-mid.png (a2f5e5547a7332eb71189ab07e0aa0784f7daf50bbaa7625a8e241f4f95755b5)
- hero/390x844-end.png (383055592a2da62f334728ae66f6102c08b07fb5ac23bf8260cc33a1f73d2ac9)
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

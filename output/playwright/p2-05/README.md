# P2-05 signature motion browser verification

Generated: 2026-09-07T08:34:19.022Z

## Outcome

- Production build: true
- Locale scenarios: 8/8
- Screenshots: 22
- Axe scans: 3; critical/serious blocking findings: 0
- Font loading: 242 production font faces use optional; verified families: 5/5
- Runtime font sets: 8/8 locale scenarios prove document.fonts, CSSOM and computed-stack parity
- Source fingerprint: 5c616b53b6b9a51068263d778490996ee972fefff7113adc408a722183474085 (p2-05-render-inputs-v1)
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
- stress/320x800-en-XA.png (b55b05c0566221c7d0c882f699882fa86857895fcc6b247b5aaaf9d81e397568)
- stress/320x800-pt-long.png (7f8c0261e6a00531b435dfdf5ec9963dfbf066035d917ed2a69f024e84132c31)
- hero/390x844-start.png (5067429ab8295478a8ac2eda5c7301b3312a0e8e09d9e6d6e73211897af98072)
- hero/390x844-mid.png (fa2e6920549801fae73e19420b477337f98930ed5971b3ea6fd52a5bc94655b5)
- hero/390x844-end.png (383055592a2da62f334728ae66f6102c08b07fb5ac23bf8260cc33a1f73d2ac9)
- hero/1440x900-start.png (ce716e9d593c5f9a8bd7cd8f5afd6b33d8d3b656d5b5cacf270cf4bf42bc8cb8)
- hero/1440x900-mid.png (9ed6c16abc8adf723d54f2635644ce7d075dbd30c24dde723b4ad241e652f78a)
- hero/1440x900-end.png (575af8798fb1100c478fc172d9efe81cb9f0a91b86fce07ecfede19a81d2cae0)
- motion/idol-mouse-spatial-1440.png (746a52afd251366363a4f09d2d9843f216d8b28435e56ee67c7747c44f62f8cd)
- motion/idol-keyboard-instant-1440.png (19e65387317b6e488d9adc434fb103dcae4380786c6929d65e783ef368171403)
- motion/idol-latest-wins-1440.png (33bc3807c961700fcac4df65c82b2bc1d4e078d15582a3741dc55bdbe3407beb)
- motion/success-end-1440.png (1164816cb1e3a13dc5136d2867880a1595eb2bb2f0052aa46681f25b21ac9f03)
- motion/idol-touch-opacity-390.png (963e42c50b839ef2c0562e42f039901e0ac4876e0f0db95288d28b4d5a47cee4)
- motion/add-confirmed-390.png (6eabb2a204f7ec173a9c62108a9307b2c12b896ee5023613b7722c67571000e1)
- reduced-motion/390x844.png (60357115086f715982bd75e4a6d4ae771e5aae2d5ded8a841ac0a519c05a1de4)
- reduced-motion/1440x900.png (2732cfbf59719753fb35dcb3b29bc1aede8d4396fc11d2de68084a972ea9eb02)

Rerun: `mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs`

This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, production release evidence, or physical-device performance evidence.

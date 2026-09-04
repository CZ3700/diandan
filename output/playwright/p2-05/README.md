# P2-05 signature motion browser verification

Generated: 2026-09-04T18:32:28.397Z

## Outcome

- Production build: true
- Locale scenarios: 8/8
- Screenshots: 22
- Axe scans: 3; critical/serious blocking findings: 0
- Font loading: 242 production font faces use optional; verified families: 5/5
- Runtime font sets: 8/8 locale scenarios prove document.fonts, CSSOM and computed-stack parity
- Source fingerprint: 3579e97760b599fdd3ed5f412e0142672db1d292b7cdfaf81f0ddd4b4b63f5cd (p2-05-render-inputs-v1)
- Physical device evidence: false

## Remaining gate

Real mobile-device recording and frame-rate evidence is still required.
Desktop Chrome viewport/touch emulation is intentionally not described as physical-device proof.
LCP, PerformanceEventTiming interaction latency, rAF pacing, and JavaScript transfer bytes are local desktop Chrome proxies; the interaction measurement is not field INP.

## Screenshot SHA-256

- viewports/360x800-en.png (ae673b3d372584ff556365b15d9b127e5f2bca1a7cc519be706cbe465aa3c776)
- viewports/390x844-vi.png (25d4c77f21d84b572a7fb96fbda90b2a2af4c6618016dc2d620e0f4f8776e379)
- viewports/768x1024-th.png (d94788453fcd9717993d685cdf1e4f5a60471ecc42b4695be23319e97b3dd04f)
- viewports/1024x768-zh-CN.png (bdb424a962ea591968a5ad917193f38228e843e919d516bfbfc673de938143a4)
- viewports/1440x900-ja.png (6e9ecaa969ce06c0fd8453b60bf839f887da08b0a11b031dc443734239a30e5e)
- viewports/1920x1080-es.png (d36a9becbd9951b1dbfb975003b442bf19de5a231f17594da0031c8b806177a7)
- stress/320x800-en-XA.png (b55b05c0566221c7d0c882f699882fa86857895fcc6b247b5aaaf9d81e397568)
- stress/320x800-pt-long.png (7f8c0261e6a00531b435dfdf5ec9963dfbf066035d917ed2a69f024e84132c31)
- hero/390x844-start.png (5067429ab8295478a8ac2eda5c7301b3312a0e8e09d9e6d6e73211897af98072)
- hero/390x844-mid.png (0ab76120abdc155859eaa350b5913de58e0e64977726425800adfedb628defac)
- hero/390x844-end.png (277f3bb5bdfab76b5e56545e348e421dd8d8689ab9cf0b8b98040d4f7aa32044)
- hero/1440x900-start.png (d2e45cf35def194737948bfaca425432ba7b810808956c58036e2f29afa56027)
- hero/1440x900-mid.png (1d525f7b8290e09a85fd44860b2b15b5621ffae142139ff6b1b642c8bba3abbf)
- hero/1440x900-end.png (1ecad14a71380baf2eda1982cb3b0f154ea1fa6a987eba6294816bb558b9a6f2)
- motion/idol-mouse-spatial-1440.png (746a52afd251366363a4f09d2d9843f216d8b28435e56ee67c7747c44f62f8cd)
- motion/idol-keyboard-instant-1440.png (19e65387317b6e488d9adc434fb103dcae4380786c6929d65e783ef368171403)
- motion/idol-latest-wins-1440.png (33bc3807c961700fcac4df65c82b2bc1d4e078d15582a3741dc55bdbe3407beb)
- motion/success-end-1440.png (1164816cb1e3a13dc5136d2867880a1595eb2bb2f0052aa46681f25b21ac9f03)
- motion/idol-touch-opacity-390.png (84e66060476d9c738363f04c33bb28f643efabbff8b6427fc6c40968e36d1aaa)
- motion/add-confirmed-390.png (bb12e022473d29a537b63942eb3507d2e86751940d4517278b3b25bbd3910ce9)
- reduced-motion/390x844.png (60357115086f715982bd75e4a6d4ae771e5aae2d5ded8a841ac0a519c05a1de4)
- reduced-motion/1440x900.png (2732cfbf59719753fb35dcb3b29bc1aede8d4396fc11d2de68084a972ea9eb02)

Rerun: `mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs`

This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, production release evidence, or physical-device performance evidence.

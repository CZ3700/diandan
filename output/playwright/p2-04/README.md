# P2-04 UI composite browser verification

Generated: 2026-09-04T15:27:17.893Z

## Outcome

- Scenarios: 16/16 passed
- Screenshots: 18
- Axe scans: 10; critical/serious blocking findings: 0
- Native Chrome zoom: 200.0% detected for requested 200%
- Source fingerprint: beac9df29fbaff97f088b13f7bf92a929f302534946597377944843def7c5c03 (p2-04-render-inputs-v1)

## Runtime gates

- preview: health 200; locale routes 200, 200, 200, 200, 200, 200, 200, 200
- staging: health 200; locale routes 404, 404, 404, 404, 404, 404, 404, 404
- production: health 200; locale routes 404, 404, 404, 404, 404, 404, 404, 404

## Screenshots

- viewports/360x800-en.png (08bf4abfa4f5131b6ff8b40375139f4825e83b03d812f360c188c87416245b86)
- viewports/390x844-vi.png (465cccbf08d6e42ba9a92c8dd414b069ebda1948920702a2d6d1bce9c74f8da7)
- viewports/768x1024-th.png (3a375143292eaca1b010e15f89a6e72ffcf8a0d072d33e0ebb85df32ea4a9cb9)
- viewports/1024x768-zh-CN.png (bc28ed32c45e17974665e2977a3ee5241f810e360478d0812088a09c196ba301)
- viewports/1440x900-ja.png (8baab1ad2a8844cc42a679653ccddbae233a6656846a4843bcaacb10f7a2d4c3)
- viewports/1920x1080-es.png (9ee49a9bc4934ddcf996d2f042fc6d6e79b96ec5ec8d43ae5a98c33307a88ac5)
- responsive/767x900-pt.png (70c0b101962a8b781487c7178974648b669fa05ef97eee3d08b40b938eeb6263)
- responsive/1023x900-en-XA.png (4ed1fe8fe1698fd1ed0b4bc7f3f0b452e5f07fb7b85c8d8d709056b035ba88b5)
- stress/320x800-en-XA.png (5da52e8d4995d7dab9352b2675234d49816cabc606dd2b56b6962836c7fcf9ad)
- stress/320x800-pt-long.png (10708d066d68fc364c9593ff20bb104b8f67721bc8450b7f60bc0d808b74ab42)
- states/390x844-en.png (a19593097ac2c358e070899885e04fb8b11c4efdbd3ba814057312e7154d3079)
- interactions/1440x900-en-hover.png (4623e6193e2302a3bdfb6fd4fd3138bed6359a80265ef20e9a9836e32ff66862)
- rtl/390x844-en.png (bdab96d95651618fcd6fa1b49afdc49ae86bb35f53f6970fe032862bf7dc6b6a)
- rtl/1440x900-en.png (45a352bcf82df0a1b1d910f71bc002b85ca319f8634914b8b7eda59abc509d49)
- reduced-motion/390x844-en.png (37fbabf45ce7f80539fbaf1b0bda8614ffb438ad571a8f64a06e6a7eab68802c)
- reduced-motion/1440x900-en.png (5879c6eeb1816d75fc6a54bf9c385b8db7136247370084f35b15c212712737ee)
- zoom/google-chrome-baseline-pt.png (b4ee6e35a9b81973f63bca2507fcb1adebcbfa3724fb04e676a95ab5ed254eed)
- zoom/google-chrome-200-percent-pt.png (b32881c7429c0689d0fc523496c9411b4743fba81c9952f88c3a41c6ed5de540)

Rerun: `mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs`

This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, formal brand approval, or real-device performance evidence.

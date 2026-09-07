# P2-04 UI composite browser verification

Generated: 2026-09-07T19:29:52.332Z

## Outcome

- Scenarios: 16/16 passed
- Screenshots: 18
- Axe scans: 10; critical/serious blocking findings: 0
- Native Chrome zoom: 200.0% detected for requested 200%
- Source fingerprint: 0375b6e34fd5936d7fb1dc29c6d678c48009008dcb0ead008b914e403b050d50 (p2-04-render-inputs-v1)

## Runtime gates

- preview: health 200; locale routes 200, 200, 200, 200, 200, 200, 200, 200
- staging: health 200; locale routes 404, 404, 404, 404, 404, 404, 404, 404
- production: health 200; locale routes 404, 404, 404, 404, 404, 404, 404, 404

## Screenshots

- viewports/360x800-en.png (deb21036e29bfe7ee2bbf44d0f3f7b370c254d2578f8969663f530ea0c934a53)
- viewports/390x844-vi.png (7ca8e3f970b92e167227aaa12ce17954abd4435ee42d27df2e782cada15ce927)
- viewports/768x1024-th.png (addd8f241ba7111c1b0dad09bac60796a597c469fe57b56b578869e2649cbfe2)
- viewports/1024x768-zh-CN.png (f3eebfb7354acc273ab176d464b4b66f4ecdc7e62847c43269f1ae5886bdf082)
- viewports/1440x900-ja.png (b0e55f70f0e388c1f99c0408610c8237ef60dbb3a3b3566922f02d6759dbdad6)
- viewports/1920x1080-es.png (fa7bbe23c814a29d82b90f7540ab97f9f61509136602299ac59529da17344f1b)
- responsive/767x900-pt.png (7fa3a9bfc36ad6c86f863a1700cbe9eee9d0b8e99e2308f894f96125861a37c0)
- responsive/1023x900-en-XA.png (be11759f7bbd5461571515dcd82a06cbf17c0eabaa19b86fc5fb94e374a59214)
- stress/320x800-en-XA.png (aab4ff7728a331d472133a4e319c5132b6d8e7b49d863b4b4269cc4c2698124f)
- stress/320x800-pt-long.png (7afdec5d6fa080bc44e276b8300d4d19d75819bc873cea580b26364bb25169ea)
- states/390x844-en.png (de165241341c56d107f3258781e3186527f0827980abf78845529e5bcc0b8306)
- interactions/1440x900-en-hover.png (e94aa7a2a7719ea7bcf7627baf697cccca1db0a931fc187e00ed038e1b438094)
- rtl/390x844-en.png (39936c3e84aedeb7f93d774b00c497ca5693dbdad5aaf8d44e67d79e76a781cd)
- rtl/1440x900-en.png (908ae7b3a52a280cce443286e2517137c5335c9f15fa081d38847fea8bdf35a9)
- reduced-motion/390x844-en.png (d6be4c23036ab6eb37dbda81d2c6d6d5069d71763265de17fa7007499c692b7a)
- reduced-motion/1440x900-en.png (76024aeffb42410fa9a71ec19e4844eaaea8b53cf79b85e0a915915e87ebb35b)
- zoom/google-chrome-baseline-pt.png (8f905c8969f182c1461aa4d02f360733a8b8d50595c2334a73fa75970abcf02f)
- zoom/google-chrome-200-percent-pt.png (ed864f5115e493e2440e0df3d932d48612d62dac533589a4fbc4bb5bcc01ccfd)

Rerun: `mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs`

This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, formal brand approval, or real-device performance evidence.

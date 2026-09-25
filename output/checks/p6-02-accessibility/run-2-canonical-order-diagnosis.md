# Run 2: canonical order-route race

- Original run 2 remains FAIL. Snapshot: `ceb34259-ca6d-4c08-9f30-4a5f0552e1c2`, owned instance `test-regression-122406e4658e499c`.
- Retained failure is `en-mobile:mail-order`; the real mail link was reached with visible, unobscured keyboard focus. The timeout is after `accessibility-flows.mjs` navigated to the URL sampled from the transient access page, then `regression-journey-browser.mjs:229` awaited paid-order content.
- Product `order-client.tsx` can render `OrderDetail` after successful exchange, then independently call `window.location.replace` in its effect. A paid DOM plus a cleared hash therefore does not establish that the canonical `/:locale/orders/:publicOrderId` navigation has completed.

The controlled real-Chrome test `a paid transient access view is not the final protected order route` recreates this sequence: the access route renders paid content, clears its fragment, and replaces itself after 200 ms. Before the fix, the assertion read `/en/order-access` instead of the canonical route and failed. After the fix, the helper waits for the exact configured origin, locale and public order path with an empty fragment, then verifies paid content. The test passes and a subsequent reload remains on the canonical order route.

Only browser-verification code changed. No product route, token lifetime, permission or payment behavior changed. Run 2 was not restarted or mutated for this controlled fixture; its original report and TEST data are retained. The controlled browser is closed by the test teardown. Complete fresh-run acceptance is still required.

Validation after the fix: 14 accessibility-tool tests PASS; related Prettier and ESLint PASS. No cookie, token, private message, mailbox content or raw browser error is included in this report.

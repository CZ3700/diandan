# P5-08 local Next development issue classification

Instance: `acceptance-e143d720dd1a4357a3c3`.
Accepted FULL evidence: `output/playwright/p5-08-local-experience/acceptance-e143d720dd1a4357a3c3-1790153667799/`.
Public order: `13953df2-a8be-49dc-ba2a-c5b2fa6cc2c1`.

## Finding

The red Next development “1 Issue” badge in `en-390-paid-order.png` is the React Flight development console diagnostic `REACT_DEV_EVAL_BLOCKED`. The observed message begins “eval() is not supported in this environment.” and explicitly states that React never uses eval in production mode. Browser source location: `/_next/static/chunks/0747_next_dist_0obo_34._.js`, line 1052, column 31 (Playwright location metadata).

The private order page correctly excludes `unsafe-eval` from its CSP. React's development client checks whether eval is available for debugging/call-stack reconstruction, catches the CSP rejection, and emits this console error. This is a development debugging limitation. It is not evidence of a hydration mismatch or an uncaught application exception. No production runtime was exercised by this diagnostic; the development-only conclusion is grounded in the explicit source guard and the absence of this helper/message from the corresponding production bundle.

## Local source evidence

- `apps/storefront/src/proxy.ts:49-51`: private order pages receive `script-src 'self' 'unsafe-inline'; connect-src 'self'`; there is no `unsafe-eval`. Actual document response confirmed this and retained `frame-ancestors 'none'` and `frame-src 'none'`.
- `apps/storefront/node_modules/next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-client.browser.development.js:12-25`: the non-production guard encloses `checkEvalAvailabilityOnceDev`; lines 17-22 try eval, catch its rejection, and log the exact observed diagnostic.
- The matching `react-server-dom-turbopack-client.browser.production.js` contains neither `checkEvalAvailabilityOnceDev` nor the diagnostic message.

## Actual read-only observations

1. First diagnostic session: opened an existing local mailbox secure link and successfully read back the exact original public order. The browser reached the matching localized order URL and `[data-order-public-id]` matched. Two console events (access page and order navigation) were the same React development eval diagnostic. There were zero `pageerror` events. No hydration diagnostic was observed. The browser was closed.
2. A subsequent session reused that already redeemed one-time link. Exchange did not succeed. This diagnostic is retained as `next-development-issue-consumed-link-diagnostic.json` in the accepted FULL evidence directory; it is explicitly incomplete and does not replace the successful original readback or the FULL/RESTART acceptance. The browser was closed.
3. A final session directly opened the original order URL without an access session. This isolated the same private-page CSP without consuming another mail link. Opening the Next issue panel confirmed its “Console Error” is the eval diagnostic and that its message explicitly excludes production. No hydration-mismatch message appeared, and `pageerror` remained zero. The unauthorized order-resource request also produced a browser network console error; its HTTP status was not captured in this diagnostic, so it is not assigned a specific status here. `next-development-issue-diagnostic.json` retains this distinction as `NEEDS_REVIEW` at the aggregate console level; the actual Next issue panel's diagnostic was positively classified. This unauthenticated read does not establish an authorized order readback. The browser was closed.

The distinction matters: zero `pageerror` events does not mean zero console errors. The accepted FULL/RESTART result remains 799 + 109 assertions; this note adds the development-display limitation rather than relabeling those runs as console-error-free.

No business payment, refund, fulfillment, configuration or content mutation was performed during this investigation. No private message, display name, email, access token, certificate pin or raw business error was recorded in these reports. No screenshots were taken during diagnosis. No application or acceptance source was changed, the CSP was not broadened, and the Next issue badge was not hidden. All diagnostic-owned browsers are closed; instance lifecycle remains with the root agent.

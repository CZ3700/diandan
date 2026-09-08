# Final compiled Drawer and Header verification

Source: production generation 5, build-input aggregate `df759a88a8dd62d8f08a08eccf87f2e29781e867ffffe955e4f554b7cadce62e`. `source-final.json` explicitly covers 995 app/package build inputs, including styles/assets/configuration, and excludes tests, diagnostic scripts, generated Next declarations, docs and output. Both browser invocations validate the exact sorted-path/NUL/hash algorithm and rehash their owned product files before starting. They do not confuse the earlier 1,664-file candidate manifest with this build-input scope.

Final results:

- `drawer-browser-attempt-2/results.json`: **23 cases / 153 assertions / 23 PNG PASS**, Chrome 152.0.7977.82, 2026-09-08T02:55:51.790Z–2026-09-08T02:56:31.805Z. Actual lazy export `/_next/static/chunks/24kmabcq-7xqq.js`, SHA-256 `6ed91078a09e1c991d30330c4590010a0b3c598eb649750024df0ff3dcda4629`; all fresh contexts confirmed it absent from initial requests.
- `header-browser-attempt-2/results.json`: **11 cases / 67 assertions / 11 PNG PASS**, 2026-09-08T02:56:54.609Z–2026-09-08T02:57:15.019Z. This repeats the original language-menu regression with the new lazy outer navigation Drawer, including first arrows, same-document script retry and nested cancellation.
- Both processes exited 0; all owned Chrome contexts and browsers closed before root resumed full UI/Lighthouse. All 34 referenced final screenshots exist. No product file changed to obtain these results.

The Drawer cases cover the header navigation, gift recipient picker and mobile gift filters. Every surface uses a fresh context for cold click, touch, Enter and Space, then repeats the same open/close cycle. Assertions check first-touch focus is exactly the popup, keyboard focus remains within the original modal trap, Escape restores the real trigger, delayed import cancellation by Escape/Tab preserves the original button and the user's current focus, and a subsequent activation succeeds. Each surface recovers a real injected script 503 by local retry. A separate two-failure case reaches the explicit exact-URL reload link and restores the actual filter form. Nested Menu close keeps the Drawer open and returns focus to the language trigger.

Preserved first failure: `drawer-browser-attempt-1/results.json` reports **21 PASS / 2 FAIL**. Both failures occurred after the first-touch popup-focus check and forward Tab had passed: an immediate reverse-Tab observation saw a SPAN outside the popup. This was not described as a broken first touch. Installed Base UI `floating-ui-react/components/FloatingFocusManager.js:568–573` routes the inside guard to the last tabbable element via `utils/enqueueFocus.js`, which uses requestAnimationFrame. The existing P2 browser verifier already handles this exact inside guard in `assertFocusInside` at `scripts/verify-ui-interactions-browser.mjs:2449`, with a bounded 500ms wait for real popup containment.

The dedicated harness now records the immediate inside/guard/type observation. Only `data-base-ui-focus-guard` with `data-type=inside` may receive that same 500ms settling window; a guard itself never passes the final condition. Other outside focus still fails. The second run reproduced those two transient inside guards and then verified actual focus within the modal. The first-touch exact-popup condition, eventual focus containment, all other assertions and product code are unchanged. The original failed report/screenshots remain intact. This is a test timing correction aligned with the existing primitive and checker, not a relaxed final focus requirement.

No whole-workspace check, performance score, seven-language browser matrix, physical touch-device, BFCache or VoiceOver result is claimed here. The scopes use English UI; Header also exercises one actual locale switch. Root runs final all-locale acceptance and Lighthouse separately.

Re-run only when root releases the browser slot and supplies a live compiled TEST fixture:

```sh
mise exec node@24.20.0 -- node apps/api/scripts/storefront-drawer-lazy-browser.mjs <origin> <fixture-manifest.json> <public-storefront-media.crt> <new-output-directory> <source-final.json>
mise exec node@24.20.0 -- node apps/api/scripts/storefront-header-lazy-browser.mjs <origin> <fixture-manifest.json> <public-storefront-media.crt> <new-output-directory> <source-final.json>
```

Both runners reuse the existing certificate-specific browser helper; no private key, auth session, business-success stub or blanket TLS exception is used. Final Drawer runner SHA-256 `c9052e977120a85e9fa20bb34d4b0061fc3cd79bc57fd925dcf8acbac01c48a0`. Scoped formatter/lint/node syntax checks passed; no new browser was opened after the final run.

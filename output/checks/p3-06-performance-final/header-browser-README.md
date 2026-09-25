# Header lazy-menu browser evidence

Actual compiled TEST result: **PASS, 11 cases / 67 assertions / 11 PNG**, Chrome 152.0.7977.82, 2026-09-08T02:26:58.697Z–2026-09-08T02:27:19.941Z. The browser and owned contexts closed; process exit 0. `header-browser-attempt-1/results.json` and its screenshots are retained unchanged.

Source candidate aggregate `009fd05e5d10c737a50c01b1f9c197e0714ff17a46e555ccdbb2412b270b3f3b` is root's production generation 3. The actual emitted lazy module is `/_next/static/chunks/3asu8ps532yh2.js`, SHA-256 `5580b6938dd7703d783cad15282ccfd77c6de59031d58651e0a85e1658ecdcf0`. Every fresh context confirmed this module absent from initial traffic before the actual interaction. This proves the bounded request boundary, not total JavaScript savings or an LCP result.

Cold ArrowUp focused option index 6; ArrowDown index 0. Enter/Space, three repeated open/close cycles, delayed import cancelled by Escape or Tab, an injected actual script 503 followed by same-document retry, mobile first ArrowDown and parent Drawer close while loading, and real locale navigation with unchanged commerce query all passed. The hypothesized inline Popup ref cancellation did not reproduce in these cold runs; no speculative product change was made.

The facade's resolve-before-commit Escape window additionally has a controlled closure regression. Browser delay tests cover cancellation while the real module request is pending. They are not evidence for physical-device, VoiceOver, BFCache, or every possible concurrent React interleaving. Seven-language SSR trigger compatibility is covered separately by the 8 boundary tests; this focused browser run uses English UI and one actual switch to the next canonical locale.

Run from the isolated worktree, after root provides a production build and releases the browser slot:

```sh
mise exec node@24.20.0 -- node apps/api/scripts/storefront-header-lazy-browser.mjs <origin> <fixture-manifest.json> <public-storefront-media.crt> <new-output-directory> <source-candidate.json>
```

The runner reuses `withAcceptanceBrowser`: exact fixture certificate SPKI pin, process-local media hostname mapping, no blanket TLS bypass or operator cookie. Only the identified real lazy script is delayed or receives the explicit 503; no successful API/menu response is mocked.

After this actual run, root requested stronger source provenance. The final runner now validates the candidate's exact `sha256(sorted relative path + NUL + content sha256 + newline)` algorithm, count and declared aggregate; it separately rehashes all five owned Header/UI product files and records the raw manifest hash. `header-product-freeze.json` independently confirms those current product bytes equal the tested candidate. The old browser report is not rewritten to pretend these new metadata checks ran inside the original invocation.

Post-run runner cleanup also makes `browserClosed` and overall PASS conditional on successful completion of the existing browser lifecycle. The 11 interaction oracles, timeout budgets, and fault injection are unchanged. These metadata/lifecycle edits have 3 light node tests PASS, scoped formatter/lint exit 0; no second Chrome run was started during root's Lighthouse window. Final runner SHA-256 `a50615ef6847701fa05eea7e64edc7b54037ca43ac746fdde17e5f94f6eaa2ef`; source-binding test SHA-256 `2820947e49d4c717d3f4e9fdf7261864e6deb29b526a8b1d77de0ef6a53e3dee`. Logs: `header-source-binding-tests.log`, `header-browser-scope-format.log`, `header-browser-scope-lint.log`.

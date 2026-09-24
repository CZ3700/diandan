# Independent review of parent changes

Reviewed the dependency upgrade, known-advisory CI guard, RUM v2 contracts/aggregation/CLI/browser evidence consumer, generated contract registry, and operational documentation. No blocking defect was found in this reviewed snapshot. This reviewer authored the separate TEST-mail GCM change and does not count its own review as independent acceptance. Source identities are in `independent-review-source.json`; the tree was not yet globally frozen.

- Next.js is pinned to 16.3.6 in both apps and the lint plugin; lock changes are confined to that Next family. The additional guard covers the published `>=16.2.0 <16.3.6` range numerically, rejects unpinned/prerelease declarations, checks secondary Next resolutions and manifest/importer alignment. npm audit remains in the CI command and retains its network/advisory limitations. The guard is specific to the named known advisory; it is not a replacement for current advisories.
- `security:dependencies` and `security:regressions` are required in the strict CI contract. The regression command builds observability and its dependencies before running local route, mail and CLI tests; the existing required workspace tests cover the new contract/aggregation suites. No secret-rule relaxation was introduced.
- The generated schema deep comparison found exactly one new entry, `/$defs/RumReportV2`, with all existing definitions unchanged (`rum-generated-contract-compatibility.json`). Source v1 schema and `aggregateRum` conflict rejection remain unchanged.
- v2 validates every observation, window and maximum count, detects identity and same-revision value conflicts in all arrival orders, quarantines all in-window records of each conflicting key, and aggregates other observations through the original p75/sample/source grouping implementation. Any conflict marks all output rows DEGRADED. Empty or fully quarantined data cannot produce a budget PASS. No raw measurement keys are emitted.
- The CLI emits v2, returns successful generation of a DEGRADED report with `fieldAcceptance:false`, and rejects malformed RUM records without printing source lines. The dashboard retains v1 decoding with a legacy label, uses escaped JSON and textContent, labels missing data INSUFFICIENT, and explains that CLEAN is not authentication or release acceptance. The browser verifier compares real CLI output with v2 and continues to require local/automated data; no browser run was performed by this reviewer.
- The runbooks correctly distinguish local TEST coverage from IdP/PSP/WAF/staging validation, acknowledge that anonymous field data is untrusted, preserve the September 30 advisory recheck gate, and do not claim a remote exploit for the TEST-mail issue.

## Executed verification

Node 24.20.0 directly invoked the installed tools; no pnpm exec or service operation was performed. `independent-review-rum-checks.json` records contracts 3/3 and observability 15/15 tests passing; `independent-review-checks.json` records CLI/dependency/UI-evidence checks 18/18 and the CI contract check passing. The first two Vitest invocations failed before testing because a relative config was resolved under each package root; their logs are retained. Absolute config paths then ran the actual suites successfully. No PostgreSQL or browser integration result is claimed here.

## Pending coordination

IaC author is completing real offline provider-schema/mock-plan tests. Final scanner refresh is intentionally deferred until the parent announces source freeze.

## Independent IaC source review

The frozen edge change was compared against actual API registration in bootstrap/admin-access/payment-webhook/admin-finance routes and storefront/admin BFF paths. Six operation scopes cover their methods and both public prefixes, with anchored path-segment expressions that do not create per-object counters. Each AWS rate statement aggregates source IP, combines exact method with decoded/normalized URI matching, retains the global rule, disables raw sampled requests, and takes explicitly validated thresholds/windows. Dynamic single-route AND and multi-route OR nesting were inspected. The stack rejects missing/extra policy names and out-of-range/fractional limits/windows. The new variables are passed explicitly from stack to edge. No remote enforcement is asserted.

Direct Node route and infrastructure safety tests passed 7/7; the final CI contract check passed (`independent-review-iac-checks.json`). The author's final real offline mock-plan run remains a separate required input; this reviewer did not start a concurrent OpenTofu invocation.

The runbook accurately retains count-before-block, private-origin, shared-NAT, callback and PSP-retry deployment validation. AWS documents evaluation windows 60/120/300/600 and approximate rate enforcement with propagation delay/reset on changes: [settings](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-high-level-settings.html), [caveats](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-caveats.html). This does not establish exact per-request application quotas or protection for direct local TEST connections.

## Final IaC evidence verification

The author supplied `../iac-final/result.json`: all 14 tool commands exit 0, with cloudEvidence false. This reviewer independently recomputed all 21 input hashes and found no mismatch with the frozen tree (`independent-iac-final-evidence.json`). Detailed logs were read directly: ../iac-final/6-bootstrap-test.log = 1 passed, ../iac-final/10-registry-test.log = 1 passed, ../iac-final/14-stack-test.log = 16 passed, all 0 failed. Logs are .gitignore-excluded, so ordinary rg --files did not list them; their .log.txt copies are also being retained by the author. No second cloud or OpenTofu execution was performed by this reviewer.

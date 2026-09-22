# P5-05 failure and correction record

Original local `.log` files are retained. A failing parser, missing tool or install wait is not described as a valid behavior RED test.

## Product defects found and corrected

- SQL draft validation originally admitted some JSON values that the contract rejects. Actual native PostgreSQL document cases now cover numeric strings, missing/extra keys, invalid array elements, duplicate values and bounds.
- Canonical routing inserts and copied approvals needed exact immutable document/review evidence. Deferred constraints and actual direct-SQL rejection cases cover these boundaries without editing historical migrations.
- Published translation inheritance was initially absent. `storage-copy-red.log` fails because unchanged published text remains DRAFT; the final native run passes all copy cases without creating a new human approval audit.
- LIVE/internal account eligibility, full replacement diff capacity, and UUID case normalization have dedicated observed RED/GREEN tests. Canonical UUID handling is limited to new configuration contracts; old contract roots remain intact.
- Saved draft account references initially used a different capacity set from workspace reads. The final capacity check covers managed history, deployed accounts and incoming channels before writing.
- Response correlation initially allowed a publication receipt without a publication identity/positive generation. Application/API/client tests now reject it and preserve uncertain requests.
- Independent configuration reads needed finite connection/query/transaction deadlines. Real blocked reads now fail within their bound, discard late resources and recover after the lock is released.
- Empty dynamic startup and an in-flight local health-policy refresh needed explicit handling. Old static initialization requirements remain unchanged; PostgreSQL still fences stale probe completion.
- Real two-process HTTP runs exposed a production integration defect: route registration cached initial action origins despite the composition's dynamic getter. Successful payments through a newly published connector could then be rejected during response validation. The route now reads and strictly validates current trusted origins when checking the response; unknown origins remain rejected and historical origins remain available. The persistence owner independently re-ran 10 route/projection tests after identifying the defect.

## Test and integration corrections

- Initial storage migration iterations exposed SQL trigger row-shape/name errors and incomplete new-migration registration. The candidate was not accepted until actual migration up/down/up and catalog equality passed.
- `runtime-first-observed-green.log` ran after an automatic workspace install wait; it is not counted as a RED observation. Application, route, health, lifecycle and composition have separate actual RED evidence.
- `ui-diff-red.log` initially contained a JSX parse error, not a behavioral failure. Corrected render tests pass; other UI client/editor/access tests have observed behavioral RED evidence.
- Whole-workspace typechecking found TEST fixture issues hidden by transpile-only tests: domain tests referenced an unavailable environment global and assigned raw primitives to branded fields, a stalled-client mock lacked the transaction-client signature, and a dynamic-startup fixture lacked parsed branded configuration. These were corrected in tests without relaxing TypeScript settings or production schemas.
- The first real HTTP initialization correctly rejected a TEST locale-grant/audit pair created in separate transactions. The fixture now creates the exact audited pair together; the database guard was retained.
- The sixth HTTP run reached actual new-channel payment and old-account recovery, then failed a TEST expectation for zero rollout. The established API returns `CAPABILITY_UNAVAILABLE` for an explicitly selected country with no available route; the fixture now asserts that refusal and separately checks the empty list without a selected country. Product semantics were retained.
- The UI's editor heading levels and returning to payment settings were corrected. Real browser navigation assertions verify reloading current draft/publication data; no mounted-component RED run is claimed for navigation.
- The seventh HTTP run exposed another incorrect fixture expectation: a payment capability from an old configuration is rejected with `STALE_CONFIGURATION`. The fixture now checks that established behavior; payment admission was not weakened.
- The first complete HTTP/UI run passed all 313 protocol assertions, then failed at the Spanish mobile settings screen. The fixed three-column navigation let the actual Manrope text extend 2.266 pixels beyond its button; axe reported one incomplete obscured-text check. A real Chrome comparison reproduced it and verified the minimal auto-fit column fix with zero violations/incomplete checks. The complete browser runner now also checks every navigation text line fits inside its button; the original failed run and screenshots remain retained.
- Automatic installation updated an unrelated `third-party-web` transitive dependency. Root removed that unrelated change and completed an offline frozen install; the lockfile change contains only the intended payment-gateway workspace dependency.

Final acceptance and any remaining failures are recorded in `final-verification.md` once all required combined checks complete. TEST PSP success does not establish real merchant sandbox or production readiness.

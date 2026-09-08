# P4-04 coordinator review

Scope: current local P4-04 checkout/payment runtime checkpoint. Real PSP approval and sandbox remain open; P4-04 is not eligible for DONE solely from the TEST provider.

## Independent review boundaries

- `application-independent-review.md`: non-author review of the root's original Application orchestration; later action-recovery code is separately reviewed below.
- `root-followup-independent-review.md`: non-author review of permanent receipt race handling, Domain recovery edge and normal TEST configuration publication.
- `psp-independent-review.md`: non-author review of independent TEST PSP persistence and protocol. Initial stable-event identity defect and later resolution remain visible.
- Root reviewed the action-recovery change from the UI/review agent: authenticated matching reconcile is validated before GET_PAYMENT; lookup fixes account/environment/attempt/external reference; normalized action must retain pinned locale/fallback, supported type and allowed origin. KMS remains outside SQL, recordReconcile receives only encrypted action under the original fenced claim. Ordinary reads do not query the provider. This change does not grant GET financial authority.
- Root reviewed the migration approach: original 0001–0025 SQL files remain byte-identical. The forward 0026 migration replaces the original payment mutation function for only the authenticated UNKNOWN→REQUIRES_ACTION edge, retaining the old body and requiring encrypted hosted action. Down restores the original definition and refuses to remove durable payment-runtime history.

## S.U.P.E.R

| # | Check | Current conclusion |
|:--|:--|:--|
| 1 | One purpose per module | PASS: contracts, creation, lookup/action, reconciliation, persistence, lifecycle and UI transport separated |
| 2 | One conceptual responsibility per function | PASS: multi-step payment execution is orchestration; DB persistence and provider/KMS calls remain separate |
| 3 | Dependencies point inward | PASS, original final repository boundary command exit0: UI/BFF→API/Application→Domain/ports→configured adapters |
| 4 | No circular imports | PASS: original final type/build/boundary gates exit0 |
| 5 | Explicit boundary contracts | PASS: public and internal Zod schemas; normalized original payment port; current old contracts unchanged |
| 6 | Serializable I/O | PASS: durable claims, commands, receipts and encrypted actions; no process-local PSP map is business evidence |
| 7 | Configuration supplied externally | PASS: deployment origins, account binding, locale map and scheduling configuration; hardcoded synthetic values confined to TEST fixtures |
| 8 | Dependencies declared | PASS: workspace payment port/Fake TEST/content dependencies explicitly declared; lockfile installed offline |
| 9 | Replaceable implementations | PASS: independent TEST provider connects through the existing payment port; production imports no Fake and needs deployed registration |
| 10 | Required checks | PASS for this local TEST checkpoint: final 31-case browser and all 38 original check steps have actual passing coverage, including documented repeats; not a single full-check exit0; real PSP still open |

Contract artifact comparison currently proves all 502 old roots, 87 old paths and 161 old public components unchanged. Existing 2,349 untracked files were verified unchanged before shared browser collection; final verification repeated all 2,349 hashes with no changes.

## Intentional remaining work

This checkpoint does not finalize order/payment/inventory success, send notifications, implement lookup-token exchange, or select a real PSP. P4-05/P4-06 and real provider inputs retain their documented boundaries. Native device/VoiceOver, final translation approval, performance and production rollout remain separate evidence requirements.

## Final checkpoint acceptance

Final source: 1979 inputs, SHA `88c0bbbac1a1299885cafc7f27dd8999f4197518e55e0fcb4dd8f13dd80ee744`. Root reviewed the final PG boundary fix: removing the newly added unused factory export restores the baseline public entrypoint, retains the internal factory and managed transaction composition, and adds a negative regression. The original adapter checker now passes without relaxation. All seven final quality commands passed; see `gate-coverage.json` for the full original 38-step mapping and explicit source evolution.

Publication authorization/CLAIM_WINDOW failures and the existing 5-second contract test timeout remain visible; later passing repetitions do not establish their causes or a fix. This limitation does not authorize a PSP release or changing task completion status. Source snapshots distinguish TEST copy seed and final barrel changes from the earlier browser freeze; business implementation and SQL remained unchanged across the final export correction, while public build bytes changed.

Post-commit additional whitespace check: `git diff f1f702f f5435cd --check` exits 2 solely for one extra EOF blank line in each 0026 SQL file. The coordinator's staging command did not stop the following local commit on this result. The PG non-author independently confirmed exact file/manifest/freeze/commit hashes and complete SQL endings. These two nonfunctional format notices are explicitly retained; the original 38 required gates passed as documented, but not every additional check is green. Tested migration bytes remain unchanged.

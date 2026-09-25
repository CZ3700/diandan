# Final-8 artifact privacy review

Bounded PASS for the frozen `final-8` evidence, source hash `642a55a818680d763f41ce5d87b5386092591ea5341c92ce4e88c8248bcb8b72`. The original run remains FAIL: quality, catalog and commerce completed; operations is partial and journey did not run. This review does not change that status or validate the forthcoming operations/journey reruns.

The collected archive contains 723 files: 135 JSON, 2 Markdown and 586 PNG. Scanned all 137 archived text files plus 22 outer runner text files (10,601,086 bytes), including raw text, URL-decoded text and parsed JSON strings. All JSON parsed. Twelve exact test-canary/token patterns produced **zero matching files or values**. Definitions and a SHA-256 inventory of every scanned text file are in `privacy-final8.json`; no matched private values are persisted or printed.

A field-name pass found two `authorization` fields containing closed outcome codes (producer `admin-orders-auth-locks.mjs:123` writes `errorCode/result.code`) and 5324 axe diagnostic `message` fields in 13 accessibility reports. These are test diagnostics, not private intent fields. No unresolved sensitive-field finding remains. This check is limited to the explicitly listed patterns and fields and is not a generic PII detector.

Directly viewed five archived screenshots. Three show opaque magenta masks: mobile gift private-message input, English desktop checkout email input and Chinese mobile checkout email input. Two additional post-save/post-checkout images show presence labels/order details without private messages, full fan names, contact values or secure-access tokens. Paths and SHA-256 hashes are recorded in the JSON. The saved cart labels contain public artist names, which are distinct from the full fan display name. The order screenshot contains a public fixture order ID, not an access token. The other 581 PNG files were not exhaustively inspected.

The cart/checkout/order screenshot producers first assert that exact private canaries are absent from body text, then mask the relevant input/textarea elements. `scripts/regression-artifacts.mjs` only filters file formats and dot/symlink entries; its extension allowlist is **not** PII redaction. Each producer remains responsible for sanitizing its output.

No browser or database was started; no source, archived artifact, original report or original FAIL was modified. The separate operations rerun and future journey evidence still require their own final privacy review.

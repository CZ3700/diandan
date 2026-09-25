# Actual VoiceOver attempt — PENDING

2026-09-07, root, native CUA on this Mac. This is an observation record, not a screen-reader pass.

- Opened System Settings → Accessibility → VoiceOver through its observed native controls. The initial switch was **off**; enabling it produced an observed **on** state. VoiceOver Utility → Visuals → Panels and Menus already had the caption panel enabled, and that preference was not changed.
- Direct VoiceOver application access by display name and the inventory-confirmed `com.apple.VoiceOver` bundle identifier repeatedly timed out. The automation could not observe its spoken output or caption content. An enabled system switch, Chrome accessibility tree, and a screenshot are insufficient to establish actual reading or rotor behavior.
- Opened the real compiled TEST artist directory at `http://localhost:63524/zh-CN/idols` in a new task tab and verified the visible page. No VoiceOver output was captured; no spoken-language correctness, live announcement, rotor, or focus-navigation pass is claimed.
- Restored the VoiceOver switch to its original **off** state and observed the result. No scripting-control permission or security setting was enabled. No unrelated browser content was saved as an artifact.

Remaining: an actual VoiceOver or NVDA operator must verify search suggestions, result-count announcements, keyboard selection/escape, continued artist browsing, gift filters/pagination, modal focus and error recovery using the real page. Record the browser/reader versions, locale, steps and observed utterances. Automated axe/DOM checks remain separate evidence.

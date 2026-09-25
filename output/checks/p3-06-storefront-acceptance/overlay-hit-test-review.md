# Overlay painted-layer regression

The same isolated actual Chrome DOM and previously compiled shared CSS failed at 390×844 and 1440×900 before the fix: sampled title, description and close-button points hit the background sticky header. All 18 sampled points now hit their intended overlay element after adding only `isolation: isolate` to `.storefront`.

`overlay-hit-test-red-green-proof.json` verifies that removing precisely this declaration reproduces the original CSS hash. The shared compiled CSS, DOM, hit points and assertions are unchanged. The RED and GREEN screenshots and JSON observations remain separate. Mobile screenshots from both attempts were actually viewed.

The new reusable helper is also called by the formal acceptance matrix immediately after opening the mobile filter, before the existing keyboard/Escape flow. No Next build or full UI rerun was performed for this isolated regression; the final newly compiled application matrix still needs to pass.

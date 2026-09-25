# Order-search focus diagnosis

The original run-3 remains FAIL. Its retained owned TEST instance was used for a read-only Thai 320×844 Chrome diagnosis. Holding the actual current orders-list POST proved that the search button was removed and focus fell to BODY during loading, remained there when complete, and resumed at an input only after Tab.

The controlled GREEN diagnosis uses the same instance after the separately owned product fix: OrdersWorkspace focus dependencies changed from [selected, filters.page] to [selected, filters]. This diagnostic snapshot differs from the original frozen source; it is not a passing full-run claim. Pending and completed responses preserve focus on the stable heading, the next Tab reaches a workspace control, and sequential keyboard navigation opens the matching current order with the original visible-outline/unobscured focus gates.

The harness now holds only the newly submitted matching request, validates its canonical response and exact order, waits for busy=false and matching rendered results, and records both focus states. The completion gate requires this evidence in all 28 cells. Three real-Chrome fixture regressions were observed RED before the fix and GREEN afterward. All 17 accessibility-tool tests, ESLint, and Prettier passed.

Remaining asynchronous actions were reviewed: add-to-cart, checkout/payment, mail canonical navigation, message approval and fulfillment already wait for distinct result state/controls. This change does not weaken those checks or claim human screen-reader coverage.

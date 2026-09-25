# Actual mail-link browser and money visibility re-review

The combined run `persistence/run-2026-09-16T02-31-39.751Z` passed 6812
assertions with its fingerprint unchanged. Its actual Worker generated the
Vietnamese email; the browser clicked that exact transient CTA, cleared the
fragment before exchange, read the real historical order and retained the same
session across both viewports. No actual email was sent externally.

Direct inspection of the original `notification-link-browser/mail-order-vi-1440.png`
shows **15,00 US$** clearly at the right of both Tạm tính and Tổng cộng. The
390 screenshot was also reported correct. The suspected missing desktop amount
is not reproduced in the original artifact; no product source change is needed.

The helper is strengthened to scroll both summary amounts into view and assert
the visible `bdi` text equals exact integer currency formatting for the real
order subtotal/total. After fonts and two animation frames settle, it adds an
actual viewport summary screenshot before retaining the full-page screenshot.
This avoids relying solely on numeric `data` attributes or an off-screen paint.

`link-money-lint.log` and `link-money-preflight.log` pass (2 preflight tests).
The extra assertions/screenshots will run as part of root's full repository
check; the previous combined run remains evidence for its original helper, and
is not relabeled as having executed the added checks. No separate full
integration rerun was started by this reviewer.

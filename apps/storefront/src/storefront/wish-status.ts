import type { WishGiftSummary } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";

export function wishStatusLabel(
  status: WishGiftSummary["status"],
  copy: StorefrontCopy,
): string {
  const labels = {
    AVAILABLE: copy.wishOpen,
    RESERVED: copy.wishPaymentPending,
    SUPPORTED: copy.wishSupported,
    UNAVAILABLE: copy.wishUnavailable,
  };
  return labels[status];
}

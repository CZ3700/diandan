import {
  minorAmountSchema,
  type MinorAmount,
  type SupportedLocale,
  type AdminFinanceAllocation,
} from "@fan-support/contracts";
import { parseManagementPrice } from "../management-center/inputs";
/** The server rechecks these limits under locks; this model only previews exact item allocations. */
export function refundAllocation(
  items: ReadonlyArray<{ orderItemId: string; availableAmountMinor: number }>,
  mode: "FULL" | "PARTIAL",
  inputs: Readonly<Record<string, string>>,
  locale: SupportedLocale,
  currency: string,
  availableMinor: number,
): { amountMinor: MinorAmount; allocations: AdminFinanceAllocation[] } | null {
  const allocations: AdminFinanceAllocation[] = [];
  let total = 0n;
  for (const item of items) {
    const input = (inputs[item.orderItemId] ?? "").trim();
    if (mode === "PARTIAL" && !input) continue;
    const amount =
      mode === "FULL"
        ? item.availableAmountMinor
        : parseManagementPrice(input, locale, currency);
    if (
      amount === null ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > item.availableAmountMinor ||
      (mode === "PARTIAL" && amount === 0)
    )
      return null;
    if (amount === 0) continue;
    allocations.push({
      orderItemId: item.orderItemId,
      amountMinor: minorAmountSchema.parse(amount),
    });
    total += BigInt(amount);
  }
  if (
    total <= 0n ||
    total > BigInt(availableMinor) ||
    total > BigInt(Number.MAX_SAFE_INTEGER)
  )
    return null;
  return { amountMinor: minorAmountSchema.parse(Number(total)), allocations };
}

/**
 * The order page folds payments and refunds away (user request 2026-09-29) but opens them
 * itself while anything there still needs a person: an unconfirmed request of this browser,
 * a refund in flight, an outstanding reconciliation or an open or lost dispute.
 */
export function financeNeedsAttention(
  detail: Readonly<{
    order: Readonly<{
      occupiedRefundAmountMinor: number;
      refundedAmountMinor: number;
      needsReconciliation: boolean;
      disputeStatus: string;
    }>;
  }> | null,
  pendingRequest: boolean,
): boolean {
  if (pendingRequest) return true;
  if (!detail) return false;
  const { order } = detail;
  return (
    order.occupiedRefundAmountMinor > order.refundedAmountMinor ||
    order.needsReconciliation ||
    order.disputeStatus === "OPEN" ||
    order.disputeStatus === "LOST"
  );
}

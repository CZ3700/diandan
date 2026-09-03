import {
  lineAmountCalculationInputSchema,
  lineAmountCalculationDecisionSchema,
  orderAmountCalculationDecisionSchema,
  orderAmountCalculationInputSchema,
  type AmountCalculationRejectionCode,
  type LineAmountCalculationDecision,
  type LineAmountCalculationInput,
  type OrderAmountCalculationDecision,
  type OrderAmountCalculationInput,
} from "@fan-support/contracts";

type AmountRejection = Extract<
  LineAmountCalculationDecision,
  { kind: "REJECTED" }
>;

const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

function rejected(code: AmountCalculationRejectionCode): AmountRejection {
  return { schemaVersion: 1, kind: "REJECTED", code };
}

function toSafeMinor(value: bigint): number | undefined {
  return value >= 0n && value <= MAX_MINOR ? Number(value) : undefined;
}

export function calculateLineAmounts(
  input: unknown,
): LineAmountCalculationDecision {
  const parsed = lineAmountCalculationInputSchema.safeParse(input);
  if (!parsed.success) {
    return rejected("INVALID_AMOUNT");
  }
  const value: LineAmountCalculationInput = parsed.data;

  const subtotal = BigInt(value.unitAmountMinor) * BigInt(value.quantity);
  const total =
    subtotal + BigInt(value.taxAmountMinor) - BigInt(value.discountAmountMinor);
  if (total < 0n) {
    return rejected("DISCOUNT_EXCEEDS_GROSS");
  }
  const lineSubtotalMinor = toSafeMinor(subtotal);
  const lineTotalMinor = toSafeMinor(total);
  if (lineSubtotalMinor === undefined || lineTotalMinor === undefined) {
    return rejected("AMOUNT_OVERFLOW");
  }
  return lineAmountCalculationDecisionSchema.parse({
    schemaVersion: 1 as const,
    kind: "CALCULATED" as const,
    lineSubtotalMinor,
    lineTotalMinor,
  });
}

export function calculateOrderAmounts(
  input: unknown,
): OrderAmountCalculationDecision {
  const parsed = orderAmountCalculationInputSchema.safeParse(input);
  if (!parsed.success) {
    return rejected("INVALID_AMOUNT");
  }
  const value: OrderAmountCalculationInput = parsed.data;

  const seenCartItems = new Set<string>();
  let subtotal = 0n;
  let tax = 0n;
  let discount = 0n;
  let lineTotal = 0n;
  for (const line of value.lines) {
    const normalizedCartItemId = line.cartItemId.toLowerCase();
    if (seenCartItems.has(normalizedCartItemId)) {
      return rejected("DUPLICATE_CART_ITEM");
    }
    seenCartItems.add(normalizedCartItemId);
    if (line.currency !== value.currency) {
      return rejected("CURRENCY_MISMATCH");
    }
    subtotal += BigInt(line.lineSubtotalMinor);
    tax += BigInt(line.taxAmountMinor);
    discount += BigInt(line.discountAmountMinor);
    lineTotal += BigInt(line.lineTotalMinor);
  }

  const shipping = BigInt(value.shippingAmountMinor);
  const fee = BigInt(value.feeAmountMinor);
  const total = lineTotal + shipping + fee;
  const amounts = [subtotal, tax, shipping, fee, discount, total].map(
    toSafeMinor,
  );
  if (amounts.some((amount) => amount === undefined)) {
    return rejected("AMOUNT_OVERFLOW");
  }
  const [
    subtotalMinor,
    taxAmountMinor,
    shippingAmountMinor,
    feeAmountMinor,
    discountAmountMinor,
    totalAmountMinor,
  ] = amounts as [number, number, number, number, number, number];
  return orderAmountCalculationDecisionSchema.parse({
    schemaVersion: 1 as const,
    kind: "CALCULATED" as const,
    subtotalMinor,
    taxAmountMinor,
    shippingAmountMinor,
    feeAmountMinor,
    discountAmountMinor,
    totalAmountMinor,
  });
}

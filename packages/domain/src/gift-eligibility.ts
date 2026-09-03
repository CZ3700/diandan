import {
  giftEligibilityInputSchema,
  type GiftEligibilityDecision,
  type GiftEligibilityInput,
} from "@fan-support/contracts";

type EligibilityRejection = Extract<
  GiftEligibilityDecision,
  { kind: "REJECTED" }
>;

function rejected(code: EligibilityRejection["code"]): EligibilityRejection {
  return { schemaVersion: 1 as const, kind: "REJECTED" as const, code };
}

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function evaluateGiftEligibility(
  input: unknown,
): GiftEligibilityDecision {
  const parsed = giftEligibilityInputSchema.safeParse(input);
  if (!parsed.success) {
    return rejected("ELIGIBILITY_DATA_INVALID");
  }
  const value: GiftEligibilityInput = parsed.data;
  if (value.gift.status !== "active") return rejected("GIFT_NOT_ACTIVE");
  if (value.gift.publishedRevisionId === null) {
    return rejected("GIFT_NOT_PUBLISHED");
  }
  if (!sameId(value.variant.giftId, value.gift.id)) {
    return rejected("VARIANT_GIFT_MISMATCH");
  }
  if (value.variant.status !== "active") return rejected("VARIANT_NOT_ACTIVE");
  if (value.idol.status !== "active") return rejected("IDOL_NOT_ACTIVE");
  if (value.idol.publishedRevisionId === null) {
    return rejected("IDOL_NOT_PUBLISHED");
  }
  if (!value.idol.acceptingGifts) {
    return rejected("IDOL_NOT_ACCEPTING_GIFTS");
  }

  const exactRelationships = value.eligibility.filter(
    (relationship) =>
      sameId(relationship.giftVariantId, value.variant.id) &&
      sameId(relationship.idolId, value.idol.id),
  );
  if (exactRelationships.length === 0) return rejected("ELIGIBILITY_MISSING");
  if (exactRelationships.length !== 1) {
    return rejected("ELIGIBILITY_AMBIGUOUS");
  }
  return { schemaVersion: 1 as const, kind: "ELIGIBLE" as const };
}

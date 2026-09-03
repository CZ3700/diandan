import { describe, expect, test } from "vitest";
import { giftEligibilityDecisionSchema } from "@fan-support/contracts";

import { evaluateGiftEligibility } from "./gift-eligibility.js";

const GIFT_ID = "7fd728b5-4304-4de8-bd09-f62f315b4a0c";
const GIFT_REVISION_ID = "e7816b86-83b2-443f-ab50-f2503771e5c7";
const VARIANT_ID = "9fa44c67-1a8e-45e9-afc2-887f0422cc8e";
const IDOL_ID = "c24a7022-5ab1-4fe6-bc3e-c69f4fa7af7a";
const IDOL_REVISION_ID = "f0546030-a4ec-4f47-a28e-d743ad6f4293";

const gift = {
  schemaVersion: 1,
  id: GIFT_ID,
  handle: "celebration-bouquet",
  status: "active",
  draftRevisionId: null,
  publishedRevisionId: GIFT_REVISION_ID,
  version: 3,
} as const;
const variant = {
  schemaVersion: 1,
  id: VARIANT_ID,
  giftId: GIFT_ID,
  sku: "CELEBRATION-01",
  status: "active",
  inventoryPolicy: "TRACKED",
} as const;
const idol = {
  schemaVersion: 1,
  id: IDOL_ID,
  handle: "idol-one",
  status: "active",
  acceptingGifts: true,
  draftRevisionId: null,
  publishedRevisionId: IDOL_REVISION_ID,
  version: 2,
} as const;
const relationship = {
  schemaVersion: 1,
  giftVariantId: VARIANT_ID,
  idolId: IDOL_ID,
  eligible: true,
} as const;

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateGiftEligibility({
    schemaVersion: 1,
    gift,
    variant,
    idol,
    eligibility: [relationship],
    ...overrides,
  });
}

describe("gift eligibility", () => {
  test("requires one exact relationship and active published entities", () => {
    const decision = evaluate();
    expect(decision).toEqual({ schemaVersion: 1, kind: "ELIGIBLE" });
    expect(giftEligibilityDecisionSchema.safeParse(decision).success).toBe(
      true,
    );
  });

  test.each([
    ["GIFT_NOT_ACTIVE", { gift: { ...gift, status: "paused" } }],
    ["GIFT_NOT_PUBLISHED", { gift: { ...gift, publishedRevisionId: null } }],
    [
      "VARIANT_GIFT_MISMATCH",
      {
        variant: {
          ...variant,
          giftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      },
    ],
    ["VARIANT_NOT_ACTIVE", { variant: { ...variant, status: "paused" } }],
    [
      "IDOL_NOT_ACTIVE",
      { idol: { ...idol, status: "paused", acceptingGifts: false } },
    ],
    ["IDOL_NOT_PUBLISHED", { idol: { ...idol, publishedRevisionId: null } }],
    ["IDOL_NOT_ACCEPTING_GIFTS", { idol: { ...idol, acceptingGifts: false } }],
    ["ELIGIBILITY_MISSING", { eligibility: [] }],
  ] as const)("rejects with %s", (code, overrides) => {
    expect(evaluate(overrides)).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code,
    });
  });

  test("fails closed on duplicate exact relationships", () => {
    expect(evaluate({ eligibility: [relationship, relationship] })).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "ELIGIBILITY_AMBIGUOUS",
    });
  });

  test("rejects malformed, unknown, and non-v1 eligibility inputs", () => {
    const valid = {
      schemaVersion: 1,
      gift,
      variant,
      idol,
      eligibility: [relationship],
    };
    for (const invalid of [
      null,
      { ...valid, schemaVersion: 2 },
      { ...valid, unknown: true },
      { gift, variant, idol, eligibility: [relationship] },
    ]) {
      expect(evaluateGiftEligibility(invalid)).toEqual({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "ELIGIBILITY_DATA_INVALID",
      });
    }
  });
});

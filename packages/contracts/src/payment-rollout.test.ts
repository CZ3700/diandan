import { expect, test } from "vitest";
import * as contracts from "./index.js";

const input = {
  schemaVersion: 1,
  checkoutSessionId: "a1000000-0000-4000-8000-000000000001",
  providerAccountId: "a1000000-0000-4000-8000-000000000002",
  routeRuleId: "a1000000-0000-4000-8000-000000000003",
  providerRolloutBasisPoints: 10000,
  ruleRolloutBasisPoints: 500,
};
function accepts(name: string, value: unknown) {
  const schema = (
    contracts as unknown as Record<
      string,
      { safeParse(value: unknown): { success: boolean } }
    >
  )[name];
  expect(schema, name).toBeDefined();
  return schema!.safeParse(value).success;
}
test("rollout input is a bounded server-owned technical context", () => {
  expect(accepts("paymentRolloutInputSchema", input)).toBe(true);
  expect(
    accepts("paymentRolloutInputSchema", {
      ...input,
      checkoutSessionId: input.checkoutSessionId.toUpperCase(),
    }),
  ).toBe(true);
  for (const patch of [
    { schemaVersion: 2 },
    { checkoutSessionId: "browser-seed" },
    { providerAccountId: "merchant" },
    { routeRuleId: "logical-route" },
    { ruleRolloutBasisPoints: -1 },
    { providerRolloutBasisPoints: 10001 },
    { ruleRolloutBasisPoints: 0.5 },
    { providerRolloutBasisPoints: Number.NaN },
    { locale: "en" },
    { bucket: 0 },
    { seed: "chosen-by-browser" },
  ])
    expect(accepts("paymentRolloutInputSchema", { ...input, ...patch })).toBe(
      false,
    );
});
test("rollout decisions keep bounded buckets and explicit invalid input", () => {
  const decision = {
    schemaVersion: 1,
    algorithmVersion: 1,
    kind: "ELIGIBLE",
    providerBucket: 0,
    ruleBucket: 9999,
  };
  for (const kind of ["ELIGIBLE", "EXCLUDED"])
    expect(accepts("paymentRolloutDecisionSchema", { ...decision, kind })).toBe(
      true,
    );
  expect(
    accepts("paymentRolloutDecisionSchema", {
      schemaVersion: 1,
      kind: "INVALID",
      reason: "INVALID_ROLLOUT_INPUT",
    }),
  ).toBe(true);
  for (const patch of [
    { algorithmVersion: 2 },
    { providerBucket: -1 },
    { ruleBucket: 10000 },
    { kind: "SUCCESS" },
    { seed: "secret" },
  ])
    expect(
      accepts("paymentRolloutDecisionSchema", { ...decision, ...patch }),
    ).toBe(false);
  expect(
    accepts(
      "paymentRolloutDecisionSchema",
      JSON.parse(JSON.stringify(decision)),
    ),
  ).toBe(true);
});

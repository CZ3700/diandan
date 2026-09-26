import { providerReferenceSchema } from "@fan-support/contracts";
import { expect, test } from "vitest";

import {
  fromPlatformReference,
  isStripeId,
  toPlatformReference,
} from "./references.js";

test("Stripe IDs round-trip through the platform reference alphabet", () => {
  for (const [stripeId, kind] of [
    [
      "cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u",
      "session",
    ],
    ["cs_live_b2", "session"],
    ["pi_3MtwBwLkdIwHu7ix28a3tqPa", "paymentIntent"],
    ["re_1Nispe2eZvKYlo2Cd31jOCgZ", "refund"],
    ["pyr_1", "refund"],
    ["dp_1MtJUT2eZvKYlo2CNaw2HvEv", "dispute"],
    ["evt_1NG8Du2eZvKYlo2CUI79vXWy", "event"],
  ] as const) {
    const reference = toPlatformReference(stripeId, kind);
    expect(providerReferenceSchema.safeParse(reference).success).toBe(true);
    expect(reference).not.toContain("_");
    expect(fromPlatformReference(reference, kind)).toBe(stripeId);
  }
});

test("foreign kinds, malformed IDs and hostile references are rejected", () => {
  expect(isStripeId("pi_1", "session")).toBe(false);
  expect(isStripeId("cs_test_", "session")).toBe(false);
  expect(isStripeId(`cs_test_${"a".repeat(300)}`, "session")).toBe(false);
  for (const value of [
    "cs_test_a.b",
    "cs test a",
    "../cs_test_a",
    "cs_test_a/b",
  ])
    expect(() => toPlatformReference(value, "session")).toThrow(TypeError);
  for (const value of ["cs.test.a/../x", "pi.1", "cs_test_a", "cs..test.a"])
    expect(() => fromPlatformReference(value, "session")).toThrow(TypeError);
});

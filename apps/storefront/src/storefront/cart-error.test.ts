import { expect, it } from "vitest";
import { isUncertain } from "./cart-error";
it("retains the request key on a temporary failure whose response may follow a commit", () => {
  expect(
    isUncertain({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "TEMPORARY_UNAVAILABLE",
    }),
  ).toBe(true);
  expect(
    isUncertain({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "VERSION_CONFLICT",
    }),
  ).toBe(false);
});

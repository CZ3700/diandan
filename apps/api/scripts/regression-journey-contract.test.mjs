import assert from "node:assert/strict";
import { test } from "node:test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  assertJourneyMatrix,
  assertStablePurchase,
  classifyJourneyPageError,
  journeyCaseSchema,
  journeySteps,
} from "./regression-journey-contract.mjs";

const sample = () => ({
  locale: SUPPORTED_LOCALES[0],
  width: 390,
  steps: Object.fromEntries(journeySteps.map((step) => [step, true])),
});
test("requires every locale and viewport with every journey stage", () => {
  const cases = SUPPORTED_LOCALES.flatMap((locale) =>
    [390, 1440].map((width) => ({ ...sample(), locale, width })),
  );
  assertJourneyMatrix(cases);
  assert.throws(() => assertJourneyMatrix(cases.slice(1)));
  assert.throws(() => assertJourneyMatrix([...cases.slice(1), cases[1]]));
  assert.throws(() =>
    assertJourneyMatrix([
      { ...cases[0], steps: { ...cases[0].steps, secureOrder: false } },
      ...cases.slice(1),
    ]),
  );
});
test("safe case schema rejects private values and unknown evidence", () => {
  for (const key of ["email", "fanMessage", "displayName", "token", "url"])
    assert.equal(
      journeyCaseSchema.safeParse({ ...sample(), [key]: "PRIVATE" }).success,
      false,
    );
});
test("presentation switching cannot change any economic or identity field", () => {
  const before = {
    cartId: "cart",
    checkoutId: "checkout",
    publicOrderId: "order",
    attemptId: "attempt",
    locale: "en",
    market: "US",
    currency: "USD",
    amountMinor: 2400,
  };
  assertStablePurchase(before, { ...before });
  for (const key of Object.keys(before))
    assert.throws(() =>
      assertStablePurchase(before, { ...before, [key]: "CHANGED" }),
    );
});

test("browser entry rejects a persistent user instance before reading or mutating files", async () => {
  const { verifyRegressionJourneys } = await import("./regression-journey.mjs");
  await assert.rejects(
    verifyRegressionJourneys({
      workspaceRoot: "/not-an-instance",
      instance: "acceptance-user-data",
      output: "/not-an-output",
    }),
    /dedicated regression instance/u,
  );
});

test("page errors retain only a closed diagnostic code, never private browser text", () => {
  assert.equal(
    classifyJourneyPageError(new Error("Hydration failed: PRIVATE_FIELD")),
    "HYDRATION",
  );
  assert.equal(
    classifyJourneyPageError(new Error("PRIVATE_FIELD")),
    "UNCLASSIFIED",
  );
  assert.equal(
    classifyJourneyPageError(new Error("ResizeObserver loop: PRIVATE_FIELD")),
    "RESIZE_OBSERVER",
  );
});

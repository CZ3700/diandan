import assert from "node:assert/strict";
import { z } from "zod";
import {
  SUPPORTED_LOCALES,
  supportedLocaleSchema,
} from "@fan-support/contracts";

export const journeySteps = Object.freeze([
  "home",
  "artist",
  "gift",
  "cart",
  "checkout",
  "hostedPayment",
  "trustedConfirmation",
  "localizedOrder",
  "localizedMail",
  "secureOrder",
]);
export const journeyCaseSchema = z.strictObject({
  locale: supportedLocaleSchema,
  width: z.union([z.literal(390), z.literal(1440)]),
  steps: z.strictObject(
    Object.fromEntries(journeySteps.map((key) => [key, z.literal(true)])),
  ),
});

/** Evidence is complete only if every unique locale/viewport executes the full path. */
export function assertJourneyMatrix(input) {
  const cases = z.array(journeyCaseSchema).parse(input);
  const keys = cases.map(({ locale, width }) => `${locale}:${width}`);
  assert.equal(
    cases.length,
    SUPPORTED_LOCALES.length * 2,
    "Complete journey matrix",
  );
  assert.equal(new Set(keys).size, cases.length, "No duplicate journey cells");
  for (const locale of SUPPORTED_LOCALES)
    for (const width of [390, 1440])
      assert(
        keys.includes(`${locale}:${width}`),
        "Every locale/viewport is present",
      );
}

/** Inputs stay in memory: assertion errors never echo potentially private values. */
export function assertStablePurchase(before, after) {
  for (const key of [
    "cartId",
    "checkoutId",
    "publicOrderId",
    "attemptId",
    "locale",
    "market",
    "currency",
    "amountMinor",
  ])
    assert(
      before[key] !== undefined && before[key] === after[key],
      `Purchase invariant: ${key}`,
    );
}

/** Classification retains useful failure evidence without serializing browser error text. */
export function classifyJourneyPageError(error) {
  const message = String(error?.message ?? "");
  for (const [code, pattern] of [
    ["HYDRATION", /hydration|hydrated|Minified React error #(?:418|423|425)/iu],
    ["CHUNK_LOAD", /ChunkLoadError|Loading chunk|dynamically imported/iu],
    ["DOM_TREE", /removeChild|insertBefore|not a child/iu],
    ["RESIZE_OBSERVER", /ResizeObserver/iu],
    ["ABORT", /abort/iu],
    ["NETWORK", /network|Failed to fetch/iu],
  ])
    if (pattern.test(message)) return code;
  return "UNCLASSIFIED";
}

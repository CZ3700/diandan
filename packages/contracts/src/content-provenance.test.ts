import { describe, expect, test } from "vitest";
import {
  contentLocaleContextSchema,
  singleSourceLocaleContextSchema,
} from "./content-provenance.js";

const original = {
  schemaVersion: 2,
  publicationMode: "DIRECT_OPERATOR_V1",
  sourceLocale: "zh-CN",
  requestedLocale: "en",
  resolvedLocale: "zh-CN",
  fallbackUsed: true,
  translationRevision: "2d0762f8-b381-4f25-a0d6-70a327a96d35",
};

describe("single-source content provenance", () => {
  test("represents the real original language when another route displays it", () => {
    expect(singleSourceLocaleContextSchema.parse(original)).toEqual(original);
    expect(contentLocaleContextSchema.parse(original)).toEqual(original);
  });

  test("identifies an original-language page without claiming a translation", () => {
    const direct = {
      ...original,
      requestedLocale: "zh-CN",
      fallbackUsed: false,
    };
    expect(singleSourceLocaleContextSchema.parse(direct)).toEqual(direct);
  });

  test.each([
    { resolvedLocale: "en" },
    { fallbackUsed: false },
    { requestedLocale: "zh-CN" },
    { sourceLocale: "fr" },
    { schemaVersion: 1 },
    { translationRevision: "unproven-source" },
    { reviewStatus: "APPROVED" },
  ])("rejects false source or publication provenance: %j", (changed) => {
    expect(
      singleSourceLocaleContextSchema.safeParse({ ...original, ...changed })
        .success,
    ).toBe(false);
  });

  test("retains the existing strict v1 direct and English-fallback variants", () => {
    for (const context of [
      {
        schemaVersion: 1,
        requestedLocale: "th",
        resolvedLocale: "th",
        fallbackUsed: false,
      },
      {
        schemaVersion: 1,
        requestedLocale: "th",
        resolvedLocale: "en",
        fallbackUsed: true,
      },
    ])
      expect(contentLocaleContextSchema.parse(context)).toEqual(context);
    expect(
      contentLocaleContextSchema.safeParse({
        schemaVersion: 1,
        requestedLocale: "en",
        resolvedLocale: "zh-CN",
        fallbackUsed: true,
      }).success,
    ).toBe(false);
  });
});

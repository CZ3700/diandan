import { expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { managementCopy } from "./copy";

it("provides the same complete utility vocabulary in each supported language", () => {
  const keys = Object.keys(managementCopy("en")).sort();
  expect(keys.length).toBeGreaterThan(50);
  for (const locale of SUPPORTED_LOCALES) {
    const copy = managementCopy(locale);
    expect(Object.keys(copy).sort()).toEqual(keys);
    expect(
      Object.values(copy).every(
        (value) => typeof value === "string" && value.trim().length > 0,
      ),
    ).toBe(true);
  }
  expect(managementCopy("zh-CN").artists).toBe("艺人");
  expect(managementCopy("ja").artists).toBe("アーティスト");
});

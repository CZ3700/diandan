import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import * as messages from "./messages.js";

describe("gift storefront presentation messages", () => {
  it("provides translated commerce states and ICU count formatting in every locale", async () => {
    const formatter = (messages as unknown as Record<string, unknown>)[
      "formatStorefrontMessage"
    ];
    expect(typeof formatter).toBe("function");
    if (typeof formatter !== "function") return;
    for (const locale of SUPPORTED_LOCALES) {
      const copy = await messages.loadStorefrontCopy(locale);
      const values = copy as unknown as Record<string, string>;
      for (const key of [
        "giftFilters",
        "giftSoldOut",
        "giftProcureOnDemand",
        "giftPreorder",
        "giftCheckoutUnavailable",
        "giftRecipient",
        "policyUnavailable",
        "marketChoose",
      ]) {
        expect(values[key], `${locale}:${key}`).toBeTruthy();
      }
      expect(
        formatter(copy, "giftResultsCount", locale, { count: 21 }),
      ).not.toMatch(/[{}]/u);
      expect(
        formatter(copy, "giftStockRemaining", locale, { count: 2 }),
      ).not.toMatch(/[{}]/u);
    }
  });
});

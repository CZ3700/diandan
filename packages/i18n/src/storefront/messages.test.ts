import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import * as entry from "../index.js";

describe("storefront locale messages", () => {
  it("loads exactly one complete presentation catalog for every public locale", async () => {
    const loader = (entry as unknown as Record<string, unknown>)[
      "loadStorefrontCopy"
    ];
    expect(typeof loader).toBe("function");
    if (typeof loader !== "function") return;
    const source = (await loader("en")) as Record<string, string>;
    for (const locale of SUPPORTED_LOCALES) {
      const copy = (await loader(locale)) as Record<string, string>;
      expect(Object.keys(copy).sort()).toEqual(Object.keys(source).sort());
      expect(
        Object.values(copy).every(
          (value) => typeof value === "string" && value.trim().length > 0,
        ),
      ).toBe(true);
      expect(copy["artistSearchLabel"]).toBeTruthy();
      expect(copy["giftHandover"]).toBeTruthy();
    }
  });
});

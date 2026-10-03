import { expect, test } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
const subject = await import("./copy").catch(() => undefined);
test("all seven policy workspaces have complete localized utility copy", () => {
  expect(subject?.policiesCopy).toBeTypeOf("function");
  const english = subject!.policiesCopy("en");
  for (const locale of SUPPORTED_LOCALES) {
    const copy = subject!.policiesCopy(locale);
    expect(Object.keys(copy).sort()).toEqual(Object.keys(english).sort());
    expect(
      Object.values(copy).every(
        (value) => typeof value === "string" && value.length > 0,
      ),
    ).toBe(true);
    if (locale !== "en") expect(copy.reviewHint).not.toBe(english.reviewHint);
  }
});

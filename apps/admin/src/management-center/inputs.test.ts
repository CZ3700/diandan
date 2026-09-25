import { describe, expect, it } from "vitest";
import {
  parseManagementPrice,
  priceInputValue,
  imageSelectionIssue,
} from "./inputs";

describe("management input boundaries", () => {
  it("accepts localized decimal prices without floating point rounding", () => {
    expect(parseManagementPrice("10.29", "en", "USD")).toBe(1029);
    expect(parseManagementPrice("10,29", "pt", "USD")).toBe(1029);
    expect(parseManagementPrice("29", "ja", "JPY")).toBe(29);
    expect(parseManagementPrice("1.123", "en", "KWD")).toBe(1123);
    expect(priceInputValue(1029, "pt", "USD")).toBe("10,29");
  });
  it("rejects ambiguous, zero, exponent and unsafe amounts", () => {
    for (const input of [
      "",
      "0",
      "-1",
      "1e3",
      "1,234",
      "1.234",
      "01",
      "9007199254740992",
    ]) {
      expect(parseManagementPrice(input, "en", "USD")).toBeNull();
    }
    expect(parseManagementPrice("1.5", "ja", "JPY")).toBeNull();
    expect(parseManagementPrice("1.25", "pt", "USD")).toBeNull();
  });
  it("rejects empty or unsupported files before requesting an upload", () => {
    expect(imageSelectionIssue({ type: "image/png", size: 1 })).toBeNull();
    expect(imageSelectionIssue({ type: "image/svg+xml", size: 1 })).toBe(
      "imageFormat",
    );
    expect(imageSelectionIssue({ type: "image/jpeg", size: 0 })).toBe(
      "imageEmpty",
    );
  });
});

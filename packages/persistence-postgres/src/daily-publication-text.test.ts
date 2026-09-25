import { expect, test } from "vitest";
import { summarizeDailyOriginal } from "./daily-publication-text.js";
test("valid emoji originals produce summaries within the existing UTF-16 contract limits without breaking a character", () => {
  const original = "😀".repeat(160);
  expect(original.length).toBeLessThanOrEqual(600);
  expect(summarizeDailyOriginal(original, 160)).toBe("😀".repeat(80));
  expect(summarizeDailyOriginal("A" + original, 160)).toBe(
    "A" + "😀".repeat(79),
  );
  expect(summarizeDailyOriginal("艺术家", 160)).toBe("艺术家");
  expect(original).toBe("😀".repeat(160));
});

import { expect, it } from "vitest";
import { deleteNameConfirmed } from "./delete-model";

it("confirms only the exact name, ignoring surrounding spaces and Unicode composition", () => {
  expect(deleteNameConfirmed("  测试艺人 ", "测试艺人")).toBe(true);
  expect(deleteNameConfirmed("Cafe\u0301", "Caf\u00e9")).toBe(true);
  expect(deleteNameConfirmed("测试", "测试艺人")).toBe(false);
  expect(deleteNameConfirmed("test artist", "Test Artist")).toBe(false);
  expect(deleteNameConfirmed("", " ")).toBe(false);
});

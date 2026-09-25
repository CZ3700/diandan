import { expect, test } from "vitest";
const subject = await import("./model").catch(() => undefined);
test("percentage parsing is exact and bounded without silently rounding", () => {
  expect(subject?.parsePercentage).toBeTypeOf("function");
  expect(subject!.parsePercentage("0.01")).toBe(1);
  expect(subject!.parsePercentage("100")).toBe(10000);
  for (const input of ["", "100.01", "1e2", "-1", "0.001"])
    expect(subject!.parsePercentage(input)).toBeNull();
});

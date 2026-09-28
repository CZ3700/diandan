import { expect, test } from "vitest";
import { focusAtPointer, focusFromKey, sameFocus } from "./focal-model";

test("pointer focus clamps to the displayed original and keeps five decimals", () => {
  expect(
    focusAtPointer(13, 37, { left: 0, top: 0, width: 300, height: 100 }),
  ).toEqual({ x: 0.04333, y: 0.37 });
  expect(
    focusAtPointer(-10, 500, { left: 0, top: 0, width: 300, height: 100 }),
  ).toEqual({ x: 0, y: 1 });
});
test("keyboard focus has bounded fine and coarse movement without swallowing unrelated keys", () => {
  expect(focusFromKey({ x: 0.995, y: 0.4 }, "ArrowRight", false)).toEqual({
    x: 1,
    y: 0.4,
  });
  expect(focusFromKey({ x: 0.5, y: 0.5 }, "ArrowUp", true)).toEqual({
    x: 0.5,
    y: 0.4,
  });
  expect(focusFromKey({ x: 0.5, y: 0.5 }, "Tab", false)).toBeNull();
  expect(sameFocus({ x: 0.1, y: 0.2 }, { x: 0.1, y: 0.2 })).toBe(true);
});

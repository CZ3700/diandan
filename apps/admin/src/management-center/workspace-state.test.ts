import { expect, it } from "vitest";
import { canStartManagementWrite } from "./workspace-state";

it("keeps history restore disabled after HTTP acknowledgement until publication finishes", () => {
  expect(canStartManagementWrite(false, [{ status: "PROCESSING" }])).toBe(
    false,
  );
  expect(canStartManagementWrite(false, [{ status: "PUBLISHED" }])).toBe(true);
});
it("permits a new action after a terminal failure without bypassing an active sibling", () => {
  expect(canStartManagementWrite(false, [{ status: "FAILED" }])).toBe(true);
  expect(
    canStartManagementWrite(false, [
      { status: "FAILED" },
      { status: "PROCESSING" },
    ]),
  ).toBe(false);
  expect(canStartManagementWrite(true, [])).toBe(false);
});

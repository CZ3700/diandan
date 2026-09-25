import { expect, it, vi } from "vitest";
import { prepareCartRemovalFocus } from "./cart-removal-focus";
it("moves a removed row's focus to the next row, or the cart when empty", () => {
  const old = { isConnected: true };
  const next = { focus: vi.fn() };
  const row = {
    getAttribute: () => "row",
    contains: (node: unknown) => node === old,
  };
  let rows: unknown[] = [row];
  const doc = { activeElement: old as unknown, body: {} };
  const root = {
    ownerDocument: doc,
    isConnected: true,
    querySelectorAll: () => rows,
    focus: vi.fn(),
  };
  const restore = prepareCartRemovalFocus(
    root as unknown as HTMLElement,
    "row",
  );
  rows = [{ querySelector: () => next }];
  old.isConnected = false;
  doc.activeElement = doc.body;
  restore();
  expect(next.focus).toHaveBeenCalledOnce();
  rows = [];
  restore();
  expect(root.focus).toHaveBeenCalledOnce();
});
it("does not steal focus moved to another row during the request", () => {
  const old = { isConnected: true };
  const doc = { activeElement: old as unknown, body: {} };
  const root = {
    ownerDocument: doc,
    isConnected: true,
    querySelectorAll: () => [
      { getAttribute: () => "row", contains: (node: unknown) => node === old },
    ],
    focus: vi.fn(),
  };
  const restore = prepareCartRemovalFocus(
    root as unknown as HTMLElement,
    "row",
  );
  doc.activeElement = {};
  old.isConnected = false;
  restore();
  expect(root.focus).not.toHaveBeenCalled();
});

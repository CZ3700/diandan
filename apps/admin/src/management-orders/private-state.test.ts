import { expect, test } from "vitest";
import * as state from "./private-state";
test("closing a private view invalidates pending reads and discards previously opened text", () => {
  expect(state.createPrivateView).toBeTypeOf("function");
  const view = state.createPrivateView<string>();
  const first = view.begin();
  expect(view.accept(first, "synthetic-private")).toBe(true);
  expect(view.read()).toBe("synthetic-private");
  view.clear();
  expect(view.read()).toBeNull();
  expect(view.accept(first, "late-private")).toBe(false);
  const second = view.begin();
  expect(view.accept(second, "new-private")).toBe(true);
  expect(view.accept(first, "stale-private")).toBe(false);
});

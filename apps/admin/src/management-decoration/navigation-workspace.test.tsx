import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type * as React from "react";
import { navigationFixture } from "./navigation-fixture";
import { AdminClientError } from "../workspace/client";
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
  useLayoutEffect: (effect: () => unknown) => {
    effect();
  },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values))
      hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.values[index],
      (next: unknown) => {
        hooks.values[index] =
          typeof next === "function" ? next(hooks.values[index]) : next;
      },
    ];
  },
}));
const subject = await import("./navigation-workspace").catch(() => undefined);
function find(
  node: unknown,
  key: string,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, key);
      if (found) return found;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (key in node.props) return node;
  return find(node.props["children"], key);
}
const baseline = navigationFixture();
const edited = {
  ...baseline,
  header: ["GIFTS", "HOME", "ARTISTS"] as typeof baseline.header,
};
const savedState = {
  schemaVersion: 1 as const,
  version: 1,
  draft: {
    revisionId: "10000000-0000-4000-8000-000000000001",
    createdAt: "2026-09-28T00:00:00Z",
    navigation: baseline,
  },
  published: null,
};
const onDirtyChange = vi.fn();
const onBusy = vi.fn();
const save = vi.fn();
const listeners = new Map<string, (event: unknown) => void>();
function render() {
  expect(subject?.NavigationWorkspace).toBeTypeOf("function");
  hooks.index = 0;
  return subject!.NavigationWorkspace({
    api: {
      read: vi.fn(),
      save,
      publish: vi.fn(),
      restore: vi.fn(),
      history: vi.fn(),
    },
    locale: "zh-CN",
    canEdit: true,
    canPublish: true,
    onDirtyChange,
    onBusy,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  hooks.values = [savedState, edited];
  hooks.index = 0;
  listeners.clear();
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    removeEventListener: () => {},
    confirm: () => false,
  });
});
afterEach(() => vi.unstubAllGlobals());
test("an already shown navigation edit synchronously installs departure protection", () => {
  render();
  expect(onDirtyChange).toHaveBeenCalledWith(true);
  const prevent = vi.fn();
  listeners.get("beforeunload")?.({
    preventDefault: prevent,
    returnValue: undefined,
  });
  expect(prevent).toHaveBeenCalledOnce();
});
test("failed save retains navigation draft and success clears its dirty state", async () => {
  save.mockRejectedValueOnce(new AdminClientError("CONTENT_UNAVAILABLE"));
  let tree = render();
  (find(tree, "data-navigation-save")!.props["onClick"] as () => void)();
  await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  expect(save).toHaveBeenCalledWith(edited, 1);
  expect(hooks.values[1]).toBe(edited);
  tree = render();
  expect(
    find(tree, "data-navigation-dirty")?.props["data-navigation-dirty"],
  ).toBe(true);
  save.mockResolvedValueOnce({
    ...savedState,
    version: 2,
    draft: { ...savedState.draft, navigation: edited },
  });
  (find(tree, "data-navigation-save")!.props["onClick"] as () => void)();
  await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  tree = render();
  expect(
    find(tree, "data-navigation-dirty")?.props["data-navigation-dirty"],
  ).toBe(false);
});

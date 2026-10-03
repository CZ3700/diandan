import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type * as React from "react";
import {
  createDefaultStorefrontTheme,
  createDefaultStorefrontPresentation,
} from "@fan-support/contracts";
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
const { ThemeWorkspace } = await import("./theme-workspace");
function find(
  node: unknown,
  key: string,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = find(child, key);
      if (result) return result;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (key in node.props) return node;
  return find(node.props["children"], key);
}
const baseline = createDefaultStorefrontTheme();
const edited = {
  ...baseline,
  presentation: {
    ...createDefaultStorefrontPresentation(),
    heroEffect: "PETALS" as const,
  },
};
const savedState = {
  schemaVersion: 1 as const,
  version: 1,
  draft: {
    revisionId: "10000000-0000-4000-8000-000000000001",
    createdAt: "2026-10-01T00:00:00Z",
    theme: baseline,
  },
  published: null,
};
const onBusy = vi.fn();
const onDirtyChange = vi.fn();
const save = vi.fn();
const listeners = new Map<string, (event: unknown) => void>();
function render() {
  hooks.index = 0;
  return ThemeWorkspace({
    api: {
      read: vi.fn(),
      history: vi.fn(),
      save,
      publish: vi.fn(),
      restore: vi.fn(),
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

test("a hero-effect-only edit enables save and protects departure", () => {
  const tree = render();
  expect(find(tree, "data-theme-dirty")?.props["data-theme-dirty"]).toBe(true);
  expect(find(tree, "data-theme-save")?.props["disabled"]).toBe(false);
  expect(find(tree, "data-theme-publish")?.props["disabled"]).toBe(true);
  expect(onDirtyChange).toHaveBeenCalledWith(true);
  const prevent = vi.fn();
  listeners.get("beforeunload")?.({
    preventDefault: prevent,
    returnValue: undefined,
  });
  expect(prevent).toHaveBeenCalledOnce();
});

test.each(["CONTENT_UNAVAILABLE", "STALE_VERSION"] as const)(
  "%s retains the selected effect and retry clears dirty only after success",
  async (code) => {
    save.mockRejectedValueOnce(new AdminClientError(code));
    let tree = render();
    (find(tree, "data-theme-save")!.props["onClick"] as () => void)();
    await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
    expect(save).toHaveBeenCalledWith(edited, 1);
    expect(hooks.values[1]).toBe(edited);
    tree = render();
    expect(find(tree, "role")?.props["role"]).toBe("alert");
    expect(find(tree, "data-theme-dirty")?.props["data-theme-dirty"]).toBe(
      true,
    );
    expect(find(tree, "data-theme-publish")?.props["disabled"]).toBe(true);
    save.mockResolvedValueOnce({
      ...savedState,
      version: 2,
      draft: { ...savedState.draft, theme: edited },
    });
    (find(tree, "data-theme-save")!.props["onClick"] as () => void)();
    await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
    tree = render();
    expect(find(tree, "data-theme-dirty")?.props["data-theme-dirty"]).toBe(
      false,
    );
    expect(find(tree, "data-theme-publish")?.props["disabled"]).toBe(false);
  },
);

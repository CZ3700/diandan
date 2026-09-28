import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type * as React from "react";
import type { ComponentProps } from "react";
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [
      hooks.values[index],
      (next: unknown) => {
        hooks.values[index] = next;
      },
    ];
  },
}));
import { DecorationCenter } from "./center";
import { NavigationWorkspace } from "./navigation-workspace";
function find(
  node: unknown,
  key: string,
  value: unknown,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = find(child, key, value);
      if (result) return result;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (node.props[key] === value) return node;
  return find(node.props["children"], key, value);
}
const api = {
  read: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
  restore: vi.fn(),
  history: vi.fn(),
};
const props: ComponentProps<typeof DecorationCenter> = {
  api,
  themeApi: api,
  navigationApi: api,
  locale: "zh-CN",
  canEdit: true,
  canPublish: true,
  onBusy: vi.fn(),
  onDirtyChange: vi.fn(),
};
beforeEach(() => {
  hooks.values = ["layout", false, false];
  hooks.index = 0;
});
afterEach(() => vi.unstubAllGlobals());
test("navigation joins the existing decoration workspace and dirty tab changes require confirmation", () => {
  const confirm = vi.fn(() => false);
  vi.stubGlobal("window", { confirm });
  let tree = DecorationCenter(props);
  (
    find(tree, "data-decoration-tab", "navigation")!.props[
      "onClick"
    ] as () => void
  )();
  expect(hooks.values[0]).toBe("navigation");
  hooks.index = 0;
  tree = DecorationCenter(props);
  const workspace = (tree.props.children as unknown[]).find(
    (child) => isValidElement(child) && child.type === NavigationWorkspace,
  ) as ReactElement<ComponentProps<typeof NavigationWorkspace>>;
  expect(workspace.props.api).toBe(props.navigationApi);
  workspace.props.onDirtyChange(true);
  hooks.index = 0;
  tree = DecorationCenter(props);
  (
    find(tree, "data-decoration-tab", "theme")!.props["onClick"] as () => void
  )();
  expect(confirm).toHaveBeenCalledOnce();
  expect(hooks.values[0]).toBe("navigation");
  confirm.mockReturnValue(true);
  (
    find(tree, "data-decoration-tab", "theme")!.props["onClick"] as () => void
  )();
  expect(hooks.values[0]).toBe("theme");
});
test("busy navigation cannot leave even after confirmation", () => {
  hooks.values = ["navigation", true, true];
  const confirm = vi.fn(() => true);
  vi.stubGlobal("window", { confirm });
  const tree = DecorationCenter(props);
  const tab = find(tree, "data-decoration-tab", "layout")!;
  expect(tab.props["disabled"]).toBe(true);
  (tab.props["onClick"] as () => void)();
  expect(confirm).not.toHaveBeenCalled();
  expect(hooks.values[0]).toBe("navigation");
});

import { isValidElement, type ComponentProps, type ReactElement } from "react";
import type * as React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useEffect: () => {},
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [
      hooks.values[index],
      (value: unknown) => (hooks.values[index] = value),
    ];
  },
}));
import { ManagementHub } from "./hub";

const props = {
  api: { context: vi.fn() },
  ordersApi: { context: vi.fn() },
  policiesApi: {},
  policiesAccess: {
    allowed: true,
    localeScopes: ["ja"],
    permissions: ["content.read", "content.translation.review"],
    actorId: "10000000-0000-4000-8000-000000000001",
  },
  locale: "zh-CN",
  onLogout: vi.fn(),
} as unknown as ComponentProps<typeof ManagementHub>;
beforeEach(() => {
  vi.clearAllMocks();
  hooks.index = 0;
  hooks.values = [
    {
      contentAllowed: false,
      orders: null,
      payments: null,
      exceptions: null,
      temporaryFailure: false,
    },
    0,
    null,
    false,
    false,
    false,
    false,
  ];
});
afterEach(() => vi.unstubAllGlobals());

test("a policy reviewer reaches policies without daily gift-management access", () => {
  const tree = ManagementHub(props);
  expect(tree.props.section).toBe("POLICIES");
  expect(tree.props.policiesAvailable).toBe(true);
  expect(tree.props.contentAllowed).toBe(false);
});

test("a policy draft protects navigation, language changes and logout", async () => {
  const confirm = vi.fn(() => false);
  vi.stubGlobal("window", { confirm });
  const tree = ManagementHub(props);
  const workspace = (tree.props.children as unknown[]).find(
    (child) =>
      isValidElement<{ onDirtyChange?: unknown }>(child) &&
      typeof child.props.onDirtyChange === "function",
  ) as ReactElement<{
    onDirtyChange: (value: boolean) => void;
    onBusy: (value: boolean) => void;
    localeScopes: string[];
  }>;
  expect(workspace).toBeDefined();
  expect(workspace.props.localeScopes).toEqual(["ja"]);
  workspace.props.onDirtyChange(true);
  hooks.index = 0;
  const edited = ManagementHub(props);
  edited.props.onSection("ARTISTS");
  expect(hooks.values[2]).toBeNull();
  expect(edited.props.beforeLeave()).toBe(false);
  const logout = edited.props.accountAction as ReactElement<{
    onLogout: () => Promise<void>;
  }>;
  await logout.props.onLogout();
  expect(props.onLogout).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledTimes(3);
});

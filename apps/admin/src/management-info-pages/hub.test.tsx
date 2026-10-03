import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ComponentProps } from "react";
import type * as React from "react";
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useEffect: () => {},
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
import { ManagementHub } from "../management-center/hub";
import { InformationPagesWorkspace } from "./workspace";
function findWorkspace(
  node: unknown,
): ReactElement<ComponentProps<typeof InformationPagesWorkspace>> | undefined {
  if (Array.isArray(node)) return node.map(findWorkspace).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (node.type === InformationPagesWorkspace)
    return node as ReturnType<typeof findWorkspace>;
  return findWorkspace(node.props["children"]);
}
const infoApi = {
  read: vi.fn(),
  save: vi.fn(),
  review: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  restore: vi.fn(),
  history: vi.fn(),
};
const props = {
  api: { context: vi.fn() },
  ordersApi: { context: vi.fn() },
  infoPagesApi: infoApi,
  infoPagesAccess: { allowed: true, localeScopes: ["ja"] },
  locale: "zh-CN",
  onLogout: vi.fn(),
} as unknown as ComponentProps<typeof ManagementHub>;
beforeEach(() => {
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
test("reviewers reach information pages without daily content access and dirty drafts protect sidebar and logout", async () => {
  const confirm = vi.fn(() => false);
  vi.stubGlobal("window", { confirm });
  const tree = ManagementHub(props);
  expect(tree.props.section).toBe("INFO_PAGES");
  expect(tree.props.infoPagesAvailable).toBe(true);
  const workspace = findWorkspace(tree)!;
  expect(workspace.props.embedded).toBe(true);
  expect(workspace.props.localeScopes).toEqual(["ja"]);
  workspace.props.onDirtyChange(true);
  hooks.index = 0;
  const edited = ManagementHub(props);
  edited.props.onSection("DECORATION");
  expect(hooks.values[2]).toBeNull();
  expect(confirm).toHaveBeenCalledOnce();
  const logout = edited.props.accountAction as ReactElement<{
    onLogout: () => Promise<void>;
  }>;
  await logout.props.onLogout();
  expect(props.onLogout).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledTimes(2);
});

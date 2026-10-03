import { afterEach, expect, test, vi } from "vitest";
import type * as React from "react";
import type { ReactElement } from "react";
import type { ManagementApi } from "./api";
import type { OrdersApi } from "../management-orders/api";

const renderState = vi.hoisted(() => ({ index: 0, dirty: true }));
vi.mock("react", async (original) => {
  const react = await original<typeof React>();
  return {
    ...react,
    useEffect: () => {},
    useState: () => {
      // Isolate the hub's departure callbacks with an already loaded decoration session.
      const states = [
        {
          contentAllowed: true,
          orders: null,
          payments: null,
          exceptions: null,
          temporaryFailure: false,
        },
        0,
        "DECORATION",
        false,
        renderState.dirty,
      ];
      return [states[renderState.index++], vi.fn()];
    },
  };
});
import { ManagementHub } from "./hub";
afterEach(() => vi.unstubAllGlobals());
function logoutAction(onLogout: () => Promise<void>) {
  renderState.index = 0;
  const shell = ManagementHub({
    api: {} as ManagementApi,
    ordersApi: {} as OrdersApi,
    locale: "zh-CN",
    onLogout,
  }) as ReactElement<{
    accountAction: ReactElement<{ onLogout: () => Promise<void> }>;
  }>;
  return shell.props.accountAction.props.onLogout;
}
test("canceling dirty-layout logout keeps the session and draft open", async () => {
  renderState.dirty = true;
  const confirm = vi.fn(() => false);
  vi.stubGlobal("window", { confirm });
  const onLogout = vi.fn(async () => {});
  await logoutAction(onLogout)();
  expect(confirm).toHaveBeenCalledOnce();
  expect(onLogout).not.toHaveBeenCalled();
});
test("confirmed dirty-layout logout and a clean logout call the original operation exactly once", async () => {
  for (const dirty of [true, false]) {
    renderState.dirty = dirty;
    const confirm = vi.fn(() => true);
    vi.stubGlobal("window", { confirm });
    const onLogout = vi.fn(async () => {});
    await logoutAction(onLogout)();
    expect(confirm).toHaveBeenCalledTimes(dirty ? 1 : 0);
    expect(onLogout).toHaveBeenCalledOnce();
  }
});

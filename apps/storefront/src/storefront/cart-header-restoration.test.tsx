import type * as React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import copy from "../../../../packages/i18n/src/storefront/en";
import type { CartSession } from "./cart-session";

const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  restoreOnLoad: false,
  session: null as CartSession | null,
}));
vi.mock("react", async (load) => ({
  ...(await load<typeof React>()),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: (effect: () => void | (() => void)) => {
    hooks.effects.push(effect);
  },
}));
vi.mock("./cart-provider", () => ({
  useCartSession: () => hooks.session,
  useCartSnapshot: (session: CartSession) => session.snapshot(),
  useCartRestorationHint: () => hooks.restoreOnLoad,
}));

const listeners = new Map<string, () => void>();
const read = vi.fn();
beforeEach(() => {
  hooks.effects = [];
  hooks.restoreOnLoad = false;
  listeners.clear();
  read.mockReset().mockResolvedValue({ outcome: "UNKNOWN" });
  hooks.session = {
    snapshot: () => ({ status: "idle", cart: null }),
    read,
  } as unknown as CartSession;
  vi.stubGlobal("document", { readyState: "loading" });
  vi.stubGlobal("window", {
    addEventListener: (event: string, listener: () => void) => {
      listeners.set(event, listener);
    },
    removeEventListener: (event: string, listener: () => void) => {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

async function mount() {
  const { CartHeader } = await import("./cart-header");
  const control = CartHeader({ locale: "en", copy, contextQuery: "" });
  if (typeof control.type !== "function")
    throw new Error("Missing cart control");
  Reflect.apply(control.type, undefined, [control.props]);
  const cleanups = hooks.effects.map((effect) => effect());
  return () => cleanups.forEach((cleanup) => cleanup?.());
}

test.each(["loading", "complete"])(
  "a visitor without a cookie makes no automatic cart request when document is %s",
  async (readyState) => {
    vi.stubGlobal("document", { readyState });
    const unmount = await mount();
    listeners.get("load")?.();
    expect(read).not.toHaveBeenCalled();
    expect(hooks.session?.snapshot()).toEqual({ status: "idle", cart: null });
    unmount();
  },
);

test("an existing cookie restores the cart after load and cleanup removes its listener", async () => {
  hooks.restoreOnLoad = true;
  const unmount = await mount();
  expect(read).not.toHaveBeenCalled();
  listeners.get("load")?.();
  expect(read).toHaveBeenCalledOnce();
  unmount();
  expect(listeners.has("load")).toBe(false);
});

test("an existing cookie also restores when the document already finished loading", async () => {
  hooks.restoreOnLoad = true;
  vi.stubGlobal("document", { readyState: "complete" });
  const unmount = await mount();
  expect(read).toHaveBeenCalledOnce();
  unmount();
});

test("a late load event does not repeat a cart read already started by an interaction", async () => {
  hooks.restoreOnLoad = true;
  const unmount = await mount();
  hooks.session!.snapshot = () => ({ status: "loading", cart: null });
  listeners.get("load")?.();
  expect(read).not.toHaveBeenCalled();
  unmount();
});

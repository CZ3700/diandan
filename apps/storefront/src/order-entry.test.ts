import { expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
const load = () => import("./order-entry").catch(() => null);
it("captures a link once, clears the URL before other work, and never puts it in history state", async () => {
  const loaded = await load();
  expect(loaded?.ORDER_ENTRY_SCRIPT).toBeTypeOf("string");
  if (!loaded) return;
  const events: string[] = [];
  const window: Record<string, unknown> = { addEventListener: vi.fn() };
  const state = { owned: true };
  const replaceState = vi.fn(() => events.push("cleared"));
  runInNewContext(loaded.ORDER_ENTRY_SCRIPT, {
    window,
    location: {
      hash: "#token=private&order=hint",
      pathname: "/en/order-access",
      search: "",
    },
    history: { state, replaceState },
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
  });
  expect(events).toEqual(["cleared"]);
  expect(replaceState).toHaveBeenCalledWith(state, "", "/en/order-access");
  expect(JSON.stringify(window)).not.toContain("private");
  const take = window["__fanOrderEntry"] as () => string | null;
  expect(take()).toBe("#token=private&order=hint");
  expect(take()).toBeNull();
});
it("wipes unclaimed fragments on pagehide and refuses to expose them if URL clearing fails", async () => {
  const loaded = await load();
  expect(loaded?.ORDER_ENTRY_SCRIPT).toBeTypeOf("string");
  if (!loaded) return;
  for (const fail of [false, true]) {
    const listeners: Record<string, () => void> = {};
    const window: Record<string, unknown> = {
      addEventListener: (name: string, callback: () => void) => {
        listeners[name] = callback;
      },
    };
    runInNewContext(loaded.ORDER_ENTRY_SCRIPT, {
      window,
      location: { hash: "#private", pathname: "/ja/order-access" },
      history: {
        state: null,
        replaceState: () => {
          if (fail) throw new Error("denied");
        },
      },
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    });
    listeners["pagehide"]?.();
    expect((window["__fanOrderEntry"] as () => string | null)()).toBeNull();
  }
});

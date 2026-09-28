import { afterEach, expect, test, vi } from "vitest";
import type * as React from "react";
import { createDefaultStorefrontNavigation } from "@fan-support/contracts";
const lifecycle = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useState: () => [null, vi.fn()],
  useEffect: (setup: () => void | (() => void)) =>
    lifecycle.effects.push(setup),
}));
import { NavigationProvider } from "./navigation-provider";
afterEach(() => {
  vi.unstubAllGlobals();
  lifecycle.effects = [];
});

test.each(["header", "menu", "footer"] as const)(
  "%s preview confines scrolling to its own viewport and cleans up streamed-content observation",
  (view) => {
    const scrollIntoView = vi.fn(),
      scrollTo = vi.fn(),
      observe = vi.fn(),
      disconnect = vi.fn();
    let resize: (() => void) | undefined;
    vi.stubGlobal("window", { scrollTo, scrollY: 120, innerHeight: 844 });
    vi.stubGlobal("document", {
      body: {},
      querySelector: () => ({
        scrollIntoView,
        getBoundingClientRect: () => ({ bottom: 5000 }),
      }),
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    NavigationProvider({
      result: {
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_NAVIGATION",
        navigation: createDefaultStorefrontNavigation(),
        source: "DEFAULT",
        version: 0,
        publicationId: null,
      },
      preview: {
        adminOrigin: "https://admin.example.invalid",
        channel: "00000000-0000-4000-8000-000000000007",
        view,
      },
      children: null,
    });
    const cleanup = lifecycle.effects[1]?.();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({
      top: view === "footer" ? 4276 : 0,
      behavior: "instant",
    });
    if (view === "footer") {
      resize?.();
      expect(scrollTo).toHaveBeenCalledTimes(2);
      cleanup?.();
      expect(disconnect).toHaveBeenCalledOnce();
    } else expect(observe).not.toHaveBeenCalled();
  },
);

import { afterEach, expect, test, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { giftDiscoveryQuerySchema } from "@fan-support/contracts";
import copy from "../../../../packages/i18n/src/storefront/en";

const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", async (load) => ({
  ...(await load<typeof ReactModule>()),
  useId: () => "filter-test",
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => [
    typeof initial === "function" ? (initial as () => unknown)() : initial,
    vi.fn(),
  ],
  useEffect: (effect: () => void | (() => void)) => {
    hooks.effects.push(effect);
  },
}));

function propsFor(
  node: ReactNode,
  attribute: string,
  value: unknown,
): Record<string, unknown> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.props[attribute] === value) return child.props;
    const found = propsFor(
      child.props["children"] as ReactNode,
      attribute,
      value,
    );
    if (found) return found;
  }
  return undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("./gift-filter-validation");
});

test.each(["pageshow", "reset", "unmount"] as const)(
  "%s cancels a pending validator before animation frames or navigation complete",
  async (action) => {
    vi.resetModules();
    hooks.effects.length = 0;
    let release!: () => void;
    const loading = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    vi.doMock("./gift-filter-validation", async () => {
      requested = true;
      await loading;
      return {
        validateGiftFilterDraft: () => ({
          kind: "VALID",
          href: "/en/gifts?sort=PRICE_DESC",
        }),
      };
    });
    const listeners = new Map<string, (event: unknown) => void>();
    const frames: Array<() => void> = [];
    const assign = vi.fn();
    vi.stubGlobal("window", {
      performance: { getEntriesByType: () => [{ type: "navigate" }] },
      addEventListener: (name: string, handler: (event: unknown) => void) =>
        listeners.set(name, handler),
      removeEventListener: (name: string) => listeners.delete(name),
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      cancelAnimationFrame: vi.fn(),
      location: { assign },
    });
    const { GiftFiltersClient } = await import("./gift-filters-client");
    const query = giftDiscoveryQuerySchema.parse({
      schemaVersion: 1,
      locale: "en",
      market: "TEST",
      currency: "USD",
    });
    const tree = GiftFiltersClient({
      locale: "en",
      copy,
      query,
      contextQuery: "",
      basePath: "/gifts",
      initialDraft: {
        sort: "PRICE_DESC",
        category: "",
        availability: "ALL",
        minimum: "",
        maximum: "",
      },
      resetHref: "/en/gifts",
      recoveryHref: "/en/gifts",
      hint: "USD",
    });
    const cleanups = hooks.effects.map((effect) => effect());
    const form = propsFor(tree, "data-gift-filters", "desktop")!;
    (form["onSubmit"] as (event: unknown) => void)({
      preventDefault: vi.fn(),
      currentTarget: { elements: { namedItem: vi.fn() } },
    });
    await vi.waitFor(() => expect(requested).toBe(true));
    if (action === "pageshow") listeners.get("pageshow")!({ persisted: true });
    else if (action === "reset") {
      const reset = propsFor(tree, "data-gift-reset", true)!;
      (reset["onClick"] as (() => void) | undefined)?.();
    } else for (const cleanup of cleanups) cleanup?.();
    release();
    // The real import must settle before observing navigation; rAF is deliberately
    // still held so history cancellation cannot depend on a later render frame.
    await import("./gift-filter-validation");
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    expect(assign).not.toHaveBeenCalled();
    for (const frame of frames) frame();
    for (const cleanup of cleanups) cleanup?.();
  },
);

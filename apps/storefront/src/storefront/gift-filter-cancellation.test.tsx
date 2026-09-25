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

test.each([
  "pageshow",
  "reset",
  "unmount",
  "disclosure",
  "sort",
  "escape",
] as const)(
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
      sortOptions: [
        {
          value: "PRICE_ASC",
          label: copy.giftSortPriceAsc,
          href: "/en/gifts?sort=PRICE_ASC&cart=preserve",
        },
      ],
      appliedFilters: [],
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
    } else if (action === "disclosure") {
      const disclosure = propsFor(tree, "data-gift-filter-disclosure", true);
      expect(disclosure).toBeDefined();
      (disclosure!["onToggle"] as (event: unknown) => void)({
        currentTarget: { open: false },
      });
    } else if (action === "sort") {
      const sort = propsFor(tree, "data-gift-toolbar-sort", true);
      expect(sort).toBeDefined();
      (sort!["onChange"] as (event: unknown) => void)({
        target: { value: "PRICE_ASC" },
      });
      expect(assign).not.toHaveBeenCalled();
      (sort!["ref"] as { current: unknown }).current = {
        value: "PRICE_ASC",
      };
      const sortForm = propsFor(tree, "data-gift-toolbar-form", true);
      expect(sortForm).toBeDefined();
      (sortForm!["onSubmit"] as (event: unknown) => void)({
        preventDefault: vi.fn(),
      });
      expect(assign).toHaveBeenCalledExactlyOnceWith(
        "/en/gifts?sort=PRICE_ASC&cart=preserve",
      );
      assign.mockClear();
    } else if (action === "escape") {
      const disclosure = propsFor(tree, "data-gift-filter-disclosure", true)!;
      expect(disclosure["onKeyDown"]).toEqual(expect.any(Function));
      const focus = vi.fn();
      const element = { open: true, querySelector: () => ({ focus }) };
      const preventDefault = vi.fn();
      (disclosure["onKeyDown"] as (event: unknown) => void)({
        key: "Escape",
        currentTarget: element,
        preventDefault,
        stopPropagation: vi.fn(),
      });
      expect(element.open).toBe(false);
      expect(focus).toHaveBeenCalledOnce();
      expect(preventDefault).toHaveBeenCalledOnce();
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

test("an invalid amount opens the desktop disclosure before focusing the invalid field", async () => {
  vi.resetModules();
  hooks.effects.length = 0;
  vi.doMock("./gift-filter-validation", () => ({
    validateGiftFilterDraft: () => ({
      kind: "INVALID",
      minimum: true,
      maximum: false,
    }),
  }));
  const focus = vi.fn();
  class TestInput {
    focus = focus;
  }
  vi.stubGlobal("HTMLInputElement", TestInput);
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
      sort: "RECOMMENDED",
      category: "",
      availability: "ALL",
      minimum: "invalid",
      maximum: "",
    },
    resetHref: "/en/gifts",
    recoveryHref: "/en/gifts",
    hint: "USD",
    sortOptions: [],
    appliedFilters: [],
  });
  const disclosure = propsFor(tree, "data-gift-filter-disclosure", true)!;
  const element = { open: false };
  (disclosure["ref"] as { current: unknown }).current = element;
  const input = new TestInput();
  focus.mockImplementation(() => expect(element.open).toBe(true));
  const namedItem = vi.fn(() => input);
  const form = propsFor(tree, "data-gift-filters", "desktop")!;
  (form["onSubmit"] as (event: unknown) => void)({
    preventDefault: vi.fn(),
    currentTarget: {
      dataset: { giftFilters: "desktop" },
      elements: { namedItem },
    },
  });
  await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
  expect(namedItem).toHaveBeenCalledWith("priceMinimum");
});

test("toolbar sorting waits for explicit submission, blocks composition Enter, and restores the URL selection after history navigation", async () => {
  vi.resetModules();
  hooks.effects.length = 0;
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
      sort: "RECOMMENDED",
      category: "",
      availability: "ALL",
      minimum: "",
      maximum: "",
    },
    resetHref: "/en/gifts",
    recoveryHref: "/en/gifts",
    hint: "USD",
    sortOptions: [
      { value: "RECOMMENDED", label: "Recommended", href: "/en/gifts" },
      {
        value: "PRICE_ASC",
        label: "Price ascending",
        href: "/en/gifts?sort=PRICE_ASC&cart=preserve",
      },
    ],
    appliedFilters: [],
  });
  const cleanups = hooks.effects.map((effect) => effect());
  const form = propsFor(tree, "data-gift-toolbar-form", true);
  expect(form).toBeDefined();
  const sort = propsFor(tree, "data-gift-toolbar-sort", true)!;
  const control = { value: "PRICE_ASC" };
  (sort["ref"] as { current: unknown }).current = control;
  (sort["onChange"] as (event: unknown) => void)({ target: control });
  expect(assign).not.toHaveBeenCalled();
  const submit = () =>
    (form!["onSubmit"] as (event: unknown) => void)({
      preventDefault: vi.fn(),
    });
  (form!["onCompositionStart"] as () => void)();
  const preventDefault = vi.fn();
  (form!["onKeyDown"] as (event: unknown) => void)({
    key: "Enter",
    nativeEvent: { isComposing: true, keyCode: 229 },
    preventDefault,
  });
  expect(preventDefault).toHaveBeenCalledOnce();
  submit();
  expect(assign).not.toHaveBeenCalled();
  (form!["onCompositionEnd"] as () => void)();
  submit();
  expect(assign).toHaveBeenCalledExactlyOnceWith(
    "/en/gifts?sort=PRICE_ASC&cart=preserve",
  );
  assign.mockClear();
  listeners.get("pageshow")!({ persisted: true });
  for (const frame of frames) frame();
  expect(control.value).toBe("RECOMMENDED");
  expect(assign).not.toHaveBeenCalled();
  expect(propsFor(tree, "data-gift-toolbar-apply", true)?.["type"]).toBe(
    "submit",
  );
  for (const cleanup of cleanups) cleanup?.();
});

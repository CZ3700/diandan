import { Children, isValidElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, expect, test, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  deps: [] as Array<readonly unknown[]>,
  layouts: [] as Array<() => void>,
  effects: [] as Array<() => void | (() => void)>,
  stateIndex: 0,
  refIndex: 0,
  dependencyIndex: 0,
  callback: undefined as unknown,
}));
vi.mock("react", async (load) => ({
  ...(await load<typeof ReactModule>()),
  useCallback: (callback: unknown) => (hooks.callback ??= callback),
  useRef: (value: unknown) => {
    const index = hooks.refIndex++;
    return (hooks.refs[index] ??= { current: value });
  },
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [
      hooks.states[index],
      (next: unknown) => {
        hooks.states[index] =
          typeof next === "function"
            ? (next as (old: unknown) => unknown)(hooks.states[index])
            : next;
      },
    ];
  },
  useLayoutEffect: (effect: () => void, deps: readonly unknown[]) => {
    const index = hooks.dependencyIndex++;
    if (
      !hooks.deps[index] ||
      deps.some((value, at) => value !== hooks.deps[index]![at])
    )
      hooks.layouts.push(effect);
    hooks.deps[index] = deps;
  },
  useEffect: (effect: () => void | (() => void)) => {
    if (hooks.effects.length === 0) hooks.effects.push(effect);
  },
}));

function find(
  node: ReactNode,
  key: string,
  value: unknown,
): Record<string, unknown> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.props[key] === value) return child.props;
    const match = find(child.props["children"] as ReactNode, key, value);
    if (match) return match;
  }
  return undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("./lazy-drawer-module");
});

async function setup(reject = false) {
  vi.resetModules();
  hooks.states.length =
    hooks.refs.length =
    hooks.deps.length =
    hooks.layouts.length =
    hooks.effects.length =
      0;
  hooks.callback = undefined;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = 0;
  let moduleSettled!: () => void;
  const settled = new Promise<void>((resolve) => {
    moduleSettled = resolve;
  });
  const LoadedDrawer = () => null;
  vi.doMock("./lazy-drawer-module", async () => {
    requested++;
    await waiting;
    moduleSettled();
    if (reject) throw new Error("CONTROLLED_CHUNK_FAILURE");
    return { StorefrontDrawer: LoadedDrawer };
  });
  const listeners = new Map<string, (event: unknown) => void>();
  const body = {};
  const document = {
    body,
    activeElement: body,
    addEventListener: (name: string, handler: (event: unknown) => void) =>
      listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    ...document,
    location: {
      href: "https://storefront.example.invalid/en?market=TEST&currency=USD",
    },
  });
  const button = () => {
    const node = {
      isConnected: true,
      contains: (target: unknown) => target === node,
      focus: vi.fn(() => {
        document.activeElement = node;
      }),
    };
    return node;
  };
  const original = button();
  let parentOpen = false;
  const change = vi.fn((next: boolean) => {
    parentOpen = next;
  });
  const { LazyDrawer } = await import("./lazy-drawer");
  const render = () => {
    hooks.stateIndex = hooks.refIndex = hooks.dependencyIndex = 0;
    hooks.layouts.length = 0;
    return LazyDrawer({
      open: parentOpen,
      onOpenChange: change,
      triggerLabel: "Open fixture",
      title: "Fixture",
      description: "Description",
      closeLabel: "Close",
      loadingLabel: "Loading",
      errorLabel: "Failed",
      retryLabel: "Retry",
    });
  };
  let tree = render();
  (
    find(tree, "className", "fs-overlay-trigger")!["ref"] as {
      current: unknown;
    }
  ).current = original;
  document.activeElement = original;
  hooks.layouts.forEach((effect) => effect());
  const cleanups = hooks.effects.map((effect) => effect());
  const activate = (touch = false) => {
    const props = find(tree, "className", "fs-overlay-trigger")!;
    if (touch)
      (props["onPointerDown"] as (event: unknown) => void)({
        pointerType: "touch",
      });
    (props["onClick"] as (event: unknown) => void)({ detail: touch ? 1 : 0 });
    tree = render();
    hooks.layouts.forEach((effect) => effect());
  };
  const settle = async () => {
    release();
    await settled;
    for (let count = 0; count < 20; count++) await Promise.resolve();
  };
  const commit = () => {
    tree = render();
    const props = find(tree, "triggerLabel", "Open fixture");
    const replacement = props ? button() : null;
    if (props && replacement) {
      original.isConnected = false;
      if (document.activeElement === original) document.activeElement = body;
      (props["triggerRef"] as { current: unknown }).current = replacement;
    }
    hooks.layouts.forEach((effect) => effect());
    tree = render();
    return { props: find(tree, "triggerLabel", "Open fixture"), replacement };
  };
  return {
    render,
    activate,
    settle,
    commit,
    requested: () => requested,
    original,
    document,
    listeners,
    change,
    setOpen: (value: boolean) => {
      parentOpen = value;
    },
    clean: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}

test.each([false, true])(
  "first real activation loads once and preserves touch=%s opening intent",
  async (touch) => {
    const state = await setup();
    expect(state.requested()).toBe(0);
    state.activate(touch);
    await state.settle();
    const result = state.commit();
    expect(result.props!["open"]).toBe(true);
    expect(result.props!["initialFocus"]).toBe(touch ? "popup" : undefined);
    expect(result.replacement!.focus).toHaveBeenCalledOnce();
    (result.props!["onOpenChange"] as (open: boolean) => void)(false);
    state.commit();
    expect(state.requested()).toBe(1);
    expect(state.change).toHaveBeenLastCalledWith(false);
    state.clean();
  },
);

test.each([
  "Escape",
  "Tab",
  "focus",
  "pointer",
  "pagehide",
  "external-close",
  "unmount",
])(
  "%s cancels a pending real module promise without late modal or focus",
  async (action) => {
    const state = await setup();
    state.activate();
    if (action === "unmount") state.clean();
    else if (action === "external-close") {
      state.setOpen(false);
      state.commit();
    } else if (action === "focus") {
      state.document.activeElement = {};
      state.listeners.get("focusin")!({ target: state.document.activeElement });
    } else if (action === "pointer")
      state.listeners.get("pointerdown")!({ target: {} });
    else if (action === "pagehide") state.listeners.get("pagehide")!({});
    else state.listeners.get("keydown")!({ key: action });
    await state.settle();
    expect(state.commit().props).toBeUndefined();
    expect(state.original.isConnected).toBe(true);
    if (action !== "unmount") state.clean();
  },
);

test.each(["Escape", "external-close"])(
  "%s after resolution but before commit retains the native focused trigger",
  async (action) => {
    const state = await setup();
    state.activate();
    await state.settle();
    if (action === "Escape") state.listeners.get("keydown")!({ key: "Escape" });
    else state.setOpen(false);
    state.commit();
    expect(state.document.activeElement).toBe(state.original);
    expect(state.original.isConnected).toBe(true);
    state.clean();
  },
);

test("focus moving between resolution and commit is never reclaimed", async () => {
  const state = await setup();
  state.activate();
  await state.settle();
  const other = {};
  state.document.activeElement = other;
  const result = state.commit();
  expect(result.props!["open"]).toBe(false);
  expect(result.replacement!.focus).not.toHaveBeenCalled();
  expect(state.document.activeElement).toBe(other);
  state.clean();
});

test("a real rejected import offers local retry and an explicit URL-preserving recovery after another failure", async () => {
  const state = await setup(true);
  state.activate();
  await state.settle();
  let tree = state.render();
  expect(find(tree, "data-drawer-load-state", "error")).toBeDefined();
  const status = find(tree, "role", "status")!;
  const retry = find(status["children"] as ReactNode, "type", "button")!;
  (retry["onClick"] as () => void)();
  await state.settle();
  tree = state.render();
  expect(
    find(
      tree,
      "href",
      "https://storefront.example.invalid/en?market=TEST&currency=USD",
    ),
  ).toBeDefined();
  state.clean();
});

import { afterEach, expect, test, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import type * as ReactModule from "react";

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  stateIndex: 0,
  refIndex: 0,
  effects: [] as Array<() => void | (() => void)>,
  layouts: [] as Array<() => void>,
}));
vi.mock("react", async (load) => ({
  ...(await load<typeof ReactModule>()),
  useCallback: (callback: unknown) => callback,
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    hooks.refs[index] ??= { current: initial };
    return hooks.refs[index];
  },
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [
      hooks.states[index],
      (next: unknown) => {
        hooks.states[index] =
          typeof next === "function"
            ? (next as (current: unknown) => unknown)(hooks.states[index])
            : next;
      },
    ];
  },
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
  useLayoutEffect: (effect: () => void) => hooks.layouts.push(effect),
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
  vi.doUnmock("./site-header-language-menu");
});

async function setup(reject = false) {
  vi.resetModules();
  hooks.states.length =
    hooks.refs.length =
    hooks.effects.length =
    hooks.layouts.length =
      0;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = 0;
  const LoadedMenu = () => null;
  vi.doMock("./site-header-language-menu", async () => {
    requested++;
    await waiting;
    if (reject) throw new Error("CONTROLLED_CHUNK_FAILURE");
    return { HeaderLanguageMenu: LoadedMenu };
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
  const window = {
    ...document,
    location: {
      href: "https://storefront.example.invalid/en?market=TEST&currency=USD",
    },
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
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
  const cancelRef = { current: null as null | (() => void) };
  const { HeaderLanguage } = await import("./site-header-language");
  const render = () => {
    hooks.stateIndex = hooks.refIndex = 0;
    hooks.effects.length = hooks.layouts.length = 0;
    return HeaderLanguage({
      locale: "en",
      label: "Language",
      loadingLabel: "Loading",
      errorLabel: "Please try again",
      retryLabel: "Try again",
      onValueChange: vi.fn(),
      cancelRef,
    });
  };
  let tree = render();
  (
    find(tree, "className", "fs-menu__trigger")!["ref"] as { current: unknown }
  ).current = original;
  document.activeElement = original;
  const cleanups = hooks.effects.map((effect) => effect());
  const activate = (key?: string) => {
    const props = find(tree, "className", "fs-menu__trigger")!;
    if (key)
      (props["onKeyDown"] as (event: unknown) => void)({
        key,
        preventDefault: vi.fn(),
      });
    else (props["onClick"] as () => void)();
  };
  const settle = async () => {
    release();
    await import("./site-header-language-menu").catch(() => undefined);
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  };
  const commit = () => {
    tree = render();
    const props = find(tree, "label", "Language");
    if (!props) return { props: null, replacement: null };
    const replacement = button();
    original.isConnected = false;
    if (document.activeElement === original) document.activeElement = body;
    (props["triggerRef"] as { current: unknown }).current = replacement;
    hooks.layouts.forEach((effect) => effect());
    tree = render();
    return { props: find(tree, "label", "Language")!, replacement };
  };
  return {
    render,
    document,
    body,
    original,
    cancelRef,
    activate,
    settle,
    commit,
    release,
    requested: () => requested,
    listeners,
    clean: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}

test.each([undefined, "ArrowDown", "ArrowUp"])(
  "first %s activation loads only on interaction and retains opening intent",
  async (key) => {
    const state = await setup();
    expect(state.requested()).toBe(0);
    state.activate(key);
    await vi.waitFor(() => expect(state.requested()).toBe(1));
    await state.settle();
    const committed = state.commit();
    expect(committed.props!["open"]).toBe(true);
    expect(committed.props!["initialFocus"]).toBe(
      key === "ArrowUp" ? "last" : key === "ArrowDown" ? "first" : undefined,
    );
    expect(committed.replacement!.focus).toHaveBeenCalledOnce();
    state.clean();
  },
);

test.each([
  "Tab",
  "Escape",
  "focus",
  "pointer",
  "pagehide",
  "parent-close",
  "unmount",
])(
  "%s cancels the real pending import without reopening or late focus",
  async (action) => {
    const state = await setup();
    state.activate();
    await vi.waitFor(() => expect(state.requested()).toBe(1));
    if (action === "unmount") state.clean();
    else if (action === "parent-close") state.cancelRef.current!();
    else if (action === "focus") {
      state.document.activeElement = {};
      state.listeners.get("focusin")!({ target: state.document.activeElement });
    } else if (action === "pointer")
      state.listeners.get("pointerdown")!({ target: {} });
    else if (action === "pagehide") state.listeners.get("pagehide")!({});
    else state.listeners.get("keydown")!({ key: action });
    if (action === "unmount") {
      state.release();
      await import("./site-header-language-menu");
      for (let turn = 0; turn < 20; turn++) await Promise.resolve();
      expect(hooks.states[0]).toBeNull();
    } else {
      await state.settle();
      const committed = state.commit();
      expect(committed.props).toBeNull();
      expect(committed.replacement).toBeNull();
      expect(state.original.isConnected).toBe(true);
      state.clean();
    }
  },
);

test("Escape keeps the focused native trigger when a cancelled import finishes", async () => {
  const state = await setup();
  state.activate();
  state.listeners.get("keydown")!({ key: "Escape" });
  await state.settle();
  state.commit();
  expect(state.document.activeElement).toBe(state.original);
  expect(state.original.isConnected).toBe(true);
  state.clean();
});

test("Escape between import resolution and commit also preserves the native trigger", async () => {
  const state = await setup();
  state.activate();
  await state.settle();
  state.listeners.get("keydown")!({ key: "Escape" });
  state.commit();
  expect(state.document.activeElement).toBe(state.original);
  expect(state.original.isConnected).toBe(true);
  state.clean();
});

test("focus moved between resolved import and commit is never reclaimed", async () => {
  const state = await setup();
  state.activate();
  await state.settle();
  state.document.activeElement = {};
  const committed = state.commit();
  expect(committed.props!["open"]).toBe(false);
  expect(committed.replacement!.focus).not.toHaveBeenCalled();
  state.clean();
});

test("a rejected menu chunk becomes a visible retry state, not an unhandled rejection", async () => {
  const state = await setup(true);
  state.activate();
  await state.settle();
  const tree = state.render();
  expect(find(tree, "data-language-state", "error")).toBeDefined();
  expect(find(tree, "role", "status")).toBeDefined();
  const status = find(tree, "role", "status")!;
  const retry = find(status["children"] as ReactNode, "type", "button")!;
  (retry["onClick"] as () => void)();
  await vi.waitFor(() => expect(hooks.states[2]).toBe(2));
  const failedAgain = state.render();
  expect(
    find(
      failedAgain,
      "href",
      "https://storefront.example.invalid/en?market=TEST&currency=USD",
    ),
  ).toBeDefined();
  state.clean();
});

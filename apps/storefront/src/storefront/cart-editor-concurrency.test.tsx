import { beforeEach, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import type * as React from "react";
import type { CartSession } from "./cart-session";
import copy from "../../../../packages/i18n/src/storefront/en";
vi.mock("./published-image", () => ({ PublishedImage: () => null }));
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  si: 0,
  ri: 0,
  effects: [] as Array<() => void | (() => void)>,
  mounted: false,
}));
vi.mock("react", async (load) => ({
  ...(await load<typeof React>()),
  useId: () => "cart-test-id",
  useRef: (value: unknown) => {
    const index = hooks.ri++;
    return (hooks.refs[index] ??= { current: value });
  },
  useState: (initial: unknown) => {
    const index = hooks.si++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [
      hooks.states[index],
      (value: unknown) => {
        hooks.states[index] =
          typeof value === "function"
            ? (value as (old: unknown) => unknown)(hooks.states[index])
            : value;
      },
    ];
  },
  useEffect: (effect: () => void | (() => void)) => {
    if (!hooks.mounted) hooks.effects.push(effect);
  },
}));
function form(node: ReactNode): Record<string, unknown> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.type === "form") return child.props;
    const found = form(child.props["children"] as ReactNode);
    if (found) return found;
  }
  return undefined;
}
beforeEach(() => {
  hooks.states = [];
  hooks.refs = [];
  hooks.effects = [];
  hooks.si = 0;
  hooks.ri = 0;
  hooks.mounted = false;
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
it("keeps the editor read version until a conflict is explicitly confirmed", async () => {
  const { CartEditor } = await import("./cart-editor");
  const itemId = "10000000-0000-4000-8000-000000000001";
  const editor = vi.fn().mockResolvedValue({
    outcome: "SUCCESS",
    action: "EDITOR_READ",
    cartItemId: itemId,
    cartVersion: 1,
    itemVersion: 1,
    content: {
      displayMode: "anonymous",
      fanMessageLocale: "und",
      fanMessage: "Synthetic draft",
    },
  });
  const mutate = vi.fn().mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "VERSION_CONFLICT",
  });
  const read = vi.fn().mockResolvedValue({ outcome: "UNKNOWN" });
  const session = { editor, mutate, read } as unknown as CartSession;
  const render = (version: number) => {
    hooks.si = 0;
    hooks.ri = 0;
    const tree = CartEditor({
      itemId,
      cartVersion: version,
      itemVersion: version,
      locale: "en",
      copy,
      session,
      onClose: vi.fn(),
    });
    hooks.mounted = true;
    return tree;
  };
  render(1);
  const cleanups = hooks.effects.map((effect) => effect());
  await Promise.resolve();
  const first = form(render(2))!;
  (first["onSubmit"] as (event: unknown) => void)({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mutate.mock.calls[0]?.[0].body)).toMatchObject({
    expectedCartVersion: 1,
    expectedItemVersion: 1,
  });
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  const second = form(render(2))!;
  (second["onSubmit"] as (event: unknown) => void)({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  expect(JSON.parse(mutate.mock.calls[1]?.[0].body)).toMatchObject({
    expectedCartVersion: 2,
    expectedItemVersion: 2,
  });
  expect(mutate.mock.calls[0]?.[0].key).not.toBe(mutate.mock.calls[1]?.[0].key);
  cleanups.forEach((cleanup) => cleanup?.());
  vi.unstubAllGlobals();
});

it("quantity drafts also retain their observed version until conflict confirmation", async () => {
  const { CartItem } = await import("./cart-item");
  const id = "10000000-0000-4000-8000-000000000001";
  const priceId = "20000000-0000-4000-8000-000000000001";
  const mutate = vi.fn().mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "VERSION_CONFLICT",
  });
  const read = vi.fn().mockResolvedValue({ outcome: "UNKNOWN" });
  const session = { mutate, read } as unknown as CartSession;
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
  const render = (version: number) => {
    hooks.si = 0;
    hooks.ri = 0;
    const tree = CartItem({
      item: {
        schemaVersion: 1,
        id,
        version,
        quantity: 1,
        displayMode: "anonymous",
        hasFanMessage: false,
        nicknameProvided: false,
        idol: null,
        gift: null,
        price: {
          status: "CURRENT",
          observedPriceId: priceId,
          current: { priceId, unitAmountMinor: 100, lineTotalMinor: 100 },
        },
        availability: {
          status: "UNAVAILABLE",
          reason: "CONTENT_UNAVAILABLE",
          maxQuantity: 5,
        },
      } as never,
      cartVersion: version,
      currency: "USD" as never,
      locale: "en",
      copy,
      session,
    });
    hooks.mounted = true;
    return tree;
  };
  const first = render(1);
  hooks.effects.forEach((effect) => effect());
  (
    propsFor(first, "label", copy.giftQuantity)!["onValueChange"] as (
      value: number,
    ) => void
  )(3);
  const next = render(2);
  (propsFor(next, "data-cart-quantity-save", true)!["onClick"] as () => void)();
  await vi.waitFor(() => expect(mutate).toHaveBeenCalledOnce());
  expect(JSON.parse(mutate.mock.calls[0]?.[0].body)).toMatchObject({
    expectedCartVersion: 1,
    expectedItemVersion: 1,
    change: { quantity: 3, observedPriceId: priceId },
  });
  vi.unstubAllGlobals();
});

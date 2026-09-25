import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as React from "react";
import copy from "../../../../packages/i18n/src/storefront/en";
import type { CartSession } from "./cart-session";
const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  writes: [] as unknown[],
}));
vi.mock("react", async (load) => ({
  ...(await load<typeof React>()),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [
    value,
    (next: unknown) => {
      hooks.writes.push(next);
    },
  ],
  useEffect: (effect: () => void | (() => void)) => {
    hooks.effects.push(effect);
  },
}));
beforeEach(() => {
  hooks.effects = [];
  hooks.writes = [];
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());
const reply = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  action: "EDITOR_READ",
  cartItemId: "10000000-0000-4000-8000-000000000001",
  cartVersion: 1,
  itemVersion: 1,
  content: {
    displayMode: "nickname",
    displayName: "Fictional canary",
    fanMessage: "Fictional private message",
    fanMessageLocale: "und",
  },
} as const;
it("closing the editor ignores a later plaintext response", async () => {
  const { CartEditor } = await import("./cart-editor");
  let resolve!: (value: unknown) => void;
  const editor = vi.fn(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  CartEditor({
    itemId: reply.cartItemId,
    cartVersion: 1,
    itemVersion: 1,
    locale: "en",
    copy,
    session: { editor } as unknown as CartSession,
    onClose: vi.fn(),
  });
  const cleanups = hooks.effects.map((effect) => effect());
  cleanups.forEach((cleanup) => cleanup?.());
  resolve(reply);
  await Promise.resolve();
  await Promise.resolve();
  expect(hooks.writes).toEqual([]);
});
it("opening preserves both exact private fields and the declared unknown language", async () => {
  const { CartEditor } = await import("./cart-editor");
  CartEditor({
    itemId: reply.cartItemId,
    cartVersion: 1,
    itemVersion: 1,
    locale: "ja",
    copy,
    session: {
      editor: vi.fn().mockResolvedValue(reply),
    } as unknown as CartSession,
    onClose: vi.fn(),
  });
  const cleanups = hooks.effects.map((effect) => effect());
  await Promise.resolve();
  await Promise.resolve();
  expect(hooks.writes).toContainEqual(reply.content);
  cleanups.forEach((cleanup) => cleanup?.());
});
it("pagehide closes the private editor before a retained page can restore it", async () => {
  const listeners = new Map<string, () => void>();
  vi.stubGlobal("window", {
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const { CartEditor } = await import("./cart-editor");
  const close = vi.fn();
  CartEditor({
    itemId: reply.cartItemId,
    cartVersion: 1,
    itemVersion: 1,
    locale: "en",
    copy,
    session: {
      editor: vi.fn(() => new Promise(() => {})),
    } as unknown as CartSession,
    onClose: close,
  });
  const cleanups = hooks.effects.map((effect) => effect());
  listeners.get("pagehide")?.();
  expect(close).toHaveBeenCalledOnce();
  cleanups.forEach((cleanup) => cleanup?.());
});

it("an initial editor version conflict refreshes public facts without automatically reopening private content", async () => {
  const { CartEditor } = await import("./cart-editor");
  const editor = vi.fn().mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "VERSION_CONFLICT",
  });
  const read = vi.fn().mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CART_NOT_FOUND",
  });
  CartEditor({
    itemId: reply.cartItemId,
    cartVersion: 1,
    itemVersion: 1,
    locale: "en",
    copy,
    session: { editor, read } as unknown as CartSession,
    onClose: vi.fn(),
  });
  const cleanups = hooks.effects.map((effect) => effect());
  await Promise.resolve();
  await Promise.resolve();
  expect(read).toHaveBeenCalledOnce();
  expect(editor).toHaveBeenCalledOnce();
  cleanups.forEach((cleanup) => cleanup?.());
});

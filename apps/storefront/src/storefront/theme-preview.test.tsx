import { afterEach, expect, test, vi } from "vitest";
import { createDefaultStorefrontTheme } from "@fan-support/contracts";
const lifecycle = vi.hoisted(() => ({
  setup: undefined as (() => void | (() => void)) | undefined,
}));
vi.mock("react", () => ({
  useEffect: (setup: () => void | (() => void)) => {
    lifecycle.setup = setup;
  },
}));
import { ThemePreview } from "./theme-preview";

afterEach(() => {
  vi.unstubAllGlobals();
  lifecycle.setup = undefined;
});

test("preview applies presets, restores legacy defaults and cleans up every presentation attribute", () => {
  const attributes = new Map<string, string>([
    ["data-storefront-motion", "NONE"],
    ["data-theme-version", "7"],
  ]);
  const play = vi.fn();
  const cancel = vi.fn();
  const root = {
    getAttribute: (key: string) => attributes.get(key) ?? null,
    setAttribute: (key: string, value: string) => {
      attributes.set(key, value);
    },
    removeAttribute: (key: string) => {
      attributes.delete(key);
    },
    querySelectorAll: () => [{ getAnimations: () => [{ play, cancel }] }],
  };
  let receive: ((event: MessageEvent<unknown>) => void) | undefined;
  const parent = { postMessage: vi.fn() };
  const removeEventListener = vi.fn();
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("window", {
    parent,
    addEventListener: (_: string, callback: typeof receive) => {
      receive = callback;
    },
    removeEventListener,
  });
  const adminOrigin = "https://admin.example.invalid";
  const channel = "8c7cc797-c5fa-4a11-b0eb-6d282b9c4019";
  ThemePreview({ adminOrigin, channel });
  const cleanup = lifecycle.setup?.();
  const send = (theme: unknown, origin = adminOrigin) =>
    receive?.({
      source: parent,
      origin,
      data: {
        schemaVersion: 1,
        type: "STOREFRONT_THEME_PREVIEW",
        channel,
        theme,
      },
    } as unknown as MessageEvent<unknown>);
  const legacy = createDefaultStorefrontTheme();
  const updated = {
    ...legacy,
    presentation: {
      heroLayout: "SPLIT",
      giftLayout: "SHOWCASE",
      motion: "SUBTLE",
      motionSpeed: "QUICK",
    },
  };
  send(updated, "https://other.example.invalid");
  expect(attributes.get("data-storefront-motion")).toBe("NONE");
  send(updated);
  expect(attributes.get("data-storefront-hero-layout")).toBe("SPLIT");
  expect(attributes.get("data-storefront-motion")).toBe("SUBTLE");
  expect(play).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1);
  send(updated);
  expect(play).toHaveBeenCalledTimes(1);
  expect(attributes.has("data-theme-version")).toBe(false);
  send(legacy);
  expect(attributes.get("data-storefront-hero-layout")).toBe("IMMERSIVE");
  expect(attributes.get("data-storefront-gift-layout")).toBe("GRID");
  expect(attributes.get("data-storefront-motion")).toBe("STANDARD");
  expect(attributes.get("data-storefront-motion-speed")).toBe("STANDARD");
  cleanup?.();
  expect([...attributes]).toEqual([
    ["data-storefront-motion", "NONE"],
    ["data-theme-version", "7"],
  ]);
  expect(removeEventListener).toHaveBeenCalledWith("message", receive);
});

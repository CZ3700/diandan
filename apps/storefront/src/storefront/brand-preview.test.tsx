import { afterEach, expect, test, vi } from "vitest";
const lifecycle = vi.hoisted(() => ({
  setup: undefined as (() => void | (() => void)) | undefined,
  setPreview: vi.fn(),
}));
vi.mock("react", () => ({
  useEffect: (setup: () => void | (() => void)) => {
    lifecycle.setup = setup;
  },
}));
vi.mock("./branding-provider", () => ({
  useStorefrontBrand: () => ({ setPreview: lifecycle.setPreview }),
}));
import { BrandPreview } from "./brand-preview";

afterEach(() => {
  vi.unstubAllGlobals();
  lifecycle.setup = undefined;
  lifecycle.setPreview.mockClear();
});
test("brand draft handshake is inert outside an iframe, and valid updates are cleared on unmount", () => {
  const parent = { postMessage: vi.fn() };
  let receive: ((event: MessageEvent<unknown>) => void) | undefined;
  const removeEventListener = vi.fn();
  vi.stubGlobal("window", {
    parent,
    addEventListener: (_: string, callback: typeof receive) => {
      receive = callback;
    },
    removeEventListener,
  });
  const adminOrigin = "https://admin.example.invalid";
  const channel = "8c7cc797-c5fa-4a11-b0eb-6d282b9c4019";
  BrandPreview({ adminOrigin, channel });
  const cleanup = lifecycle.setup?.();
  expect(parent.postMessage).toHaveBeenCalledWith(
    { schemaVersion: 1, type: "STOREFRONT_BRAND_PREVIEW_READY", channel },
    adminOrigin,
  );
  const brand = { schemaVersion: 1, lightLogo: null, darkLogo: null };
  const event = {
    source: parent,
    origin: adminOrigin,
    data: {
      schemaVersion: 1,
      type: "STOREFRONT_BRAND_PREVIEW",
      channel,
      brand,
    },
  };
  receive?.({
    ...event,
    origin: "https://foreign.invalid",
  } as unknown as MessageEvent<unknown>);
  expect(lifecycle.setPreview).not.toHaveBeenCalled();
  receive?.(event as unknown as MessageEvent<unknown>);
  expect(lifecycle.setPreview).toHaveBeenCalledWith(brand);
  cleanup?.();
  expect(removeEventListener).toHaveBeenCalledWith("message", receive);
  expect(lifecycle.setPreview).toHaveBeenLastCalledWith(null);
  const standalone: Record<string, unknown> = {};
  standalone["parent"] = standalone;
  vi.stubGlobal("window", standalone);
  BrandPreview({ adminOrigin, channel });
  expect(lifecycle.setup?.()).toBeUndefined();
});

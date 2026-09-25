import { expect, test, vi } from "vitest";
import { fixture } from "./cart-runtime.test-fixtures.js";
import type { CartRuntimeRepositories } from "@fan-support/persistence-port";
import type {
  CartRuntimeHeader,
  CartRuntimeView,
  SupportedLocale,
} from "@fan-support/contracts";
const current = vi.hoisted(() => ({ readGift: vi.fn() }));
vi.mock("./storefront-commerce.js", () => ({
  createStorefrontCommerceUseCases: () => current,
}));
const path = "./cart-runtime-view.js";
const module = (await import(path).catch(() => ({}))) as {
  readCartRuntimeView?: (
    repos: CartRuntimeRepositories,
    cart: CartRuntimeHeader,
    locale: SupportedLocale,
  ) => Promise<CartRuntimeView>;
};
test("shared cart projection preserves current content and private flags without decrypting", async () => {
  const f = fixture("ja");
  current.readGift.mockResolvedValue(f.current);
  const repos = {
    cartRuntime: {
      listItems: async () => [f.item],
      resolveGiftHandle: async () => ({
        schemaVersion: 1,
        giftId: f.command.giftId,
        handle: "test-gift",
      }),
    },
    storefrontCommerce: {},
  } as unknown as CartRuntimeRepositories;
  expect(module.readCartRuntimeView).toBeTypeOf("function");
  const result = await module.readCartRuntimeView!(repos, f.cart, "ja");
  expect(result).toMatchObject({
    presentationLocale: "ja",
    market: f.cart.market,
    currency: f.cart.currency,
    items: [{ id: f.item.id, quantity: 2, hasFanMessage: false }],
  });
  expect(JSON.stringify(result)).not.toMatch(
    /Ciphertext|encryptedDataKey|supportIntentId|tokenDigest/,
  );
});
test("an unavailable current content proof cannot become a successful cart projection", async () => {
  const f = fixture();
  current.readGift.mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
  const repos = {
    cartRuntime: {
      listItems: async () => [f.item],
      resolveGiftHandle: async () => ({
        schemaVersion: 1,
        giftId: f.command.giftId,
        handle: "test-gift",
      }),
    },
    storefrontCommerce: {},
  } as unknown as CartRuntimeRepositories;
  expect(module.readCartRuntimeView).toBeTypeOf("function");
  await expect(
    module.readCartRuntimeView!(repos, f.cart, "en"),
  ).rejects.toMatchObject({ code: "CONTENT_UNAVAILABLE" });
});

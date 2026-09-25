import { expect, test, vi } from "vitest";
import type { StorefrontCommerceRepository } from "@fan-support/persistence-port";

async function create(repository: StorefrontCommerceRepository) {
  const module = await import("./storefront-commerce.js").catch(
    () => undefined,
  );
  expect(module, "storefront commerce use cases must exist").toBeDefined();
  const run = vi.fn(
    async (
      work: (repositories: {
        storefrontCommerce: StorefrontCommerceRepository;
      }) => Promise<never>,
    ) => work({ storefrontCommerce: repository }),
  );
  return {
    useCases: module!.createStorefrontCommerceUseCases({
      transactions: { runInStorefrontCommerceTransaction: run },
    }),
    run,
  };
}
const query = {
  schemaVersion: 1,
  handle: "studio-gift",
  locale: "en",
  market: "TEST",
  currency: "USD",
};
const context = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "STOREFRONT_CONTEXT",
  markets: [],
  policies: [],
} as const;
function repository() {
  return {
    readContext: vi.fn<StorefrontCommerceRepository["readContext"]>(
      async () => ({ ...context, markets: [], policies: [] }),
    ),
    loadGift: vi.fn<StorefrontCommerceRepository["loadGift"]>(async () => ({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "NOT_FOUND",
    })),
  };
}
test("invalid caller scope and configuration payloads do not reach the transaction", async () => {
  const { useCases, run } = await create(repository());
  expect(
    await useCases.readGift({ ...query, currency: undefined }),
  ).toMatchObject({ code: "INVALID_QUERY" });
  expect(
    await useCases.readContext({ schemaVersion: 1, market: "TEST" }),
  ).toMatchObject({ code: "INVALID_QUERY" });
  expect(run).not.toHaveBeenCalled();
});
test("configuration reads return only validated public metadata in one transaction", async () => {
  const repo = repository(),
    { useCases, run } = await create(repo);
  expect(await useCases.readContext({ schemaVersion: 1 })).toEqual(context);
  expect(run).toHaveBeenCalledTimes(1);
  repo.readContext.mockResolvedValueOnce({
    ...context,
    inventoryLocations: [{ id: "private" }],
  } as never);
  expect(await useCases.readContext({ schemaVersion: 1 })).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "COMMERCE_UNAVAILABLE",
  });
});
test("missing content and infrastructure failures remain distinct safe responses", async () => {
  const repo = repository(),
    { useCases } = await create(repo);
  expect(await useCases.readGift(query)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  });
  repo.loadGift.mockRejectedValueOnce(new Error("private database statement"));
  expect(await useCases.readGift(query)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
  repo.loadGift.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    context: "caller forged",
  } as never);
  expect(await useCases.readGift(query)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
});

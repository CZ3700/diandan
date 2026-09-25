import { expect, it, vi } from "vitest";
import { createPublishedGiftCommerceUseCases } from "./published-gift-commerce.js";
it("validates queries before I/O and maps unavailable proof without provider text", async () => {
  const load = vi.fn(
    async () =>
      ({ schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" }) as const,
  );
  const useCases = createPublishedGiftCommerceUseCases({
    transactions: {
      runInPublishedGiftCommerceTransaction: async (work) =>
        work({ publishedGiftCommerce: { load } }),
    },
  });
  const query = {
    schemaVersion: 1,
    locator: { kind: "GIFT", handle: "studio-gift" },
    locale: "en",
  };
  expect(await useCases.execute({ ...query, currency: "USD" })).toMatchObject({
    code: "INVALID_QUERY",
  });
  expect(load).not.toHaveBeenCalled();
  expect(await useCases.execute(query)).toMatchObject({ code: "NOT_FOUND" });
  load.mockRejectedValueOnce(new Error("private SQL statement"));
  expect(await useCases.execute(query)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
});

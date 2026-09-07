import * as homepageModule from "./storefront-homepage.js";
import { expect, test, vi } from "vitest";
import type {
  StorefrontHomepageRepository,
  StorefrontHomepageTransactionManager,
} from "@fan-support/persistence-port";

async function factory() {
  return homepageModule.createStorefrontHomepageUseCases;
}
test("invalid homepage query cannot reach persistence", async () => {
  const create = await factory();
  const run = vi.fn();
  const useCases = create({
    transactions: { runInStorefrontHomepageTransaction: run },
  });
  expect(
    await useCases.execute({ schemaVersion: 1, locale: "en", giftIds: [] }),
  ).toMatchObject({ code: "INVALID_QUERY" });
  expect(run).not.toHaveBeenCalled();
});
test("missing homepage and database failure return safe bounded errors", async () => {
  const create = await factory();
  const load = vi.fn<StorefrontHomepageRepository["load"]>(async () => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  }));
  let runs = 0;
  const transactions: StorefrontHomepageTransactionManager = {
    async runInStorefrontHomepageTransaction(work) {
      runs += 1;
      return work({ storefrontHomepage: { load } });
    },
  };
  const useCases = create({ transactions });
  expect(await useCases.execute({ schemaVersion: 1, locale: "ja" })).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  });
  expect(runs).toBe(1);
  expect(load).toHaveBeenCalledWith({ schemaVersion: 1, locale: "ja" });
  load.mockRejectedValue(new Error("private database content"));
  expect(await useCases.execute({ schemaVersion: 1, locale: "ja" })).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
});

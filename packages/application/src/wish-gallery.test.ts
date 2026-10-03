import { expect, test } from "vitest";
import type { WishGalleryRepository } from "@fan-support/persistence-port";
import type * as WishGalleryModule from "./wish-gallery.js";
const modulePath = "./wish-gallery.js";
const module = (await import(modulePath).catch(() => ({}))) as Partial<
  typeof WishGalleryModule
>;
const id = "00000000-0000-4000-8000-000000000001";
function setup(repository: unknown) {
  expect(module["createWishGalleryUseCases"]).toBeTypeOf("function");
  let commits = 0;
  const app = module["createWishGalleryUseCases"]!({
    transactions: {
      async runInWishGalleryTransaction(work) {
        const value = await work(repository as WishGalleryRepository);
        commits++;
        return value;
      },
    },
  });
  return { app, commits: () => commits };
}
test("invalid reads stop before persistence; valid pages are validated inside the transaction", async () => {
  const state = setup({
    read: async () => ({ schemaVersion: 1, entries: [], nextCursor: null }),
  });
  expect(
    await state.app.read({ schemaVersion: 1, locale: "en", limit: 51 }),
  ).toMatchObject({ outcome: "FAILURE", code: "INVALID_REQUEST" });
  expect(state.commits()).toBe(0);
  expect(
    await state.app.read({ schemaVersion: 1, locale: "en" }),
  ).toMatchObject({ outcome: "SUCCESS", page: { entries: [] } });
  expect(state.commits()).toBe(1);
  const corrupt = setup({
    read: async () => ({
      schemaVersion: 1,
      entries: [],
      nextCursor: null,
      orderId: id,
    }),
  });
  expect(
    await corrupt.app.read({ schemaVersion: 1, locale: "en" }),
  ).toMatchObject({ outcome: "FAILURE", code: "TEMPORARY_UNAVAILABLE" });
  expect(corrupt.commits()).toBe(0);
});
test("withdrawal validates matching identity before commit and never exposes internal errors", async () => {
  const input = {
    schemaVersion: 1,
    publicOrderId: id,
    entryId: id,
    requestId: id,
    correlationId: id,
    taskName: "gallery-withdraw",
    sessionCandidates: [
      { schemaVersion: 1, tokenDigest: "a".repeat(64), pepperVersion: "v1" },
    ],
  };
  const state = setup({
    withdraw: async () => ({ schemaVersion: 1, entryId: id, withdrawn: true }),
  });
  expect(await state.app.withdraw(input)).toMatchObject({
    outcome: "SUCCESS",
    withdrawn: { entryId: id, withdrawn: true },
  });
  const wrong = setup({
    withdraw: async () => ({
      schemaVersion: 1,
      entryId: "00000000-0000-4000-8000-000000000002",
      withdrawn: true,
    }),
  });
  expect(await wrong.app.withdraw(input)).toMatchObject({
    outcome: "FAILURE",
    code: "TEMPORARY_UNAVAILABLE",
  });
  expect(wrong.commits()).toBe(0);
  const error = setup({
    withdraw: async () => {
      throw new Error("private SQL details");
    },
  });
  expect(await error.app.withdraw(input)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "TEMPORARY_UNAVAILABLE",
  });
});

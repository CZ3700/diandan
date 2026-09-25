import * as homepageModule from "./storefront-homepage-repository.js";
import { expect, test, vi } from "vitest";
import type { TransactionScopeControl } from "./transaction-runner.js";

async function factory() {
  return homepageModule.createStorefrontHomepageRepository;
}
const scope = {
  trackOperation: <T>(work: () => Promise<T>) => work(),
} as TransactionScopeControl;
test("repository rejects client-selected IDs before database access", async () => {
  const create = await factory();
  const query = vi.fn();
  const reader = create(
    { query, release: vi.fn() },
    scope,
    "https://media.example.test/",
  );
  expect(
    await reader.load({
      schemaVersion: 1,
      locale: "en",
      idolId: "caller",
    } as never),
  ).toMatchObject({ code: "INVALID_QUERY" });
  expect(query).not.toHaveBeenCalled();
});
test("missing published homepage performs no artist or gift catalog reads", async () => {
  const create = await factory();
  const query = vi.fn(async (sql: string) => {
    void sql;
    return { rows: [] };
  });
  const reader = create(
    { query, release: vi.fn() },
    scope,
    "https://media.example.test/",
  );
  expect(await reader.load({ schemaVersion: 1, locale: "en" })).toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    query.mock.calls.some(([sql]) =>
      /public\.(?:idols|gifts)\b/u.test(String(sql)),
    ),
  ).toBe(false);
});

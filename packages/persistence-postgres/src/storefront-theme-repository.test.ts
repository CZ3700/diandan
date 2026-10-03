import { expect, test, vi } from "vitest";
import { createStorefrontThemeRepository } from "./storefront-theme-repository.js";
import type { TransactionScopeControl } from "./transaction-runner.js";
const scope = {
  trackOperation: async <T>(work: () => Promise<T>) => work(),
} as TransactionScopeControl;
test("public read fetches no draft and default is only for an existing unconfigured head", async () => {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string) => {
    statements.push(sql);
    return { rows: [{ published_publication_id: null }] };
  });
  const repository = createStorefrontThemeRepository(
    { query, release: () => undefined },
    scope,
  );
  expect(await repository.readPublished()).toMatchObject({
    outcome: "SUCCESS",
    source: "DEFAULT",
    version: 0,
  });
  expect(query).toHaveBeenCalledTimes(1);
  expect(statements[0]).not.toContain("draft_revision_id");
});
test("missing or broken persistence does not fabricate a default theme", async () => {
  const query = vi.fn(async () => ({ rows: [] }));
  const repository = createStorefrontThemeRepository(
    { query, release: () => undefined },
    scope,
  );
  await expect(repository.readPublished()).rejects.toThrow();
});

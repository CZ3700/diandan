import { expect, it, vi } from "vitest";
import { createPublicationRuntimeRepository } from "./publication-runtime-repository.js";
import { createPublicationAuthorizationRepository } from "./publication-authorization-repository.js";
import { createPublicationPurgeRepository } from "./publication-purge-repository.js";
import type { TransactionScopeControl } from "./transaction-runner.js";
const scope = {
  trackOperation: <Result>(work: () => Promise<Result>) => work(),
} as TransactionScopeControl;
it.each(["load", "write", "readReceipt", "status", "retry"] as const)(
  "rejects malformed publication %s without a query",
  async (method) => {
    const client = { query: vi.fn(), release: vi.fn() };
    expect(
      await createPublicationRuntimeRepository(client, scope)[method](
        {} as never,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_COMMAND",
    });
    expect(client.query).not.toHaveBeenCalled();
  },
);
it("rejects incomplete publication authority without querying", async () => {
  const client = { query: vi.fn(), release: vi.fn() };
  expect(
    await createPublicationAuthorizationRepository(client, scope).authorize(
      {} as never,
    ),
  ).toEqual({ schemaVersion: 1, outcome: "FAILURE", code: "INVALID_COMMAND" });
  expect(client.query).not.toHaveBeenCalled();
});
it.each(["claim", "record"] as const)(
  "rejects malformed purge %s without a query",
  async (method) => {
    const client = { query: vi.fn(), release: vi.fn() };
    expect(
      await createPublicationPurgeRepository(client, scope)[method](
        {} as never,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_COMMAND",
    });
    expect(client.query).not.toHaveBeenCalled();
  },
);

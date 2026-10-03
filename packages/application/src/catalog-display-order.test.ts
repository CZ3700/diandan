import { expect, test, vi } from "vitest";
import type { CatalogDisplayOrderTransactionManager } from "@fan-support/persistence-port";
import { createCatalogDisplayOrderUseCases } from "./catalog-display-order.js";

const id = "00000000-0000-4000-8000-000000000001";
const principal = {
  schemaVersion: 1,
  actorId: id,
  sessionId: id,
  authorizedAt: "2026-09-29T00:00:00Z",
  expiresAt: "2026-09-29T01:00:00Z",
};
const state = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "DISPLAY_ORDER",
  orderKind: "GIFT",
  version: 1,
  items: [],
  replayed: false,
};
function fixture() {
  const authorization = {
    authorize: vi
      .fn()
      .mockResolvedValue({ schemaVersion: 1, outcome: "SUCCESS", principal }),
  };
  const displayOrder = { execute: vi.fn().mockResolvedValue(state) };
  const transactions = {
    runInCatalogDisplayOrderTransaction: vi.fn(
      async (work: (repos: unknown) => unknown) =>
        work({ authorization, displayOrder }),
    ),
  } as unknown as CatalogDisplayOrderTransactionManager;
  const useCases = createCatalogDisplayOrderUseCases({
    transactions,
    tokenPepper: "c".repeat(64),
  });
  const request = (command: object) => ({
    schemaVersion: 1,
    requestId: id,
    sessionToken: "a".repeat(42) + "A",
    csrfToken: "b".repeat(42) + "A",
    command,
  });
  return { authorization, displayOrder, useCases, request };
}
test("reading needs content.read and saving publishes with content.publish (L2-10)", async () => {
  const f = fixture();
  await f.useCases.execute(
    f.request({ schemaVersion: 1, action: "READ", kind: "GIFT" }),
  );
  await f.useCases.execute(
    f.request({
      schemaVersion: 1,
      action: "SAVE",
      kind: "GIFT",
      expectedVersion: 0,
      orderedIds: [id],
      idempotencyKey: "display-order-save-01",
    }),
  );
  expect(
    f.authorization.authorize.mock.calls.map(([command]) => ({
      permission: (command as { permission: string }).permission,
      locales: (command as { locales: string[] }).locales,
    })),
  ).toEqual([
    { permission: "content.read", locales: [] },
    { permission: "content.publish", locales: [] },
  ]);
  const saved = f.displayOrder.execute.mock.calls[1]?.[0];
  expect(saved).toMatchObject({ principal, requestId: id });
  expect(saved.requestHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(JSON.stringify(saved)).not.toContain("a".repeat(42));
});
test("duplicate ids and revoked authority never reach the repository", async () => {
  const f = fixture();
  expect(
    await f.useCases.execute(
      f.request({
        schemaVersion: 1,
        action: "SAVE",
        kind: "IDOL",
        expectedVersion: 0,
        orderedIds: [id, id],
        idempotencyKey: "display-order-save-02",
      }),
    ),
  ).toMatchObject({ outcome: "FAILURE", code: "INVALID_COMMAND" });
  f.authorization.authorize.mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "FORBIDDEN",
  });
  expect(
    await f.useCases.execute(
      f.request({ schemaVersion: 1, action: "READ", kind: "IDOL" }),
    ),
  ).toMatchObject({ outcome: "FAILURE", code: "FORBIDDEN" });
  expect(f.displayOrder.execute).not.toHaveBeenCalled();
});

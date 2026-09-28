import { expect, test, vi, beforeEach } from "vitest";
import type { ManagementCenterClaim } from "@fan-support/contracts";
const mocks = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("./gift-commerce-inventory-data.js", () => ({
  writeCommerceInventory: mocks.write,
}));
import { publishDailyGiftInventory } from "./daily-publication-inventory.js";
const id = "d1000000-0000-4000-8000-000000000001",
  at = "2026-09-08T00:00:00Z";
const claim = (quantity: number) =>
  ({
    actorId: id,
    sessionId: id,
    requestId: id,
    authorizedUntil: "2026-09-08T01:00:00Z",
    operation: { operationId: id },
    intent: {
      kind: "SAVE_GIFT",
      inventory: { policy: "TRACKED", locationId: id, quantity },
    },
  }) as ManagementCenterClaim;
const client = (onHand: number | null, reserved = 0) => ({
  release: vi.fn(),
  query: vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ version: 2 }] })
    .mockResolvedValueOnce({
      rows: onHand === null ? [] : [{ on_hand: onHand, reserved, version: 4 }],
    }),
});
beforeEach(() => mocks.write.mockReset());
test("saving target stock uses actual balance delta/version in the publication transaction", async () => {
  const db = client(10, 3);
  mocks.write.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    action: "ADJUST_INVENTORY",
    resultId: id,
    giftVariantId: id,
    inventoryItemId: id,
    inventoryLocationId: id,
    balanceVersion: 5,
    replayed: false,
  });
  await publishDailyGiftInventory(db, claim(7), id, at);
  expect(mocks.write.mock.calls[0]?.[0]).toBe(db);
  expect(mocks.write.mock.calls[0]?.[1].command).toMatchObject({
    deltaOnHand: -3,
    expectedBalanceVersion: 4,
    expectedVariantVersion: 2,
  });
});
test("zero or unchanged stock creates no fictional receipt", async () => {
  await publishDailyGiftInventory(client(null), claim(0), id, at);
  await publishDailyGiftInventory(client(7), claim(7), id, at);
  expect(mocks.write).not.toHaveBeenCalled();
});
test("saving stock below reserved units fails without modifying stock", async () => {
  await expect(
    publishDailyGiftInventory(client(10, 5), claim(3), id, at),
  ).rejects.toThrow();
  expect(mocks.write).not.toHaveBeenCalled();
});
test("a content-only gift edit does not restore stock sold since the form opened", async () => {
  const input = claim(10);
  if (input.intent.kind !== "SAVE_GIFT") throw new Error("fixture");
  input.intent = {
    ...input.intent,
    commerceEdit: {
      price: { mode: "PRESERVE" },
      inventory: { mode: "PRESERVE" },
    },
  };
  const db = client(9);
  await publishDailyGiftInventory(db, input, id, at);
  expect(mocks.write).not.toHaveBeenCalled();
  expect(db.query).not.toHaveBeenCalled();
});

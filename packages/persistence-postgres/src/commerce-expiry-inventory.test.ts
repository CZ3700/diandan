import { expect, test, vi } from "vitest";
import {
  inventoryBalanceSchema,
  inventoryReservationSchema,
  persistencePortCommandSchema,
} from "@fan-support/contracts";
import type { InventoryRepository } from "@fan-support/persistence-port";
import { repositorySuccess } from "./repository-response.js";
import { expireInventory } from "./commerce-expiry-inventory.js";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-16T00:00:00.123456Z";
const command = {
  schemaVersion: 1 as const,
  cartId: id(10),
  requestId: id(11),
  correlationId: id(12),
  taskName: "expiry-test",
};
function fixture() {
  const reservations = [1, 2].map((n) =>
    inventoryReservationSchema.parse({
      schemaVersion: 1,
      id: id(n),
      checkoutQuoteId: id(20),
      cartItemId: id(30 + n),
      giftVariantId: id(40),
      inventoryLocationId: id(50),
      quantity: n,
      status: "ACTIVE",
      expiresAt: "2026-09-15T23:00:00.123456Z",
      version: 1,
    }),
  );
  let balance = inventoryBalanceSchema.parse({
    schemaVersion: 1 as const,
    inventoryItemId: id(60),
    inventoryLocationId: id(50),
    onHand: 10,
    reserved: 3,
    version: 1,
  });
  const rows = reservations.map((r) => ({
    id: r.id,
    inventory_item_id: id(60),
    location_id: r.inventoryLocationId,
    cart_item_id: r.cartItemId,
    checkout_quote_id: r.checkoutQuoteId,
    gift_variant_id: r.giftVariantId,
    quantity: r.quantity,
    expires_at: r.expiresAt,
  }));
  const query = vi.fn(async () => ({ rows }));
  const load = vi.fn<InventoryRepository["loadManyForUpdate"]>(
    async (input) => {
      persistencePortCommandSchema.parse(input);
      return repositorySuccess("LOAD_INVENTORY_FOR_UPDATE", {
        items: input.targets.map((target) => ({
          inventoryItem: {
            schemaVersion: 1,
            id: target.inventoryItemId,
            giftVariantId: id(40),
            sku: "TEST",
            policy: "TRACKED",
            status: "ACTIVE",
          },
          inventoryLocation: {
            schemaVersion: 1,
            id: target.inventoryLocationId,
            code: "TEST",
            status: "ACTIVE",
          },
          balance: { ...balance },
          reservation: reservations.find((r) => r.id === target.reservationId),
        })),
      });
    },
  );
  const apply = vi.fn<InventoryRepository["applyReservationTransition"]>(
    async (input) => {
      persistencePortCommandSchema.parse(input);
      expect(input.decision.previousBalance).toEqual(balance);
      balance = { ...input.decision.nextBalance };
      return repositorySuccess("APPLY_INVENTORY_RESERVATION_TRANSITION", {
        reservation: input.decision.nextReservation,
        balance,
        ledgerEntry: input.ledgerEntry,
      });
    },
  );
  return {
    rows,
    query,
    load,
    apply,
    inventory: {
      loadManyForUpdate: load,
      applyReservationTransition: apply,
    } as unknown as InventoryRepository,
    balance: () => balance,
    client: { query, release: vi.fn() },
  };
}
test("expiry releases two artists' reservations once without decrementing on-hand", async () => {
  const f = fixture();
  await expect(
    expireInventory(f.client, f.inventory, id(70), at, command),
  ).resolves.toBe(2);
  expect(f.balance()).toMatchObject({ onHand: 10, reserved: 0, version: 3 });
  expect(
    f.apply.mock.calls.map(([input]) => input.ledgerEntry.deltaOnHand),
  ).toEqual([0, 0]);
  expect(
    f.apply.mock.calls.map(([input]) => input.ledgerEntry.idempotencyKey),
  ).toEqual([`commerce.expiry:${id(1)}`, `commerce.expiry:${id(2)}`]);
  expect(f.load.mock.invocationCallOrder.at(-1)).toBeLessThan(
    f.apply.mock.invocationCallOrder[0]!,
  );
});
test("locked reservation identity drift rolls back before any ledger write", async () => {
  const f = fixture();
  f.rows[0]!.expires_at = "2026-09-15T23:00:00.123457Z";
  await expect(
    expireInventory(f.client, f.inventory, id(70), at, command),
  ).rejects.toMatchObject({ code: "INTEGRITY_VIOLATION" });
  expect(f.apply).not.toHaveBeenCalled();
});
test("inventory is never expired using a caller's future-only wall clock", async () => {
  const f = fixture();
  await expect(
    expireInventory(
      f.client,
      f.inventory,
      id(70),
      "2026-09-15T00:00:00Z",
      command,
    ),
  ).rejects.toMatchObject({ code: "INTEGRITY_VIOLATION" });
  expect(f.apply).not.toHaveBeenCalled();
});

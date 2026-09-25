import { expect, test, vi } from "vitest";
import {
  inventoryReservationSchema,
  persistencePortCommandSchema,
  type InventoryReservation,
  type LoadInventoryForUpdateCommand,
} from "@fan-support/contracts";
import type { InventoryRepository } from "@fan-support/persistence-port";
import { repositoryFailure, repositorySuccess } from "./repository-response.js";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const time = "2026-09-10T00:00:00.000Z";
const reservation = (
  n: number,
  quantity = 2,
  status: InventoryReservation["status"] = "ACTIVE",
) =>
  inventoryReservationSchema.parse({
    schemaVersion: 1,
    id: uuid(n),
    checkoutQuoteId: uuid(1000),
    cartItemId: uuid(1000 + n),
    giftVariantId: uuid(2000),
    inventoryLocationId: uuid(3000),
    quantity,
    status,
    expiresAt: "2026-09-09T00:00:00.000Z",
    version: 1,
  });
type Target = LoadInventoryForUpdateCommand["targets"][number] & {
  reservationId: InventoryReservation["id"];
};
function fixture(reservations: InventoryReservation[], targets?: Target[]) {
  const selected =
    targets ??
    (reservations.map((value) => ({
      inventoryItemId: uuid(4000),
      inventoryLocationId: value.inventoryLocationId,
      reservationId: value.id,
    })) as Target[]);
  const balances = new Map(
    selected.map((target) => [
      target.inventoryItemId,
      {
        schemaVersion: 1,
        inventoryItemId: target.inventoryItemId,
        inventoryLocationId: target.inventoryLocationId,
        onHand: 1000,
        reserved: reservations
          .filter((entry) => entry.status === "ACTIVE")
          .reduce((sum, entry) => sum + entry.quantity, 0),
        version: 1,
      },
    ]),
  );
  const stored = new Map(reservations.map((entry) => [entry.id, { ...entry }]));
  const load = vi.fn<InventoryRepository["loadManyForUpdate"]>(
    async (command) => {
      persistencePortCommandSchema.parse(command);
      return repositorySuccess("LOAD_INVENTORY_FOR_UPDATE", {
        items: command.targets.map((target) => ({
          inventoryItem: {
            schemaVersion: 1,
            id: target.inventoryItemId,
            giftVariantId: uuid(2000),
            sku: "TEST-ITEM",
            policy: "TRACKED",
            status: "ACTIVE",
          },
          inventoryLocation: {
            schemaVersion: 1,
            id: target.inventoryLocationId,
            code: "TEST",
            status: "ACTIVE",
          },
          balance: { ...balances.get(target.inventoryItemId)! },
          reservation: target.reservationId
            ? { ...stored.get(target.reservationId)! }
            : null,
        })),
      });
    },
  );
  const transition = vi.fn<InventoryRepository["applyReservationTransition"]>(
    async (command) => {
      persistencePortCommandSchema.parse(command);
      const { decision, ledgerEntry } = command;
      expect(decision.previousBalance).toEqual(
        balances.get(decision.inventoryItemId),
      );
      expect(decision.previousReservation).toEqual(
        stored.get(decision.reservationId),
      );
      balances.set(decision.inventoryItemId, { ...decision.nextBalance });
      stored.set(decision.reservationId, { ...decision.nextReservation });
      return repositorySuccess("APPLY_INVENTORY_RESERVATION_TRANSITION", {
        balance: decision.nextBalance,
        reservation: decision.nextReservation,
        ledgerEntry,
      });
    },
  );
  const creation = vi.fn<InventoryRepository["applyReservationCreation"]>();
  return {
    repository: {
      loadManyForUpdate: load,
      applyReservationCreation: creation,
      applyReservationTransition: transition,
    },
    reservations,
    targets: selected,
    load,
    transition,
    creation,
    stored,
    balances,
  };
}
async function apply(
  f: ReturnType<typeof fixture>,
  targetStatus: "COMMITTED" | "RELEASED" = "COMMITTED",
  evaluatedAt = time,
) {
  const module = await import("./order-payment-inventory.js").catch(() => null);
  expect(module?.applyOrderPaymentInventory).toBeTypeOf("function");
  return module!.applyOrderPaymentInventory({
    repository: f.repository,
    targets: f.targets,
    reservations: f.reservations,
    targetStatus,
    evaluatedAt,
    requestId: uuid(5000),
    correlationId: uuid(5001),
  });
}
test("two artists sharing inventory advance the balance sequentially without double spending", async () => {
  const f = fixture([reservation(2, 3), reservation(1, 2)]);
  expect(await apply(f)).toEqual({ unavailable: false, transitioned: 2 });
  expect(
    f.transition.mock.calls.map(
      ([command]) => command.decision.expectedBalanceVersion,
    ),
  ).toEqual([1, 2]);
  expect([...f.balances.values()][0]).toMatchObject({
    onHand: 995,
    reserved: 0,
    version: 3,
  });
  expect(f.creation).not.toHaveBeenCalled();
  const ledgers = f.transition.mock.calls.map(
    ([command]) => command.ledgerEntry,
  );
  expect(new Set(ledgers.map((entry) => entry.id)).size).toBe(2);
  expect(
    ledgers.every(
      (entry) =>
        entry.reasonCode === "RESERVATION_COMMITTED" &&
        entry.occurredAt === time,
    ),
  ).toBe(true);
});
test("release returns reserved stock without reducing on-hand quantities", async () => {
  const f = fixture([reservation(1), reservation(2)]);
  expect(await apply(f, "RELEASED")).toEqual({
    unavailable: false,
    transitioned: 2,
  });
  expect([...f.balances.values()][0]).toMatchObject({
    onHand: 1000,
    reserved: 0,
    version: 3,
  });
});
test("actual terminal reservations cannot be recreated; active past-expiry reservations still use the domain rule", async () => {
  const f = fixture([
    reservation(1),
    reservation(2, 2, "RELEASED"),
    reservation(3, 2, "EXPIRED"),
    reservation(4, 2, "COMMITTED"),
  ]);
  expect(await apply(f)).toEqual({ unavailable: true, transitioned: 1 });
  expect(f.transition.mock.calls[0]?.[0].decision.nextReservation.id).toBe(
    uuid(1),
  );
  expect(f.creation).not.toHaveBeenCalled();
});
test("terminal rows are no-ops on release and commits replay without another ledger", async () => {
  const f = fixture([reservation(1)]);
  await apply(f);
  expect(await apply(f)).toEqual({ unavailable: false, transitioned: 0 });
  expect(await apply(f, "RELEASED")).toEqual({
    unavailable: false,
    transitioned: 0,
  });
  expect(f.transition).toHaveBeenCalledTimes(1);
});
test("reads the locked reservation status instead of an earlier caller snapshot", async () => {
  const f = fixture([reservation(1)]);
  f.stored.set(f.reservations[0]!.id, {
    ...f.reservations[0]!,
    status: "EXPIRED",
    version: 2,
  });
  expect(await apply(f)).toEqual({ unavailable: true, transitioned: 0 });
  expect(f.transition).not.toHaveBeenCalled();
});
test("nontracked empty input performs no inventory operation", async () => {
  const f = fixture([]);
  expect(await apply(f)).toEqual({ unavailable: false, transitioned: 0 });
  expect(f.load).not.toHaveBeenCalled();
});
test("locks all targets in stable bounded batches before any write", async () => {
  const reservations = Array.from({ length: 101 }, (_, i) =>
    reservation(i + 1),
  );
  const targets = reservations.map((entry, i) => ({
    inventoryItemId: uuid(4101 - i),
    inventoryLocationId: entry.inventoryLocationId,
    reservationId: entry.id,
  })) as Target[];
  const f = fixture(reservations, targets);
  await apply(f);
  const loads = f.load.mock.calls.map(([command]) => command.targets);
  expect(loads.every((batch) => batch.length <= 100)).toBe(true);
  expect(loads.flat().map((entry) => entry.inventoryItemId)).toEqual(
    [...targets]
      .sort((a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId))
      .map((entry) => entry.inventoryItemId),
  );
  expect(Math.max(...f.load.mock.invocationCallOrder)).toBeLessThan(
    Math.min(...f.transition.mock.invocationCallOrder),
  );
});
test("duplicate or missing target bindings reject before repository calls", async () => {
  for (const mutation of ["duplicate", "missing", "wrong-location"] as const) {
    const f = fixture([reservation(1)]);
    if (mutation === "duplicate") f.targets.push(f.targets[0]!);
    if (mutation === "missing") f.targets.length = 0;
    if (mutation === "wrong-location")
      f.targets[0] = {
        ...f.targets[0]!,
        inventoryLocationId: uuid(3001),
      } as Target;
    await expect(apply(f)).rejects.toThrow();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.transition).not.toHaveBeenCalled();
  }
});
test("another cart or quote reservation cannot be used for this order", async () => {
  for (const field of [
    "cartItemId",
    "checkoutQuoteId",
    "giftVariantId",
  ] as const) {
    const f = fixture([reservation(1)]);
    f.stored.set(f.reservations[0]!.id, {
      ...f.reservations[0]!,
      [field]: uuid(9000),
    });
    await expect(apply(f)).rejects.toThrow();
    expect(f.transition).not.toHaveBeenCalled();
  }
});
test("a failed inventory write throws without swallowing or retrying it", async () => {
  const f = fixture([reservation(1), reservation(2)]);
  f.transition.mockRejectedValueOnce(new Error("TEST private storage detail"));
  await expect(apply(f)).rejects.toThrow();
  expect(f.transition).toHaveBeenCalledTimes(1);
});

test("rejects a mismatched write receipt instead of counting a transition", async () => {
  const f = fixture([reservation(1)]);
  f.transition.mockImplementationOnce(async ({ decision, ledgerEntry }) =>
    repositorySuccess("APPLY_INVENTORY_RESERVATION_TRANSITION", {
      balance: decision.nextBalance,
      reservation: { ...decision.nextReservation, cartItemId: uuid(9000) },
      ledgerEntry,
    }),
  );
  await expect(apply(f)).rejects.toThrow("Order payment inventory");
  expect(f.transition).toHaveBeenCalledTimes(1);
});

test("typed persistence failure prevents success without retries", async () => {
  const f = fixture([reservation(1)]);
  f.transition.mockResolvedValueOnce(
    repositoryFailure(
      "APPLY_INVENTORY_RESERVATION_TRANSITION",
      "TRANSACTION_OUTCOME_UNKNOWN",
    ),
  );
  await expect(apply(f)).rejects.toThrow("Order payment inventory");
  expect(f.transition).toHaveBeenCalledTimes(1);
});

test("missing or duplicated locked rows fail before any inventory write", async () => {
  for (const mode of ["missing", "duplicated"] as const) {
    const entries = [reservation(1), reservation(2)];
    const targets = entries.map((entry, index) => ({
      inventoryItemId: uuid(4000 + index),
      inventoryLocationId: entry.inventoryLocationId,
      reservationId: entry.id,
    })) as Target[];
    const f = fixture(entries, targets);
    const original = f.load.getMockImplementation()!;
    f.load.mockImplementationOnce(async (command) => {
      const response = await original(command);
      if (response.outcome !== "SUCCESS")
        throw new Error("TEST fixture requires success");
      const first = response.value.items[0]!;
      return repositorySuccess("LOAD_INVENTORY_FOR_UPDATE", {
        items: mode === "missing" ? [first] : [first, first],
      });
    });
    await expect(apply(f)).rejects.toThrow("Order payment inventory");
    expect(f.transition).not.toHaveBeenCalled();
  }
});

const preciseTime = "2026-09-10T00:00:00.123456Z";
const adjacentInstants = [
  "2026-09-10T00:00:00.123455Z",
  "2026-09-10T00:00:00.123457Z",
];
test.each(adjacentInstants)(
  "a locked reservation expiry differing by one microsecond is not the requested reservation (%s)",
  async (expiresAt) => {
    const expected = inventoryReservationSchema.parse({
      ...reservation(1),
      expiresAt: preciseTime,
    });
    const f = fixture([expected]);
    f.stored.set(expected.id, { ...expected, expiresAt });
    await expect(apply(f)).rejects.toThrow("Order payment inventory");
    expect(f.transition).not.toHaveBeenCalled();
  },
);
test.each(adjacentInstants)(
  "a write receipt cannot change reservation expiry by one microsecond (%s)",
  async (expiresAt) => {
    const f = fixture([
      inventoryReservationSchema.parse({
        ...reservation(1),
        expiresAt: preciseTime,
      }),
    ]);
    f.transition.mockImplementationOnce(async ({ decision, ledgerEntry }) =>
      repositorySuccess("APPLY_INVENTORY_RESERVATION_TRANSITION", {
        balance: decision.nextBalance,
        reservation: { ...decision.nextReservation, expiresAt },
        ledgerEntry,
      }),
    );
    await expect(apply(f)).rejects.toThrow("Order payment inventory");
  },
);
test.each(adjacentInstants)(
  "a write receipt cannot change ledger occurrence by one microsecond (%s)",
  async (occurredAt) => {
    const f = fixture([reservation(1)]);
    f.transition.mockImplementationOnce(async ({ decision, ledgerEntry }) =>
      repositorySuccess("APPLY_INVENTORY_RESERVATION_TRANSITION", {
        balance: decision.nextBalance,
        reservation: decision.nextReservation,
        ledgerEntry: { ...ledgerEntry, occurredAt },
      }),
    );
    await expect(apply(f, "COMMITTED", preciseTime)).rejects.toThrow(
      "Order payment inventory",
    );
  },
);
test("equivalent offset and fractional representations retain exact microsecond identity", async () => {
  const expected = inventoryReservationSchema.parse({
    ...reservation(1),
    expiresAt: preciseTime,
  });
  const f = fixture([expected]);
  f.stored.set(expected.id, {
    ...expected,
    expiresAt: "2026-09-10T08:00:00.1234560+08:00",
  });
  f.transition.mockImplementationOnce(async ({ decision, ledgerEntry }) =>
    repositorySuccess("APPLY_INVENTORY_RESERVATION_TRANSITION", {
      balance: decision.nextBalance,
      reservation: { ...decision.nextReservation, expiresAt: preciseTime },
      ledgerEntry: {
        ...ledgerEntry,
        occurredAt: "2026-09-10T08:00:00.123456+08:00",
      },
    }),
  );
  expect(await apply(f, "COMMITTED", preciseTime)).toEqual({
    unavailable: false,
    transitioned: 1,
  });
});

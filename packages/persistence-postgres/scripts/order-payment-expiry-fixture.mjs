import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { Client } from "pg";
import {
  inventoryLedgerEntrySchema,
  persistencePortCommandSchema,
  persistencePortResponseSchema,
} from "@fan-support/contracts";
import { planInventoryReservationTransition } from "@fan-support/domain";
import { createPostgresPersistence } from "../dist/index.js";
/** TEST helper: real wall-clock expiry, original domain transition and repository. No SQL status or ledger mutation. */
export async function expireOrderPaymentReservations({
  clientConfig,
  orderId,
  timeoutMs = 20000,
}) {
  const client = new Client(clientConfig);
  await client.connect();
  const persistence = createPostgresPersistence(clientConfig);
  try {
    const state = (
      await client.query(
        `SELECT a.status FROM public.orders o JOIN public.payment_attempts a ON a.id=o.current_payment_attempt_id WHERE o.id=$1::uuid`,
        [orderId],
      )
    ).rows;
    assert.equal(state.length, 1);
    assert.equal(
      state[0].status,
      "UNKNOWN",
      "only a genuinely uncertain checkout exercises late expiration",
    );
    const targets = (
      await client.query(
        `SELECT ii.id "inventoryItemId",r.location_id "inventoryLocationId",r.id "reservationId" FROM public.inventory_reservations r JOIN public.inventory_items ii ON ii.gift_variant_id=r.gift_variant_id WHERE r.locked_order_id=$1::uuid AND r.status='ACTIVE' ORDER BY ii.id,r.location_id,r.id`,
        [orderId],
      )
    ).rows;
    assert.ok(
      targets.length > 0,
      "normal checkout must have real ACTIVE reservations",
    );
    const start = performance.now();
    while (true) {
      const { ready } = (
        await client.query(
          `SELECT bool_and(expires_at<=clock_timestamp()) ready FROM public.inventory_reservations WHERE locked_order_id=$1::uuid AND status='ACTIVE'`,
          [orderId],
        )
      ).rows[0];
      if (ready === true) break;
      assert.ok(
        performance.now() - start < timeoutMs,
        "actual reservation expiry deadline",
      );
      await setTimeout(50);
    }
    const before = (
      await client.query(
        `SELECT count(*)::integer count FROM public.inventory_ledger WHERE source_type='EXPIRY' AND source_id IN(SELECT id FROM public.inventory_reservations WHERE locked_order_id=$1::uuid)`,
        [orderId],
      )
    ).rows[0].count;
    const runTransition = (delta) =>
      persistence.transactionManager.runInTransaction(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        async ({ inventory }) => {
          let transitioned = 0;
          for (const target of targets) {
            const response = persistencePortResponseSchema.parse(
              await inventory.loadManyForUpdate(
                persistencePortCommandSchema.parse({
                  schemaVersion: 1,
                  operation: "LOAD_INVENTORY_FOR_UPDATE",
                  targets: [target],
                }),
              ),
            );
            assert.equal(response.outcome, "SUCCESS");
            assert.equal(response.operation, "LOAD_INVENTORY_FOR_UPDATE");
            assert.equal(response.value.items.length, 1);
            const snapshot = response.value.items[0];
            assert.equal(snapshot.reservation?.status, "ACTIVE");
            const at = (
              await client.query(
                `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`,
              )
            ).rows[0].at;
            const decision = planInventoryReservationTransition({
              schemaVersion: 1,
              inventoryItem: snapshot.inventoryItem,
              balance: snapshot.balance,
              reservation: snapshot.reservation,
              targetStatus: "EXPIRED",
              evaluatedAt: at,
            });
            assert.equal(decision.kind, "APPLY");
            const ledgerEntry = inventoryLedgerEntrySchema.parse({
              schemaVersion: 1,
              id: randomUUID(),
              inventoryItemId: decision.inventoryItemId,
              inventoryLocationId: decision.inventoryLocationId,
              ...decision.ledgerDelta,
              reasonCode: decision.reasonCode,
              idempotencyKey: `order.payment.expiry:${target.reservationId}`,
              actor: {
                kind: "SYSTEM",
                taskName: "order-payment-expiry-fixture",
              },
              occurredAt: at,
            });
            const previousExpiry = decision.previousReservation.expiresAt;
            const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/u.exec(
              previousExpiry,
            );
            assert.ok(
              match,
              "real PostgreSQL inventory load retains an exact UTC timestamp",
            );
            const micros =
              BigInt(Date.parse(match[1] + "Z")) * 1000n +
              BigInt((match[2] ?? "").padEnd(6, "0"));
            if (delta !== undefined) {
              const changed = micros + delta;
              const wrong =
                new Date(Number(changed / 1000000n) * 1000)
                  .toISOString()
                  .slice(0, 19) +
                "." +
                String(changed % 1000000n).padStart(6, "0") +
                "Z";
              const rejected = persistencePortResponseSchema.parse(
                await inventory.applyReservationTransition({
                  schemaVersion: 1,
                  operation: "APPLY_INVENTORY_RESERVATION_TRANSITION",
                  decision: {
                    ...decision,
                    previousReservation: {
                      ...decision.previousReservation,
                      expiresAt: wrong,
                    },
                    nextReservation: {
                      ...decision.nextReservation,
                      expiresAt: wrong,
                    },
                  },
                  ledgerEntry,
                }),
              );
              assert.equal(rejected.outcome, "FAILURE");
              assert.equal(
                rejected.error.code,
                "VERSION_CONFLICT",
                "one microsecond identity drift must not create a ledger",
              );
              return { schemaVersion: 1, transitioned: 0 };
            }
            const offset =
              new Date(Date.parse(match[1] + "Z") + 8 * 3600000)
                .toISOString()
                .slice(0, 19) +
              "." +
              (match[2] ?? "").padEnd(6, "0") +
              "+08:00";
            const equivalentDecision = {
              ...decision,
              previousReservation: {
                ...decision.previousReservation,
                expiresAt: offset,
              },
              nextReservation: {
                ...decision.nextReservation,
                expiresAt: offset,
              },
            };
            const applied = persistencePortResponseSchema.parse(
              await inventory.applyReservationTransition({
                schemaVersion: 1,
                operation: "APPLY_INVENTORY_RESERVATION_TRANSITION",
                decision: equivalentDecision,
                ledgerEntry,
              }),
            );
            assert.equal(applied.outcome, "SUCCESS");
            assert.equal(
              applied.operation,
              "APPLY_INVENTORY_RESERVATION_TRANSITION",
            );
            assert.equal(applied.value.reservation.status, "EXPIRED");
            assert.equal(applied.value.balance.onHand, snapshot.balance.onHand);
            assert.equal(
              applied.value.balance.reserved,
              snapshot.balance.reserved - snapshot.reservation.quantity,
            );
            transitioned++;
          }
          return { schemaVersion: 1, transitioned };
        },
      );
    // A failed repository command intentionally makes its whole transaction rollback-only.
    // Each negative probe must therefore finish its real rollback before the valid expiry starts.
    for (const delta of [-1n, 1n]) {
      await assert.rejects(runTransition(delta), { code: "VERSION_CONFLICT" });
      const unchanged = (
        await client.query(
          `SELECT count(*)::integer count FROM public.inventory_ledger WHERE source_type='EXPIRY' AND source_id IN(SELECT id FROM public.inventory_reservations WHERE locked_order_id=$1::uuid)`,
          [orderId],
        )
      ).rows[0].count;
      assert.equal(
        unchanged,
        before,
        "rejected precision drift leaves no expiry ledger",
      );
    }
    const result = await runTransition();
    const after = (
      await client.query(
        `SELECT count(*)::integer count FROM public.inventory_ledger WHERE source_type='EXPIRY' AND source_id IN(SELECT id FROM public.inventory_reservations WHERE locked_order_id=$1::uuid)`,
        [orderId],
      )
    ).rows[0].count;
    assert.equal(after - before, targets.length);
    return {
      schemaVersion: 1,
      status: "PASS",
      ...result,
      scope:
        "Real elapsed expiry and domain/repository transition; inventory on-hand preserved, exactly one expiry ledger per reservation",
    };
  } finally {
    await persistence.close();
    await client.end();
  }
}

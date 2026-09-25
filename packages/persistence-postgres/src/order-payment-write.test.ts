import { expect, test, vi } from "vitest";
import { orderPaymentApplyCommandSchema } from "@fan-support/contracts";
import type {
  InventoryRepository,
  OutboxRepository,
} from "@fan-support/persistence-port";
import { applyOrderPaymentInventory } from "./order-payment-inventory.js";
import { applyOrderPaymentAggregate } from "./order-payment-write.js";
vi.mock("./order-payment-inventory.js", () => ({
  applyOrderPaymentInventory: vi.fn(),
}));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("a verified failure becomes terminal in the same transaction before requesting reservation release", async () => {
  const sequence: string[] = [];
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("UPDATE public.payment_attempts"))
      sequence.push("TERMINAL");
    if (sql.includes("SELECT i.id,i.cart_item_id"))
      return {
        rows: [
          {
            id: id(10),
            cart_item_id: id(11),
            gift_variant_id: id(12),
            quantity: 1,
            support_intent_id: id(13),
            inventory_policy: "TRACKED",
            intent_status: "CHECKOUT_LOCKED",
          },
        ],
      };
    if (sql.includes("SELECT DISTINCT ON"))
      return {
        rows: [
          {
            id: id(14),
            inventory_item_id: id(15),
            location_id: id(16),
            cart_item_id: id(11),
            gift_variant_id: id(12),
            quantity: 1,
            checkout_quote_id: id(17),
            checkout_session_id: id(18),
            status: "ACTIVE",
            expires_at: "2026-09-10T00:01:00.000123Z",
            version: 1,
          },
        ],
      };
    if (sql.includes("SELECT * FROM public.fulfillments"))
      return {
        rows: [
          { id: id(19), order_item_id: id(10), status: "PENDING", version: 1 },
        ],
      };
    if (sql.includes("event_time FROM"))
      return { rows: [{ event_time: "2026-09-10T00:00:00.000001Z" }] };
    return { rows: [] };
  });
  vi.mocked(applyOrderPaymentInventory).mockImplementation(async () => {
    sequence.push("RELEASE");
    return { unavailable: false, transitioned: 1 };
  });
  const outbox = {
    append: vi.fn(async (command) => ({
      outcome: "SUCCESS",
      operation: "APPEND_OUTBOX_EVENT",
      value: { eventId: command.event.eventId },
    })),
  } as unknown as OutboxRepository;
  const result = await applyOrderPaymentAggregate({
    client: { query, release: vi.fn() },
    inventory: {} as InventoryRepository,
    outbox,
    command: orderPaymentApplyCommandSchema.parse({
      schemaVersion: 1,
      providerEventId: id(1),
      requestId: id(2),
      correlationId: id(3),
      taskName: "order-payment-apply",
    }),
    event: {
      id: id(1),
      event_type: "PAYMENT_STATUS",
      normalized_status: "FAILED",
      evidence_kind: "VERIFIED_WEBHOOK",
      reconcile_audit_log_id: null,
    },
    attempt: { id: id(4), status: "PROCESSING", version: 2 },
    order: {
      id: id(5),
      cart_id: id(6),
      order_status: "PENDING_PAYMENT",
      payment_status: "PENDING",
      cart_status: "LOCKED",
      checkout_quote_id: id(17),
      checkout_session_id: id(18),
      market: "TEST",
      currency: "USD",
    },
  });
  expect(result).toMatchObject({
    decision: "APPLIED",
    outcome: "FAILED_RELEASED",
  });
  expect(sequence).toEqual(["TERMINAL", "RELEASE"]);
});

test("trusted matched success binds the missing external reference after a lost create response", async () => {
  const query = vi.fn<
    (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
  >(async (sql) => {
    if (sql.includes("SELECT i.id,i.cart_item_id"))
      return {
        rows: [
          {
            id: id(10),
            cart_item_id: id(11),
            gift_variant_id: id(12),
            quantity: 1,
            support_intent_id: id(13),
            inventory_policy: "PROCURE_ON_DEMAND",
            intent_status: "CHECKOUT_LOCKED",
          },
        ],
      };
    if (sql.includes("SELECT * FROM public.fulfillments"))
      return {
        rows: [
          { id: id(19), order_item_id: id(10), status: "PENDING", version: 1 },
        ],
      };
    if (sql.includes("event_time FROM"))
      return { rows: [{ event_time: "2026-09-10T00:00:00.000001Z" }] };
    if (sql.includes("SELECT version FROM public.carts"))
      return { rows: [{ version: 3 }] };
    if (sql.includes("transaction_timestamp()>a.updated_at"))
      return { rows: [{ at: "2026-09-10T00:00:00.000001Z", valid: true }] };
    return { rows: [] };
  });
  vi.mocked(applyOrderPaymentInventory).mockResolvedValue({
    unavailable: false,
    transitioned: 0,
  });
  const outbox = {
    append: vi.fn(async (command) => ({
      outcome: "SUCCESS",
      operation: "APPEND_OUTBOX_EVENT",
      value: { eventId: command.event.eventId },
    })),
  } as unknown as OutboxRepository;
  const result = await applyOrderPaymentAggregate({
    client: { query, release: vi.fn() },
    inventory: {} as InventoryRepository,
    outbox,
    command: orderPaymentApplyCommandSchema.parse({
      schemaVersion: 1,
      providerEventId: id(1),
      requestId: id(2),
      correlationId: id(3),
      taskName: "order-payment-apply",
    }),
    event: {
      id: id(1),
      provider_event_id: "capture-evidence",
      provider_account_id: id(20),
      environment: "TEST",
      event_type: "PAYMENT_STATUS",
      normalized_status: "SUCCEEDED",
      evidence_kind: "AUTHENTICATED_RECONCILE",
      reconcile_audit_log_id: id(21),
      external_payment_reference: "payment-after-lost-response",
      amount_minor: 100,
      currency: "USD",
      occurred_at: "2026-09-09T23:59:59.000123Z",
      provider_transaction_type: "CAPTURE",
      provider_transaction_reference: "capture-after-lost-response",
    },
    attempt: {
      id: id(4),
      status: "UNKNOWN",
      version: 2,
      provider_account_id: id(20),
      environment: "TEST",
      external_reference: null,
      amount_minor: 100,
      currency: "USD",
      provider_call_started: true,
    },
    order: {
      id: id(5),
      version: 3,
      cart_id: id(6),
      order_status: "PENDING_PAYMENT",
      payment_status: "PENDING",
      dispute_status: "NONE",
      fulfillment_status: "PENDING",
      current_payment_attempt_id: id(4),
      cart_status: "LOCKED",
      checkout_quote_id: id(17),
      checkout_session_id: id(18),
      market: "TEST",
      currency: "USD",
    },
  });
  expect(result).toMatchObject({ decision: "APPLIED", outcome: "PAID" });
  const mutation = query.mock.calls.find(([sql]) =>
    sql.startsWith("UPDATE public.payment_attempts"),
  );
  expect(mutation?.[0]).toContain(
    "external_reference=coalesce(external_reference",
  );
  expect(mutation?.[1]).toContain("payment-after-lost-response");
});

import { expect, expectTypeOf, test } from "vitest";

import type {
  ReliableEventTransactionRepositories,
  TransactionRepositories,
} from "./index.js";

import * as persistencePort from "./index.js";

test("exports atomic persistence command and response schemas", () => {
  const exports = persistencePort as Record<string, unknown>;
  expect(exports["persistencePortCommandSchema"]).toBeDefined();
  expect(exports["persistencePortResponseSchema"]).toBeDefined();
  expect(exports["persistenceTransactionFailureSchema"]).toBeDefined();
  expect(exports["PersistenceTransactionFailureError"]).toBeTypeOf("function");
  expect(exports["parsePersistenceTransactionFailure"]).toBeTypeOf("function");
});

test("exports a companion reliable-event persistence boundary", () => {
  const exports = persistencePort as Record<string, unknown>;
  expect(exports["reliableEventPersistenceCommandSchema"]).toBeDefined();
  expect(exports["reliableEventPersistenceResponseSchema"]).toBeDefined();
  expect(exports["paymentWebhookEndpointDescriptorSchema"]).toBeDefined();
});

test("keeps the legacy transaction repository keys unchanged", () => {
  expectTypeOf<keyof TransactionRepositories>().toEqualTypeOf<
    "idempotency" | "outbox" | "inventory"
  >();
  expect(persistencePort.persistencePortOperationSchema.options).toEqual([
    "BEGIN_IDEMPOTENCY",
    "COMPLETE_IDEMPOTENCY",
    "APPEND_OUTBOX_EVENT",
    "LOAD_INVENTORY_FOR_UPDATE",
    "APPLY_INVENTORY_RESERVATION_CREATION",
    "APPLY_INVENTORY_RESERVATION_TRANSITION",
  ]);
});

test("groups reliable-event repositories without widening the legacy manager", () => {
  expectTypeOf<keyof ReliableEventTransactionRepositories>().toEqualTypeOf<
    | "paymentWebhookEndpoints"
    | "verifiedWebhookReceipts"
    | "webhookProcessing"
    | "outbox"
    | "outboxDispatch"
    | "webhookPayloadRetention"
  >();
  expect(
    persistencePort.reliableEventPersistenceOperationSchema.options,
  ).toEqual([
    "LOAD_PAYMENT_WEBHOOK_ENDPOINT",
    "RECORD_VERIFIED_WEBHOOK_RECEIPT",
    "LOAD_WEBHOOK_PROCESSING_CONTEXT",
    "RECORD_WEBHOOK_PROCESSING_ATTEMPT",
    "RECORD_WEBHOOK_EFFECT",
    "LIST_READY_OUTBOX_EVENTS",
    "LOAD_OUTBOX_DISPATCH_CONTEXT",
    "RECORD_OUTBOX_DISPATCH_ATTEMPT",
    "RECORD_OUTBOX_EFFECT",
    "PURGE_EXPIRED_WEBHOOK_PAYLOADS",
  ]);
});

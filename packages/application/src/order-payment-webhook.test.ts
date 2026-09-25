import { expect, test } from "vitest";
import * as application from "./index.js";
import type { WebhookInboxHandler } from "./process-webhook-inbox.js";
import {
  loadWebhookProcessingContextResponseSchema,
  recordWebhookEffectCommandSchema,
} from "@fan-support/contracts";
const id = "00000000-0000-4000-8000-000000000001";
const context = loadWebhookProcessingContextResponseSchema.parse({
  schemaVersion: 1,
  operation: "LOAD_WEBHOOK_PROCESSING_CONTEXT",
  outcome: "SUCCESS",
  value: {
    decision: "READY",
    webhookInboxId: id,
    providerEventRowId: id,
    nextAttemptNumber: 1,
    event: {
      schemaVersion: 1,
      providerAccountId: id,
      environment: "TEST",
      providerEventId: "event-1",
      evidence: { kind: "VERIFIED_WEBHOOK", webhookInboxId: id },
      occurredAt: "2026-09-10T00:00:00Z",
      association: { status: "UNMATCHED", externalReference: "payment-1" },
      eventType: "PAYMENT_STATUS",
      status: "PROCESSING",
      amountMinor: 100,
      currency: "USD",
    },
  },
}).value as Parameters<WebhookInboxHandler["handle"]>[0];
function handler() {
  const factory = (
    application as unknown as {
      createOrderPaymentWebhookHandler?: () => WebhookInboxHandler;
    }
  ).createOrderPaymentWebhookHandler;
  expect(factory).toBeTypeOf("function");
  return factory!();
}
test("the effect identity passes the frozen inbox persistence contract", () => {
  expect(
    recordWebhookEffectCommandSchema.safeParse({
      schemaVersion: 1,
      operation: "RECORD_WEBHOOK_EFFECT",
      webhookEffectId: id,
      webhookInboxId: id,
      ...handler().effect(context),
    }).success,
  ).toBe(true);
});
test("webhook handler uses only a persisted reference on the same transaction repository", async () => {
  let captured: unknown;
  const h = handler();
  await h.handle(context, {
    orderPaymentApplication: {
      apply: async (command: unknown) => {
        captured = command;
        return {
          schemaVersion: 1,
          decision: "IGNORED",
          providerEventId: id,
          receiptId: id,
          attemptId: null,
          orderId: null,
          reasonCode: "NON_FINAL_STATUS",
        };
      },
    },
  } as never);
  expect(captured).toMatchObject({
    schemaVersion: 1,
    providerEventId: id,
    taskName: "order-payment-webhook",
  });
  expect(Object.keys(captured as object).sort()).toEqual(
    [
      "schemaVersion",
      "providerEventId",
      "taskName",
      "requestId",
      "correlationId",
    ].sort(),
  );
  expect(h.effect(context)).toEqual({
    effectKey: "ORDER_PAYMENT_APPLICATION",
    subjectId: id,
  });
});
test("unmatched webhook throws so inbox processing cannot record success", async () => {
  const h = handler();
  await expect(
    h.handle(context, {
      orderPaymentApplication: {
        apply: async () => ({
          schemaVersion: 1,
          decision: "UNMATCHED",
          providerEventId: id,
          reason: "EXTERNAL_REFERENCE_NOT_BOUND",
        }),
      },
    } as never),
  ).rejects.toMatchObject({ code: "EVIDENCE_UNMATCHED" });
});
test("missing transaction repository rejects rather than acknowledging payment", async () => {
  await expect(handler().handle(context, {} as never)).rejects.toMatchObject({
    code: "PERSISTENCE_FAILURE",
  });
});

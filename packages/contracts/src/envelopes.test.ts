import { expect, test } from "vitest";

type Schema = Readonly<{
  parse: (value: unknown) => unknown;
  safeParse: (value: unknown) => Readonly<{ success: boolean }>;
}>;

test("keeps the public error envelope on a strict safe allowlist", async () => {
  const envelopes = await import("./envelopes.js").catch(() => undefined);

  expect(envelopes, "envelope contract module must exist").toBeDefined();
  expect(envelopes?.publicErrorEnvelopeSchema).toBeDefined();
  const schema = envelopes?.publicErrorEnvelopeSchema as Schema;
  const safeError = {
    schemaVersion: 1,
    code: "VALIDATION_FAILED",
    requestId: "018f47a4-7b7c-4f27-8b35-25c984619a11",
    fieldIssues: [
      {
        field: "displayName",
        code: "TOO_LONG",
      },
    ],
  };

  expect(schema.safeParse(safeError).success).toBe(true);
  expect(JSON.parse(JSON.stringify(schema.parse(safeError)))).toEqual(
    safeError,
  );
  for (const unsafeField of [
    { stack: "PRIVATE_STACK" },
    { cause: "PRIVATE_CAUSE" },
    { message: "PRIVATE_MESSAGE" },
    { details: { token: "PRIVATE_TOKEN" } },
    { providerResponse: "PRIVATE_PROVIDER_RESPONSE" },
    { email: "fan@example.invalid" },
  ]) {
    expect(schema.safeParse({ ...safeError, ...unsafeField }).success).toBe(
      false,
    );
  }
  expect(
    schema.safeParse({
      ...safeError,
      requestId: "018F47A4-7B7C-4F27-8B35-25C984619A11",
    }).success,
  ).toBe(false);
  expect(schema.safeParse({ ...safeError, schemaVersion: 2 }).success).toBe(
    false,
  );
  for (const internalField of [
    "encryptedDataKey",
    "providerAccountId",
    "supportIntentId",
    "objectKey",
  ]) {
    expect(
      schema.safeParse({
        ...safeError,
        fieldIssues: [{ field: internalField, code: "INVALID" }],
      }).success,
    ).toBe(false);
  }
});

test("uses a strict event-type to payload union with ID-only outbox data", async () => {
  const envelopes = await import("./envelopes.js").catch(() => undefined);
  expect(envelopes?.eventEnvelopeSchema).toBeDefined();

  const schema = envelopes?.eventEnvelopeSchema as Schema;
  const event = {
    schemaVersion: 1,
    eventId: "16eb83a0-3b1e-480c-a2c0-46cfb809b855",
    eventType: "ORDER_PAYMENT_CONFIRMED",
    occurredAt: "2026-09-03T00:05:00Z",
    aggregateId: "4f847525-ed50-44db-b2cb-319977b397e0",
    correlationId: "a6a9869f-a9dd-4b7f-8b86-e6f5ad456bd8",
    requestId: "018f47a4-7b7c-4f27-8b35-25c984619a11",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    payload: {
      orderId: "4f847525-ed50-44db-b2cb-319977b397e0",
      paymentAttemptId: "0be91762-1464-45bc-b0c5-d87f03e81d7e",
    },
  };

  expect(schema.safeParse(event).success).toBe(true);
  expect(JSON.parse(JSON.stringify(schema.parse(event)))).toEqual(event);
  const cartEvent = {
    ...event,
    eventType: "CART_ITEM_ADDED",
    aggregateId: "e9ce3868-aa67-491a-a244-bb8ce2704fe9",
    payload: {
      cartId: "e9ce3868-aa67-491a-a244-bb8ce2704fe9",
      cartItemId: "c0d51f36-f139-4fd7-9205-fb6d9db1666e",
    },
  };
  expect(schema.safeParse(cartEvent).success).toBe(true);
  expect(
    schema.safeParse({
      ...cartEvent,
      aggregateId: "080d253d-c94e-41cb-b74d-2b546487f3e4",
    }).success,
  ).toBe(false);
  for (const unsafeEvent of [
    { ...event, eventType: "UNKNOWN_EVENT" },
    {
      ...event,
      eventType: "NOTIFICATION_REQUESTED",
    },
    { ...event, metadata: { fanMessage: "PRIVATE_MESSAGE" } },
    { ...event, payload: { ...event.payload, email: "fan@example.invalid" } },
    { ...event, occurredAt: new Date() },
    {
      ...event,
      aggregateId: "080d253d-c94e-41cb-b74d-2b546487f3e4",
    },
    { ...event, payload: { ...event.payload, amount: 1n } },
  ]) {
    expect(schema.safeParse(unsafeEvent).success).toBe(false);
  }
});

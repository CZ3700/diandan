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
  const envelopeBase = {
    schemaVersion: 1,
    eventId: "16eb83a0-3b1e-480c-a2c0-46cfb809b855",
    occurredAt: "2026-09-03T00:05:00Z",
    correlationId: "a6a9869f-a9dd-4b7f-8b86-e6f5ad456bd8",
    requestId: "018f47a4-7b7c-4f27-8b35-25c984619a11",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  } as const;
  const events = [
    {
      eventType: "CART_ITEM_ADDED",
      aggregateId: "e9ce3868-aa67-491a-a244-bb8ce2704fe9",
      payload: {
        cartId: "e9ce3868-aa67-491a-a244-bb8ce2704fe9",
        cartItemId: "c0d51f36-f139-4fd7-9205-fb6d9db1666e",
      },
    },
    {
      eventType: "ORDER_PAYMENT_CONFIRMED",
      aggregateId: "4f847525-ed50-44db-b2cb-319977b397e0",
      payload: {
        orderId: "4f847525-ed50-44db-b2cb-319977b397e0",
        paymentAttemptId: "0be91762-1464-45bc-b0c5-d87f03e81d7e",
      },
    },
    {
      eventType: "FULFILLMENT_STATUS_CHANGED",
      aggregateId: "92c20c76-f9db-40d8-ad9f-3c92d4f4c1e7",
      payload: {
        fulfillmentId: "92c20c76-f9db-40d8-ad9f-3c92d4f4c1e7",
        orderId: "4f847525-ed50-44db-b2cb-319977b397e0",
        status: "PREPARING",
      },
    },
    {
      eventType: "NOTIFICATION_REQUESTED",
      aggregateId: "6da8d409-8016-4e67-a4fa-9157494549df",
      payload: {
        notificationDeliveryId: "6da8d409-8016-4e67-a4fa-9157494549df",
        orderId: "4f847525-ed50-44db-b2cb-319977b397e0",
      },
    },
    {
      eventType: "CONTENT_PUBLICATION_CHANGED",
      aggregateId: "5e7d782d-a4c9-4c97-91a2-e2ae95c6ae1e",
      locale: "th",
      payload: {
        contentPublicationId: "5e7d782d-a4c9-4c97-91a2-e2ae95c6ae1e",
      },
    },
    {
      eventType: "PAYMENT_STATUS_CHANGED",
      aggregateId: "0be91762-1464-45bc-b0c5-d87f03e81d7e",
      payload: {
        paymentAttemptId: "0be91762-1464-45bc-b0c5-d87f03e81d7e",
        orderId: "4f847525-ed50-44db-b2cb-319977b397e0",
        status: "PROCESSING",
      },
    },
    {
      eventType: "REFUND_STATUS_CHANGED",
      aggregateId: "9238cd69-c70d-480e-bab9-c7c5709866ba",
      payload: {
        refundId: "9238cd69-c70d-480e-bab9-c7c5709866ba",
        orderId: "4f847525-ed50-44db-b2cb-319977b397e0",
        status: "REQUESTED",
      },
    },
    {
      eventType: "DISPUTE_STATUS_CHANGED",
      aggregateId: "9fa3a55f-7089-470e-9594-430211ba9619",
      payload: {
        disputeId: "9fa3a55f-7089-470e-9594-430211ba9619",
        orderId: "4f847525-ed50-44db-b2cb-319977b397e0",
        status: "OPEN",
      },
    },
    {
      eventType: "PAYMENT_CONFIG_PUBLISHED",
      aggregateId: "76bc0b6a-d699-45be-9d0f-6a43e189e563",
      payload: {
        paymentConfigVersionId: "76bc0b6a-d699-45be-9d0f-6a43e189e563",
        paymentConfigPublicationId: "22606206-b4ba-4815-a478-2f531fbf7bdb",
      },
    },
    {
      eventType: "PRICE_BOOK_PUBLISHED",
      aggregateId: "3e9f7d7b-f1cd-42fc-bf6e-6e668b05c640",
      payload: {
        priceBookPublicationId: "1a3d802d-16e8-456b-9e52-a073506df8df",
        priceBookId: "3e9f7d7b-f1cd-42fc-bf6e-6e668b05c640",
        priceBookRevision: 4,
        market: "US",
        currency: "USD",
      },
    },
  ] as const;

  expect(events.map(({ eventType }) => eventType)).toEqual([
    "CART_ITEM_ADDED",
    "ORDER_PAYMENT_CONFIRMED",
    "FULFILLMENT_STATUS_CHANGED",
    "NOTIFICATION_REQUESTED",
    "CONTENT_PUBLICATION_CHANGED",
    "PAYMENT_STATUS_CHANGED",
    "REFUND_STATUS_CHANGED",
    "DISPUTE_STATUS_CHANGED",
    "PAYMENT_CONFIG_PUBLISHED",
    "PRICE_BOOK_PUBLISHED",
  ]);

  for (const eventFields of events) {
    const event = { ...envelopeBase, ...eventFields };
    expect(schema.safeParse(event).success, eventFields.eventType).toBe(true);
    expect(JSON.parse(JSON.stringify(schema.parse(event)))).toEqual(event);
    expect(
      schema.safeParse({ ...event, schemaVersion: 2 }).success,
      `${eventFields.eventType} must reject unknown schema versions`,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...event,
        aggregateId: "080d253d-c94e-41cb-b74d-2b546487f3e4",
      }).success,
      `${eventFields.eventType} must bind aggregateId to its payload owner`,
    ).toBe(false);
    for (const unsafePayloadField of [
      { amountMinor: 1 },
      { fanMessage: "PRIVATE_MESSAGE" },
      { email: "fan@example.invalid" },
      { metadata: { source: "UNBOUNDED" } },
    ]) {
      expect(
        schema.safeParse({
          ...event,
          payload: { ...event.payload, ...unsafePayloadField },
        }).success,
        `${eventFields.eventType} payload must remain strict and minimal`,
      ).toBe(false);
    }
  }

  expect(
    schema.safeParse({
      ...envelopeBase,
      ...events[0],
      eventType: "UNKNOWN_EVENT",
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({ ...envelopeBase, ...events[0], metadata: {} }).success,
  ).toBe(false);
  const contentPublicationEvent = events[4];
  expect(
    schema.safeParse({
      ...envelopeBase,
      ...contentPublicationEvent,
      locale: undefined,
    }).success,
    "content publication events must identify the exact purge locale",
  ).toBe(false);
  expect(
    schema.safeParse({
      ...envelopeBase,
      ...contentPublicationEvent,
      locale: "fr",
    }).success,
    "content publication events must use a supported public locale",
  ).toBe(false);
  expect(
    schema.safeParse({ ...envelopeBase, ...events[0], occurredAt: new Date() })
      .success,
  ).toBe(false);
  for (const [eventIndex, invalidStatus] of [
    [5, "PAID"],
    [6, "REFUNDED"],
    [7, "PROCESSING"],
  ] as const) {
    const event = events[eventIndex];
    expect(
      schema.safeParse({
        ...envelopeBase,
        ...event,
        payload: { ...event.payload, status: invalidStatus },
      }).success,
      `${event.eventType} must use its canonical status schema`,
    ).toBe(false);
  }
  const priceBookEvent = events[9];
  expect(
    schema.safeParse({
      ...envelopeBase,
      ...priceBookEvent,
      payload: { ...priceBookEvent.payload, priceBookRevision: undefined },
    }).success,
    "price-book publication events must carry the exact revision",
  ).toBe(false);
  expect(
    schema.safeParse({
      ...envelopeBase,
      ...priceBookEvent,
      payload: { ...priceBookEvent.payload, market: "global" },
    }).success,
    "price-book publication events must use a canonical market",
  ).toBe(false);
});

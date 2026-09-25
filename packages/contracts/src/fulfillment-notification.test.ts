import { expect, test } from "vitest";

type Schema = Readonly<{
  safeParse: (value: unknown) => Readonly<{ success: boolean }>;
}>;

test("defines fulfillment and notification commands without addresses or fan PII", async () => {
  const contracts = await import("./fulfillment-notification.js").catch(
    () => undefined,
  );
  expect(contracts, "fulfillment/notification module must exist").toBeDefined();
  expect(contracts?.giftFulfillmentSchema).toBeDefined();
  expect(contracts?.notificationLocaleSnapshotSchema).toBeDefined();
  expect(contracts?.notificationCommandSchema).toBeDefined();

  const fulfillment = {
    schemaVersion: 1,
    id: "ac1a166d-8776-4e0f-ab40-ed16595b0b71",
    orderId: "4f847525-ed50-44db-b2cb-319977b397e0",
    orderItemId: "94951ae7-33b0-444f-8db8-089d10106085",
    status: "PREPARING",
    version: 2,
    preparedAt: "2026-09-03T01:00:00Z",
    updatedAt: "2026-09-03T01:00:00Z",
  };
  const localeSnapshot = {
    schemaVersion: 1,
    requestedLocale: "vi",
    resolvedLocale: "en",
    fallbackUsed: true,
    templateKey: "order.preparing",
    templateVersion: "order-preparing-v3",
    contentRevisionIds: ["7ef0823b-a666-430a-9055-4aa9465d41c7"],
  };
  const command = {
    schemaVersion: 1,
    id: "3c3093ab-2f96-49e7-ad22-dd030b8f44af",
    orderId: fulfillment.orderId,
    customerContactId: "5721ba0b-26a8-4413-8f17-69f6a970dd17",
    eventType: "PREPARING",
    locale: localeSnapshot,
    idempotencyKey: "notification-order-preparing-v3",
    correlationId: "a6a9869f-a9dd-4b7f-8b86-e6f5ad456bd8",
  };

  expect(
    (contracts?.giftFulfillmentSchema as Schema).safeParse(fulfillment).success,
  ).toBe(true);
  expect(
    (contracts?.notificationLocaleSnapshotSchema as Schema).safeParse(
      localeSnapshot,
    ).success,
  ).toBe(true);
  expect(
    (contracts?.notificationCommandSchema as Schema).safeParse(command).success,
  ).toBe(true);
  expect(
    (contracts?.giftFulfillmentSchema as Schema).safeParse({
      ...fulfillment,
      status: "ON_HOLD",
      holdReasonCode: "ADDRESS_REVIEW_REQUIRED",
    }).success,
  ).toBe(true);
  expect(
    (contracts?.giftFulfillmentSchema as Schema).safeParse({
      ...fulfillment,
      status: "ON_HOLD",
      holdReasonCode: "fan@example.invalid",
    }).success,
  ).toBe(false);
  expect(
    (contracts?.notificationCommandSchema as Schema).safeParse({
      ...command,
      idempotencyKey: "fan@example.invalid",
    }).success,
  ).toBe(false);
  expect(
    (contracts?.notificationLocaleSnapshotSchema as Schema).safeParse({
      ...localeSnapshot,
      templateVersion: "fan@example.invalid PRIVATE_MESSAGE",
    }).success,
  ).toBe(false);

  for (const privateField of [
    { email: "fan@example.invalid" },
    { fanMessage: "PRIVATE_MESSAGE" },
    { displayName: "PRIVATE_NAME" },
    { fulfillmentAddress: "PRIVATE_ADDRESS" },
    { fanMessageCiphertext: "PRIVATE_CIPHERTEXT" },
  ]) {
    expect(
      (contracts?.notificationCommandSchema as Schema).safeParse({
        ...command,
        ...privateField,
      }).success,
    ).toBe(false);
    expect(
      (contracts?.giftFulfillmentSchema as Schema).safeParse({
        ...fulfillment,
        ...privateField,
      }).success,
    ).toBe(false);
  }

  expect(
    (contracts?.notificationLocaleSnapshotSchema as Schema).safeParse({
      ...localeSnapshot,
      resolvedLocale: "pt",
    }).success,
  ).toBe(false);
});

import { describe, expect, test } from "vitest";
import * as contracts from "./index.js";

const module = contracts as unknown as Record<
  string,
  { safeParse(value: unknown): { success: boolean } }
>;
const uuid = "12345678-1234-4234-8234-123456789012";
const variables = {
  schemaVersion: 1,
  siteName: "Studio",
  publicOrderId: uuid,
  orderedAt: "2026-09-16T00:00:00Z",
  currency: "USD",
  totalMinor: 1200,
  items: [
    {
      idolName: "Artist",
      idolLocale: "en",
      giftName: "Gift",
      giftLocale: "en",
      variantName: null,
      variantLocale: null,
      quantity: 1,
      lineTotalMinor: 1200,
    },
  ],
  orderUrl: `https://store.example.test/en/order-access#token=${"A".repeat(43)}&order=${uuid}`,
};
describe("transactional notification contracts", () => {
  test("provides strict serializable historical template variables", () => {
    expect(module["orderNotificationVariablesSchema"]).toBeDefined();
    expect(
      module["orderNotificationVariablesSchema"]!.safeParse(variables).success,
    ).toBe(true);
    for (const changed of [
      { ...variables, email: "private@example.test" },
      { ...variables, totalMinor: 1.1 },
      {
        ...variables,
        orderUrl: `https://store.example.test/en/order-access?token=${"A".repeat(43)}`,
      },
    ]) {
      expect(
        module["orderNotificationVariablesSchema"]!.safeParse(changed).success,
      ).toBe(false);
    }
  });
  test("carries the public order number and reads archived v1 variables as null", () => {
    const schema = contracts.orderNotificationVariablesSchema;
    expect(
      schema.parse({ ...variables, publicOrderNo: "FS-7K3M9C" }).publicOrderNo,
    ).toBe("FS-7K3M9C");
    expect(schema.parse(variables).publicOrderNo).toBeNull();
    for (const publicOrderNo of ["fs-7k3m9c", "FS-7K3M9U", "7K3M9C"])
      expect(schema.safeParse({ ...variables, publicOrderNo }).success).toBe(
        false,
      );
  });
  test("requires a reason for a whole-message incident fallback", () => {
    expect(module["orderNotificationTemplateSelectionSchema"]).toBeDefined();
    const selection = {
      schemaVersion: 1,
      eventType: "PAYMENT_CONFIRMED",
      requestedLocale: "th",
      resolvedLocale: "en",
      fallbackUsed: true,
      templateKey: "order.payment.confirmed",
      templateVersion: `v1.${"a".repeat(64)}`,
    };
    expect(
      module["orderNotificationTemplateSelectionSchema"]!.safeParse(selection)
        .success,
    ).toBe(false);
    expect(
      module["orderNotificationTemplateSelectionSchema"]!.safeParse({
        ...selection,
        fallbackReasonCode: "TEMPLATE_UNAVAILABLE",
      }).success,
    ).toBe(true);
  });
});

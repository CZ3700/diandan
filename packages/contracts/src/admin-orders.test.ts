import { describe, expect, test } from "vitest";
import * as contracts from "./index.js";
import type { z } from "zod";

const id = "01950000-0000-4000-8000-000000000001";
const schemas = contracts as unknown as Record<string, z.ZodType>;
function accepts(name: string, input: unknown) {
  expect(schemas[name], `missing contract ${name}`).toBeDefined();
  return schemas[name]!.safeParse(input).success;
}
const base = {
  schemaVersion: 1,
  orderId: id,
  expectedOrderVersion: 2,
  idempotencyKey: "orders-command-0001",
  reasonCode: "OPERATOR_CONFIRMED",
};
describe("admin order command boundaries", () => {
  test("versioned order discovery is separate from content permissions", () => {
    expect(
      accepts("adminOrdersCommandSchema", {
        schemaVersion: 1,
        action: "CONTEXT",
      }),
    ).toBe(true);
    expect(accepts("adminOrdersPermissionSchema", "orders.read")).toBe(true);
    expect(accepts("adminOrdersPermissionSchema", "management.direct")).toBe(
      false,
    );
  });
  test("bounded listings have explicit status and review filters", () => {
    const list = {
      schemaVersion: 1,
      action: "LIST",
      page: 1,
      pageSize: 20,
      query: "",
      fulfillment: "ALL",
      moderation: "ALL",
    };
    expect(accepts("adminOrdersCommandSchema", list)).toBe(true);
    for (const invalid of [
      { page: 0 },
      { pageSize: 51 },
      { query: "a".repeat(81) },
      { email: "forbidden@example.invalid" },
    ])
      expect(accepts("adminOrdersCommandSchema", { ...list, ...invalid })).toBe(
        false,
      );
  });
  test("fulfillment changes bind order and line versions", () => {
    const command = {
      ...base,
      action: "PREPARE",
      fulfillmentId: id,
      expectedFulfillmentVersion: 1,
    };
    expect(accepts("adminOrdersCommandSchema", command)).toBe(true);
    expect(
      accepts("adminOrdersCommandSchema", {
        ...command,
        expectedFulfillmentVersion: 0,
      }),
    ).toBe(false);
    expect(
      accepts("adminOrdersCommandSchema", {
        ...command,
        paymentStatus: "PAID",
      }),
    ).toBe(false);
  });
  test("manager exceptions require explicit confirmation", () => {
    const command = {
      ...base,
      action: "HOLD",
      fulfillmentId: id,
      expectedFulfillmentVersion: 1,
      confirmed: true,
    };
    expect(accepts("adminOrdersCommandSchema", command)).toBe(true);
    expect(
      accepts("adminOrdersCommandSchema", { ...command, confirmed: false }),
    ).toBe(false);
    expect(
      accepts("adminOrdersCommandSchema", {
        ...command,
        targetStatus: "DELIVERED",
      }),
    ).toBe(false);
  });
  test("human review requires a recent private access, confirmed known language, and version", () => {
    const command = {
      ...base,
      action: "REVIEW_MESSAGE",
      itemId: id,
      expectedIntentVersion: 3,
      accessId: id,
      reviewLocale: "ja",
      languageConfirmed: true,
      decision: "APPROVED",
    };
    expect(accepts("adminOrdersCommandSchema", command)).toBe(true);
    for (const invalid of [
      { reviewLocale: "und" },
      { languageConfirmed: false },
      { decision: "AUTOMATED" },
      { fanMessage: "forbidden" },
    ])
      expect(
        accepts("adminOrdersCommandSchema", { ...command, ...invalid }),
      ).toBe(false);
  });
  test("resend accepts neither recipient, locale nor a fabricated event", () => {
    const command = {
      ...base,
      action: "RESEND_NOTIFICATION",
      expectedLatestNotificationId: id,
    };
    expect(accepts("adminOrdersCommandSchema", command)).toBe(true);
    for (const extra of [
      { eventType: "DELIVERED" },
      { locale: "th" },
      { email: "forbidden@example.invalid" },
    ])
      expect(
        accepts("adminOrdersCommandSchema", { ...command, ...extra }),
      ).toBe(false);
  });
  test("note plaintext is accepted only on its dedicated command", () => {
    expect(
      accepts("adminOrdersCommandSchema", {
        ...base,
        action: "ADD_NOTE",
        note: "Preparation confirmed.",
      }),
    ).toBe(true);
    expect(
      accepts("adminOrdersCommandSchema", {
        ...base,
        action: "ADD_NOTE",
        note: "a".repeat(1001),
      }),
    ).toBe(false);
    expect(
      accepts("adminOrdersCommandSchema", {
        schemaVersion: 1,
        action: "DETAIL",
        orderId: id,
        note: "forbidden",
      }),
    ).toBe(false);
  });
});

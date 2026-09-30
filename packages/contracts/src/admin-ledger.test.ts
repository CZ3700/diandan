import { describe, expect, test } from "vitest";
import {
  adminLedgerCommandSchema,
  adminLedgerExportLineSchema,
  adminLedgerLineSchema,
  adminLedgerPeriodSchema,
  adminLedgerRequestSchema,
  adminLedgerResponseSchema,
  adminLedgerTimeZoneSchema,
} from "./admin-ledger.js";
import { adminLedgerStoreRequestSchema } from "./admin-ledger-persistence.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = `${"a".repeat(42)}A`;
const line = {
  orderId: id(1),
  itemId: id(2),
  orderNumber: "FS-ABC234",
  paidAt: "2026-10-01T02:03:04.000000Z",
  artistId: id(3),
  giftTitle: "Moon bouquet",
  giftKind: "PHYSICAL",
  quantity: 2,
  unitAmountMinor: 1250,
  amountMinor: 2500,
  refundedMinor: 500,
  refundPendingMinor: 0,
  netMinor: 2000,
  currency: "USD",
  environment: "TEST",
  category: "PENDING",
  fulfillmentStatus: "PREPARING",
  chargebackLost: false,
  deliveredAt: null,
  waitingDays: 3,
  message: { intentVersion: 2 },
};

describe("ledger periods", () => {
  test("presets carry no dates and custom ranges run forward within 366 days", () => {
    for (const kind of ["TODAY", "THIS_WEEK", "THIS_MONTH", "LAST_MONTH"])
      expect(adminLedgerPeriodSchema.safeParse({ kind }).success).toBe(true);
    expect(
      adminLedgerPeriodSchema.safeParse({ kind: "TODAY", from: "2026-10-01" })
        .success,
    ).toBe(false);
    const custom = (from: string, to: string) =>
      adminLedgerPeriodSchema.safeParse({ kind: "CUSTOM", from, to }).success;
    expect(custom("2026-10-01", "2026-10-01")).toBe(true);
    expect(custom("2024-01-01", "2024-12-31")).toBe(true);
    expect(custom("2026-01-01", "2027-01-01")).toBe(true);
    expect(custom("2026-01-01", "2027-01-02")).toBe(false);
    expect(custom("2026-10-02", "2026-10-01")).toBe(false);
    expect(custom("2026-02-30", "2026-03-01")).toBe(false);
    expect(custom("2026-10-1", "2026-10-02")).toBe(false);
  });

  test("time zones are plain IANA names", () => {
    for (const zone of [
      "Asia/Shanghai",
      "UTC",
      "Etc/GMT+8",
      "America/Argentina/Buenos_Aires",
    ])
      expect(adminLedgerTimeZoneSchema.safeParse(zone).success).toBe(true);
    for (const zone of [
      "",
      "../etc/passwd",
      "Asia/Shanghai'; --",
      "Asia//Shanghai",
      "+08:00",
    ])
      expect(adminLedgerTimeZoneSchema.safeParse(zone).success).toBe(false);
  });
});

describe("ledger commands", () => {
  test("requests are strict and message reads name the exact line version and review language", () => {
    const request = {
      schemaVersion: 1,
      requestId: id(9),
      sessionToken: token,
      csrfToken: token,
      command: {
        schemaVersion: 1,
        action: "OVERVIEW",
        period: { kind: "THIS_MONTH" },
        broker: { kind: "ALL" },
      },
    };
    expect(adminLedgerRequestSchema.safeParse(request).success).toBe(true);
    expect(
      adminLedgerRequestSchema.safeParse({ ...request, actorId: id(1) })
        .success,
    ).toBe(false);
    expect(
      adminLedgerCommandSchema.safeParse({
        schemaVersion: 1,
        action: "READ_MESSAGE",
        orderId: id(1),
        itemId: id(2),
        expectedIntentVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      adminLedgerCommandSchema.safeParse({
        schemaVersion: 1,
        action: "EXPORT",
        scope: { kind: "ARTIST", artistId: id(3) },
        period: { kind: "TODAY" },
      }).success,
    ).toBe(true);
    expect(
      adminLedgerCommandSchema.safeParse({
        schemaVersion: 1,
        action: "EXPORT",
        scope: { kind: "ARTIST" },
        period: { kind: "TODAY" },
      }).success,
    ).toBe(false);
  });

  test("the store request carries the deployment time zone and no raw tokens", () => {
    const access = {
      schemaVersion: 1,
      sessionTokenDigest: "a".repeat(64),
      csrfTokenDigest: "b".repeat(64),
      requestId: id(1),
      correlationId: id(1),
    };
    const command = { schemaVersion: 1, action: "CONTEXT" };
    expect(
      adminLedgerStoreRequestSchema.safeParse({
        schemaVersion: 1,
        access,
        command,
        timeZone: "Asia/Shanghai",
      }).success,
    ).toBe(true);
    expect(
      adminLedgerStoreRequestSchema.safeParse({
        schemaVersion: 1,
        access,
        command,
      }).success,
    ).toBe(false);
    expect(
      adminLedgerStoreRequestSchema.safeParse({
        schemaVersion: 1,
        access,
        command,
        timeZone: "Asia/Shanghai",
        sessionToken: token,
      }).success,
    ).toBe(false);
  });
});

describe("ledger lines", () => {
  test("page lines may point at a readable message; export lines cannot", () => {
    expect(adminLedgerLineSchema.safeParse(line).success).toBe(true);
    const exported = Object.fromEntries(
      Object.entries(line).filter(([key]) => key !== "message"),
    );
    expect(adminLedgerExportLineSchema.safeParse(exported).success).toBe(true);
    expect(adminLedgerExportLineSchema.safeParse(line).success).toBe(false);
    expect(Object.keys(adminLedgerExportLineSchema.shape)).not.toContain(
      "message",
    );
  });

  test("amounts are integer minor units and TEST/LIVE are explicit", () => {
    expect(
      adminLedgerLineSchema.safeParse({ ...line, amountMinor: 12.5 }).success,
    ).toBe(false);
    expect(
      adminLedgerLineSchema.safeParse({ ...line, refundedMinor: -1 }).success,
    ).toBe(false);
    expect(
      adminLedgerLineSchema.safeParse({ ...line, environment: "SANDBOX" })
        .success,
    ).toBe(false);
  });

  test("an overview response parses with per-currency totals", () => {
    const figures = {
      environment: "LIVE",
      currency: "USD",
      completedOrders: 1,
      completedMinor: 1000,
      pendingOrders: 0,
      pendingMinor: 0,
      refundedMinor: 0,
      refundPendingMinor: 0,
      netMinor: 1000,
    };
    const period = {
      kind: "THIS_MONTH",
      from: "2026-10-01",
      to: "2026-10-01",
      timeZone: "Asia/Shanghai",
      startsAt: "2026-09-30T16:00:00.000000Z",
      endsBefore: "2026-10-01T16:00:00.000000Z",
    };
    const parsed = adminLedgerResponseSchema.safeParse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "OVERVIEW",
      period,
      broker: { kind: "ALL" },
      totals: [figures, { ...figures, currency: "JPY" }],
      artists: [
        {
          artistId: id(3),
          displayName: "Aria",
          archived: false,
          broker: null,
          ...figures,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

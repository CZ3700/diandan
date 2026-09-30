import { describe, expect, test } from "vitest";
import {
  SUPPORTED_LOCALES,
  adminLedgerLineSchema,
  adminLedgerResponseSchema,
} from "@fan-support/contracts";
import { ledgerCopy } from "./copy";
import type { LedgerExport } from "./api";
import {
  fill,
  filterArtists,
  ledgerFileName,
  ledgerWorkbook,
  lineStatus,
  moneyCell,
  periodText,
  sheetInstant,
  splitLines,
  zoneLabel,
} from "./model";
import { buildXlsx } from "./xlsx";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const figures = {
  environment: "LIVE",
  currency: "USD",
  completedOrders: 1,
  completedMinor: 3000,
  pendingOrders: 1,
  pendingMinor: 4000,
  refundedMinor: 500,
  refundPendingMinor: 1000,
  netMinor: 7000,
} as const;
const line = {
  orderId: id(10),
  itemId: id(11),
  orderNumber: "FS-ABC234",
  paidAt: "2026-03-05T02:00:00.000000Z",
  artistId: id(1),
  giftTitle: "Moon bouquet",
  giftKind: "PHYSICAL",
  quantity: 2,
  unitAmountMinor: 1250,
  amountMinor: 2500,
  refundedMinor: 500,
  refundPendingMinor: 0,
  netMinor: 2000,
  currency: "USD",
  environment: "LIVE",
  category: "COMPLETED",
  fulfillmentStatus: "DELIVERED",
  chargebackLost: false,
  deliveredAt: "2026-03-06T10:00:00.000000Z",
  waitingDays: null,
} as const;
const exported = adminLedgerResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "EXPORT",
  exportId: id(99),
  exportedAt: "2026-10-01T06:30:00.000000Z",
  exportedBy: "Studio Owner",
  period: {
    kind: "CUSTOM",
    from: "2026-03-01",
    to: "2026-03-31",
    timeZone: "Asia/Shanghai",
    startsAt: "2026-02-28T16:00:00.000000Z",
    endsBefore: "2026-03-31T16:00:00.000000Z",
  },
  scope: { kind: "BROKER", brokerId: id(5) },
  subject: "Mina Park",
  totals: [
    figures,
    {
      ...figures,
      currency: "JPY",
      completedMinor: 3000,
      pendingMinor: 0,
      netMinor: 3000,
    },
  ],
  artists: [
    {
      artistId: id(1),
      displayName: "Aria",
      archived: false,
      broker: { brokerId: id(5), displayName: "Mina Park", active: false },
      ...figures,
    },
  ],
  lines: [
    line,
    {
      ...line,
      itemId: id(12),
      category: "REFUNDED",
      chargebackLost: true,
      netMinor: 0,
      refundedMinor: 2500,
    },
  ],
  truncated: true,
}) as LedgerExport;

describe("copy", () => {
  test("every language has the same keys and placeholders as English", () => {
    const en = ledgerCopy("en");
    const holes = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/gu)].map((m) => m[1]).sort();
    for (const locale of SUPPORTED_LOCALES) {
      const copy = ledgerCopy(locale);
      expect(Object.keys(copy).sort(), locale).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(copy)) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
        expect(holes(value), `${locale}.${key}`).toEqual(
          holes(en[key as keyof typeof en]),
        );
      }
    }
    expect(
      new Set(SUPPORTED_LOCALES.map((locale) => ledgerCopy(locale).title)).size,
    ).toBe(6);
  });
});

describe("figures", () => {
  test("minor units become exact decimals with the currency's own places", () => {
    expect(moneyCell(123456, "USD")).toEqual({ decimal: "1234.56", places: 2 });
    expect(moneyCell(5, "USD")).toEqual({ decimal: "0.05", places: 2 });
    expect(moneyCell(0, "USD")).toEqual({ decimal: "0.00", places: 2 });
    expect(moneyCell(3000, "JPY")).toEqual({ decimal: "3000", places: 0 });
    expect(moneyCell(1234, "KWD")).toEqual({ decimal: "1.234", places: 3 });
  });

  test("the ledger zone is named with its offset, and instants print in that zone", () => {
    expect(
      zoneLabel("Asia/Shanghai", "en", new Date("2026-10-01T00:00:00Z")),
    ).toMatch(/UTC\+8$/u);
    expect(zoneLabel("UTC", "zh-CN", new Date("2026-10-01T00:00:00Z"))).toMatch(
      /UTC\+0$/u,
    );
    expect(sheetInstant("2026-03-31T16:00:00.000000Z", "Asia/Shanghai")).toBe(
      "2026-04-01 00:00",
    );
    expect(periodText(exported.period, "zh-CN", ledgerCopy("zh-CN"))).toMatch(
      /^2026年3月1日 至 2026年3月31日（.+UTC\+8）$/u,
    );
  });

  test("lines split into pending, completed and refunded-or-closed", () => {
    const page = (change: Record<string, unknown>) =>
      adminLedgerLineSchema.parse({ ...line, message: null, ...change });
    const parts = splitLines(
      ["PENDING", "COMPLETED", "REFUNDED", "CLOSED"].map((category) =>
        page({ category }),
      ),
    );
    expect([
      parts.pending.length,
      parts.completed.length,
      parts.closed.length,
    ]).toEqual([1, 1, 2]);
    const copy = ledgerCopy("en");
    expect(
      lineStatus(page({ chargebackLost: true, category: "REFUNDED" }), copy),
    ).toBe(copy.chargebackLost);
    expect(lineStatus(page({ category: "REFUNDED" }), copy)).toBe(
      copy.statusRefunded,
    );
    expect(
      lineStatus(
        page({ category: "PENDING", fulfillmentStatus: "ON_HOLD" }),
        copy,
      ),
    ).toBe(copy.statusOnHold);
  });

  test("artist search ignores case in the reader's language", () => {
    const rows = [
      { ...exported.artists[0]!, displayName: "İlkay" },
      { ...exported.artists[0]!, displayName: "Aria" },
    ];
    expect(
      filterArtists(rows, " aria ", "en").map((row) => row.displayName),
    ).toEqual(["Aria"]);
    expect(filterArtists(rows, "", "en")).toHaveLength(2);
    expect(fill("{count} 笔 / {missing}", { count: 3 })).toBe(
      "3 笔 / {missing}",
    );
  });
});

describe("export workbook", () => {
  test("names scope, period, zone, reader and time, and lists every total and line", () => {
    const copy = ledgerCopy("zh-CN");
    const [summary, details] = ledgerWorkbook(exported, copy, "zh-CN");
    expect(summary!.name).toBe("汇总");
    expect(details!.name).toBe("明细");
    const text = (sheet: typeof summary) =>
      sheet!.rows.map((row) =>
        row.cells.map((cell) =>
          typeof cell === "object" && cell ? cell.decimal : cell,
        ),
      );
    const rows = text(summary);
    expect(rows).toContainEqual([copy.exportScope, "Mina Park 名下全部艺人"]);
    expect(rows).toContainEqual([copy.exportPeriod, "2026-03-01 – 2026-03-31"]);
    expect(rows).toContainEqual([copy.exportedBy, "Studio Owner"]);
    expect(rows).toContainEqual([copy.exportedAt, "2026-10-01 14:30"]);
    expect(rows).toContainEqual([copy.notice, copy.truncatedSheet]);
    expect(rows).toContainEqual([
      "Aria",
      "Mina Park （已停用）",
      "正式",
      "USD",
      1,
      "30.00",
      1,
      "40.00",
      "5.00",
      "10.00",
      "70.00",
    ]);
    expect(rows).toContainEqual([
      "合计",
      "",
      "正式",
      "JPY",
      1,
      "3000",
      1,
      "0",
      "500",
      "1000",
      "3000",
    ]);
    const lines = text(details);
    expect(lines).toContainEqual([
      "FS-ABC234",
      "2026-03-05 10:00",
      "Aria",
      "Mina Park （已停用）",
      "Moon bouquet",
      "实物投喂",
      2,
      "12.50",
      "25.00",
      "5.00",
      "20.00",
      "USD",
      "正式",
      "已送达",
      "2026-03-06 18:00",
      null,
    ]);
    expect(lines.some((row) => row.includes("拒付败诉"))).toBe(true);
  });

  test("the file never carries fan data and opens as a valid package", () => {
    const bytes = buildXlsx(ledgerWorkbook(exported, ledgerCopy("th"), "th"));
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toMatch(/message|intentVersion|@/u);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  test("file names keep only safe characters", () => {
    expect(ledgerFileName(exported, ledgerCopy("zh-CN"))).toBe(
      "艺人账目_Mina Park_2026-03-01_2026-03-31.xlsx",
    );
    expect(
      ledgerFileName({ ...exported, subject: 'a/b:c*"d' }, ledgerCopy("en")),
    ).toBe("artist-ledger_a_b_c_d_2026-03-01_2026-03-31.xlsx");
    expect(
      ledgerFileName(
        { ...exported, scope: { kind: "ALL" }, subject: null },
        ledgerCopy("en"),
      ),
    ).toBe("artist-ledger_All artists_2026-03-01_2026-03-31.xlsx");
  });
});

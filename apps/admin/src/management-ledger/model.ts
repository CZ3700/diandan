import type {
  AdminLedgerArtistRow,
  AdminLedgerExportLine,
  AdminLedgerExportScope,
  AdminLedgerLine,
  AdminLedgerResolvedPeriod,
  AdminLedgerTotal,
  SupportedLocale,
} from "@fan-support/contracts";
import type { LedgerExport } from "./api";
import type { LedgerCopy } from "./copy";
import type { XlsxCell, XlsxDecimalPlaces, XlsxRow, XlsxSheet } from "./xlsx";

// ADR-022 / L3-12: presentation rules for the artist ledger. Figures come from the API as they are.

export function fill(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** The zone's name in the reader's language plus its UTC offset, e.g. "China Standard Time UTC+8". */
export function zoneLabel(
  timeZone: string,
  locale: SupportedLocale,
  at = new Date(),
): string {
  const part = (formatLocale: string, timeZoneName: "long" | "shortOffset") =>
    new Intl.DateTimeFormat(formatLocale, { timeZone, timeZoneName })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
  const offset = part("en", "shortOffset")?.replace(/^GMT/u, "UTC") || "UTC";
  const name = part(locale, "long");
  return name && !name.startsWith("GMT")
    ? `${name} ${offset}`
    : `${timeZone} ${offset}`;
}

/** A calendar day in the ledger zone, e.g. 2026-10-01 → "Oct 1, 2026" in the reader's language. */
export function formatDay(day: string, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}
export function formatInstant(
  iso: string,
  locale: SupportedLocale,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}
/** Sortable and unambiguous in a spreadsheet: "2026-10-01 14:03" in the ledger zone. */
export function sheetInstant(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function periodText(
  period: AdminLedgerResolvedPeriod,
  locale: SupportedLocale,
  copy: LedgerCopy,
): string {
  return fill(copy.periodRange, {
    from: formatDay(period.from, locale),
    to: formatDay(period.to, locale),
    zone: zoneLabel(period.timeZone, locale),
  });
}

function currencyPlaces(currency: string): XlsxDecimalPlaces {
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return Math.min(3, Math.max(0, digits)) as XlsxDecimalPlaces;
}
/** Integer minor units to an exact decimal cell; no floating point on the way. */
export function moneyCell(amountMinor: number, currency: string): XlsxCell {
  const places = currencyPlaces(currency);
  const digits = String(amountMinor).padStart(places + 1, "0");
  return {
    decimal:
      places === 0
        ? digits
        : `${digits.slice(0, -places)}.${digits.slice(-places)}`,
    places,
  };
}

export function splitLines(lines: readonly AdminLedgerLine[]) {
  return {
    pending: lines.filter((line) => line.category === "PENDING"),
    completed: lines.filter((line) => line.category === "COMPLETED"),
    closed: lines.filter(
      (line) => line.category === "REFUNDED" || line.category === "CLOSED",
    ),
  };
}

export function filterArtists(
  rows: readonly AdminLedgerArtistRow[],
  query: string,
  locale: SupportedLocale,
): AdminLedgerArtistRow[] {
  const needle = query.trim().toLocaleLowerCase(locale);
  return needle === ""
    ? [...rows]
    : rows.filter((row) =>
        row.displayName.toLocaleLowerCase(locale).includes(needle),
      );
}

export function lineStatus(
  line: AdminLedgerExportLine,
  copy: LedgerCopy,
): string {
  if (line.chargebackLost) return copy.chargebackLost;
  if (line.category === "REFUNDED") return copy.statusRefunded;
  switch (line.fulfillmentStatus) {
    case "PENDING":
      return copy.statusPending;
    case "PREPARING":
      return copy.statusPreparing;
    case "ON_HOLD":
      return copy.statusOnHold;
    case "DELIVERED":
      return copy.statusDelivered;
    default:
      return copy.statusCanceled;
  }
}
export function giftKindLabel(
  kind: AdminLedgerExportLine["giftKind"],
  copy: LedgerCopy,
): string {
  switch (kind) {
    case "VIRTUAL":
      return copy.kindVirtual;
    case "PHYSICAL":
      return copy.kindPhysical;
    case "WISH":
      return copy.kindWish;
    case "MERCHANDISE":
      return copy.kindMerchandise;
    default:
      return copy.kindOther;
  }
}
export function brokerName(
  broker: AdminLedgerArtistRow["broker"],
  copy: LedgerCopy,
): string {
  if (broker === null) return copy.noBroker;
  return broker.active
    ? broker.displayName
    : `${broker.displayName} ${copy.suspended}`;
}
export function scopeText(
  scope: AdminLedgerExportScope,
  subject: string | null,
  copy: LedgerCopy,
): string {
  switch (scope.kind) {
    case "ALL":
      return copy.exportScopeAll;
    case "UNASSIGNED":
      return copy.exportScopeUnassigned;
    case "BROKER":
      return fill(copy.exportScopeBroker, { name: subject ?? "" });
    case "ARTIST":
      return fill(copy.exportScopeArtist, { name: subject ?? "" });
  }
}
const environmentText = (environment: "TEST" | "LIVE", copy: LedgerCopy) =>
  environment === "TEST" ? copy.test : copy.live;

function figureCells(total: AdminLedgerTotal): XlsxCell[] {
  return [
    total.completedOrders,
    moneyCell(total.completedMinor, total.currency),
    total.pendingOrders,
    moneyCell(total.pendingMinor, total.currency),
    moneyCell(total.refundedMinor, total.currency),
    moneyCell(total.refundPendingMinor, total.currency),
    moneyCell(total.netMinor, total.currency),
  ];
}

/**
 * Summary and details sheets. The header names scope, period, zone, reader and time; there are no fan
 * emails, signatures or messages because the export response carries none.
 */
export function ledgerWorkbook(
  exported: LedgerExport,
  copy: LedgerCopy,
  locale: SupportedLocale,
): XlsxSheet[] {
  const { period } = exported;
  const header: XlsxRow[] = [
    { cells: [copy.workbookTitle], bold: true },
    {
      cells: [
        copy.exportScope,
        scopeText(exported.scope, exported.subject, copy),
      ],
    },
    { cells: [copy.exportPeriod, `${period.from} – ${period.to}`] },
    {
      cells: [
        copy.timeZone,
        zoneLabel(period.timeZone, locale, new Date(exported.exportedAt)),
      ],
    },
    { cells: [copy.exportedBy, exported.exportedBy] },
    {
      cells: [
        copy.exportedAt,
        sheetInstant(exported.exportedAt, period.timeZone),
      ],
    },
    { cells: [copy.notice, copy.noticeText] },
    ...(exported.truncated
      ? [{ cells: [copy.notice, copy.truncatedSheet] }]
      : []),
    { cells: [] },
  ];
  const summary: XlsxRow[] = [
    ...header,
    {
      bold: true,
      cells: [
        copy.artist,
        copy.assignedBroker,
        copy.environment,
        copy.currency,
        copy.completedOrders,
        copy.completedAmount,
        copy.pendingOrders,
        copy.pendingAmount,
        copy.refunded,
        copy.refundPendingAmount,
        copy.net,
      ],
    },
    ...exported.artists.map((row) => ({
      cells: [
        row.displayName,
        brokerName(row.broker, copy),
        environmentText(row.environment, copy),
        row.currency,
        ...figureCells(row),
      ],
    })),
    { cells: [] },
    ...exported.totals.map((total) => ({
      bold: true,
      cells: [
        copy.totalRow,
        "",
        environmentText(total.environment, copy),
        total.currency,
        ...figureCells(total),
      ],
    })),
  ];
  const artists = new Map(exported.artists.map((row) => [row.artistId, row]));
  const details: XlsxRow[] = [
    ...header,
    {
      bold: true,
      cells: [
        copy.orderNumber,
        copy.paidAt,
        copy.artist,
        copy.assignedBroker,
        copy.gift,
        copy.kind,
        copy.quantity,
        copy.unitPrice,
        copy.amount,
        copy.refunded,
        copy.netAmount,
        copy.currency,
        copy.environment,
        copy.status,
        copy.deliveredAt,
        copy.waiting,
      ],
    },
    ...exported.lines.map((line) => {
      const artist = artists.get(line.artistId);
      return {
        cells: [
          line.orderNumber,
          sheetInstant(line.paidAt, period.timeZone),
          artist?.displayName ?? line.artistId,
          artist ? brokerName(artist.broker, copy) : "",
          line.giftTitle,
          giftKindLabel(line.giftKind, copy),
          line.quantity,
          moneyCell(line.unitAmountMinor, line.currency),
          moneyCell(line.amountMinor, line.currency),
          moneyCell(line.refundedMinor, line.currency),
          moneyCell(line.netMinor, line.currency),
          line.currency,
          environmentText(line.environment, copy),
          lineStatus(line, copy),
          line.deliveredAt === null
            ? null
            : sheetInstant(line.deliveredAt, period.timeZone),
          line.waitingDays,
        ],
      };
    }),
  ];
  return [
    {
      name: copy.sheetSummary,
      columns: [24, 22, 10, 8, 12, 16, 12, 16, 14, 14, 16],
      rows: summary,
    },
    {
      name: copy.sheetDetails,
      columns: [12, 18, 24, 22, 32, 14, 8, 12, 12, 12, 12, 8, 10, 16, 18, 10],
      rows: details,
    },
  ];
}

const UNSAFE_FILE = /[\\/:*?"<>|\p{Cc}]+/gu;
export function ledgerFileName(
  exported: LedgerExport,
  copy: LedgerCopy,
): string {
  const scope =
    exported.scope.kind === "ALL"
      ? copy.exportScopeAll
      : exported.scope.kind === "UNASSIGNED"
        ? copy.exportScopeUnassigned
        : (exported.subject ?? "");
  const safe = (text: string) =>
    text.replace(UNSAFE_FILE, "_").trim().slice(0, 60);
  return `${safe(copy.fileName)}_${safe(scope) || "scope"}_${exported.period.from}_${exported.period.to}.xlsx`;
}

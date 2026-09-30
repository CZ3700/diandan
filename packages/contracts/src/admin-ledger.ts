import { z } from "zod";
import { adminOpaqueTokenSchema } from "./admin-content.js";
import { adminOrdersPrivateResponseSchema } from "./admin-orders.js";
import { checkoutVersionSchema } from "./checkout-preflight.js";
import { currencySchema, minorAmountSchema } from "./commerce.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { giftKindSchema } from "./gift-commerce-profile.js";
import { publicOrderNoSchema } from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { managementCenterBrokerSchema } from "./management-center.js";
import { fulfillmentStatusSchema } from "./order.js";

/**
 * ADR-022 / L3-12: a read-only summary of what each artist received, built from orders, payments and
 * refunds. It is internal reconciliation, never a settlement: no commission, payout or balance.
 */
export const ADMIN_LEDGER_MAX_LINES = 10_000;
export const ADMIN_LEDGER_MAX_PERIOD_DAYS = 366;

const uuid = z.uuid();
const version = z.literal(1);
const localDate = z.iso.date();
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const displayName = z.string().min(1).max(200);

export const adminLedgerFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_COMMAND",
    "UNAUTHENTICATED",
    "CSRF_INVALID",
    "FORBIDDEN",
    "NOT_FOUND",
    "STALE_VERSION",
    "LANGUAGE_REVIEW_REQUIRED",
    "PRIVATE_CONTENT_UNAVAILABLE",
    "PRIVATE_ACCESS_EXPIRED",
    "TEMPORARY_UNAVAILABLE",
  ]),
});

/** An IANA zone name; the deployment decides it (Asia/Shanghai by default) and the server resolves every period. */
export const adminLedgerTimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/u);

function calendarDay(date: string): number {
  return (
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
    ) / 86_400_000
  );
}

/** Periods are calendar days in the ledger time zone; "to" is inclusive. Presets are resolved on the server's clock. */
export const adminLedgerPeriodSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("TODAY") }),
  z.strictObject({ kind: z.literal("THIS_WEEK") }),
  z.strictObject({ kind: z.literal("THIS_MONTH") }),
  z.strictObject({ kind: z.literal("LAST_MONTH") }),
  z
    .strictObject({ kind: z.literal("CUSTOM"), from: localDate, to: localDate })
    .refine(
      (period) =>
        calendarDay(period.to) >= calendarDay(period.from) &&
        calendarDay(period.to) - calendarDay(period.from) <
          ADMIN_LEDGER_MAX_PERIOD_DAYS,
      { message: "A custom period runs forward and covers at most 366 days" },
    ),
]);
export const adminLedgerResolvedPeriodSchema = z.strictObject({
  kind: z.enum(["TODAY", "THIS_WEEK", "THIS_MONTH", "LAST_MONTH", "CUSTOM"]),
  from: localDate,
  to: localDate,
  timeZone: adminLedgerTimeZoneSchema,
  /** The first instant inside the period and the first instant after it, in UTC. */
  startsAt: contentTimestampSchema,
  endsBefore: contentTimestampSchema,
});

export const adminLedgerBrokerFilterSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ALL") }),
  z.strictObject({ kind: z.literal("UNASSIGNED") }),
  z.strictObject({ kind: z.literal("BROKER"), brokerId: uuid }),
]);
/** The three exports the user asked for are one button in different places: everything, one broker, one artist. */
export const adminLedgerExportScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ALL") }),
  z.strictObject({ kind: z.literal("UNASSIGNED") }),
  z.strictObject({ kind: z.literal("BROKER"), brokerId: uuid }),
  z.strictObject({ kind: z.literal("ARTIST"), artistId: uuid }),
]);

export const adminLedgerCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ schemaVersion: version, action: z.literal("CONTEXT") }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("OVERVIEW"),
    period: adminLedgerPeriodSchema,
    broker: adminLedgerBrokerFilterSchema,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("ARTIST"),
    artistId: uuid,
    period: adminLedgerPeriodSchema,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("EXPORT"),
    scope: adminLedgerExportScopeSchema,
    period: adminLedgerPeriodSchema,
  }),
  /** Reveals one fan message; every call writes an audit before decryption and expires within five minutes. */
  z.strictObject({
    schemaVersion: version,
    action: z.literal("READ_MESSAGE"),
    orderId: uuid,
    itemId: uuid,
    expectedIntentVersion: checkoutVersionSchema,
    reviewLocale: supportedLocaleSchema,
  }),
]);
export const adminLedgerRequestSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: adminLedgerCommandSchema,
});

/** Money is never added across currencies or between TEST and LIVE payments. */
const figures = {
  environment: z.enum(["TEST", "LIVE"]),
  currency: currencySchema,
  completedOrders: count,
  completedMinor: minorAmountSchema,
  pendingOrders: count,
  pendingMinor: minorAmountSchema,
  refundedMinor: minorAmountSchema,
  refundPendingMinor: minorAmountSchema,
  netMinor: minorAmountSchema,
};
export const adminLedgerTotalSchema = z.strictObject(figures);
export const adminLedgerArtistSchema = z.strictObject({
  artistId: uuid,
  displayName,
  archived: z.boolean(),
  broker: managementCenterBrokerSchema.nullable(),
});
export const adminLedgerArtistRowSchema = z.strictObject({
  ...adminLedgerArtistSchema.shape,
  ...figures,
});
/**
 * One gift line. COMPLETED: delivered and not fully refunded; PENDING: still pending, preparing or on hold and
 * not fully refunded; REFUNDED: fully refunded or the order's chargeback was lost; CLOSED: anything else paid.
 */
export const adminLedgerLineSchema = z.strictObject({
  orderId: uuid,
  itemId: uuid,
  orderNumber: publicOrderNoSchema,
  paidAt: contentTimestampSchema,
  artistId: uuid,
  giftTitle: z.string().min(1).max(160),
  giftKind: z.union([giftKindSchema, z.literal("LEGACY")]),
  quantity: z.number().int().min(1).max(2_147_483_647),
  unitAmountMinor: minorAmountSchema,
  amountMinor: minorAmountSchema,
  refundedMinor: minorAmountSchema,
  refundPendingMinor: minorAmountSchema,
  netMinor: minorAmountSchema,
  currency: currencySchema,
  environment: z.enum(["TEST", "LIVE"]),
  category: z.enum(["COMPLETED", "PENDING", "REFUNDED", "CLOSED"]),
  fulfillmentStatus: fulfillmentStatusSchema.nullable(),
  chargebackLost: z.boolean(),
  deliveredAt: contentTimestampSchema.nullable(),
  /** Whole days since payment, for lines still waiting; null otherwise. */
  waitingDays: count.nullable(),
  /** Present only when this reader may reveal a message or signature on the line. */
  message: z.strictObject({ intentVersion: checkoutVersionSchema }).nullable(),
});
/** Exports never carry fan messages, signatures, emails or anything that reveals whether a message exists. */
export const adminLedgerExportLineSchema = adminLedgerLineSchema.omit({
  message: true,
});

const success = { schemaVersion: version, outcome: z.literal("SUCCESS") };
export const adminLedgerResponseSchema = z.union([
  adminLedgerFailureSchema,
  z.strictObject({
    ...success,
    kind: z.literal("CONTEXT"),
    actorId: uuid,
    /** ALL: every artist (ledger.read). ASSIGNED: only the reader's own artists (ledger.assigned). */
    scope: z.enum(["ALL", "ASSIGNED"]),
    canReadMessages: z.boolean(),
    timeZone: adminLedgerTimeZoneSchema,
    today: localDate,
    brokers: z.array(managementCenterBrokerSchema).max(500),
  }),
  z.strictObject({
    ...success,
    kind: z.literal("OVERVIEW"),
    period: adminLedgerResolvedPeriodSchema,
    broker: adminLedgerBrokerFilterSchema,
    totals: z.array(adminLedgerTotalSchema).max(64),
    artists: z.array(adminLedgerArtistRowSchema).max(5000),
  }),
  z.strictObject({
    ...success,
    kind: z.literal("ARTIST"),
    period: adminLedgerResolvedPeriodSchema,
    artist: adminLedgerArtistSchema,
    totals: z.array(adminLedgerTotalSchema).max(64),
    lines: z.array(adminLedgerLineSchema).max(ADMIN_LEDGER_MAX_LINES),
    truncated: z.boolean(),
  }),
  z.strictObject({
    ...success,
    kind: z.literal("EXPORT"),
    exportId: uuid,
    exportedAt: contentTimestampSchema,
    exportedBy: displayName,
    period: adminLedgerResolvedPeriodSchema,
    scope: adminLedgerExportScopeSchema,
    /** The broker or artist named by the scope, for the sheet header. */
    subject: z.string().min(1).max(200).nullable(),
    totals: z.array(adminLedgerTotalSchema).max(64),
    artists: z.array(adminLedgerArtistRowSchema).max(5000),
    lines: z.array(adminLedgerExportLineSchema).max(ADMIN_LEDGER_MAX_LINES),
    truncated: z.boolean(),
  }),
]);
export const adminLedgerMessageResponseSchema = z.union([
  adminLedgerFailureSchema,
  adminOrdersPrivateResponseSchema.options[1],
]);

export type AdminLedgerFailure = z.infer<typeof adminLedgerFailureSchema>;
export type AdminLedgerPeriod = z.infer<typeof adminLedgerPeriodSchema>;
export type AdminLedgerResolvedPeriod = z.infer<
  typeof adminLedgerResolvedPeriodSchema
>;
export type AdminLedgerBrokerFilter = z.infer<
  typeof adminLedgerBrokerFilterSchema
>;
export type AdminLedgerExportScope = z.infer<
  typeof adminLedgerExportScopeSchema
>;
export type AdminLedgerCommand = z.infer<typeof adminLedgerCommandSchema>;
export type AdminLedgerRequest = z.infer<typeof adminLedgerRequestSchema>;
export type AdminLedgerTotal = z.infer<typeof adminLedgerTotalSchema>;
export type AdminLedgerArtist = z.infer<typeof adminLedgerArtistSchema>;
export type AdminLedgerArtistRow = z.infer<typeof adminLedgerArtistRowSchema>;
export type AdminLedgerLine = z.infer<typeof adminLedgerLineSchema>;
export type AdminLedgerExportLine = z.infer<typeof adminLedgerExportLineSchema>;
export type AdminLedgerResponse = z.infer<typeof adminLedgerResponseSchema>;
export type AdminLedgerMessageResponse = z.infer<
  typeof adminLedgerMessageResponseSchema
>;

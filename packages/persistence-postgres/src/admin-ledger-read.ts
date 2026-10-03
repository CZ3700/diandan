import {
  ADMIN_LEDGER_MAX_LINES,
  adminLedgerArtistSchema,
  adminLedgerLineSchema,
  adminLedgerResolvedPeriodSchema,
  adminLedgerTotalSchema,
  type AdminLedgerArtist,
  type AdminLedgerLine,
  type AdminLedgerPeriod,
  type AdminLedgerResolvedPeriod,
  type AdminLedgerTotal,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import { adminOrdersTimestamp } from "./admin-orders-data.js";
import { readBrokers } from "./management-center-assignment.js";
import type { TransactionClient } from "./transaction-runner.js";

// ADR-022 / L3-12: every ledger figure comes from one statement over orders, payments, fulfillments and
// refunds, so totals, artist rows and lines always describe the same READ COMMITTED snapshot.

/** Which artists a query covers. ASSIGNED readers are narrowed to their own artists on top of this. */
export type LedgerFilter =
  | { readonly kind: "ALL" }
  | { readonly kind: "UNASSIGNED" }
  | { readonly kind: "BROKER"; readonly brokerId: string }
  | { readonly kind: "ARTIST"; readonly artistId: string };

export type LedgerReader = Readonly<{
  actorId: string;
  scope: "ALL" | "ASSIGNED";
  /** Lines of the reader's own artists may reveal messages (ledger.messages). */
  brokerMessages: boolean;
  /** The orders page's message rules apply to every line (orders.read + orders.message.read). */
  orderMessages: boolean;
}>;

export type LedgerArtistFigures = AdminLedgerTotal & {
  readonly artistId: string;
};
export type LedgerFigures = Readonly<{
  totals: AdminLedgerTotal[];
  artists: LedgerArtistFigures[];
  lines: AdminLedgerLine[];
  truncated: boolean;
}>;

export async function readLedgerToday(
  client: TransactionClient,
  timeZone: string,
): Promise<string> {
  const [row] = await draftRows(
    client,
    "SELECT (transaction_timestamp() AT TIME ZONE $1)::date::text today",
    [timeZone],
  );
  return String(row?.["today"]);
}

/** Presets follow the server clock in the ledger time zone; weeks start on Monday. "to" is inclusive. */
export async function resolveLedgerPeriod(
  client: TransactionClient,
  period: AdminLedgerPeriod,
  timeZone: string,
): Promise<AdminLedgerResolvedPeriod> {
  const [clock] = await draftRows(
    client,
    `WITH local AS (SELECT transaction_timestamp() AT TIME ZONE $1 now)
    SELECT now::date::text today,date_trunc('week',now)::date::text week_start,date_trunc('month',now)::date::text month_start,
     (date_trunc('month',now)-interval '1 month')::date::text last_month_start,(date_trunc('month',now)::date-1)::text last_month_end FROM local`,
    [timeZone],
  );
  const day = (key: string) => String(clock?.[key]);
  const [from, to] =
    period.kind === "TODAY"
      ? [day("today"), day("today")]
      : period.kind === "THIS_WEEK"
        ? [day("week_start"), day("today")]
        : period.kind === "THIS_MONTH"
          ? [day("month_start"), day("today")]
          : period.kind === "LAST_MONTH"
            ? [day("last_month_start"), day("last_month_end")]
            : [period.from, period.to];
  const [bounds] = await draftRows(
    client,
    `SELECT ${adminOrdersTimestamp("($1::date::timestamp AT TIME ZONE $3)")} starts_at,${adminOrdersTimestamp("(($2::date+1)::timestamp AT TIME ZONE $3)")} ends_before`,
    [from, to, timeZone],
  );
  return adminLedgerResolvedPeriodSchema.parse({
    kind: period.kind,
    from,
    to,
    timeZone,
    startsAt: bounds?.["starts_at"],
    endsBefore: bounds?.["ends_before"],
  });
}

const FIGURES = `count(DISTINCT order_id) FILTER(WHERE category='COMPLETED') "completedOrders",
 coalesce(sum(net) FILTER(WHERE category='COMPLETED'),0) "completedMinor",
 count(DISTINCT order_id) FILTER(WHERE category='PENDING') "pendingOrders",
 coalesce(sum(net) FILTER(WHERE category='PENDING'),0) "pendingMinor",
 coalesce(sum(refunded),0) "refundedMinor",coalesce(sum(refund_pending),0) "refundPendingMinor",coalesce(sum(net),0) "netMinor"`;
const utc = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Only paid orders count: a line enters the ledger when its order's single succeeded payment falls inside
 * the period (cancelled orders are never paid). Amounts and states are the current ones, so later refunds
 * are deducted. A lost chargeback returns the whole order; pending refunds are shown but not deducted.
 */
function ledgerStatement(filterSql: string): string {
  return `WITH lines AS (
  SELECT i.id item_id,i.order_id,o.public_order_no,pa.succeeded_at paid_at,pa.environment,i.idol_id,i.gift_title,coalesce(i.gift_kind,'LEGACY') gift_kind,
   i.quantity,i.unit_amount_minor::bigint unit_amount,i.line_total_minor::bigint amount,i.currency::text currency,o.dispute_status='LOST' chargeback_lost,
   f.status fstatus,f.delivered_at,coalesce(r.succeeded,0)::bigint refunded_raw,coalesce(r.pending,0)::bigint refund_pending_raw,s.version intent_version,
   coalesce(s.privacy_state='ACTIVE' AND (s.fan_message_ciphertext IS NOT NULL OR s.display_mode='nickname'),false) private_readable,
   coalesce($3::uuid IS NOT NULL AND s.moderation_status NOT IN('REJECTED','REDACTED') AND public.idol_current_broker(i.idol_id)=$3::uuid,false) broker_readable
  FROM public.payment_attempts pa JOIN public.orders o ON o.id=pa.order_id JOIN public.order_items i ON i.order_id=o.id
  LEFT JOIN public.fulfillments f ON f.order_item_id=i.id AND f.order_id=i.order_id
  LEFT JOIN public.support_intents s ON s.id=i.support_intent_id
  LEFT JOIN LATERAL(SELECT sum(ri.amount_minor) FILTER(WHERE rf.status='SUCCEEDED') succeeded,
    sum(ri.amount_minor) FILTER(WHERE rf.status IN('REQUESTED','SUBMITTING','PROCESSING','UNKNOWN')) pending
   FROM public.refund_items ri JOIN public.refunds rf ON rf.id=ri.refund_id WHERE ri.order_item_id=i.id) r ON true
  WHERE pa.status='SUCCEEDED' AND pa.succeeded_at>=$1::timestamptz AND pa.succeeded_at<$2::timestamptz${filterSql}
 ),classified AS (
  SELECT l.*,CASE WHEN chargeback_lost THEN amount ELSE least(refunded_raw,amount) END refunded,
   CASE WHEN chargeback_lost THEN 0 ELSE refund_pending_raw END refund_pending,
   CASE WHEN chargeback_lost OR refunded_raw>=amount THEN 'REFUNDED' WHEN fstatus='DELIVERED' THEN 'COMPLETED'
    WHEN fstatus IN('PENDING','PREPARING','ON_HOLD') THEN 'PENDING' ELSE 'CLOSED' END category
  FROM lines l
 ),figured AS (
  SELECT c.*,amount-refunded net,
   CASE WHEN category='PENDING' THEN floor(extract(epoch FROM transaction_timestamp()-paid_at)/86400)::int END waiting_days
  FROM classified c
 )
 SELECT
  (SELECT coalesce(json_agg(t ORDER BY t.environment='TEST',t.currency),'[]'::json) FROM
   (SELECT environment,currency,${FIGURES} FROM figured GROUP BY environment,currency) t) totals,
  (SELECT coalesce(json_agg(t),'[]'::json) FROM
   (SELECT idol_id "artistId",environment,currency,${FIGURES} FROM figured GROUP BY idol_id,environment,currency) t) artists,
  (SELECT coalesce(json_agg(json_build_object('orderId',order_id,'itemId',item_id,'orderNumber',public_order_no,'paidAt',${utc("paid_at")},
    'artistId',idol_id,'giftTitle',gift_title,'giftKind',gift_kind,'quantity',quantity,'unitAmountMinor',unit_amount,'amountMinor',amount,
    'refundedMinor',refunded,'refundPendingMinor',refund_pending,'netMinor',net,'currency',currency,'environment',environment,'category',category,
    'fulfillmentStatus',fstatus,'chargebackLost',chargeback_lost,'deliveredAt',${utc("delivered_at")},'waitingDays',waiting_days,
    'intentVersion',intent_version,'privateReadable',private_readable,'brokerReadable',broker_readable) ORDER BY paid_at DESC,public_order_no,item_id),'[]'::json)
   FROM (SELECT * FROM figured ORDER BY paid_at DESC,public_order_no,item_id LIMIT $4::int) x) lines`;
}

export async function readLedgerFigures(
  client: TransactionClient,
  input: Readonly<{
    period: AdminLedgerResolvedPeriod;
    filter: LedgerFilter;
    reader: LedgerReader;
    withLines: boolean;
  }>,
): Promise<LedgerFigures> {
  const params: unknown[] = [
    input.period.startsAt,
    input.period.endsBefore,
    input.reader.brokerMessages ? input.reader.actorId : null,
    input.withLines ? ADMIN_LEDGER_MAX_LINES + 1 : 0,
  ];
  const placeholder = (value: unknown) => {
    params.push(value);
    return `$${params.length}::uuid`;
  };
  const { filter } = input;
  let filterSql =
    filter.kind === "UNASSIGNED"
      ? " AND public.idol_current_broker(i.idol_id) IS NULL"
      : filter.kind === "BROKER"
        ? ` AND public.idol_current_broker(i.idol_id)=${placeholder(filter.brokerId)}`
        : filter.kind === "ARTIST"
          ? ` AND i.idol_id=${placeholder(filter.artistId)}`
          : "";
  if (input.reader.scope === "ASSIGNED")
    filterSql += ` AND public.idol_current_broker(i.idol_id)=${placeholder(input.reader.actorId)}`;
  const [row] = await draftRows(client, ledgerStatement(filterSql), params);
  const totals = (row?.["totals"] as unknown[]).map((total) =>
    adminLedgerTotalSchema.parse(total),
  );
  const artists = (row?.["artists"] as Record<string, unknown>[]).map(
    ({ artistId, ...figures }) => ({
      ...adminLedgerTotalSchema.parse(figures),
      artistId: String(artistId),
    }),
  );
  const raw = row?.["lines"] as Record<string, unknown>[];
  const lines = raw.slice(0, ADMIN_LEDGER_MAX_LINES).map((line) => {
    const { intentVersion, privateReadable, brokerReadable, ...rest } = line;
    const readable =
      privateReadable === true &&
      (brokerReadable === true || input.reader.orderMessages);
    return adminLedgerLineSchema.parse({
      ...rest,
      message: readable ? { intentVersion } : null,
    });
  });
  return {
    totals,
    artists,
    lines,
    truncated: raw.length > ADMIN_LEDGER_MAX_LINES,
  };
}

/** Current names and owners; archived (deleted) artists keep their history in the ledger. */
export async function readLedgerArtists(
  client: TransactionClient,
  artistIds: readonly string[],
): Promise<Map<string, AdminLedgerArtist>> {
  if (artistIds.length === 0) return new Map();
  const rows = await draftRows(
    client,
    `SELECT o.id,o.status='archived' archived,left(coalesce(d.document->'source'->'fields'->>'displayName',t.display_name,o.handle),200) name,
    public.idol_current_broker(o.id) broker_id
    FROM public.idols o LEFT JOIN public.idol_revisions r ON r.id=coalesce(o.published_revision_id,o.draft_revision_id)
    LEFT JOIN public.daily_publication_revisions d ON d.revision_id=r.id
    LEFT JOIN public.idol_revision_translations t ON t.idol_revision_id=r.id AND t.locale='en'
    WHERE o.id=ANY($1::uuid[])`,
    [artistIds],
  );
  const brokers = await readBrokers(client, [
    ...new Set(
      rows
        .map((row) => row["broker_id"])
        .filter((id): id is string => typeof id === "string"),
    ),
  ]);
  return new Map(
    rows.map((row) => [
      String(row["id"]),
      adminLedgerArtistSchema.parse({
        artistId: row["id"],
        displayName: row["name"],
        archived: row["archived"] === true,
        broker:
          typeof row["broker_id"] === "string"
            ? (brokers.get(row["broker_id"]) ?? null)
            : null,
      }),
    ]),
  );
}

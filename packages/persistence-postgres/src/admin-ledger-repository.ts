import { randomUUID } from "node:crypto";
import {
  adminLedgerResponseSchema,
  adminLedgerStoreRequestSchema,
  adminOrdersConfirmPrivateSchema,
  type AdminLedgerArtistRow,
  type AdminLedgerExportScope,
  type AdminLedgerResponse,
  type AdminLedgerStoreRequest,
} from "@fan-support/contracts";
import type { AdminLedgerRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import { confirmAdminOrdersAuthority } from "./admin-orders-authorization.js";
import { adminOrdersTimestamp } from "./admin-orders-data.js";
import {
  ledgerFailure,
  ledgerFailureFromOrders,
  readLedgerPrincipal,
  type LedgerPrincipal,
} from "./admin-ledger-authorization.js";
import {
  confirmLedgerMessage,
  prepareLedgerMessage,
} from "./admin-ledger-message.js";
import {
  readLedgerArtists,
  readLedgerFigures,
  readLedgerToday,
  resolveLedgerPeriod,
  type LedgerFigures,
  type LedgerFilter,
  type LedgerReader,
} from "./admin-ledger-read.js";
import {
  readBrokerDirectory,
  readBrokers,
} from "./management-center-assignment.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

const success = { schemaVersion: 1, outcome: "SUCCESS" } as const;
const reader = (p: LedgerPrincipal): LedgerReader => ({
  actorId: p.orders.actorId,
  scope: p.scope,
  brokerMessages: p.brokerMessages,
  orderMessages: p.orderMessages,
});

/** A broker sees only itself: its whole scope is "its own artists", and it may narrow to one of them. */
function allowedFilter(
  p: LedgerPrincipal,
  filter: LedgerFilter,
): LedgerFilter | null {
  if (p.scope === "ALL") return filter;
  if (
    filter.kind === "ALL" ||
    (filter.kind === "BROKER" && filter.brokerId === p.orders.actorId)
  )
    return { kind: "BROKER", brokerId: p.orders.actorId };
  return filter.kind === "ARTIST" ? filter : null;
}

async function artistRows(
  client: TransactionClient,
  figures: LedgerFigures,
): Promise<AdminLedgerArtistRow[]> {
  const artists = await readLedgerArtists(client, [
    ...new Set(figures.artists.map((row) => row.artistId)),
  ]);
  return figures.artists
    .map((row) => {
      const artist = artists.get(row.artistId);
      if (!artist) throw new Error("ledger line names an unknown artist");
      return { ...artist, ...row };
    })
    .sort(
      (a, b) =>
        a.displayName.localeCompare(b.displayName, "en") ||
        a.artistId.localeCompare(b.artistId) ||
        Number(a.environment === "TEST") - Number(b.environment === "TEST") ||
        a.currency.localeCompare(b.currency),
    );
}

/** An artist outside a broker's scope reads as missing rather than forbidden. */
async function visibleArtist(
  client: TransactionClient,
  p: LedgerPrincipal,
  artistId: string,
) {
  const artist = (await readLedgerArtists(client, [artistId])).get(artistId);
  return artist &&
    (p.scope === "ALL" || artist.broker?.brokerId === p.orders.actorId)
    ? artist
    : null;
}

async function exportLedger(
  client: TransactionClient,
  request: AdminLedgerStoreRequest,
  p: LedgerPrincipal,
  scope: AdminLedgerExportScope,
): Promise<AdminLedgerResponse> {
  if (request.command.action !== "EXPORT")
    return ledgerFailure("INVALID_COMMAND");
  const filter = allowedFilter(p, scope);
  if (!filter) return ledgerFailure("FORBIDDEN");
  let subject: string | null = null;
  if (scope.kind === "ARTIST") {
    const artist = await visibleArtist(client, p, scope.artistId);
    if (!artist) return ledgerFailure("NOT_FOUND");
    subject = artist.displayName;
  } else if (filter.kind === "BROKER") {
    const broker = (await readBrokers(client, [filter.brokerId])).get(
      filter.brokerId,
    );
    if (!broker) return ledgerFailure("NOT_FOUND");
    subject = broker.displayName;
  }
  const period = await resolveLedgerPeriod(
    client,
    request.command.period,
    request.timeZone,
  );
  const figures = await readLedgerFigures(client, {
    period,
    filter,
    reader: reader(p),
    withLines: true,
  });
  const artists = await artistRows(client, figures);
  const expired = await confirmAdminOrdersAuthority(client, p.orders);
  if (expired) return ledgerFailureFromOrders(expired);
  const exportId = randomUUID(),
    auditId = randomUUID();
  const recordedScope =
    filter.kind === "BROKER" && scope.kind === "ALL" ? filter : scope;
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category)
    VALUES($1,'ADMIN',$2,'ARTIST_LEDGER_EXPORT','ARTIST_LEDGER_EXPORT',$3,$4,$5,$6,'SUCCEEDED','ARTIST_LEDGER')`,
    [
      auditId,
      p.orders.actorId,
      exportId,
      `${recordedScope.kind}_SCOPE`,
      request.access.requestId,
      request.access.correlationId,
    ],
  );
  await client.query(
    `INSERT INTO public.artist_ledger_exports(id,actor_id,session_id,scope,broker_identity_id,idol_id,period_from,period_to,time_zone,line_count,truncated,audit_log_id,request_id)
    VALUES($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13)`,
    [
      exportId,
      p.orders.actorId,
      p.orders.sessionId,
      recordedScope.kind,
      recordedScope.kind === "BROKER" ? recordedScope.brokerId : null,
      recordedScope.kind === "ARTIST" ? recordedScope.artistId : null,
      period.from,
      period.to,
      period.timeZone,
      figures.lines.length,
      figures.truncated,
      auditId,
      request.access.requestId,
    ],
  );
  const [who] = await draftRows(
    client,
    `SELECT coalesce(a.display_name,left(i.id::text,8)) display_name,${adminOrdersTimestamp("transaction_timestamp()")} exported_at
    FROM public.admin_identities i LEFT JOIN public.admin_local_accounts a ON a.admin_identity_id=i.id WHERE i.id=$1`,
    [p.orders.actorId],
  );
  return adminLedgerResponseSchema.parse({
    ...success,
    kind: "EXPORT",
    exportId,
    exportedAt: who?.["exported_at"],
    exportedBy: who?.["display_name"],
    period,
    scope: recordedScope,
    subject,
    totals: figures.totals,
    artists,
    // Page lines may point at a readable message; an export line never does.
    lines: figures.lines.map((line) =>
      Object.fromEntries(
        Object.entries(line).filter(([key]) => key !== "message"),
      ),
    ),
    truncated: figures.truncated,
  });
}

async function execute(
  client: TransactionClient,
  request: AdminLedgerStoreRequest,
): Promise<AdminLedgerResponse> {
  const c = request.command;
  if (c.action === "READ_MESSAGE") return ledgerFailure("INVALID_COMMAND");
  const auth = await readLedgerPrincipal(client, request.access);
  if (auth.outcome === "FAILURE") return auth;
  const p = auth.principal;
  if (c.action === "CONTEXT")
    return adminLedgerResponseSchema.parse({
      ...success,
      kind: "CONTEXT",
      actorId: p.orders.actorId,
      scope: p.scope,
      canReadMessages: p.brokerMessages || p.orderMessages,
      timeZone: request.timeZone,
      today: await readLedgerToday(client, request.timeZone),
      brokers: p.scope === "ALL" ? await readBrokerDirectory(client) : [],
    });
  if (c.action === "EXPORT") return exportLedger(client, request, p, c.scope);
  if (c.action === "OVERVIEW") {
    const filter = allowedFilter(p, c.broker);
    if (!filter) return ledgerFailure("FORBIDDEN");
    const period = await resolveLedgerPeriod(
      client,
      c.period,
      request.timeZone,
    );
    const figures = await readLedgerFigures(client, {
      period,
      filter,
      reader: reader(p),
      withLines: false,
    });
    return adminLedgerResponseSchema.parse({
      ...success,
      kind: "OVERVIEW",
      period,
      broker: c.broker,
      totals: figures.totals,
      artists: await artistRows(client, figures),
    });
  }
  const artist = await visibleArtist(client, p, c.artistId);
  if (!artist) return ledgerFailure("NOT_FOUND");
  const period = await resolveLedgerPeriod(client, c.period, request.timeZone);
  const figures = await readLedgerFigures(client, {
    period,
    filter: { kind: "ARTIST", artistId: c.artistId },
    reader: reader(p),
    withLines: true,
  });
  return adminLedgerResponseSchema.parse({
    ...success,
    kind: "ARTIST",
    period,
    artist,
    totals: figures.totals,
    lines: figures.lines,
    truncated: figures.truncated,
  });
}

/** Read-only summaries plus the audited export receipt and the two steps of a message read. */
export function createAdminLedgerRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): AdminLedgerRepository {
  const tracked = <T>(work: () => Promise<T>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    execute: (input) =>
      tracked(async () => {
        const parsed = adminLedgerStoreRequestSchema.safeParse(input);
        return parsed.success
          ? execute(client, parsed.data)
          : ledgerFailure("INVALID_COMMAND");
      }),
    prepareMessage: (input) =>
      tracked(async () => {
        const parsed = adminLedgerStoreRequestSchema.safeParse(input);
        return parsed.success
          ? prepareLedgerMessage(client, parsed.data)
          : ledgerFailure("INVALID_COMMAND");
      }),
    confirmMessage: (input) =>
      tracked(async () => {
        const parsed = adminOrdersConfirmPrivateSchema.safeParse(input);
        return parsed.success
          ? confirmLedgerMessage(client, parsed.data)
          : ledgerFailure("INVALID_COMMAND");
      }),
  };
}

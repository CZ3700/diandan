import {
  catalogDisplayOrderCommandSchema,
  catalogDisplayOrderResponseSchema,
  DISPLAY_ORDER_LIMIT,
  type CatalogDisplayOrderKind,
  type CatalogDisplayOrderResponse,
} from "@fan-support/contracts";
import type { CatalogDisplayOrderRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import { thumbnail } from "./management-center-operation-read.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

// L2-10: the newest catalog_display_orders row per kind is the current manual order.
const failure = (
  code: "STALE_VERSION" | "NOT_FOUND" | "IDEMPOTENCY_CONFLICT",
): CatalogDisplayOrderResponse => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});

/** Items the storefront shows, in the order it shows them: manual positions first, then the default. */
export function displayOrderItemsSql(kind: CatalogDisplayOrderKind): string {
  const artist = kind === "IDOL",
    table = artist ? "idols" : "gifts",
    revision = artist ? "idol" : "gift";
  return `WITH manual AS (SELECT ordered_ids FROM public.catalog_display_orders WHERE kind='${kind}' ORDER BY version DESC LIMIT 1)
    SELECT o.id,o.status,left(coalesce(d.document->'source'->'fields'->>'${artist ? "displayName" : "title"}',t.${artist ? "display_name" : "title"},o.handle),160) AS name,
      media.media_asset_id,array_position((SELECT ordered_ids FROM manual),o.id) AS manual_position
    FROM public.${table} o
    JOIN public.${revision}_revisions r ON r.id=o.published_revision_id
    ${artist ? "" : "LEFT JOIN public.gift_publication_heads h ON h.gift_id=o.id LEFT JOIN public.content_publications p ON p.id=h.publication_id"}
    LEFT JOIN public.daily_publication_revisions d ON d.revision_id=r.id
    LEFT JOIN public.${revision}_revision_translations t ON t.${revision}_revision_id=r.id AND t.locale='en'
    LEFT JOIN LATERAL(SELECT media_asset_id FROM public.${revision}_revision_media m WHERE m.${revision}_revision_id=r.id AND m.role='${artist ? "PORTRAIT" : "PRIMARY"}' ORDER BY m.sort_order LIMIT 1) media ON true
    WHERE o.status IN ('active','paused')
    ORDER BY manual_position NULLS LAST,${artist ? "r.display_order" : "p.published_at DESC NULLS LAST"},o.id
    LIMIT ${DISPLAY_ORDER_LIMIT}`;
}

export function createCatalogDisplayOrderRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl: string,
): CatalogDisplayOrderRepository {
  const run = <T>(work: () => Promise<T>): Promise<T> =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  async function currentVersion(kind: CatalogDisplayOrderKind) {
    const [row] = await draftRows(
      client,
      "SELECT coalesce(max(version),0)::text AS version FROM public.catalog_display_orders WHERE kind=$1",
      [kind],
    );
    return Number(row?.["version"] ?? 0);
  }
  async function read(
    kind: CatalogDisplayOrderKind,
    replayed: boolean,
  ): Promise<CatalogDisplayOrderResponse> {
    const version = await currentVersion(kind);
    const rows = await draftRows(client, displayOrderItemsSql(kind));
    const items = [];
    for (const row of rows)
      items.push({
        id: row["id"],
        name: row["name"],
        image: await thumbnail(
          client,
          row["media_asset_id"],
          String(row["name"]),
          publicMediaBaseUrl,
        ),
        status: row["status"],
        manual: row["manual_position"] !== null,
      });
    return catalogDisplayOrderResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "DISPLAY_ORDER",
      orderKind: kind,
      version,
      items,
      replayed,
    });
  }
  return {
    execute: (input) =>
      run(async () => {
        const command = catalogDisplayOrderCommandSchema.parse(input.command);
        if (command.action === "READ") return read(command.kind, false);
        // One writer per kind at a time; the unique (kind, version) key still guards any other path.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:display-order:'||$1,0))",
          [command.kind],
        );
        const [existing] = await draftRows(
          client,
          "SELECT kind,request_hash FROM public.catalog_display_orders WHERE actor_id=$1 AND idempotency_key=$2",
          [input.principal.actorId, command.idempotencyKey],
        );
        if (existing)
          return existing["kind"] === command.kind &&
            existing["request_hash"] === input.requestHash
            ? read(command.kind, true)
            : failure("IDEMPOTENCY_CONFLICT");
        const version = await currentVersion(command.kind);
        if (version !== command.expectedVersion)
          return failure("STALE_VERSION");
        const ids = command.orderedIds.map((id) => id.toLowerCase());
        if (ids.length > 0) {
          const [known] = await draftRows(
            client,
            `SELECT count(*)::text AS total FROM public.${command.kind === "IDOL" ? "idols" : "gifts"} WHERE id=ANY($1::uuid[]) AND status<>'archived'`,
            [ids],
          );
          if (Number(known?.["total"]) !== ids.length)
            return failure("NOT_FOUND");
        }
        const [instant] = await draftRows(
          client,
          `SELECT gen_random_uuid() AS id,gen_random_uuid() AS audit_id,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`,
        );
        await client.query(
          `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at)
          VALUES($1,'ADMIN',$2,'CATALOG_DISPLAY_ORDER_SAVE','CATALOG_DISPLAY_ORDER',$3,$4,$5,$3,'SUCCEEDED',$6::timestamptz)`,
          [
            instant?.["audit_id"],
            input.principal.actorId,
            instant?.["id"],
            `${command.kind}_ORDER`,
            input.requestId,
            instant?.["now"],
          ],
        );
        await client.query(
          `INSERT INTO public.catalog_display_orders(id,kind,version,ordered_ids,actor_id,session_id,audit_log_id,idempotency_key,request_hash,created_at)
          VALUES($1,$2,$3,$4::uuid[],$5,$6,$7,$8,$9,$10::timestamptz)`,
          [
            instant?.["id"],
            command.kind,
            version + 1,
            ids,
            input.principal.actorId,
            input.principal.sessionId,
            instant?.["audit_id"],
            command.idempotencyKey,
            input.requestHash,
            instant?.["now"],
          ],
        );
        return read(command.kind, false);
      }),
  };
}

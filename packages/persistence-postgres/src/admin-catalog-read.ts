import {
  adminCatalogResponseSchema,
  type AdminCatalogReadCommand,
  type AdminCatalogResponse,
} from "@fan-support/contracts";
import { AUTHORING_TABLES, ownerValue } from "./content-authoring-model.js";
import { PREFLIGHT_TABLES } from "./publication-preflight-mapping.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  adminOwnerSql,
  catalogFailure,
  lifecycleOf,
  mapCatalogOwner,
  readCatalogOwner,
} from "./admin-catalog-data.js";
import type { TransactionClient } from "./transaction-runner.js";
async function historyPage(
  client: TransactionClient,
  query: string,
  values: unknown[],
  limit: number,
  offset: number,
) {
  const [count] = await draftRows(
    client,
    `SELECT count(*)::text AS total FROM (${query}) history`,
    values,
  );
  const rows = await draftRows(
    client,
    `${query} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );
  return { rows, total: Number(count?.["total"] ?? 0) };
}
export async function readAdminCatalog(
  client: TransactionClient,
  command: AdminCatalogReadCommand,
): Promise<AdminCatalogResponse> {
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  if (command.action === "READ_OWNER") {
    const owner = await readCatalogOwner(
      client,
      command.target,
      command.locale,
    );
    return owner
      ? { schemaVersion: 1, outcome: "SUCCESS", kind: "OWNER", owner }
      : catalogFailure("NOT_FOUND");
  }
  const offset = (command.page - 1) * command.pageSize;
  if (command.action === "LIST_OWNERS") {
    if (
      command.status !== undefined &&
      command.kind !== "IDOL" &&
      command.kind !== "GIFT"
    )
      return catalogFailure("INVALID_COMMAND");
    const table = AUTHORING_TABLES[command.kind];
    const query = `WITH owners AS(${adminOwnerSql(command.kind)}),filtered AS(SELECT * FROM owners WHERE ($2::text IS NULL OR strpos(lower(coalesce(label,'')||' '||coalesce(owner->>'handle','')||' '||coalesce(owner->>'policy_key','')),lower($2))>0) AND ($3::text IS NULL OR owner->>'status'=$3)) SELECT (SELECT count(*)::text FROM filtered) AS total,coalesce((SELECT jsonb_agg(to_jsonb(page.*)) FROM(SELECT * FROM filtered ORDER BY owner->>'created_at' DESC NULLS LAST,owner->>'${table.ownerKey ?? "created_at"}' LIMIT $4 OFFSET $5) page),'[]') AS items`;
    const [row] = await draftRows(client, query, [
      command.locale,
      command.q ?? null,
      command.status ?? null,
      command.pageSize,
      offset,
    ]);
    return adminCatalogResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "OWNERS",
      items: ((row?.["items"] as DraftRow[]) ?? []).map((item) =>
        mapCatalogOwner(command.kind, item, command.locale),
      ),
      totalItems: Number(row?.["total"] ?? 0),
      page: command.page,
      pageSize: command.pageSize,
    });
  }
  const target = command.target,
    table = AUTHORING_TABLES[target.kind],
    head = PREFLIGHT_TABLES[target.kind];
  if (!(await readCatalogOwner(client, target, "en")))
    return catalogFailure("NOT_FOUND");
  if (command.history === "IDENTITY" && target.kind !== "IDOL")
    return catalogFailure("INVALID_COMMAND");
  const where =
    table.ownerColumn === null ? "true" : `r.${table.ownerColumn}=$1`;
  const values = table.ownerColumn === null ? [] : [ownerValue(target)];
  let rows: DraftRow[], total: number;
  if (command.history === "REVISIONS") {
    ({ rows, total } = await historyPage(
      client,
      `SELECT to_jsonb(r.*) AS row FROM public.${table.revisions} r WHERE ${where} ORDER BY revision DESC`,
      values,
      command.pageSize,
      offset,
    ));
    const owner = await readCatalogOwner(client, target, "en");
    return adminCatalogResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "HISTORY",
      totalItems: total,
      page: command.page,
      pageSize: command.pageSize,
      items: rows.map((entry) => {
        const row = entry["row"] as DraftRow;
        return {
          kind: "REVISION",
          revisionId: row["id"],
          revisionNumber: Number(row["revision"]),
          lifecycle: lifecycleOf(row),
          createdBy: row["created_by"],
          createdAt: row["created_at"],
          isCurrentPublished: row["id"] === owner?.publishedRevisionId,
          isDraftPointer: row["id"] === owner?.draftRevisionId,
        };
      }),
    });
  }
  if (command.history === "PUBLICATIONS") {
    const pubWhere =
      head.owner === null
        ? "p.content_type='HOMEPAGE'"
        : `p.${head.owner}=$1 AND p.content_type='${target.kind}'`;
    ({ rows, total } = await historyPage(
      client,
      `WITH RECURSIVE publications AS(SELECT p.* FROM public.content_publications p WHERE ${pubWhere}),chain AS(
       SELECT id,1::bigint AS version FROM publications WHERE replaces_publication_id IS NULL
       UNION ALL SELECT p.id,c.version+1 FROM publications p JOIN chain c ON p.replaces_publication_id=c.id)
       SELECT to_jsonb(p.*) AS row,c.version::text AS head_version,h.publication_id=p.id AS is_current FROM publications p JOIN chain c ON c.id=p.id LEFT JOIN public.${head.heads} h ON ${head.owner === null ? "true" : `h.${head.owner}=p.${head.owner}`} ORDER BY c.version DESC`,
      values,
      command.pageSize,
      offset,
    ));
    return adminCatalogResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "HISTORY",
      totalItems: total,
      page: command.page,
      pageSize: command.pageSize,
      items: rows.map((entry) => {
        const row = entry["row"] as DraftRow;
        return {
          kind: "PUBLICATION",
          publicationId: row["id"],
          revisionId: row[head.parent],
          headVersion: Number(entry["head_version"]),
          action: row["action"],
          actorId: row["published_by"],
          publishedAt: row["published_at"],
          isCurrent: entry["is_current"],
        };
      }),
    });
  }
  ({ rows, total } = await historyPage(
    client,
    "SELECT to_jsonb(r.*) AS row,a.reason_code FROM public.admin_idol_identity_receipts r JOIN public.audit_logs a ON a.id=r.audit_log_id WHERE r.idol_id=$1 ORDER BY r.result_base_version DESC",
    values,
    command.pageSize,
    offset,
  ));
  return adminCatalogResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "HISTORY",
    totalItems: total,
    page: command.page,
    pageSize: command.pageSize,
    items: rows.map((entry) => {
      const row = entry["row"] as DraftRow;
      return {
        kind: "IDENTITY",
        resultId: row["id"],
        idolId: row["idol_id"],
        action: row["action"],
        expectedBaseVersion: Number(row["expected_base_version"]),
        resultBaseVersion: Number(row["result_base_version"]),
        oldHandle: row["old_handle"],
        newHandle: row["new_handle"],
        oldStatus: row["old_status"],
        newStatus: row["new_status"],
        oldAcceptingGifts: row["old_accepting_gifts"],
        newAcceptingGifts: row["new_accepting_gifts"],
        actorId: row["actor_id"],
        createdAt: row["created_at"],
        reasonCode: entry["reason_code"],
      };
    }),
  });
}

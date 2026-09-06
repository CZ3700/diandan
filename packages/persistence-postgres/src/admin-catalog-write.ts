import {
  publishedContentReadCommandSchema,
  type AdminCatalogWriteCommand,
} from "@fan-support/contracts";
import { projectPublishedContent } from "@fan-support/content";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  catalogFailure,
  identityEventTime,
  readIdentityReceipt,
} from "./admin-catalog-data.js";
import { loadPublishedContentContext } from "./published-content-repository.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

export async function writeAdminCatalog(
  client: TransactionClient,
  scope: TransactionScopeControl,
  input: AdminCatalogWriteCommand,
  publicMediaBaseUrl: string | undefined,
) {
  const command = input.command;
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  let prior: DraftRow | undefined;
  if (command.action !== "CREATE_IDOL") {
    const [row] = await draftRows(
      client,
      "SELECT to_jsonb(i.*) AS idol FROM public.idols i WHERE id=$1 FOR UPDATE",
      [command.idolId],
    );
    prior = row?.["idol"] as DraftRow | undefined;
    if (!prior) return catalogFailure("NOT_FOUND");
    if (Number(prior["version"]) !== command.expectedBaseVersion)
      return catalogFailure("STALE_VERSION");
    if (prior["status"] === "archived") return catalogFailure("FORBIDDEN");
  }
  const handle =
    command.action === "CREATE_IDOL"
      ? command.handle
      : command.action === "RENAME_IDOL"
        ? command.newHandle
        : String(prior?.["handle"]);
  const status =
    command.action === "CREATE_IDOL"
      ? "draft"
      : command.action === "SET_IDOL_STATUS"
        ? command.status
        : String(prior?.["status"]);
  const accepting =
    command.action === "SET_IDOL_STATUS"
      ? command.acceptingGifts
      : command.action === "CREATE_IDOL"
        ? false
        : Boolean(prior?.["accepting_gifts"]);
  if (command.action === "RENAME_IDOL" && handle === prior?.["handle"])
    return catalogFailure("INVALID_COMMAND");
  if (
    command.action === "SET_IDOL_STATUS" &&
    status === prior?.["status"] &&
    accepting === prior?.["accepting_gifts"]
  )
    return catalogFailure("INVALID_COMMAND");
  if (
    command.action === "SET_IDOL_STATUS" &&
    status === "paused" &&
    prior?.["published_revision_id"] === null
  )
    return catalogFailure("INVALID_CONTENT");
  if (command.action !== "SET_IDOL_STATUS") {
    const names = [handle, ...(prior ? [String(prior["handle"])] : [])].sort();
    for (const name of names)
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:idol-handle:'||$1,0))",
        [name],
      );
    const [occupied] = await draftRows(
      client,
      "SELECT 1 FROM public.idols WHERE handle=$1 UNION ALL SELECT 1 FROM public.slug_redirects WHERE entity_type='IDOL' AND old_handle=$1 LIMIT 1",
      [handle],
    );
    if (occupied) return catalogFailure("ALREADY_EXISTS");
  }
  if (command.action === "SET_IDOL_STATUS" && status === "active") {
    if (!prior?.["published_revision_id"])
      return catalogFailure("INVALID_CONTENT");
    if (!publicMediaBaseUrl) return catalogFailure("CONTENT_UNAVAILABLE");
    const context = await loadPublishedContentContext(
      client,
      scope,
      publishedContentReadCommandSchema.parse({
        schemaVersion: 1,
        locator: { kind: "IDOL", handle },
        locale: "en",
      }),
      publicMediaBaseUrl,
    );
    if (
      context.outcome === "FAILURE" ||
      projectPublishedContent(context.context).outcome === "FAILURE"
    )
      return catalogFailure("INVALID_CONTENT");
  }
  const time = await identityEventTime(client, input, prior),
    idolId = command.action === "CREATE_IDOL" ? time.idolId : command.idolId;
  await client.query(
    "INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at) VALUES($1,'ADMIN',$2,$3,'IDOL_IDENTITY',$4,$5,$6,$6,'SUCCEEDED','CONTENT_IDENTITY',$7)",
    [
      time.auditId,
      input.principal.actorId,
      command.action,
      idolId,
      command.reasonCode,
      input.requestId,
      time.at,
    ],
  );
  await client.query(
    `INSERT INTO public.admin_idol_identity_receipts(id,idol_id,action,expected_base_version,result_base_version,authoring_version,publication_head_version,old_handle,new_handle,old_status,new_status,old_accepting_gifts,new_accepting_gifts,previous_updated_at,draft_revision_id,published_revision_id,actor_id,session_id,audit_log_id,redirect_id,created_at)
     VALUES($1,$2,$3,$4,$4::bigint+1,(SELECT coalesce(max(revision),0) FROM public.idol_revisions WHERE idol_id=$2),(SELECT coalesce(max(version),0) FROM public.idol_publication_heads WHERE idol_id=$2),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      time.id,
      idolId,
      command.action,
      command.expectedBaseVersion,
      prior?.["handle"] ?? null,
      handle,
      prior?.["status"] ?? null,
      status,
      prior?.["accepting_gifts"] ?? null,
      accepting,
      prior?.["updated_at"] ?? null,
      prior?.["draft_revision_id"] ?? null,
      prior?.["published_revision_id"] ?? null,
      input.principal.actorId,
      input.principal.sessionId,
      time.auditId,
      command.action === "RENAME_IDOL" ? time.redirectId : null,
      time.at,
    ],
  );
  if (command.action === "CREATE_IDOL")
    await client.query(
      "INSERT INTO public.idols(id,handle,status,accepting_gifts,version,created_at,updated_at) VALUES($1,$2,'draft',false,1,$3,$3)",
      [idolId, handle, time.at],
    );
  else {
    if (command.action === "RENAME_IDOL")
      await client.query(
        "INSERT INTO public.slug_redirects(id,entity_type,idol_id,old_handle,new_handle,created_at) VALUES($1,'IDOL',$2,$3,$4,$5)",
        [time.redirectId, idolId, prior?.["handle"], handle, time.at],
      );
    await client.query(
      "UPDATE public.idols SET handle=$2,status=$3,accepting_gifts=$4,version=version+1,updated_at=$5 WHERE id=$1 AND version=$6",
      [idolId, handle, status, accepting, time.at, command.expectedBaseVersion],
    );
  }
  return readIdentityReceipt(client, time.id, input.principal.actorId);
}

import {
  contentTimestampSchema,
  publicationRuntimeResponseSchema,
  publicationStatusResponseSchema,
  publicationManifestSchema,
  type PublicationRuntimeWriteCommand,
  type PublicationStatusCommand,
} from "@fan-support/contracts";
import { computePublicationManifestHash } from "@fan-support/content";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { baseContentFailure } from "./base-content-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import { PREFLIGHT_TABLES } from "./publication-preflight-mapping.js";
import { purgeJob } from "./publication-purge-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export async function publicationTime(
  client: TransactionClient,
  input: PublicationRuntimeWriteCommand,
  evaluatedAt: string,
  head: DraftRow | undefined,
) {
  const [row] = await draftRows(
    client,
    `WITH event_clock AS MATERIALIZED (SELECT GREATEST(clock_timestamp(),transaction_timestamp(),$1::timestamptz,$2::timestamptz,$3::timestamptz+interval '1 microsecond') AS event_time)
    SELECT gen_random_uuid() AS result_id,gen_random_uuid() AS manifest_id,gen_random_uuid() AS publication_id,gen_random_uuid() AS audit_id,
    ${utcTimestampSql("event_time")} AS now,to_jsonb(event_time) AS lifecycle_time FROM event_clock`,
    [input.principal.authorizedAt, evaluatedAt, head?.["updated_at"] ?? null],
  );
  if (!row) throw new Error("Publication event time unavailable");
  return {
    resultId: String(row["result_id"]),
    manifestId: String(row["manifest_id"]),
    publicationId: String(row["publication_id"]),
    auditId: String(row["audit_id"]),
    at: contentTimestampSchema.parse(row["now"]),
    lifecycleAt: contentTimestampSchema.parse(row["lifecycle_time"]),
  };
}
export async function writePublicationAudit(
  client: TransactionClient,
  entry: {
    id: string;
    actorId: string;
    action: string;
    subjectType: string;
    subjectId: string;
    requestId: string;
    reasonCode: string;
    at: string;
  },
) {
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
    VALUES($1,'ADMIN',$2,$3,$4,$5,$6,$7,$7,'SUCCEEDED','CONTENT_PUBLICATION',$8)`,
    [
      entry.id,
      entry.actorId,
      entry.action,
      entry.subjectType,
      entry.subjectId,
      entry.reasonCode,
      entry.requestId,
      entry.at,
    ],
  );
}
export async function readPublicationReceipt(
  client: TransactionClient,
  resultId: string,
  actorId: string,
) {
  const [row] = await draftRows(
    client,
    `SELECT to_jsonb(r.*) AS receipt,m.manifest,m.manifest_hash FROM public.content_publication_receipts r
    LEFT JOIN public.content_publication_manifests m ON m.id=r.manifest_id WHERE r.id=$1 AND r.actor_id=$2`,
    [resultId, actorId],
  );
  if (!row) return baseContentFailure("NOT_FOUND");
  const receipt = row["receipt"] as DraftRow;
  if (receipt["action"] === "RETRY_PURGE")
    return publicationRuntimeResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PURGE_RETRY",
      resultId,
      publicationId: receipt["publication_id"],
      purgeJobId: receipt["purge_job_id"],
      generation: Number(receipt["result_generation"]),
      version: Number(receipt["result_version"]),
      replayed: false,
    });
  const manifest = publicationManifestSchema.parse(row["manifest"]);
  if (computePublicationManifestHash(manifest) !== row["manifest_hash"])
    return baseContentFailure("CONTENT_UNAVAILABLE");
  return publicationRuntimeResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PUBLICATION_MUTATION",
    resultId,
    action: receipt["action"],
    target: manifest.target,
    headVersion: Number(receipt["result_head_version"]),
    contentHash: receipt["result_content_hash"],
    publicationId: receipt["publication_id"],
    manifestHash:
      receipt["action"] === "VALIDATE" ? null : row["manifest_hash"],
    replayed: false,
  });
}
export async function readPublicationStatus(
  client: TransactionClient,
  command: PublicationStatusCommand,
) {
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const [row] = await draftRows(
    client,
    `SELECT ${utcTimestampSql("p.published_at")} AS published_at,p.content_type,m.manifest,m.manifest_hash,r.result_head_version
    FROM public.content_publications p JOIN public.content_publication_manifests m ON m.publication_id=p.id
    JOIN public.content_publication_receipts r ON r.publication_id=p.id AND r.action IN ('PUBLISH','ROLLBACK') WHERE p.id=$1 AND p.proof_version=2`,
    [command.publicationId],
  );
  if (!row) return baseContentFailure("NOT_FOUND");
  const manifest = publicationManifestSchema.parse(row["manifest"]);
  if (computePublicationManifestHash(manifest) !== row["manifest_hash"])
    return baseContentFailure("CONTENT_UNAVAILABLE");
  const table = PREFLIGHT_TABLES[manifest.target.owner.kind];
  const [head] = await draftRows(
    client,
    `SELECT EXISTS(SELECT 1 FROM public.${table.heads} WHERE publication_id=$1) AS current`,
    [command.publicationId],
  );
  const jobs = await draftRows(
    client,
    "SELECT to_jsonb(j.*) AS job FROM public.content_purge_jobs j WHERE publication_id=$1 ORDER BY locale,generation",
    [command.publicationId],
  );
  return publicationStatusResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PUBLICATION_STATUS",
    publicationId: command.publicationId,
    target: manifest.target,
    headVersion: Number(row["result_head_version"]),
    manifestHash: row["manifest_hash"],
    publishedAt: contentTimestampSchema.parse(row["published_at"]),
    isCurrent: head?.["current"] === true,
    jobs: jobs.map((entry) => purgeJob(entry["job"] as DraftRow)),
  });
}

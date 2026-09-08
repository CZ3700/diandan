import { createHash, randomUUID } from "node:crypto";
import {
  contentAuthoringTargetSchema,
  type DailyPublicationDocument,
  type ManagementCenterClaim,
} from "@fan-support/contracts";
import {
  buildDailyPublicationManifest,
  computeDailyPublicationManifestHash,
} from "@fan-support/content";
import { writePublishedDailyIdolSearchProjection } from "./catalog-search-projection.js";
import { draftRows } from "./content-draft-data.js";
import { dailyManifestText } from "./daily-publication-data.js";
import { loadDailyMedia } from "./daily-publication-media.js";
import { loadDailyPublicationContext } from "./daily-publication-read.js";
import { writePublicationAudit } from "./publication-runtime-data.js";
import { publicationPurgePaths } from "./publication-runtime-write.js";
import { PREFLIGHT_TABLES } from "./publication-preflight-mapping.js";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import type { TransactionClient } from "./transaction-runner.js";

/** A daily event is a separate immutable proof namespace; the existing head/outbox invariants still execute. */
export async function publishDailyDocument(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  document: DailyPublicationDocument,
  publicMediaBaseUrl: string,
  time: string,
  expectedBaseVersion: number | null,
) {
  const owner = contentAuthoringTargetSchema.parse({
    kind: document.kind,
    ...(document.kind === "IDOL"
      ? { idolId: document.ownerId }
      : document.kind === "GIFT"
        ? { giftId: document.ownerId }
        : document.kind === "MEDIA_METADATA"
          ? { mediaAssetId: document.ownerId }
          : {}),
  });
  const table = PREFLIGHT_TABLES[owner.kind];
  const [head] = await draftRows(
    client,
    `SELECT * FROM public.${table.heads} WHERE ${table.owner ? `${table.owner}=$1` : "true"} FOR UPDATE`,
    table.owner ? [document.ownerId] : [],
  );
  const headVersion = (head ? Number(head["version"]) : 0) + 1;
  const media = await loadDailyMedia(client, document, publicMediaBaseUrl);
  const manifest = buildDailyPublicationManifest({
    operationId: claim.operation.operationId,
    actorId: claim.actorId,
    document,
    media,
  });
  const publicationId = randomUUID(),
    auditId = randomUUID();
  const manifestHash = computeDailyPublicationManifestHash(manifest);
  const baseVersion =
    expectedBaseVersion === null
      ? null
      : expectedBaseVersion + (expectedBaseVersion === 0 ? 2 : 1);
  await writePublicationAudit(client, {
    id: auditId,
    actorId: claim.actorId,
    action: "CONTENT_PUBLISH",
    subjectType: "CONTENT_PUBLICATION",
    subjectId: publicationId,
    requestId: claim.requestId,
    reasonCode: "DIRECT_OPERATOR_V1",
    at: time,
  });
  await client.query(
    `INSERT INTO public.daily_publication_manifests(publication_id,revision_id,operation_id,actor_id,session_id,audit_log_id,head_version,expected_base_version,result_base_version,manifest_text,manifest_hash,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      publicationId,
      document.revisionId,
      claim.operation.operationId,
      claim.actorId,
      claim.sessionId,
      auditId,
      headVersion,
      expectedBaseVersion,
      baseVersion,
      dailyManifestText(manifest),
      manifestHash,
      time,
    ],
  );
  await writePublishedDailyIdolSearchProjection(client, manifest);
  const revisionTable = `${document.kind.toLowerCase()}_revisions`;
  if (head)
    await client.query(
      `UPDATE public.${revisionTable} SET lifecycle='SUPERSEDED',superseded_at=$2 WHERE id=$1 AND lifecycle='PUBLISHED'`,
      [head[table.parent], time],
    );
  await client.query(
    `UPDATE public.${revisionTable} SET lifecycle='VALIDATED',validated_at=$2 WHERE id=$1 AND lifecycle='DRAFT'`,
    [document.revisionId, time],
  );
  await client.query(
    `UPDATE public.${revisionTable} SET lifecycle='PUBLISHED',published_at=$2 WHERE id=$1 AND lifecycle='VALIDATED'`,
    [document.revisionId, time],
  );
  const values = [
    publicationId,
    document.kind,
    document.revisionId,
    ...(table.owner ? [document.ownerId] : []),
    head?.["publication_id"] ?? null,
    document.source.sourceHash,
    createHash("sha256")
      .update(`DIRECT_OPERATOR_V1:${claim.operation.operationId}`)
      .digest("hex"),
    manifestHash,
    claim.actorId,
    time,
    `daily-publication:${publicationId}`,
    auditId,
  ];
  await client.query(
    `INSERT INTO public.content_publications(id,content_type,${table.parent}${table.owner ? `,${table.owner}` : ""},replaces_publication_id,translation_manifest_hash,approval_manifest_hash,media_manifest_hash,published_by,published_at,idempotency_key,audit_log_id,action,proof_version) VALUES(${values.map((_, i) => `$${i + 1}`).join(",")},'PUBLISH',3)`,
    values,
  );
  if (head)
    await client.query(
      `UPDATE public.${table.heads} SET publication_id=$2,${table.parent}=$3,version=version+1,updated_at=$4 WHERE id=$1 AND version=$5`,
      [head["id"], publicationId, document.revisionId, time, headVersion - 1],
    );
  else {
    const params = [
      publicationId,
      document.revisionId,
      ...(table.owner ? [document.ownerId] : []),
      time,
    ];
    await client.query(
      `INSERT INTO public.${table.heads}(id,publication_id,${table.parent}${table.owner ? `,${table.owner}` : ""},version,created_at,updated_at) VALUES(gen_random_uuid(),${params
        .slice(0, -1)
        .map((_, i) => `$${i + 1}`)
        .join(",")},1,$${params.length},$${params.length})`,
      params,
    );
  }
  if (document.kind === "IDOL" || document.kind === "GIFT")
    await client.query(
      `UPDATE public.${document.kind === "IDOL" ? "idols" : "gifts"} SET published_revision_id=$2,draft_revision_id=NULL,status='active',${document.kind === "IDOL" ? "accepting_gifts=true," : ""}version=version+1,updated_at=$3 WHERE id=$1`,
      [document.ownerId, document.revisionId, time],
    );
  for (const locale of SUPPORTED_LOCALES) {
    const [event] = await draftRows(
      client,
      `INSERT INTO public.outbox_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,primary_subject_id,secondary_subject_id,locale,idempotency_key,request_id,correlation_id,occurred_at,available_at,created_at) VALUES(gen_random_uuid(),'CONTENT_PUBLICATION_CHANGED','CONTENT_PUBLICATION',$1::uuid,1,$1::uuid,$2::uuid,$3::public.supported_locale,$4,$5::uuid,$5::uuid,$6::timestamptz,$6::timestamptz,$6::timestamptz) RETURNING id`,
      [
        publicationId,
        document.revisionId,
        locale,
        `content-publication:${publicationId}:${locale}`,
        claim.requestId,
        time,
      ],
    );
    if (!event) throw new Error("Daily publication event unavailable");
    await client.query(
      `INSERT INTO public.content_purge_jobs(id,publication_id,outbox_event_id,locale,paths,created_at,updated_at,next_attempt_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$5,$5)`,
      [
        publicationId,
        event["id"],
        locale,
        publicationPurgePaths(
          { owner, revisionId: document.revisionId },
          locale,
        ),
        time,
      ],
    );
  }
  const [stored] = await draftRows(
    client,
    `SELECT to_jsonb(p.*) publication,to_jsonb(h.*) head FROM public.content_publications p JOIN public.${table.heads} h ON h.publication_id=p.id WHERE p.id=$1`,
    [publicationId],
  );
  if (!stored) throw new Error("Daily committed candidate unavailable");
  const loaded = await loadDailyPublicationContext(
    client,
    owner,
    claim.intent.sourceLocale,
    stored["publication"] as Record<string, unknown>,
    stored["head"] as Record<string, unknown>,
    publicMediaBaseUrl,
  );
  if (loaded.outcome !== "SUCCESS")
    throw new Error("Daily public proof verification failed");
  return {
    publicationId,
    revisionId: document.revisionId,
    headVersion,
    publishedAt: time,
    baseVersion,
  };
}

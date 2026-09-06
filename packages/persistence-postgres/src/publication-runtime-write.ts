import { createHash } from "node:crypto";
import {
  SUPPORTED_LOCALES,
  sourceHashSchema,
  contentAuthoringSnapshotSchema,
  type PublicationRuntimeWriteCommand,
  type SupportedLocale,
  type PublicationPreflightTarget,
} from "@fan-support/contracts";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
  computePublicationManifestSectionHashes,
  computeContentAuthoringSnapshotHash,
  evaluatePublicationPreflight,
  serializePublicationManifest,
  verifyPublicationManifest,
} from "@fan-support/content";
import { draftRows } from "./content-draft-data.js";
import { baseContentFailure } from "./base-content-data.js";
import { PREFLIGHT_TABLES } from "./publication-preflight-mapping.js";
import { AUTHORING_TABLES, ownerValue } from "./content-authoring-model.js";
import { writePublishedIdolSearchProjections } from "./catalog-search-projection.js";
import {
  loadPublicationRuntime,
  publicationHead,
} from "./publication-runtime-load.js";
import {
  publicationTime,
  readPublicationReceipt,
  writePublicationAudit,
} from "./publication-runtime-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

export function publicationPurgePaths(
  target: PublicationPreflightTarget,
  locale: SupportedLocale,
): string[] {
  const root = `/${locale}`,
    paths = [`${root}/sitemap.xml`];
  switch (target.owner.kind) {
    case "HOMEPAGE":
      paths.push(root);
      break;
    case "POLICY":
      paths.push(`${root}/policies/${target.owner.policyKey}*`);
      break;
    case "MEDIA_METADATA":
      paths.push(
        root,
        `${root}/idols*`,
        `${root}/gifts*`,
        `${root}/media/${target.owner.mediaAssetId.toLowerCase()}*`,
      );
      break;
    default:
      paths.push(root, `${root}/idols*`, `${root}/gifts*`);
  }
  return paths.sort();
}
const blocked = (
  code: "MANIFEST_MISMATCH" | "MEDIA_METADATA_PUBLICATION_REQUIRED",
) => ({
  schemaVersion: 1 as const,
  outcome: "FAILURE" as const,
  code: "PUBLICATION_BLOCKED" as const,
  issues: [{ code, severity: "BLOCKER" as const, path: ["manifest"] }],
});

/** Persists the Application's manifest only after comparing it with the same locked canonical facts. */
export async function writePublicationRuntime(
  client: TransactionClient,
  scope: TransactionScopeControl,
  input: PublicationRuntimeWriteCommand,
) {
  const command = input.command,
    action = command.action === "ROLLBACK" ? "ROLLBACK" : "PUBLISH";
  const loaded = await loadPublicationRuntime(client, scope, {
    schemaVersion: 1,
    target: command.target,
    action,
  });
  if (loaded.outcome === "FAILURE") return loaded;
  const context = loaded.context,
    canonical = context.preflight,
    snapshot = canonical.snapshot;
  if (canonical.headVersion !== command.expectedVersion)
    return baseContentFailure("STALE_VERSION");
  if (snapshot.contentHash !== command.expectedContentHash)
    return baseContentFailure("STALE_CONTENT");
  if (command.action === "VALIDATE") {
    const [authoring] = await draftRows(
      client,
      "SELECT id FROM public.content_authoring_receipts WHERE coalesce(idol_revision_id,gift_revision_id,homepage_revision_id,policy_revision_id,media_metadata_revision_id)=$1",
      [snapshot.revisionId],
    );
    if (!authoring) return baseContentFailure("INVALID_REVIEW_STATE");
  }
  const gate = evaluatePublicationPreflight(canonical);
  if (gate.outcome === "FAILURE") return gate;
  if (!gate.ready)
    return {
      schemaVersion: 1 as const,
      outcome: "FAILURE" as const,
      code: "PUBLICATION_BLOCKED" as const,
      issues: gate.issues,
    };
  if (command.action === "VALIDATE" && snapshot.lifecycle.status !== "DRAFT")
    return baseContentFailure("REVISION_NOT_DRAFT");
  if (
    (command.action === "PUBLISH" &&
      snapshot.lifecycle.status !== "VALIDATED") ||
    (command.action === "ROLLBACK" &&
      snapshot.lifecycle.status !== "SUPERSEDED")
  )
    return baseContentFailure("INVALID_REVIEW_STATE");
  if (
    canonical.mediaSnapshots.some(
      (media) =>
        !["PUBLISHED", "SUPERSEDED"].includes(media.lifecycle.status) ||
        !context.mediaPublications.some(
          (publication) => publication.revisionId === media.revisionId,
        ),
    )
  )
    return blocked("MEDIA_METADATA_PUBLICATION_REQUIRED");
  const expected =
    command.action === "ROLLBACK" && context.previousManifest
      ? context.previousManifest
      : buildPublicationManifest(canonical);
  if (
    !verifyPublicationManifest(expected, canonical) ||
    computePublicationManifestHash(input.manifest) !== input.manifestHash ||
    serializePublicationManifest(input.manifest) !==
      serializePublicationManifest(expected)
  )
    return blocked("MANIFEST_MISMATCH");
  const head = await publicationHead(client, canonical.target),
    table = PREFLIGHT_TABLES[snapshot.target.kind],
    base = AUTHORING_TABLES[snapshot.target.kind];
  if ((head ? Number(head["version"]) : 0) !== command.expectedVersion)
    return baseContentFailure("STALE_VERSION");
  const time = await publicationTime(
      client,
      input,
      canonical.evaluatedAt,
      head,
    ),
    publishing = command.action !== "VALIDATE";
  const [session] = await draftRows(
    client,
    "SELECT expires_at>clock_timestamp() AND expires_at>$2::timestamptz AND revoked_at IS NULL AND authenticated_with_mfa AND admin_identity_id=$3::uuid AS valid FROM public.admin_sessions WHERE id=$1 FOR SHARE",
    [input.principal.sessionId, time.at, input.principal.actorId],
  );
  if (session?.["valid"] !== true) return baseContentFailure("UNAUTHENTICATED");
  let lifecycle = snapshot.lifecycle;
  if (command.action === "VALIDATE")
    lifecycle = { status: "VALIDATED", validatedAt: time.lifecycleAt };
  else if (command.action === "PUBLISH") {
    if (snapshot.lifecycle.status !== "VALIDATED")
      throw new Error("Publication lifecycle changed after locking");
    lifecycle = {
      ...snapshot.lifecycle,
      status: "PUBLISHED",
      publishedAt: time.lifecycleAt,
    };
  }
  const contentHash = sourceHashSchema.parse(
    computeContentAuthoringSnapshotHash(
      contentAuthoringSnapshotSchema.parse({ ...snapshot, lifecycle }),
    ),
  );
  const sections = computePublicationManifestSectionHashes(input.manifest),
    mediaHash =
      snapshot.target.kind === "POLICY" ? null : sections.mediaManifestHash;
  await writePublicationAudit(client, {
    id: time.auditId,
    actorId: input.principal.actorId,
    action: `CONTENT_${command.action}`,
    subjectType: publishing ? "CONTENT_PUBLICATION" : "CONTENT_VALIDATION",
    subjectId: publishing ? time.publicationId : time.resultId,
    requestId: input.requestId,
    reasonCode: command.reasonCode,
    at: time.at,
  });
  await client.query(
    `INSERT INTO public.content_publication_manifests(id,publication_id,${table.parent},manifest_text,manifest_hash,translation_manifest_hash,approval_manifest_hash,media_manifest_hash,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      time.manifestId,
      publishing ? time.publicationId : null,
      snapshot.revisionId,
      serializePublicationManifest(input.manifest),
      input.manifestHash,
      sections.translationManifestHash,
      sections.approvalManifestHash,
      mediaHash,
      time.at,
    ],
  );
  await client.query(
    `INSERT INTO public.content_publication_receipts(id,action,actor_id,session_id,audit_log_id,manifest_id,publication_id,expected_version,expected_content_hash,result_head_version,result_content_hash,created_at,field_paths)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      time.resultId,
      command.action,
      input.principal.actorId,
      input.principal.sessionId,
      time.auditId,
      time.manifestId,
      publishing ? time.publicationId : null,
      command.expectedVersion,
      command.expectedContentHash,
      command.expectedVersion + (publishing ? 1 : 0),
      contentHash,
      time.at,
      publishing
        ? ["lifecycle", "publication", "searchProjection", "cachePurge"]
        : ["lifecycle"],
    ],
  );
  if (command.action === "VALIDATE") {
    await client.query(
      `UPDATE public.${base.revisions} SET lifecycle='VALIDATED',validated_at=$2 WHERE id=$1 AND lifecycle='DRAFT'`,
      [snapshot.revisionId, time.at],
    );
    return readPublicationReceipt(
      client,
      time.resultId,
      input.principal.actorId,
    );
  }
  if (head)
    await client.query(
      `UPDATE public.${base.revisions} SET lifecycle='SUPERSEDED',superseded_at=$2 WHERE id=$1 AND lifecycle='PUBLISHED'`,
      [head[table.parent], time.at],
    );
  if (command.action === "PUBLISH")
    await client.query(
      `UPDATE public.${base.revisions} SET lifecycle='PUBLISHED',published_at=$2 WHERE id=$1 AND lifecycle='VALIDATED'`,
      [snapshot.revisionId, time.at],
    );
  const databaseKey = createHash("sha256")
    .update(
      `fan-support.publication-event.v1\n${input.principal.actorId}\n${command.action}\n${time.resultId}`,
    )
    .digest("hex");
  const owner = ownerValue(snapshot.target);
  const publicationValues = [
    time.publicationId,
    snapshot.target.kind,
    snapshot.revisionId,
    ...(table.owner ? [owner] : []),
    command.action,
    head?.["publication_id"] ?? null,
    sections.translationManifestHash,
    sections.approvalManifestHash,
    mediaHash,
    input.principal.actorId,
    time.at,
    `publication:${databaseKey}`,
    time.auditId,
  ];
  await client.query(
    `INSERT INTO public.content_publications(id,content_type,${table.parent}${table.owner ? `,${table.owner}` : ""},action,replaces_publication_id,translation_manifest_hash,approval_manifest_hash,media_manifest_hash,published_by,published_at,idempotency_key,audit_log_id)
    VALUES(${publicationValues.map((_, index) => `$${index + 1}`).join(",")})`,
    publicationValues,
  );
  if (head)
    await client.query(
      `UPDATE public.${table.heads} SET publication_id=$2,${table.parent}=$3,version=version+1,updated_at=$4 WHERE id=$1 AND version=$5`,
      [
        head["id"],
        time.publicationId,
        snapshot.revisionId,
        time.at,
        command.expectedVersion,
      ],
    );
  else {
    const headValues = [
      time.publicationId,
      snapshot.revisionId,
      ...(table.owner ? [owner] : []),
      1,
      time.at,
      time.at,
    ];
    await client.query(
      `INSERT INTO public.${table.heads}(id,publication_id,${table.parent}${table.owner ? `,${table.owner}` : ""},version,created_at,updated_at)
      VALUES(gen_random_uuid(),${headValues.map((_, index) => `$${index + 1}`).join(",")})`,
      headValues,
    );
  }
  if (snapshot.target.kind === "IDOL" || snapshot.target.kind === "GIFT") {
    const candidate = canonical.candidate;
    if (
      (candidate.objectKind !== "IDOL" && candidate.objectKind !== "GIFT") ||
      candidate.objectKind !== snapshot.target.kind
    )
      throw new Error("Publication owner mismatch");
    await client.query(
      `UPDATE public.${base.ownerTable} SET published_revision_id=$2,status=$3,version=version+1,updated_at=$4 WHERE id=$1`,
      [owner, snapshot.revisionId, candidate.targetOperationalStatus, time.at],
    );
  }
  await writePublishedIdolSearchProjections(client, input.manifest);
  for (const locale of SUPPORTED_LOCALES) {
    const [event] = await draftRows(
      client,
      `INSERT INTO public.outbox_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,primary_subject_id,secondary_subject_id,locale,idempotency_key,request_id,correlation_id,occurred_at,available_at,created_at)
      VALUES(gen_random_uuid(),'CONTENT_PUBLICATION_CHANGED','CONTENT_PUBLICATION',$1::uuid,1,$1::uuid,$2::uuid,$3::public.supported_locale,$4,$5::uuid,$5::uuid,$6::timestamptz,$6::timestamptz,$6::timestamptz) RETURNING id`,
      [
        time.publicationId,
        snapshot.revisionId,
        locale,
        `content-publication:${time.publicationId}:${locale}`,
        input.requestId,
        time.at,
      ],
    );
    await client.query(
      `INSERT INTO public.content_purge_jobs(id,publication_id,outbox_event_id,locale,paths,created_at,updated_at,next_attempt_at)
      VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$5,$5)`,
      [
        time.publicationId,
        event?.["id"],
        locale,
        publicationPurgePaths(canonical.target, locale),
        time.at,
      ],
    );
  }
  return readPublicationReceipt(client, time.resultId, input.principal.actorId);
}

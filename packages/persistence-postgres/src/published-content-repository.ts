import {
  contentAuthoringTargetSchema,
  publishedContentReadCommandSchema,
  publishedContentContextSchema,
  publicationManifestSchema,
  publicationManifestRecordSchema,
  publicMediaUrlSchema,
  type PublishedContentReadCommand,
  type PublishedContentFailure,
  type PublishedContentContextResponse,
  type ContentAuthoringTarget,
} from "@fan-support/contracts";
import {
  serializePublicationManifest,
  computePublicationManifestHash,
} from "@fan-support/content";
import type { PublishedContentRepository } from "@fan-support/persistence-port";
import { createPublicationPreflightRepository } from "./publication-preflight-repository.js";
import { PREFLIGHT_TABLES } from "./publication-preflight-mapping.js";
import { ownerValue } from "./content-authoring-model.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { hasPublishedMediaProof } from "./published-content-media-proof.js";
import { readGiftPublicationProfile } from "./gift-commerce-gift-profile.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

function failure(
  code: PublishedContentFailure["code"],
): PublishedContentFailure {
  return { schemaVersion: 1, outcome: "FAILURE", code };
}
function baseUrl(input: string): URL {
  try {
    const value = new URL(publicMediaUrlSchema.parse(input));
    if (value.search || value.hash) throw new Error("Invalid origin");
    if (!value.pathname.endsWith("/")) value.pathname += "/";
    return value;
  } catch {
    throw new TypeError("Invalid public media configuration");
  }
}
async function resolveOwner(
  client: TransactionClient,
  command: PublishedContentReadCommand,
): Promise<ContentAuthoringTarget | undefined> {
  const locator = command.locator;
  if (locator.kind === "IDOL" || locator.kind === "GIFT") {
    const [row] = await draftRows(
      client,
      `SELECT id FROM public.${locator.kind === "IDOL" ? "idols" : "gifts"} WHERE handle=$1`,
      [locator.handle],
    );
    if (!row) return undefined;
    return contentAuthoringTargetSchema.parse({
      kind: locator.kind,
      [locator.kind === "IDOL" ? "idolId" : "giftId"]: row["id"],
    });
  }
  return contentAuthoringTargetSchema.parse(locator);
}
/** The caller owns the consistent transaction used by discovery or the public application read. */
export async function loadPublishedContentContext(
  client: TransactionClient,
  scope: TransactionScopeControl,
  input: PublishedContentReadCommand,
  publicMediaBaseUrl: string,
): Promise<PublishedContentContextResponse> {
  const parsed = publishedContentReadCommandSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_QUERY");
  const command = parsed.data,
    base = baseUrl(publicMediaBaseUrl);
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const owner = await resolveOwner(client, command);
  if (!owner) return failure("NOT_FOUND");
  const table = PREFLIGHT_TABLES[owner.kind];
  const rows = await draftRows(
    client,
    `SELECT to_jsonb(h.*) AS head,to_jsonb(p.*) AS publication,m.manifest,m.manifest_text,m.manifest_hash,r.result_head_version
    FROM public.${table.heads} h JOIN public.content_publications p ON p.id=h.publication_id
      AND p.${table.parent}=h.${table.parent} AND p.content_type=$1
      ${table.owner === null ? "" : `AND p.${table.owner}=h.${table.owner}`}
    LEFT JOIN public.content_publication_manifests m ON m.publication_id=p.id
    LEFT JOIN public.content_publication_receipts r ON r.manifest_id=m.id AND r.publication_id=p.id AND r.action=p.action
    WHERE ${table.owner === null ? "true" : `h.${table.owner}=$2`}`,
    table.owner === null ? [owner.kind] : [owner.kind, ownerValue(owner)],
  );
  if (rows.length === 0) return failure("NOT_FOUND");
  if (rows.length !== 1) return failure("CONTENT_UNAVAILABLE");
  const row = rows[0]!,
    publication = row["publication"] as DraftRow | undefined,
    head = row["head"] as DraftRow | undefined;
  if (publication?.["proof_version"] === 1) return failure("NOT_FOUND");
  if (publication?.["proof_version"] !== 2 || !head)
    return failure("CONTENT_UNAVAILABLE");
  const manifest = publicationManifestSchema.safeParse(row["manifest"]);
  if (
    !manifest.success ||
    serializePublicationManifest(manifest.data) !== row["manifest_text"] ||
    computePublicationManifestHash(manifest.data) !== row["manifest_hash"]
  )
    return failure("CONTENT_UNAVAILABLE");
  const record = publicationManifestRecordSchema.safeParse({
    schemaVersion: 1,
    publicationId: publication["id"],
    target: { owner, revisionId: head[table.parent] },
    action: publication["action"],
    publishedAt: publication["published_at"],
    headVersion: Number(row["result_head_version"]),
    manifestHash: row["manifest_hash"],
    manifest: manifest.data,
  });
  if (!record.success || Number(head["version"]) !== record.data.headVersion)
    return failure("CONTENT_UNAVAILABLE");
  if (owner.kind === "GIFT")
    await readGiftPublicationProfile(client, {
      publicationId: record.data.publicationId,
      giftId: owner.giftId,
      giftRevisionId: record.data.target.revisionId,
      manifestHash: record.data.manifestHash,
    });
  const loaded = await createPublicationPreflightRepository(client, scope).load(
    {
      schemaVersion: 1,
      action: record.data.action,
      target: record.data.target,
    },
  );
  if (loaded.outcome === "FAILURE")
    return failure(
      loaded.code === "NOT_FOUND" ? "NOT_FOUND" : "CONTENT_UNAVAILABLE",
    );
  const canonical = loaded.context,
    candidate = canonical.candidate;
  const snapshots =
    candidate.objectKind === "MEDIA_METADATA"
      ? [canonical.snapshot]
      : canonical.mediaSnapshots;
  const references = [];
  for (const snapshot of snapshots) {
    if (snapshot.target.kind !== "MEDIA_METADATA")
      return failure("CONTENT_UNAVAILABLE");
    references.push({
      revisionId: snapshot.revisionId,
      mediaAssetId: snapshot.target.mediaAssetId,
    });
  }
  if (!(await hasPublishedMediaProof(client, references)))
    return failure("CONTENT_UNAVAILABLE");
  const variants =
    candidate.objectKind === "POLICY"
      ? []
      : candidate.objectKind === "MEDIA_METADATA"
        ? candidate.variants
        : candidate.mediaVariants;
  const media = [];
  for (const snapshot of snapshots) {
    if (snapshot.target.kind !== "MEDIA_METADATA")
      return failure("CONTENT_UNAVAILABLE");
    const assetId = snapshot.target.mediaAssetId;
    const variant = variants
      .filter(
        (item) =>
          item.mediaAssetId === assetId &&
          item.status === "READY" &&
          manifest.data.media.variants.some((proof) => proof.id === item.id),
      )
      .toSorted(
        (a, b) =>
          b.width - a.width ||
          b.height - a.height ||
          (a.format === "WEBP"
            ? -1
            : b.format === "WEBP"
              ? 1
              : a.id.localeCompare(b.id)),
      )[0];
    if (!variant) return failure("CONTENT_UNAVAILABLE");
    media.push({
      mediaAssetId: assetId,
      mediaMetadataRevisionId: snapshot.revisionId,
      mediaVariantId: variant.id,
      url: new URL(variant.objectKey, base).href,
    });
  }
  const context = publishedContentContextSchema.safeParse({
    schemaVersion: 1,
    locale: command.locale,
    publication: record.data,
    canonical,
    media,
  });
  return context.success
    ? { schemaVersion: 1, outcome: "SUCCESS", context: context.data }
    : failure("CONTENT_UNAVAILABLE");
}
export function createPublishedContentRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl: string,
): PublishedContentRepository {
  const base = baseUrl(publicMediaBaseUrl).href;
  return {
    load: (command) =>
      scope.trackOperation(async () => {
        try {
          return await loadPublishedContentContext(
            client,
            scope,
            command,
            base,
          );
        } catch (error) {
          throw persistenceTransactionFailureFromPostgres(error);
        }
      }),
  };
}

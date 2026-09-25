import {
  publicationManifestSchema,
  publicationRuntimeContextResponseSchema,
  type PublicationPreflightCommand,
} from "@fan-support/contracts";
import { computePublicationManifestHash } from "@fan-support/content";
import { createPublicationPreflightRepository } from "./publication-preflight-repository.js";
import { ownerValue } from "./content-authoring-model.js";
import { PREFLIGHT_TABLES } from "./publication-preflight-mapping.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { baseContentFailure } from "./base-content-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

export async function loadPublicationRuntime(
  client: TransactionClient,
  scope: TransactionScopeControl,
  command: PublicationPreflightCommand,
) {
  const result = await createPublicationPreflightRepository(client, scope).load(
    command,
  );
  if (result.outcome === "FAILURE") return result;
  const context = result.context,
    table = PREFLIGHT_TABLES[context.target.owner.kind];
  const history = await draftRows(
    client,
    `SELECT p.proof_version,m.manifest,m.manifest_hash FROM public.content_publications p
    LEFT JOIN public.content_publication_manifests m ON m.publication_id=p.id WHERE p.${table.parent}=$1 ORDER BY p.published_at DESC,p.id`,
    [context.target.revisionId],
  );
  let previousManifest = null;
  for (const row of history) {
    if (row["proof_version"] !== 2) continue;
    const parsed = publicationManifestSchema.safeParse(row["manifest"]);
    if (
      !parsed.success ||
      computePublicationManifestHash(parsed.data) !== row["manifest_hash"]
    )
      return baseContentFailure("CONTENT_UNAVAILABLE");
    previousManifest ??= parsed.data;
  }
  const mediaPublications: {
    mediaAssetId: string;
    revisionId: string;
    publicationId: string;
  }[] = [];
  for (const snapshot of context.mediaSnapshots) {
    const [publication] = await draftRows(
      client,
      `SELECT p.id,p.media_asset_id,p.proof_version,m.manifest,m.manifest_hash FROM public.content_publications p
      LEFT JOIN public.content_publication_manifests m ON m.publication_id=p.id WHERE p.media_metadata_revision_id=$1 ORDER BY p.published_at DESC,p.id LIMIT 1`,
      [snapshot.revisionId],
    );
    if (!publication) continue;
    if (publication["proof_version"] === 2) {
      const parsed = publicationManifestSchema.safeParse(
        publication["manifest"],
      );
      if (
        !parsed.success ||
        computePublicationManifestHash(parsed.data) !==
          publication["manifest_hash"]
      )
        return baseContentFailure("CONTENT_UNAVAILABLE");
    }
    mediaPublications.push({
      mediaAssetId: String(publication["media_asset_id"]),
      revisionId: snapshot.revisionId,
      publicationId: String(publication["id"]),
    });
  }
  return publicationRuntimeContextResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    context: {
      schemaVersion: 1,
      preflight: context,
      previousManifest,
      mediaPublications,
    },
  });
}

export async function publicationHead(
  client: TransactionClient,
  target: PublicationPreflightCommand["target"],
) {
  const table = PREFLIGHT_TABLES[target.owner.kind];
  const value = ownerValue(target.owner);
  const [row] = await draftRows(
    client,
    `SELECT to_jsonb(h.*) AS head FROM public.${table.heads} h WHERE ${table.owner === null ? "true" : `${table.owner}=$1`} FOR UPDATE`,
    table.owner === null ? [] : [value],
  );
  return row?.["head"] as DraftRow | undefined;
}

import type { TransactionClient } from "./transaction-runner.js";
import { catalogRecord, catalogRows } from "./catalog-publication-mapper.js";

/** Referenced historical metadata may use legacy proof; every v2 ledger event needs its exact immutable receipt. */
export async function hasPublishedMediaProof(
  client: Pick<TransactionClient, "query">,
  references: readonly { revisionId: string; mediaAssetId: string }[],
): Promise<boolean> {
  if (references.length === 0) return true;
  const result = await client.query(
    `SELECT metadata.id AS revision_id,metadata.media_asset_id
    FROM public.media_metadata_revisions metadata WHERE metadata.id=ANY($1::uuid[])
      AND metadata.lifecycle IN ('PUBLISHED','SUPERSEDED')
      AND EXISTS(SELECT 1 FROM public.content_publications p
        LEFT JOIN public.content_publication_manifests proof ON proof.publication_id=p.id
        LEFT JOIN public.content_publication_receipts receipt ON receipt.manifest_id=proof.id AND receipt.publication_id=p.id
        WHERE p.content_type='MEDIA_METADATA' AND p.media_metadata_revision_id=metadata.id AND p.media_asset_id=metadata.media_asset_id
          AND (p.proof_version=1 OR (p.proof_version=2 AND proof.media_metadata_revision_id=metadata.id
            AND proof.manifest->'target'->>'revisionId'=metadata.id::text
            AND proof.manifest->'target'->'owner'->>'kind'='MEDIA_METADATA'
            AND proof.manifest->'target'->'owner'->>'mediaAssetId'=metadata.media_asset_id::text
            AND proof.manifest_text=public.canonical_publication_json(proof.manifest)
            AND proof.manifest_hash=encode(sha256(convert_to(E'fan-support.publication-manifest.v1\\n'||proof.manifest_text,'UTF8')),'hex')
            AND receipt.action=p.action AND receipt.actor_id=p.published_by AND receipt.audit_log_id=p.audit_log_id
            AND receipt.created_at=p.published_at AND receipt.result_head_version>0)))`,
    [references.map((row) => row.revisionId)],
  );
  const rows = catalogRows(catalogRecord(result)["rows"]);
  return (
    rows.length === references.length &&
    references.every(
      (ref) =>
        rows.filter(
          (row) =>
            row["revision_id"] === ref.revisionId &&
            row["media_asset_id"] === ref.mediaAssetId,
        ).length === 1,
    )
  );
}

import { createHash, randomUUID } from "node:crypto";
import { approvePreflightBase } from "../../../packages/persistence-postgres/scripts/postgres-publication-preflight-fixtures.mjs";

/** Independent synthetic historical asset avoids changing the five-kind fixture parents' dependencies. */
export async function withIndependentPublicationMedia(
  client,
  persistence,
  fixtures,
) {
  const id = randomUUID();
  const checksum = (label) =>
    createHash("sha256")
      .update(`publication-fixture:${id}:${label}`)
      .digest("hex");
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO public.media_assets(id,checksum_sha256,mime_type,width,height,byte_size,object_key,processing_status,rights_status,rights_reference,created_at)
      SELECT $1,$2,mime_type,width,height,byte_size,$3,processing_status,rights_status,rights_reference,created_at FROM public.media_assets WHERE id=$4`,
      [
        id,
        checksum("source"),
        `publication-fixture/${id}/source.webp`,
        fixtures.targets.media.mediaAssetId,
      ],
    );
    const variants = (
      await client.query(
        "SELECT * FROM public.media_variants WHERE media_asset_id=$1 ORDER BY format,width,height",
        [fixtures.targets.media.mediaAssetId],
      )
    ).rows;
    for (const variant of variants)
      await client.query(
        `INSERT INTO public.media_variants(id,media_asset_id,format,width,height,byte_size,checksum_sha256,object_key,status,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          randomUUID(),
          id,
          variant.format,
          variant.width,
          variant.height,
          variant.byte_size,
          checksum(`${variant.format}:${variant.width}:${variant.height}`),
          `publication-fixture/${id}/${variant.width}-${variant.height}.${variant.format.toLowerCase()}`,
          variant.status,
          variant.created_at,
        ],
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  const owner = { kind: "MEDIA_METADATA", mediaAssetId: id };
  const created =
    await persistence.contentAuthoringTransactionManager.runInContentAuthoringTransaction(
      ({ contentAuthoring }) =>
        contentAuthoring.write({
          schemaVersion: 1,
          actorId: fixtures.editor,
          requestId: randomUUID(),
          command: {
            schemaVersion: 1,
            action: "CREATE",
            target: owner,
            content: fixtures.content.media,
            expectedVersion: 0,
            reasonCode: "HTTP_INDEPENDENT_MEDIA",
            idempotencyKey: randomUUID(),
          },
        }),
    );
  if (created.outcome !== "SUCCESS")
    throw new Error("Independent media authoring unavailable");
  await approvePreflightBase(persistence, fixtures, owner, created.resultId);
  return {
    ...fixtures,
    referencedMediaTarget: {
      owner: fixtures.targets.media,
      revisionId: fixtures.revisions.media,
    },
    targets: { ...fixtures.targets, media: owner },
    revisions: { ...fixtures.revisions, media: created.resultId },
    publicationHeadVersions: { ...fixtures.publicationHeadVersions, media: 0 },
  };
}

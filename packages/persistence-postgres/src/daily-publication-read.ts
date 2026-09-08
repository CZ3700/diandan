import {
  dailyPublicationContextSchema,
  dailyPublicationDocumentSchema,
  dailyPublicationManifestSchema,
  giftVariantDefinitionSchema,
  priceBookRevisionSchema,
  priceSchema,
  type ContentAuthoringTarget,
  type PublishedContentContextResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  computeDailyDocumentHash,
  computeDailyPublicationManifestHash,
  projectDailyPublication,
  serializeDailyPublicationManifest,
} from "@fan-support/content";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { loadDailyMedia } from "./daily-publication-media.js";
import { loadGiftCurrentPriceEvidence } from "./gift-commerce-pricing-current.js";
import { preflightRows } from "./publication-preflight-data.js";
import { PREFLIGHT_TABLES } from "./publication-preflight-mapping.js";
import { pickFields } from "./content-authoring-model.js";
import type { TransactionClient } from "./transaction-runner.js";

const failure = (): PublishedContentContextResponse => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
});
export async function loadDailyPublicationContext(
  client: TransactionClient,
  owner: ContentAuthoringTarget,
  locale: SupportedLocale,
  publication: DraftRow,
  head: DraftRow,
  publicMediaBaseUrl: string,
): Promise<PublishedContentContextResponse> {
  if (owner.kind === "POLICY") return failure();
  const table = PREFLIGHT_TABLES[owner.kind];
  const [row] = await draftRows(
    client,
    `SELECT m.manifest,m.manifest_text,m.manifest_hash,m.head_version,d.document,d.document_hash,r.lifecycle,public.publication_utc(clock_timestamp()) evaluated_at
    FROM public.daily_publication_manifests m JOIN public.daily_publication_revisions d ON d.revision_id=m.revision_id JOIN public.${owner.kind.toLowerCase()}_revisions r ON r.id=d.revision_id WHERE m.publication_id=$1 AND d.revision_id=$2 FOR SHARE OF m,d,r`,
    [publication["id"], head[table.parent]],
  );
  if (!row) return failure();
  const manifest = dailyPublicationManifestSchema.parse(row["manifest"]);
  const document = dailyPublicationDocumentSchema.parse(row["document"]);
  if (
    serializeDailyPublicationManifest(manifest) !== row["manifest_text"] ||
    computeDailyPublicationManifestHash(manifest) !== row["manifest_hash"] ||
    computeDailyDocumentHash(document) !== row["document_hash"] ||
    Number(row["head_version"]) !== Number(head["version"])
  )
    return failure();
  let status = "active",
    handle: unknown = null,
    acceptingGifts = false;
  if (document.kind === "IDOL" || document.kind === "GIFT") {
    const [base] = await draftRows(
      client,
      `SELECT status,handle,${document.kind === "IDOL" ? "accepting_gifts" : "false AS accepting_gifts"} FROM public.${document.kind === "IDOL" ? "idols" : "gifts"} WHERE id=$1 AND published_revision_id=$2 FOR SHARE`,
      [document.ownerId, document.revisionId],
    );
    if (!base) return failure();
    status = String(base["status"]);
    handle = base["handle"];
    acceptingGifts = base["accepting_gifts"] === true;
  }
  const variantRows =
    document.kind === "GIFT"
      ? await preflightRows(
          client,
          "gift_variants",
          "r.gift_id=$1 ORDER BY r.id",
          [document.ownerId],
        )
      : [];
  const variants = variantRows.map((row) =>
    giftVariantDefinitionSchema.parse(
      pickFields(row, [
        "schemaVersion",
        "id",
        "giftId",
        "sku",
        "status",
        "inventoryPolicy",
      ]),
    ),
  );
  const priceEvidence =
    document.kind === "GIFT"
      ? await loadGiftCurrentPriceEvidence(
          client,
          variants.map((row) => row.id),
        )
      : { bookRows: [], priceRows: [] };
  const priceBooks = priceEvidence.bookRows.map((row) =>
    priceBookRevisionSchema.parse({
      ...pickFields(row, [
        "schemaVersion",
        "id",
        "market",
        "currency",
        "validFrom",
        "validUntil",
      ]),
      revision: Number(row["revision"]),
      status: row["lifecycle"],
    }),
  );
  const prices = priceEvidence.priceRows.map((row) =>
    priceSchema.parse({
      ...pickFields(row, [
        "schemaVersion",
        "id",
        "priceBookId",
        "giftVariantId",
        "validFrom",
      ]),
      ...(row["valid_to"] === null ? {} : { validUntil: row["valid_to"] }),
      revision: Number(row["revision"]),
      priceBookRevision: Number(row["price_book_revision"]),
      unitAmountMinor: Number(row["amount_minor"]),
    }),
  );
  const context = dailyPublicationContextSchema.parse({
    schemaVersion: 3,
    publicationMode: "DIRECT_OPERATOR_V1",
    locale,
    publication: {
      publicationId: publication["id"],
      revisionId: document.revisionId,
      headVersion: Number(head["version"]),
      publishedAt: publication["published_at"],
      manifestHash: row["manifest_hash"],
    },
    manifest,
    current: {
      publicationId: publication["id"],
      revisionId: head[table.parent],
      headVersion: Number(head["version"]),
      evaluatedAt: row["evaluated_at"],
      lifecycle: row["lifecycle"],
      status,
      handle,
      acceptingGifts,
      document,
      media: await loadDailyMedia(client, document, publicMediaBaseUrl),
      prices,
      priceBooks,
      variants,
    },
  });
  return projectDailyPublication(context).outcome === "SUCCESS"
    ? { schemaVersion: 1, outcome: "SUCCESS", context }
    : failure();
}

import {
  contentAuthoringSnapshotSchema,
  sourceHashSchema,
  type ContentAuthoringSnapshot,
  type ContentAuthoringTarget,
} from "@fan-support/contracts";
import { computeContentAuthoringSnapshotHash } from "@fan-support/content";
import {
  draftRows,
  loadGiftDetailDraft,
  loadIdolAliasDraft,
  type DraftRow,
} from "./content-draft-data.js";
import {
  AUTHORING_TABLES,
  ownerValue,
  pickFields,
} from "./content-authoring-model.js";
import type { TransactionClient } from "./transaction-runner.js";

export async function lockAuthoringOwner(
  client: TransactionClient,
  target: ContentAuthoringTarget,
): Promise<DraftRow | undefined> {
  const table = AUTHORING_TABLES[target.kind];
  if (table.ownerTable === null) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:content-authoring:homepage',0))",
    );
    return {};
  }
  const [row] = await draftRows(
    client,
    `SELECT to_jsonb(o.*) AS owner FROM public.${table.ownerTable} o WHERE ${table.ownerKey}=$1 FOR UPDATE`,
    [ownerValue(target)],
  );
  return row?.["owner"] as DraftRow | undefined;
}
export async function authoringHeadVersion(
  client: TransactionClient,
  target: ContentAuthoringTarget,
): Promise<number> {
  const table = AUTHORING_TABLES[target.kind];
  const [row] = await draftRows(
    client,
    `SELECT COALESCE(max(revision),0)::text AS version FROM public.${table.revisions}${table.ownerColumn === null ? "" : ` WHERE ${table.ownerColumn}=$1`}`,
    table.ownerColumn === null ? [] : [ownerValue(target)],
  );
  const value = Number(row?.["version"]);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("invalid authoring version");
  return value;
}
async function children(
  client: TransactionClient,
  table: string,
  column: string,
  id: string,
  fields: readonly string[],
  order: string,
): Promise<Record<string, unknown>[]> {
  return (
    await draftRows(
      client,
      `SELECT to_jsonb(c.*) AS value FROM public.${table} c WHERE ${column}=$1 ORDER BY ${order}`,
      [id],
    )
  ).map((row) => pickFields(row["value"] as DraftRow, fields));
}
function review(row: DraftRow): unknown {
  return {
    status: row["status"],
    ...pickFields(row, [
      "submittedAt",
      "reviewerId",
      "reviewedAt",
      "reviewedSourceHash",
      "reviewedContentHash",
    ]),
  };
}
export async function loadAuthoringSnapshot(
  client: TransactionClient,
  target: ContentAuthoringTarget,
  id: string,
  headVersion: number,
): Promise<ContentAuthoringSnapshot | undefined> {
  const table = AUTHORING_TABLES[target.kind];
  const [header] = await draftRows(
    client,
    `SELECT to_jsonb(r.*) AS revision FROM public.${table.revisions} r WHERE id=$1${table.ownerColumn === null ? "" : ` AND ${table.ownerColumn}=$2`} FOR UPDATE`,
    table.ownerColumn === null ? [id] : [id, ownerValue(target)],
  );
  if (!header) return undefined;
  const row = header["revision"] as DraftRow;
  id = String(row["id"]);
  switch (target.kind) {
    case "IDOL":
      target = {
        kind: "IDOL",
        idolId: String(row["idol_id"]) as typeof target.idolId,
      };
      break;
    case "GIFT":
      target = {
        kind: "GIFT",
        giftId: String(row["gift_id"]) as typeof target.giftId,
      };
      break;
    case "MEDIA_METADATA":
      target = {
        kind: "MEDIA_METADATA",
        mediaAssetId: String(
          row["media_asset_id"],
        ) as typeof target.mediaAssetId,
      };
      break;
    default:
      break;
  }
  const translations = await draftRows(
    client,
    `SELECT to_jsonb(t.*) AS translation,to_jsonb(r.*) AS review,to_jsonb(e.*) AS evidence FROM public.${table.translations} t LEFT JOIN LATERAL(SELECT * FROM public.${table.reviews} WHERE ${table.translation}=t.id ORDER BY sequence DESC LIMIT 1) r ON true LEFT JOIN public.${table.evidence} e ON e.target_translation_id=t.id WHERE t.${table.parent}=$1 ORDER BY t.locale FOR UPDATE OF t`,
    [id],
  );
  const text = [],
    audits = [];
  for (const entry of translations) {
    const translation = entry["translation"] as DraftRow,
      current = entry["review"] as DraftRow | undefined,
      evidence = entry["evidence"] as DraftRow | undefined;
    if (!current) throw new Error("missing canonical authoring review");
    const fields = pickFields(translation, table.fields);
    if (target.kind === "GIFT")
      fields["variantLabels"] = await children(
        client,
        "gift_variant_labels",
        "gift_translation_id",
        String(translation["id"]),
        ["giftVariantId", "label"],
        "gift_variant_id",
      );
    if (target.kind === "HOMEPAGE")
      fields["slotLabels"] = await children(
        client,
        "homepage_slot_translations",
        "homepage_translation_id",
        String(translation["id"]),
        ["slotKey", "label"],
        "slot_key",
      );
    text.push({
      ...pickFields(translation, ["locale", "origin", "importBatchId"]),
      fields,
    });
    let inheritedFrom;
    if (evidence) {
      const [source] = await draftRows(
        client,
        `SELECT ${table.parent} FROM public.${table.translations} WHERE id=$1`,
        [evidence["source_translation_id"]],
      );
      inheritedFrom = {
        revisionId: source?.[table.parent],
        translationId: evidence["source_translation_id"],
        reviewId: evidence["source_approval_review_id"],
      };
    }
    audits.push({
      id: translation["id"],
      reviewId: current["id"],
      reviewSequence: current["sequence"],
      ...pickFields(translation, [
        "locale",
        "sourceHash",
        "translatedFromSourceHash",
        "origin",
        "importBatchId",
        "editorId",
        "editedAt",
      ]),
      review: review(current),
      ...(inheritedFrom ? { inheritedFrom } : {}),
    });
  }
  const extensions: Record<string, unknown> = {},
    content: Record<string, unknown> = {
      kind: target.kind,
      translations: text,
    };
  if (target.kind === "IDOL") {
    content["structure"] = pickFields(row, [
      "themeAccent",
      "heroTextTone",
      "displayOrder",
    ]);
    content["media"] = await children(
      client,
      "idol_revision_media",
      table.parent,
      id,
      ["role", "mediaAssetId", "mediaMetadataRevisionId", "sortOrder"],
      "role,sort_order",
    );
    const aliases = await loadIdolAliasDraft(client, id);
    if (aliases.outcome === "SUCCESS") {
      extensions["aliases"] = aliases.aliasSet;
      content["aliases"] = aliases.aliasSet.aliases;
    } else if (aliases.code !== "NOT_FOUND") throw new Error("invalid aliases");
  } else if (target.kind === "GIFT") {
    content["structure"] = {
      ...pickFields(row, ["category", "requiresSafetyNotice", "shippingMode"]),
      deliveryEstimate: {
        minimum: row["delivery_minimum"],
        maximum: row["delivery_maximum"],
        unit: row["delivery_unit"],
      },
      contents: await children(
        client,
        "gift_revision_contents",
        table.parent,
        id,
        ["componentCode", "quantity", "unit"],
        "component_code",
      ),
    };
    content["media"] = await children(
      client,
      "gift_revision_media",
      table.parent,
      id,
      ["role", "mediaAssetId", "mediaMetadataRevisionId", "sortOrder"],
      "role,sort_order",
    );
    const details = await loadGiftDetailDraft(client, id);
    if (details.outcome === "SUCCESS") {
      extensions["details"] = details;
      content["details"] = {
        blocks: details.document.blocks,
        translations: details.translations.map((tr) => ({
          locale: tr.locale,
          origin: tr.origin,
          ...(tr.importBatchId ? { importBatchId: tr.importBatchId } : {}),
          blocks: tr.blocks,
        })),
      };
    } else if (details.code !== "NOT_FOUND") throw new Error("invalid details");
  } else if (target.kind === "HOMEPAGE")
    content["structure"] = {
      slots: await children(
        client,
        "homepage_slots",
        table.parent,
        id,
        [
          "slotKey",
          "kind",
          "idolId",
          "giftId",
          "policyKey",
          "desktopMediaAssetId",
          "desktopMediaMetadataRevisionId",
          "mobileMediaAssetId",
          "mobileMediaMetadataRevisionId",
          "sortOrder",
        ],
        "sort_order",
      ),
    };
  else if (target.kind === "POLICY")
    content["structure"] = pickFields(row, ["kind", "effectiveAt"]);
  else
    content["structure"] = {
      presentationKind: row["presentation_kind"],
      focalPoint: { x: row["focal_x"], y: row["focal_y"] },
    };
  const snapshot = contentAuthoringSnapshotSchema.parse({
    schemaVersion: 1,
    target,
    revisionId: id,
    revisionNumber: row["revision"],
    headVersion,
    lifecycle: {
      status: row["lifecycle"],
      ...pickFields(row, [
        "validatedAt",
        "publishedAt",
        "supersededAt",
        "archivedAt",
      ]),
    },
    createdBy: row["created_by"],
    createdAt: row["created_at"],
    contentHash: "0".repeat(64),
    content,
    translationAudits: audits,
    extensions,
  });
  return {
    ...snapshot,
    contentHash: sourceHashSchema.parse(
      computeContentAuthoringSnapshotHash(snapshot),
    ),
  };
}

/** Preserve database microseconds and respect locked historical causal bounds. */
export async function authoringTime(
  client: TransactionClient,
  target: ContentAuthoringTarget,
  owner: DraftRow,
  source: ContentAuthoringSnapshot | null,
  trustedCommerceTime?: string,
): Promise<string> {
  const table = AUTHORING_TABLES[target.kind];
  const commerceTime = target.kind === "GIFT" ? trustedCommerceTime : undefined;
  // New commerce receipts use the stable authority floor plus the same locked
  // content history. Ordinary authoring retains its existing clock behavior.
  const observedTime =
    commerceTime === undefined ? "clock_timestamp()," : "$5::timestamptz,";
  const extensionBound =
    target.kind === "IDOL"
      ? `,(SELECT max(GREATEST(s.edited_at,r.created_at,r.submitted_at,r.reviewed_at)) FROM public.idol_revision_alias_sets s LEFT JOIN public.idol_revision_alias_reviews r ON r.alias_set_id=s.id WHERE s.idol_revision_id=$3)`
      : target.kind === "GIFT"
        ? `,(SELECT max(GREATEST(d.edited_at,t.edited_at,r.created_at,r.submitted_at,r.reviewed_at)) FROM public.gift_detail_documents d JOIN public.gift_detail_translations t ON t.document_id=d.id LEFT JOIN public.gift_detail_translation_reviews r ON r.gift_detail_translation_id=t.id WHERE d.gift_revision_id=$3)`
        : "";
  const [row] = await draftRows(
    client,
    `SELECT to_char(GREATEST(${observedTime}transaction_timestamp(),$1::timestamptz,$2::timestamptz,(SELECT max(GREATEST(p.created_at,p.validated_at,p.published_at,p.superseded_at,p.archived_at)) FROM public.${table.revisions} p ${table.ownerColumn === null ? "" : `WHERE p.${table.ownerColumn}::text=$4`}),(SELECT max(t.edited_at) FROM public.${table.translations} t WHERE t.${table.parent}=$3),(SELECT max(GREATEST(r.created_at,r.submitted_at,r.reviewed_at)) FROM public.${table.reviews} r JOIN public.${table.translations} t ON r.${table.translation}=t.id WHERE t.${table.parent}=$3)${extensionBound}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`,
    [
      owner["updated_at"] ?? owner["created_at"] ?? null,
      source?.createdAt ?? null,
      source?.revisionId ?? null,
      ...(table.ownerColumn === null ? [] : [ownerValue(target)]),
      ...(commerceTime === undefined ? [] : [commerceTime]),
    ],
  );
  if (typeof row?.["now"] !== "string")
    throw new Error("invalid authoring time");
  return row["now"];
}

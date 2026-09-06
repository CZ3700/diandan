import {
  giftVariantDefinitionSchema,
  giftVariantIdolEligibilitySchema,
  inventoryItemSchema,
  inventoryBalanceSchema,
  priceBookRevisionSchema,
  priceSchema,
  type ContentAuthoringSnapshot,
} from "@fan-support/contracts";
import { pickFields } from "./content-authoring-model.js";
import type { DraftRow } from "./content-draft-data.js";
import { draftRows } from "./content-draft-data.js";
import {
  preflightRows,
  type loadPreflightMedia,
} from "./publication-preflight-data.js";
import {
  preflightBase,
  preflightCurrentPublication,
  preflightRevision,
  preflightTranslations,
  PREFLIGHT_TABLES,
} from "./publication-preflight-mapping.js";
import type { TransactionClient } from "./transaction-runner.js";
import { loadGiftCurrentPriceEvidence } from "./gift-commerce-pricing-current.js";

async function giftCommerce(client: TransactionClient, giftId: string) {
  const variants = await preflightRows(
    client,
    "gift_variants",
    "r.gift_id=$1 ORDER BY r.id",
    [giftId],
  );
  const ids = variants.map((row) => row["id"]);
  const eligibility = await preflightRows(
    client,
    "gift_variant_idol_eligibility",
    "r.gift_variant_id=ANY($1::uuid[]) ORDER BY r.gift_variant_id,r.idol_id",
    [ids],
  );
  const idols = await preflightRows(
    client,
    "idols",
    "r.id=ANY($1::uuid[]) ORDER BY r.id",
    [eligibility.map((row) => row["idol_id"])],
  );
  const { bookRows, priceRows: prices } = await loadGiftCurrentPriceEvidence(
    client,
    ids,
  );
  const items = await preflightRows(
    client,
    "inventory_items",
    "r.gift_variant_id=ANY($1::uuid[]) ORDER BY r.id",
    [ids],
  );
  const balances = await preflightRows(
    client,
    "inventory_balances",
    "r.inventory_item_id=ANY($1::uuid[]) ORDER BY r.inventory_item_id,r.location_id",
    [items.map((row) => row["id"])],
  );
  return {
    variants: variants.map((row) =>
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
    ),
    eligibility: eligibility.map((row) =>
      giftVariantIdolEligibilitySchema.parse({
        schemaVersion: 1,
        ...pickFields(row, ["giftVariantId", "idolId"]),
        eligible: true,
      }),
    ),
    eligibleIdols: idols.map((row) => preflightBase(row, "IDOL")),
    priceBooks: bookRows.map((row) =>
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
    ),
    prices: prices.map((row) =>
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
    ),
    inventoryItems: items.map((row) =>
      inventoryItemSchema.parse(
        pickFields(row, [
          "schemaVersion",
          "id",
          "giftVariantId",
          "sku",
          "policy",
          "status",
        ]),
      ),
    ),
    inventoryBalances: balances.map((row) =>
      inventoryBalanceSchema.parse({
        schemaVersion: row["schema_version"],
        inventoryItemId: row["inventory_item_id"],
        inventoryLocationId: row["location_id"],
        onHand: Number(row["on_hand"]),
        reserved: Number(row["reserved"]),
        version: Number(row["version"]),
      }),
    ),
  };
}
async function homepageReferences(
  client: TransactionClient,
  snapshot: ContentAuthoringSnapshot,
) {
  if (snapshot.content.kind !== "HOMEPAGE")
    throw new Error("Invalid homepage snapshot");
  const slots = snapshot.content.structure.slots;
  const idols = await preflightRows(
    client,
    "idols",
    "r.id=ANY($1::uuid[]) ORDER BY r.id",
    [slots.flatMap((slot) => ("idolId" in slot ? [slot.idolId] : []))],
  );
  const gifts = await preflightRows(
    client,
    "gifts",
    "r.id=ANY($1::uuid[]) ORDER BY r.id",
    [slots.flatMap((slot) => ("giftId" in slot ? [slot.giftId] : []))],
  );
  const policies = await draftRows(
    client,
    `SELECT h.policy_key,h.policy_revision_id,r.lifecycle,p.id,p.action
    FROM public.policy_publication_heads h JOIN public.content_publications p ON p.id=h.publication_id
    JOIN public.policy_revisions r ON r.id=h.policy_revision_id WHERE h.policy_key=ANY($1::text[]) ORDER BY h.policy_key FOR SHARE OF h,p,r`,
    [
      slots.flatMap((slot) =>
        slot.kind === "POLICY_LINK" ? [slot.policyKey] : [],
      ),
    ],
  );
  return {
    slots: slots.map((slot) => ({
      schemaVersion: 1,
      homepageRevisionId: snapshot.revisionId,
      ...slot,
    })),
    referencedIdols: idols.map((row) => preflightBase(row, "IDOL")),
    referencedGifts: gifts.map((row) => preflightBase(row, "GIFT")),
    referencedPolicies: policies.map((row) => ({
      schemaVersion: 1,
      policyKey: row["policy_key"],
      publishedRevisionId: row["policy_revision_id"],
      selectedRevisionLifecycle: row["lifecycle"],
      currentPublication: {
        schemaVersion: 1,
        objectKind: "POLICY",
        id: row["id"],
        action: row["action"],
        policyKey: row["policy_key"],
        targetRevisionId: row["policy_revision_id"],
      },
    })),
  };
}

export async function loadPreflightCandidate(
  client: TransactionClient,
  snapshot: ContentAuthoringSnapshot,
  head: DraftRow | undefined,
  media: Awaited<ReturnType<typeof loadPreflightMedia>>,
  action: "PUBLISH" | "ROLLBACK",
  evaluatedAt: string,
) {
  const kind = snapshot.target.kind;
  const currentPublication = preflightCurrentPublication(snapshot.target, head);
  const currentPublishedRevisionId =
    head?.[PREFLIGHT_TABLES[kind].parent] ?? null;
  if (kind === "MEDIA_METADATA")
    return {
      objectKind: kind,
      currentPublication,
      currentPublishedRevisionId,
      asset: media.mediaAssets[0],
      variants: media.mediaVariants,
    };
  const common = {
    schemaVersion: 1,
    objectKind: kind,
    action,
    evaluatedAt,
    currentPublication,
    revision: preflightRevision(snapshot),
    translations: preflightTranslations(snapshot),
  };
  if (kind === "POLICY") return { ...common, currentPublishedRevisionId };
  const mediaFields = {
    mediaAssets: media.mediaAssets,
    mediaVariants: media.mediaVariants,
    mediaMetadataRevisions: media.mediaSnapshots.map(preflightRevision),
    mediaTranslations: media.mediaSnapshots.flatMap(preflightTranslations),
  };
  if (kind === "HOMEPAGE")
    return {
      ...common,
      ...mediaFields,
      currentPublishedRevisionId,
      ...(await homepageReferences(client, snapshot)),
    };
  if (snapshot.target.kind !== "IDOL" && snapshot.target.kind !== "GIFT")
    throw new Error("Invalid publication owner kind");
  const ownerId =
    snapshot.target.kind === "IDOL"
      ? snapshot.target.idolId
      : snapshot.target.giftId;
  const [owner] = await preflightRows(
    client,
    kind === "IDOL" ? "idols" : "gifts",
    "r.id=$1",
    [ownerId],
  );
  if (!owner) throw new Error("Missing canonical publication owner");
  const base = preflightBase(owner, kind);
  if (snapshot.content.kind !== "IDOL" && snapshot.content.kind !== "GIFT")
    throw new Error("Invalid publication content kind");
  // A draft has no published operating state: check the stricter active requirements.
  // A currently paused owner keeps paused semantics; archived owners still fail the base gate.
  const main = {
    ...common,
    ...mediaFields,
    base,
    targetOperationalStatus: base.status === "paused" ? "paused" : "active",
    mediaReferences: snapshot.content.media.map((reference) => ({
      schemaVersion: 1,
      [PREFLIGHT_TABLES[kind].parentField]: snapshot.revisionId,
      ...reference,
    })),
  };
  return kind === "IDOL"
    ? { ...main, targetAcceptingGifts: owner["accepting_gifts"] }
    : { ...main, ...(await giftCommerce(client, ownerId)) };
}

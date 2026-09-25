import {
  giftCommerceReadResponseSchema,
  type GiftCommerceReadCommand,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { readGiftRevisionProfile } from "./gift-commerce-gift-profile.js";
import { giftCommerceFailure } from "./gift-commerce-gift-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export async function readGiftCommerceGift(
  client: TransactionClient,
  command: Extract<GiftCommerceReadCommand, { action: "READ_GIFT" }>,
) {
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const [row] = await draftRows(
    client,
    `SELECT to_jsonb(g.*) AS gift,(SELECT max(revision) FROM public.gift_revisions WHERE gift_id=g.id) AS authoring_version,
    (SELECT id FROM public.gift_revisions WHERE gift_id=g.id ORDER BY revision DESC LIMIT 1) AS latest_revision_id,
    (SELECT version FROM public.gift_publication_heads WHERE gift_id=g.id AND gift_revision_id=g.published_revision_id) AS head_version
    FROM public.gifts g WHERE id=$1 FOR SHARE`,
    [command.giftId],
  );
  if (!row) return giftCommerceFailure("NOT_FOUND");
  const gift = row["gift"] as DraftRow,
    latest = row["latest_revision_id"] as string | null;
  const selected = command.revisionId ?? latest;
  let label: unknown = null;
  if (selected) {
    const [revision] = await draftRows(
      client,
      "SELECT r.id,t.title FROM public.gift_revisions r LEFT JOIN public.gift_revision_translations t ON t.gift_revision_id=r.id AND t.locale=$3 WHERE r.id=$1 AND r.gift_id=$2",
      [selected, command.giftId, command.locale],
    );
    if (!revision) return giftCommerceFailure("NOT_FOUND");
    label = revision["title"] ?? null;
  }
  const variants = await draftRows(
    client,
    `SELECT v.*,(SELECT id FROM public.inventory_items WHERE gift_variant_id=v.id) AS inventory_item_id,
    coalesce((SELECT jsonb_agg(idol_id ORDER BY idol_id) FROM public.gift_variant_idol_eligibility WHERE gift_variant_id=v.id),'[]'::jsonb) AS eligible_idol_ids,
    public.gift_commerce_variant_policy_locked(v.id) AS policy_locked FROM public.gift_variants v WHERE gift_id=$1 ORDER BY created_at,id`,
    [command.giftId],
  );
  const profile = (id: unknown) =>
    typeof id === "string"
      ? readGiftRevisionProfile(client, command.giftId, id)
      : Promise.resolve(null);
  return giftCommerceReadResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "GIFT",
    value: {
      schemaVersion: 1,
      gift: {
        schemaVersion: 1,
        id: gift["id"],
        handle: gift["handle"],
        status: gift["status"],
        draftRevisionId: gift["draft_revision_id"],
        publishedRevisionId: gift["published_revision_id"],
        version: Number(gift["version"]),
      },
      locale: command.locale,
      label,
      authoringVersion: Number(row["authoring_version"] ?? 0),
      publicationHeadVersion: Number(row["head_version"] ?? 0),
      latestRevisionId: latest,
      latestProfile: await profile(latest),
      publishedProfile: await profile(gift["published_revision_id"]),
      selectedRevisionId: selected,
      selectedProfile: await profile(selected),
      variants: variants.map((variant) => ({
        schemaVersion: 1,
        id: variant["id"],
        giftId: variant["gift_id"],
        sku: variant["sku"],
        status: variant["status"],
        inventoryPolicy: variant["inventory_policy"],
        version: Number(variant["version"]),
        eligibleIdolIds: variant["eligible_idol_ids"],
        inventoryItemId: variant["inventory_item_id"],
        policyLocked: variant["policy_locked"],
      })),
    },
  });
}

import { validateDailyGiftCommerceEdit } from "./daily-publication-commerce.js";
import { resolveManagementClaimImageSource } from "./management-image-source.js";
import { randomUUID } from "node:crypto";
import {
  dailyMediaMetadataDocumentSchema,
  dailyPublicationDocumentSchema,
  giftVariantDefinitionSchema,
  managementCenterPreparedMediaSchema,
  type DailyPublicationDocument,
  type ManagementCenterClaim,
  type ManagementCenterPreparedMedia,
} from "@fan-support/contracts";
import { computeDailySourceHash } from "@fan-support/content";
import type { ManagementCenterPublicationRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  insertDailyDocument,
  loadDailyClaim,
} from "./daily-publication-data.js";
import { prepareDailyMediaMetadata } from "./daily-publication-metadata.js";
import {
  copyDailyMetadata,
  loadDailyHomepageTemplate,
} from "./daily-publication-template.js";
import { publishDailyDocument } from "./daily-publication-write.js";
import { publishDailyGiftPrice } from "./daily-publication-price.js";
import { publishDailyGiftInventory } from "./daily-publication-inventory.js";
import { managementFailure } from "./management-center-operation-data.js";
import { createResourceRun } from "./resource-management-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

import { summarizeDailyOriginal as short } from "./daily-publication-text.js";
type Ref = {
  role: string;
  mediaAssetId: string;
  mediaMetadataRevisionId: string;
  sortOrder: number;
};
async function existingMedia(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  revisionId: string,
  kind: "IDOL" | "GIFT",
) {
  const rows = await draftRows(
    client,
    `SELECT role,media_asset_id,media_metadata_revision_id,sort_order FROM public.${kind.toLowerCase()}_revision_media WHERE ${kind.toLowerCase()}_revision_id=$1 ORDER BY role,sort_order FOR SHARE`,
    [revisionId],
  );
  const refs: Ref[] = [];
  for (const row of rows)
    refs.push({
      role: String(row["role"]),
      mediaAssetId: String(row["media_asset_id"]),
      mediaMetadataRevisionId: await copyDailyMetadata(
        client,
        claim,
        String(row["media_asset_id"]),
        String(row["media_metadata_revision_id"]),
      ),
      sortOrder: Number(row["sort_order"]),
    });
  return refs;
}
function preparedRefs(prepared: ManagementCenterPreparedMedia): Ref[] {
  return prepared.assets.map((row) => ({
    role: row.role === "GIFT_PRIMARY" ? "PRIMARY" : row.role,
    mediaAssetId: row.assetId,
    mediaMetadataRevisionId: row.metadataRevisionId,
    sortOrder: 0,
  }));
}
async function publishMetadata(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  refs: readonly Ref[],
  base: string,
  time: string,
) {
  for (const id of [
    ...new Set(refs.map((ref) => ref.mediaMetadataRevisionId)),
  ].sort()) {
    const [row] = await draftRows(
      client,
      `SELECT d.document,r.lifecycle FROM public.daily_publication_revisions d JOIN public.media_metadata_revisions r ON r.id=d.revision_id WHERE d.revision_id=$1 AND d.operation_id=$2`,
      [id, claim.operation.operationId],
    );
    if (!row) throw new Error("Daily prepared metadata not bound to operation");
    const document = dailyMediaMetadataDocumentSchema.parse(row["document"]);
    if (row["lifecycle"] !== "DRAFT")
      throw new Error("Daily prepared metadata already consumed");
    await publishDailyDocument(client, claim, document, base, time, null);
  }
}
async function prepareCatalog(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  prepared: ManagementCenterPreparedMedia | null,
) {
  const intent = claim.intent;
  if (intent.kind !== "SAVE_ARTIST" && intent.kind !== "SAVE_GIFT")
    throw new Error("Catalog intent required");
  if (
    intent.kind === "SAVE_GIFT" &&
    intent.inventory.policy === "TRACKED" &&
    !(
      "commerceEdit" in intent &&
      intent.commerceEdit.inventory.mode === "PRESERVE"
    )
  ) {
    const [location] = await draftRows(
      client,
      "SELECT id FROM public.inventory_locations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
      [intent.inventory.locationId],
    );
    if (!location) return managementFailure("NOT_FOUND");
  }
  const kind = intent.kind === "SAVE_ARTIST" ? "IDOL" : "GIFT",
    table = kind === "IDOL" ? "idols" : "gifts";
  const targetId = claim.operation.targetId;
  if (!targetId) throw new Error("Daily target missing");
  const [prior] = await draftRows(
    client,
    `SELECT * FROM public.${table} WHERE id=$1 FOR UPDATE`,
    [targetId],
  );
  if (
    intent.id === null
      ? prior !== undefined
      : !prior ||
        Number(prior["version"]) !== intent.expectedVersion ||
        prior["status"] === "archived"
  )
    return null;
  if (intent.kind === "SAVE_GIFT" && "commerceEdit" in intent) {
    const rows = await draftRows(
      client,
      "SELECT id FROM public.gift_variants WHERE gift_id=$1 AND status<>'archived' ORDER BY id FOR UPDATE",
      [targetId],
    );
    if (
      rows.length !== 1 ||
      !(await validateDailyGiftCommerceEdit(
        client,
        claim,
        String(rows[0]!["id"]),
      ))
    )
      return managementFailure("TARGET_CONFLICT");
  }
  let refs: Ref[];
  if (prepared) refs = preparedRefs(prepared);
  else {
    if (!prior?.["published_revision_id"]) return null;
    refs = await existingMedia(
      client,
      claim,
      String(prior["published_revision_id"]),
      kind,
    );
  }
  const [clock] = await draftRows(
    client,
    `SELECT public.publication_utc(GREATEST(clock_timestamp(),coalesce((SELECT max(created_at) FROM public.daily_publication_revisions WHERE operation_id=$1),clock_timestamp()))) at`,
    [claim.operation.operationId],
  );
  if (!clock) throw new Error("Daily event time unavailable");
  const time = String(clock["at"]);
  const handle = prior
    ? String(prior["handle"])
    : `${kind.toLowerCase()}-${targetId.replaceAll("-", "")}`;
  if (!prior)
    await client.query(
      `INSERT INTO public.${table}(id,handle,status,${kind === "IDOL" ? "accepting_gifts," : ""}version,created_at,updated_at) VALUES($1,$2,'draft',${kind === "IDOL" ? "false," : ""}1,$3,$3)`,
      [targetId, handle, time],
    );
  const [revision] = await draftRows(
    client,
    `SELECT coalesce(max(revision),0)+1 revision FROM public.${kind.toLowerCase()}_revisions WHERE ${kind.toLowerCase()}_id=$1`,
    [targetId],
  );
  if (!revision) throw new Error("Daily revision sequence unavailable");
  const revisionId = randomUUID();
  const common = {
    schemaVersion: 3,
    kind,
    ownerId: targetId,
    revisionId,
    revisionNumber: Number(revision["revision"]),
    createdBy: claim.actorId,
    createdAt: time,
  };
  const source = (fields: unknown) => ({
    id: randomUUID(),
    locale: intent.sourceLocale,
    sourceHash: computeDailySourceHash(kind, intent.sourceLocale, fields),
    editorId: claim.actorId,
    editedAt: time,
    fields,
  });
  let document: DailyPublicationDocument;
  let variantId: string | undefined;
  if (intent.kind === "SAVE_ARTIST") {
    const [style] = prior?.["published_revision_id"]
      ? await draftRows(
          client,
          `SELECT theme_accent,hero_text_tone,display_order FROM public.idol_revisions WHERE id=$1`,
          [prior["published_revision_id"]],
        )
      : await draftRows(
          client,
          `SELECT d.artist_presentation->>'themeAccent' theme_accent,d.artist_presentation->>'heroTextTone' hero_text_tone,(SELECT coalesce(max(display_order),-1)+1 FROM public.idol_revisions) display_order FROM public.management_defaults d JOIN public.config_versions c ON c.id=d.config_version_id WHERE c.config_kind='MANAGEMENT_DEFAULTS' AND c.lifecycle='PUBLISHED' FOR SHARE OF d,c`,
        );
    if (!style)
      throw new Error("Daily artist presentation defaults unavailable");
    const fields = {
      displayName: intent.name,
      shortBio: short(intent.description, 160),
      fullBio: intent.description,
      seoTitle: intent.name,
      seoDescription: short(intent.description, 155),
    };
    document = dailyPublicationDocumentSchema.parse({
      ...common,
      kind: "IDOL",
      source: source(fields),
      structure: {
        themeAccent: style["theme_accent"],
        heroTextTone: style["hero_text_tone"],
        displayOrder: Number(style["display_order"]),
      },
      media: refs,
    });
    await insertDailyDocument(client, claim, document);
    await client.query(
      `INSERT INTO public.idol_revisions(id,idol_id,revision,lifecycle,theme_accent,hero_text_tone,display_order,created_by,created_at) VALUES($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8)`,
      [
        revisionId,
        targetId,
        document.revisionNumber,
        style["theme_accent"],
        style["hero_text_tone"],
        style["display_order"],
        claim.actorId,
        time,
      ],
    );
  } else {
    const variants = await draftRows(
      client,
      `SELECT v.*,r.rule FROM public.gift_variants v LEFT JOIN public.gift_variant_recipient_rules r ON r.gift_variant_id=v.id WHERE v.gift_id=$1 ORDER BY v.id FOR UPDATE OF v`,
      [targetId],
    );
    if (
      variants.length > 1 ||
      variants.some(
        (row) =>
          row["status"] === "archived" || row["rule"] !== "ALL_ACTIVE_ARTISTS",
      )
    )
      throw new Error("Daily gift requires its explicit managed variant");
    const inventoryPolicy =
      "commerceEdit" in intent &&
      intent.commerceEdit.inventory.mode === "PRESERVE" &&
      variants[0]
        ? giftVariantDefinitionSchema.shape.inventoryPolicy.parse(
            variants[0]["inventory_policy"],
          )
        : intent.inventory.policy;
    if (variants[0]) {
      const [item] = await draftRows(
        client,
        "SELECT policy FROM public.inventory_items WHERE gift_variant_id=$1 FOR SHARE",
        [variants[0]["id"]],
      );
      if (
        item &&
        (item["policy"] !== inventoryPolicy ||
          variants[0]["inventory_policy"] !== inventoryPolicy)
      )
        return managementFailure("INVENTORY_POLICY_LOCKED");
    }
    variantId = variants[0] ? String(variants[0]["id"]) : randomUUID();
    const sku = variants[0]
      ? String(variants[0]["sku"])
      : `GIFT-${variantId.replaceAll("-", "").toUpperCase()}`;
    if (variants[0])
      await client.query(
        `UPDATE public.gift_variants SET status='active',inventory_policy=$2,version=version+1,updated_at=$3 WHERE id=$1`,
        [variantId, inventoryPolicy, time],
      );
    else
      await client.query(
        `INSERT INTO public.gift_variants(id,gift_id,sku,status,inventory_policy,version,created_at,updated_at) VALUES($1,$2,$3,'active',$4,1,$5,$5)`,
        [variantId, targetId, sku, inventoryPolicy, time],
      );
    await client.query(
      `INSERT INTO public.gift_variant_recipient_rules(gift_variant_id,rule,operation_id) VALUES($1,'ALL_ACTIVE_ARTISTS',$2) ON CONFLICT(gift_variant_id) DO NOTHING`,
      [variantId, claim.operation.operationId],
    );
    const variant = giftVariantDefinitionSchema.parse({
      schemaVersion: 1,
      id: variantId,
      giftId: targetId,
      sku,
      status: "active",
      inventoryPolicy,
    });
    const fields = {
      title: intent.name,
      shortDescription: short(intent.description, 160),
      description: intent.description,
      variantLabels: [
        { giftVariantId: variantId, label: short(intent.name, 80) },
      ],
      seoTitle: short(intent.name, 60),
      seoDescription: short(intent.description, 155),
    };
    document = dailyPublicationDocumentSchema.parse({
      ...common,
      kind: "GIFT",
      giftKind: intent.giftKind,
      source: source(fields),
      structure: {
        category: intent.category,
        contents: [],
        requiresSafetyNotice: false,
        shippingMode: "internal_to_idol",
      },
      variants: [variant],
      media: refs,
    });
    await insertDailyDocument(client, claim, document);
    await client.query(
      `INSERT INTO public.gift_revisions(id,gift_id,revision,lifecycle,category,delivery_minimum,delivery_maximum,delivery_unit,requires_safety_notice,shipping_mode,created_by,created_at,profile_version) VALUES($1,$2,$3,'DRAFT',$4,NULL,NULL,NULL,false,'internal_to_idol',$5,$6,3)`,
      [
        revisionId,
        targetId,
        document.revisionNumber,
        intent.category,
        claim.actorId,
        time,
      ],
    );
  }
  for (const ref of refs)
    await client.query(
      `INSERT INTO public.${kind.toLowerCase()}_revision_media(${kind.toLowerCase()}_revision_id,role,media_asset_id,media_metadata_revision_id,sort_order) VALUES($1,$2,$3,$4,$5)`,
      [
        revisionId,
        ref.role,
        ref.mediaAssetId,
        ref.mediaMetadataRevisionId,
        ref.sortOrder,
      ],
    );
  return { document, refs, time, handle, variantId };
}
async function prepareHomepage(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  prepared: ManagementCenterPreparedMedia | null,
) {
  const intent = claim.intent;
  if (intent.kind !== "REPLACE_POSTER" && intent.kind !== "RESTORE_POSTER")
    throw new Error("Poster intent required");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:homepage',0))",
  );
  const [head] = await draftRows(
    client,
    "SELECT * FROM public.homepage_publication_heads FOR UPDATE",
  );
  if (!head || Number(head["version"]) !== intent.expectedVersion) return null;
  const template = await loadDailyHomepageTemplate(
    client,
    claim,
    String(head["homepage_revision_id"]),
  );
  const history =
    intent.kind === "RESTORE_POSTER"
      ? await loadDailyHomepageTemplate(client, claim, intent.sourceRevisionId)
      : null;
  const historicalHeroes = history?.slots.filter(
    (slot) => slot.kind === "HERO_IDOL",
  );
  if (historicalHeroes && historicalHeroes.length !== 1)
    throw new Error("Historical poster hero unavailable");
  const revisionId = randomUUID();
  const slots = [];
  const refs: Ref[] = [];
  for (const slot of template.slots) {
    if (slot.kind !== "HERO_IDOL") {
      slots.push({ ...slot, homepageRevisionId: revisionId });
      continue;
    }
    let desktop: Ref, mobile: Ref;
    if (prepared) {
      const choices = preparedRefs(prepared);
      const d = choices.find((row) => row.role === "HERO_DESKTOP"),
        m = choices.find((row) => row.role === "HERO_MOBILE");
      if (!d || !m) throw new Error("Prepared poster roles unavailable");
      desktop = d;
      mobile = m;
    } else {
      // Restore only the image pair; the current copy, source locale and every slot target remain authoritative.
      const previous = historicalHeroes?.[0] ?? slot;
      desktop = {
        role: "HERO_DESKTOP",
        mediaAssetId: previous.desktopMediaAssetId,
        mediaMetadataRevisionId: await copyDailyMetadata(
          client,
          claim,
          previous.desktopMediaAssetId,
          previous.desktopMediaMetadataRevisionId,
        ),
        sortOrder: 0,
      };
      mobile = {
        role: "HERO_MOBILE",
        mediaAssetId: previous.mobileMediaAssetId,
        mediaMetadataRevisionId: await copyDailyMetadata(
          client,
          claim,
          previous.mobileMediaAssetId,
          previous.mobileMediaMetadataRevisionId,
        ),
        sortOrder: 0,
      };
    }
    refs.push(desktop, mobile);
    slots.push({
      ...slot,
      homepageRevisionId: revisionId,
      desktopMediaAssetId: desktop.mediaAssetId,
      desktopMediaMetadataRevisionId: desktop.mediaMetadataRevisionId,
      mobileMediaAssetId: mobile.mediaAssetId,
      mobileMediaMetadataRevisionId: mobile.mediaMetadataRevisionId,
    });
  }
  const [clock] = await draftRows(
    client,
    `SELECT coalesce(max(revision),0)+1 revision,public.publication_utc(GREATEST(clock_timestamp(),coalesce((SELECT max(created_at) FROM public.daily_publication_revisions WHERE operation_id=$1),clock_timestamp()))) at FROM public.homepage_revisions`,
    [claim.operation.operationId],
  );
  if (!clock) throw new Error("Homepage revision clock unavailable");
  const time = String(clock["at"]);
  const document = dailyPublicationDocumentSchema.parse({
    schemaVersion: 3,
    kind: "HOMEPAGE",
    ownerId: revisionId,
    revisionId,
    revisionNumber: Number(clock["revision"]),
    createdBy: claim.actorId,
    createdAt: time,
    source: {
      id: randomUUID(),
      locale: template.locale,
      sourceHash: computeDailySourceHash(
        "HOMEPAGE",
        template.locale,
        template.fields,
      ),
      editorId: claim.actorId,
      editedAt: time,
      fields: template.fields,
    },
    slots,
  });
  await insertDailyDocument(client, claim, document);
  await client.query(
    `INSERT INTO public.homepage_revisions(id,revision,lifecycle,created_by,created_at) VALUES($1,$2,'DRAFT',$3,$4)`,
    [revisionId, document.revisionNumber, claim.actorId, time],
  );
  for (const slot of slots) {
    await client.query(
      `INSERT INTO public.homepage_slots(homepage_revision_id,slot_key,kind,idol_id,gift_id,policy_key,desktop_media_asset_id,desktop_media_metadata_revision_id,mobile_media_asset_id,mobile_media_metadata_revision_id,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        revisionId,
        slot.slotKey,
        slot.kind,
        "idolId" in slot ? slot.idolId : null,
        "giftId" in slot ? slot.giftId : null,
        "policyKey" in slot ? slot.policyKey : null,
        "desktopMediaAssetId" in slot ? slot.desktopMediaAssetId : null,
        "desktopMediaMetadataRevisionId" in slot
          ? slot.desktopMediaMetadataRevisionId
          : null,
        "mobileMediaAssetId" in slot ? slot.mobileMediaAssetId : null,
        "mobileMediaMetadataRevisionId" in slot
          ? slot.mobileMediaMetadataRevisionId
          : null,
        slot.sortOrder,
      ],
    );
  }
  return { document, refs, time, handle: undefined, variantId: undefined };
}
export function createDailyPublicationRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl: string,
): ManagementCenterPublicationRepository {
  const run = createResourceRun(client, scope);
  return {
    resolveImageSource: (input) =>
      run(async () => {
        const claim = await loadDailyClaim(client, input);
        return claim
          ? resolveManagementClaimImageSource(client, claim)
          : managementFailure("NEEDS_AUTHORIZATION");
      }),
    prepareMediaMetadata: (input) =>
      run(() => prepareDailyMediaMetadata(client, input)),
    publish: (input) =>
      run(async () => {
        const claim = await loadDailyClaim(client, input);
        if (!claim) return managementFailure("NEEDS_AUTHORIZATION");
        const prepared =
          input.preparedMedia === null
            ? null
            : managementCenterPreparedMediaSchema.parse(input.preparedMedia);
        if (
          JSON.stringify(prepared) !==
          JSON.stringify(claim.checkpoint.preparedMedia)
        )
          return managementFailure("INVALID_COMMAND");
        if (
          "image" in claim.intent &&
          claim.intent.image !== null &&
          prepared === null
        )
          return managementFailure("MEDIA_FAILED");
        const plan =
          claim.intent.kind === "SAVE_ARTIST" ||
          claim.intent.kind === "SAVE_GIFT"
            ? await prepareCatalog(client, claim, prepared)
            : await prepareHomepage(client, claim, prepared);
        if (!plan) return managementFailure("TARGET_CONFLICT");
        if ("outcome" in plan) return plan;
        await publishMetadata(
          client,
          claim,
          plan.refs,
          publicMediaBaseUrl,
          plan.time,
        );
        let pricePublicationId: string | undefined;
        if (plan.variantId) {
          await publishDailyGiftInventory(
            client,
            claim,
            plan.variantId,
            plan.time,
          );
          pricePublicationId = (
            await publishDailyGiftPrice(
              client,
              claim,
              plan.variantId,
              plan.time,
            )
          ).pricePublicationId;
        }
        const result = await publishDailyDocument(
          client,
          claim,
          plan.document,
          publicMediaBaseUrl,
          plan.time,
          "id" in claim.intent ? claim.intent.expectedVersion : null,
        );
        if (plan.document.kind === "MEDIA_METADATA")
          throw new Error("A management operation requires main content");
        return {
          schemaVersion: 1 as const,
          outcome: "SUCCESS" as const,
          target: {
            kind: plan.document.kind,
            id: plan.document.ownerId,
            ...(plan.handle ? { handle: plan.handle } : {}),
          },
          publicationId: result.publicationId,
          revisionId: result.revisionId,
          headVersion: result.headVersion,
          targetVersion: result.baseVersion ?? result.headVersion,
          publishedAt: result.publishedAt,
          ...(pricePublicationId ? { pricePublicationId } : {}),
        };
      }),
  };
}

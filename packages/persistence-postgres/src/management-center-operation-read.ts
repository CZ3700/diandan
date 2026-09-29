import {
  giftCategorySchema,
  giftKindSchema,
  managementCenterResponseSchema,
  publicMediaViewSchema,
  type AdminPrincipal,
  type ManagementCenterCommand,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import {
  managementOperationSql,
  mapManagementOperation,
} from "./management-center-operation-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export async function readManagementCenterContext(
  client: TransactionClient,
  principal: AdminPrincipal,
) {
  const markets = await draftRows(
    client,
    `SELECT m.market,to_jsonb(ARRAY(SELECT currency FROM(SELECT m.default_currency AS currency UNION SELECT b.currency FROM public.price_books b WHERE b.market_id=m.id) currencies ORDER BY currency)) AS currencies FROM public.markets m WHERE m.status='ACTIVE' ORDER BY m.market LIMIT 251`,
  );
  const [defaults] = await draftRows(
    client,
    `SELECT d.* FROM public.management_defaults d JOIN public.config_versions c ON c.id=d.config_version_id AND c.config_kind='MANAGEMENT_DEFAULTS' AND c.lifecycle='PUBLISHED'`,
  );
  const [poster] = await draftRows(
    client,
    `SELECT h.version,h.homepage_revision_id,EXISTS(SELECT 1 FROM public.homepage_slots s WHERE s.homepage_revision_id=h.homepage_revision_id AND s.kind='HERO_IDOL') AS available FROM public.homepage_publication_heads h`,
  );
  const operations = await draftRows(
    client,
    `${managementOperationSql} WHERE o.actor_id=$1 ORDER BY o.updated_at DESC,o.id DESC LIMIT 10`,
    [principal.actorId],
  );
  return managementCenterResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "CONTEXT",
    capability: "DIRECT_OPERATOR_V1",
    markets,
    defaults: defaults
      ? {
          priceScope:
            defaults["market"] === null
              ? null
              : { market: defaults["market"], currency: defaults["currency"] },
          inventoryPolicy: defaults["inventory_policy"],
          inventoryLocationId: defaults["inventory_location_id"],
          eligibility: defaults["eligibility_rule"],
        }
      : null,
    giftKinds: giftKindSchema.options,
    categories: giftCategorySchema.options,
    poster:
      poster?.["available"] === true
        ? {
            available: true,
            version: Number(poster["version"]),
            currentRevisionId: poster["homepage_revision_id"],
          }
        : { available: false, version: 0, currentRevisionId: null },
    operations: operations.map(mapManagementOperation),
  });
}
async function thumbnail(
  client: TransactionClient,
  assetId: unknown,
  alt: string,
  publicMediaBaseUrl: string,
) {
  if (typeof assetId !== "string") return null;
  const [variant] = await draftRows(
    client,
    `SELECT v.object_key FROM public.media_assets a JOIN public.media_variants v ON v.media_asset_id=a.id WHERE a.id=$1 AND a.identity_kind='PROCESSED_MASTER' AND a.processing_status='READY' AND a.rights_status='APPROVED' AND v.status='READY' ORDER BY abs(v.width-960),v.width,v.id LIMIT 1`,
    [assetId],
  );
  if (!variant) return null;
  const base = new URL(
    publicMediaBaseUrl.endsWith("/")
      ? publicMediaBaseUrl
      : publicMediaBaseUrl + "/",
  );
  const url = new URL(String(variant["object_key"]), base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
    throw new Error("Invalid management thumbnail origin");
  return publicMediaViewSchema.parse({ url: url.href, alt });
}
async function giftDetails(client: TransactionClient, row: DraftRow) {
  const [variant] = await draftRows(
    client,
    `SELECT v.id,v.inventory_policy,(SELECT count(*)::text FROM public.gift_variants all_v WHERE all_v.gift_id=v.gift_id AND all_v.status<>'archived') AS variant_count,
    i.id inventory_item_id,location.id location_id,configured_location.id configured_location_id,coalesce(balance.on_hand,0)::text quantity,
    configured.intent#>>'{price,market}' configured_market,configured.intent#>>'{price,currency}' configured_currency,
    EXISTS(SELECT 1 FROM public.gift_variant_recipient_rules rule WHERE rule.gift_variant_id=v.id AND rule.rule='ALL_ACTIVE_ARTISTS') AS all_artists
    FROM public.gift_variants v LEFT JOIN public.inventory_items i ON i.gift_variant_id=v.id
    LEFT JOIN LATERAL(SELECT l.id FROM public.inventory_locations l JOIN public.inventory_balances b ON b.location_id=l.id AND b.inventory_item_id=i.id WHERE l.status='ACTIVE' ORDER BY l.id LIMIT 1) location ON true
    LEFT JOIN public.inventory_balances balance ON balance.inventory_item_id=i.id AND balance.location_id=location.id
    LEFT JOIN public.gift_publication_heads head ON head.gift_id=v.gift_id AND head.gift_revision_id=$2
    LEFT JOIN public.daily_publication_revisions daily ON daily.revision_id=head.gift_revision_id AND daily.object_kind='GIFT' AND daily.object_id=v.gift_id
    LEFT JOIN public.daily_publication_manifests manifest ON manifest.publication_id=head.publication_id AND manifest.revision_id=daily.revision_id AND manifest.operation_id=daily.operation_id
    LEFT JOIN public.management_operations configured ON configured.id=manifest.operation_id AND configured.status='SUCCEEDED' AND configured.target_id=v.gift_id
      AND configured.result->>'publicationId'=manifest.publication_id::text AND configured.result->>'revisionId'=daily.revision_id::text
      AND configured.intent->>'kind'='SAVE_GIFT'
    LEFT JOIN public.inventory_locations configured_location ON configured.intent#>>'{inventory,policy}'='TRACKED' AND configured_location.id=(configured.intent#>>'{inventory,locationId}')::uuid AND configured_location.status='ACTIVE'
    WHERE v.gift_id=$1 AND v.status<>'archived' ORDER BY v.created_at,v.id LIMIT 1`,
    [row["id"], row["revision_id"]],
  );
  const [price] = variant
    ? await draftRows(
        client,
        `SELECT h.market,h.currency,p.amount_minor FROM public.price_book_publication_heads h JOIN public.price_book_publications publication ON publication.id=h.publication_id JOIN public.price_books b ON b.id=h.price_book_id AND b.revision=h.price_book_revision JOIN public.prices p ON p.price_book_id=b.id AND p.price_book_revision=b.revision AND p.market=h.market AND p.currency=h.currency JOIN public.markets m ON m.id=h.market_id AND m.status='ACTIVE' WHERE p.gift_variant_id=$1 AND ($2::text IS NULL OR (h.market=$2 AND h.currency=$3)) AND b.valid_from<=transaction_timestamp() AND (b.valid_until IS NULL OR b.valid_until>transaction_timestamp()) AND p.valid_from<=transaction_timestamp() AND (p.valid_to IS NULL OR p.valid_to>transaction_timestamp()) AND ((publication.action='PUBLISH' AND p.status='PUBLISHED') OR (publication.action='ROLLBACK' AND p.status IN('PUBLISHED','SUPERSEDED'))) ORDER BY h.market,h.currency LIMIT 1`,
        [
          variant["id"],
          variant["configured_market"] ?? null,
          variant["configured_currency"] ?? null,
        ],
      )
    : [];
  const locationId =
    variant?.["location_id"] ?? variant?.["configured_location_id"] ?? null;
  return {
    giftKind: row["gift_kind"] ?? "OTHER",
    category: row["category"] ?? "OTHER",
    price: price
      ? {
          market: price["market"],
          currency: price["currency"],
          amountMinor: Number(price["amount_minor"]),
        }
      : null,
    inventory:
      !variant ||
      (variant["inventory_policy"] === "TRACKED" && locationId === null)
        ? null
        : variant["inventory_policy"] === "TRACKED"
          ? {
              policy: "TRACKED",
              locationId,
              quantity: Number(variant["quantity"]),
            }
          : { policy: variant["inventory_policy"] },
    eligibility: {
      rule:
        variant?.["all_artists"] === true
          ? "ALL_ACTIVE_ARTISTS"
          : "EXPLICIT_ARTISTS",
    },
    canEdit:
      price !== undefined &&
      Number(variant?.["variant_count"]) === 1 &&
      variant?.["all_artists"] === true &&
      (variant["inventory_policy"] !== "TRACKED" || locationId !== null),
    inventoryPolicyLocked:
      variant?.["inventory_item_id"] !== null &&
      variant?.["inventory_item_id"] !== undefined,
  };
}
export async function readManagementCenterList(
  client: TransactionClient,
  command: Extract<ManagementCenterCommand, { action: "LIST" }>,
  publicMediaBaseUrl: string,
) {
  if (command.section === "POSTERS")
    return readPosters(client, command, publicMediaBaseUrl);
  const artist = command.section === "ARTISTS",
    table = artist ? "idols" : "gifts",
    revision = artist ? "idol" : "gift";
  const [count] = await draftRows(
    client,
    // Deleted (archived) artists and gifts leave the daily list; orders keep their own snapshots.
    `SELECT count(*)::text total FROM public.${table} WHERE status<>'archived'`,
  );
  const rows = await draftRows(
    client,
    `SELECT o.id,o.handle,o.version,o.status,r.id revision_id,coalesce(d.source_locale::text,t.locale::text,'en') source_locale,
    coalesce(d.document->'source'->'fields'->>'${artist ? "displayName" : "title"}',t.${artist ? "display_name" : "title"},o.handle) name,
    coalesce(d.document->'source'->'fields'->>'${artist ? "fullBio" : "description"}',t.${artist ? "full_bio" : "description"},'') description,
    media.media_asset_id ${artist ? "" : ",r.category,coalesce(d.document->>'giftKind',profile.gift_kind) gift_kind"}
    FROM public.${table} o LEFT JOIN public.${revision}_revisions r ON r.id=coalesce(o.published_revision_id,o.draft_revision_id)
    LEFT JOIN public.daily_publication_revisions d ON d.revision_id=r.id
    LEFT JOIN public.${revision}_revision_translations t ON t.${revision}_revision_id=r.id AND t.locale='en'
    LEFT JOIN LATERAL(SELECT media_asset_id FROM public.${revision}_revision_media m WHERE m.${revision}_revision_id=r.id AND m.role='${artist ? "PORTRAIT" : "PRIMARY"}' ORDER BY m.sort_order LIMIT 1) media ON true
    ${artist ? "" : "LEFT JOIN public.gift_revision_profiles profile ON profile.gift_revision_id=r.id"}
    WHERE o.status<>'archived'
    ORDER BY o.created_at DESC,o.id DESC LIMIT $1 OFFSET $2`,
    [command.pageSize, (command.page - 1) * command.pageSize],
  );
  const items = [];
  for (const row of rows)
    items.push({
      kind: artist ? "ARTIST" : "GIFT",
      id: row["id"],
      version: Number(row["version"]),
      sourceLocale: row["source_locale"],
      name: row["name"],
      description: row["description"],
      image: await thumbnail(
        client,
        row["media_asset_id"],
        String(row["name"]),
        publicMediaBaseUrl,
      ),
      status: row["status"],
      handle: row["handle"],
      ...(!artist ? await giftDetails(client, row) : {}),
    });
  return managementCenterResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LIST",
    section: command.section,
    page: command.page,
    pageSize: command.pageSize,
    totalItems: Number(count?.["total"]),
    items,
  });
}
async function readPosters(
  client: TransactionClient,
  command: Extract<ManagementCenterCommand, { action: "LIST" }>,
  publicMediaBaseUrl: string,
) {
  const query = `FROM public.homepage_revisions r JOIN public.homepage_slots s ON s.homepage_revision_id=r.id AND s.kind='HERO_IDOL' JOIN public.content_publications p ON p.homepage_revision_id=r.id AND p.action='PUBLISH' LEFT JOIN public.homepage_publication_heads h ON true LEFT JOIN public.daily_publication_revisions d ON d.revision_id=r.id LEFT JOIN public.homepage_revision_translations t ON t.homepage_revision_id=r.id AND t.locale='en' WHERE r.lifecycle<>'ARCHIVED'`;
  const [count] = await draftRows(
    client,
    `SELECT count(*)::text total ${query}`,
  );
  const rows = await draftRows(
    client,
    `SELECT r.id,h.version,h.homepage_revision_id=r.id AS current,coalesce(d.source_locale::text,'en') source_locale,coalesce(d.document->'source'->'fields'->>'heroTitle',t.hero_title) AS image_alt,s.desktop_media_asset_id,s.mobile_media_asset_id,${utcTimestampSql("p.published_at")} AS created_at ${query} ORDER BY p.published_at DESC,p.id DESC LIMIT $1 OFFSET $2`,
    [command.pageSize, (command.page - 1) * command.pageSize],
  );
  const items = [];
  for (const row of rows) {
    const image = await thumbnail(
      client,
      row["desktop_media_asset_id"],
      String(row["image_alt"] ?? ""),
      publicMediaBaseUrl,
    );
    const mobile =
      image === null
        ? null
        : await thumbnail(
            client,
            row["mobile_media_asset_id"],
            image.alt,
            publicMediaBaseUrl,
          );
    items.push({
      kind: "POSTER",
      id: row["id"],
      version: Number(row["version"]),
      sourceLocale: row["source_locale"],
      sourceRevisionId: row["id"],
      current: row["current"],
      image,
      canRestore: image !== null && mobile !== null && row["current"] !== true,
      canDelete: row["current"] !== true,
      createdAt: row["created_at"],
    });
  }
  return managementCenterResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LIST",
    section: "POSTERS",
    page: command.page,
    pageSize: command.pageSize,
    totalItems: Number(count?.["total"]),
    items,
  });
}

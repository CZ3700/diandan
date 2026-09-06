import { randomUUID } from "node:crypto";
import { URL } from "node:url";

const stateTables = [
  "content_publications",
  "outbox_events",
  "audit_logs",
  "idempotency_records",
  "idols",
  "gifts",
  "policies",
  "media_assets",
  "idol_publication_heads",
  "gift_publication_heads",
  "homepage_publication_heads",
  "policy_publication_heads",
  "media_metadata_publication_heads",
  "site_locale_config_publication_heads",
  "price_book_publication_heads",
  "payment_config_publication_heads",
  "idol_revisions",
  "gift_revisions",
  "homepage_revisions",
  "policy_revisions",
  "media_metadata_revisions",
  "idol_translation_reviews",
  "gift_translation_reviews",
  "homepage_translation_reviews",
  "policy_translation_reviews",
  "media_metadata_translation_reviews",
  "idol_revision_alias_reviews",
  "gift_detail_translation_reviews",
];

export function firstReferencedMediaAsset(snapshot) {
  switch (snapshot.content.kind) {
    case "MEDIA_METADATA":
      return snapshot.target.mediaAssetId;
    case "HOMEPAGE":
      return snapshot.content.structure.slots.find(
        (slot) => slot.desktopMediaAssetId,
      ).desktopMediaAssetId;
    case "IDOL":
    case "GIFT":
      return snapshot.content.media[0].mediaAssetId;
    default:
      throw new Error("UNSUPPORTED_MEDIA_FIXTURE");
  }
}

/** Digests compare complete business rows without copying their contents into test output. */
export async function preflightBusinessState(client) {
  const result = await client.query(
    stateTables
      .map(
        (table) =>
          `SELECT '${table}' AS table_name, md5(coalesce(jsonb_agg(to_jsonb(entry) ORDER BY to_jsonb(entry)::text),'[]'::jsonb)::text) AS digest FROM public.${table} entry`,
      )
      .join(" UNION ALL "),
  );
  return JSON.stringify(result.rows);
}

export function unrelatedPreflightOwner(owner) {
  switch (owner.kind) {
    case "IDOL":
      return { kind: "IDOL", idolId: randomUUID() };
    case "GIFT":
      return { kind: "GIFT", giftId: randomUUID() };
    case "MEDIA_METADATA":
      return { kind: "MEDIA_METADATA", mediaAssetId: randomUUID() };
    case "POLICY":
      return { kind: "POLICY", policyKey: "unrelated-fixture-policy" };
    case "HOMEPAGE":
      return { kind: "POLICY", policyKey: "unrelated-fixture-policy" };
  }
}

export function preflightEnvironment(config) {
  const database = new URL("postgresql://localhost");
  database.hostname = config.host;
  database.port = String(config.port);
  database.username = config.user;
  database.password = config.password;
  database.pathname = `/${config.database}`;
  return {
    NODE_ENV: "test",
    FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3002",
    FAN_SUPPORT_DATABASE_URL: database.toString(),
    FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "static",
    FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "https://object-storage:9000",
    FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT: "https://object-storage:9000",
    FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "fan-support-media-source",
    FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET:
      "fan-support-media-derivative",
    FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
      "https://media.example.invalid",
    FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
    FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: "TEST_ACCESS_KEY_ID",
    FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY:
      "TEST_OBJECT_STORAGE_SECRET_VALUE",
    FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
  };
}

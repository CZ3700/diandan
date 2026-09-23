import assert from "node:assert/strict";
import { Client } from "pg";
import { supportedLocaleSchema } from "@fan-support/contracts";
import { createPostgresPersistence } from "@fan-support/persistence-postgres";
import { verifyGiftBrowsePublicationCases } from "../../../packages/persistence-postgres/scripts/gift-browse-publication-cases.mjs";

/** Read the actual simple-management publication. Queries do not mutate business rows. */
export async function verifyAccessibilityDailyBrowse({ config, facts }) {
  const database = {
    host: "127.0.0.1",
    port: config.ports.postgres,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
  };
  const client = new Client(database);
  const persistence = createPostgresPersistence(database, {
    catalogPublicMediaBaseUrl: config.origins.media,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT d.source_locale FROM public.gift_publication_heads h
       JOIN public.daily_publication_revisions d ON d.revision_id=h.gift_revision_id
         AND d.object_id=h.gift_id AND d.object_kind='GIFT' WHERE h.gift_id=$1`,
      [facts.giftId],
    );
    assert(
      rows.length === 1,
      "Exactly one actual daily gift head supplies the source locale",
    );
    const sourceLocale = supportedLocaleSchema.parse(rows[0].source_locale);
    return await verifyGiftBrowsePublicationCases({
      persistence,
      giftId: facts.giftId,
      idolId: facts.artistId,
      sourceLocale,
    });
  } finally {
    const results = await Promise.allSettled([
      client.end(),
      persistence.close(),
    ]);
    assert(
      results.every((result) => result.status === "fulfilled"),
      "Daily browse read connections close successfully",
    );
  }
}

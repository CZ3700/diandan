import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { withLocalHomepageSessions } from "./local-experience-homepage-sessions.mjs";

/** The studio stock location a local TEST instance offers by default (wishes and limited gifts). */
export const LOCAL_DEFAULT_LOCATION_CODE = "STUDIO_DEFAULT";

const publishedDefaultsSql = `SELECT c.id,c.version,d.market,d.currency,d.inventory_location_id,d.eligibility_rule,d.artist_presentation
 FROM public.management_defaults d JOIN public.config_versions c ON c.id=d.config_version_id
 WHERE c.config_kind='MANAGEMENT_DEFAULTS' AND c.lifecycle='PUBLISHED'`;

/**
 * Wishes are always limited stock and the management center takes their stock location from the
 * published defaults, which the first bootstrap leaves empty. An instance without a default gets
 * one studio location through the audited commerce API and a new defaults version pointing at it;
 * a default that already exists is never replaced.
 */
export async function applyLocalDefaultInventoryLocation({
  client,
  managerId,
  createLocation,
}) {
  const published = (await client.query(publishedDefaultsSql)).rows;
  if (published.length !== 1)
    throw new Error("LOCAL_MANAGEMENT_DEFAULTS_UNAVAILABLE");
  const [current] = published;
  if (current.inventory_location_id !== null)
    return {
      outcome: "PRESERVED",
      locationId: current.inventory_location_id,
    };
  const existing = (
    await client.query(
      "SELECT id,status FROM public.inventory_locations WHERE location_key=$1",
      [LOCAL_DEFAULT_LOCATION_CODE],
    )
  ).rows[0];
  if (existing && existing.status !== "ACTIVE")
    throw new Error("LOCAL_DEFAULT_LOCATION_INACTIVE");
  const locationId =
    existing?.id ?? (await createLocation(LOCAL_DEFAULT_LOCATION_CODE));
  const next = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO public.config_versions(id,config_kind,version,lifecycle,created_by) VALUES($1,'MANAGEMENT_DEFAULTS',$2,'DRAFT',$3)",
      [next, Number(current.version) + 1, managerId],
    );
    // A default location requires the TRACKED marker; new ordinary gifts still start on demand.
    await client.query(
      "INSERT INTO public.management_defaults(config_version_id,market,currency,inventory_policy,inventory_location_id,eligibility_rule,artist_presentation) VALUES($1,$2,$3,'TRACKED',$4,$5,$6)",
      [
        next,
        current.market,
        current.currency,
        locationId,
        current.eligibility_rule,
        current.artist_presentation,
      ],
    );
    await client.query(
      "UPDATE public.config_versions SET lifecycle='VALIDATED' WHERE id=$1",
      [next],
    );
    const superseded = await client.query(
      "UPDATE public.config_versions SET lifecycle='SUPERSEDED' WHERE id=$1 AND lifecycle='PUBLISHED'",
      [current.id],
    );
    if (superseded.rowCount !== 1)
      throw new Error("LOCAL_MANAGEMENT_DEFAULTS_CHANGED");
    await client.query(
      "UPDATE public.config_versions SET lifecycle='PUBLISHED',published_at=clock_timestamp() WHERE id=$1",
      [next],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { outcome: "CONFIGURED", locationId };
}

/** Runs on every start after the API is ready; synthetic staff sessions last only for the request. */
export async function ensureLocalDefaultInventoryLocation({
  database,
  config,
  business,
  base,
  progress = () => undefined,
}) {
  if (config.environment !== "LOCAL_TEST")
    throw new Error("Default inventory location requires local TEST");
  const client = new Client(database);
  await client.connect();
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('local-experience-default-location',0))",
    );
    await client.query(
      "CREATE TABLE IF NOT EXISTS local_experience.default_location_bootstrap(id integer PRIMARY KEY CHECK(id=1),session_ids uuid[] NOT NULL)",
    );
    const saveSessionIds = (ids) =>
      client.query(
        "INSERT INTO local_experience.default_location_bootstrap(id,session_ids) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET session_ids=EXCLUDED.session_ids",
        [ids],
      );
    // An interrupted earlier start may have recorded sessions it could not revoke.
    const leftover =
      (
        await client.query(
          "SELECT session_ids FROM local_experience.default_location_bootstrap WHERE id=1",
        )
      ).rows[0]?.session_ids ?? [];
    if (leftover.length > 0) {
      await client.query(
        "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[]) AND revoked_at IS NULL",
        [leftover],
      );
      await saveSessionIds([]);
    }
    const result = await applyLocalDefaultInventoryLocation({
      client,
      managerId: business.managerId,
      createLocation: (code) => {
        progress("default TEST inventory location");
        return withLocalHomepageSessions(
          { client, config, base, saveSessionIds },
          async (content) =>
            (
              await content.write(
                "/api/v1/admin/gift-commerce/inventory/locations/create",
                { code, expectedVersion: 0 },
                "manager",
              )
            ).inventoryLocationId,
        );
      },
    });
    return result;
  } finally {
    await client.end();
  }
}

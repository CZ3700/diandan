import assert from "node:assert/strict";
import { Client } from "pg";
import {
  SUPPORTED_LOCALES,
  storefrontHomepageResponseSchema,
} from "@fan-support/contracts";
import { loadLocalState } from "../../../scripts/local-experience-state.mjs";
import { bootstrapLocalHomepageOnce } from "./local-experience-homepage.mjs";
import { fileURLToPath, URL } from "node:url";

/** Runs only after an actual locally uploaded artist has published. No seed, truncation or service restart. */
export async function verifyLocalHomepage({ workspaceRoot, instance }) {
  const state = await loadLocalState(workspaceRoot, instance),
    config = state.config;
  const database = {
    host: "127.0.0.1",
    port: config.ports.postgres,
    ...config.database,
    ssl: false,
  };
  const client = new Client(database);
  await client.connect();
  let checks = 0;
  const check = (value, message) => {
    checks++;
    assert.ok(value, message);
  };
  try {
    const before = (
      await client.query(
        "SELECT to_jsonb(h.*) value FROM homepage_publication_heads h",
      )
    ).rows;
    const sessions = [],
      original = Client.prototype.query;
    Client.prototype.query = function (...args) {
      if (
        typeof args[0] === "string" &&
        args[0].startsWith("INSERT INTO admin_sessions")
      )
        sessions.push(args[1][0]);
      return original.apply(this, args);
    };
    let result;
    try {
      result = await bootstrapLocalHomepageOnce({ config, database });
    } finally {
      Client.prototype.query = original;
    }
    check(
      result.done,
      "A real published artist and delivery policy must be available",
    );
    const after = (
      await client.query(
        "SELECT to_jsonb(h.*) value FROM homepage_publication_heads h",
      )
    ).rows;
    check(after.length === 1, "One actual homepage publication head exists");
    if (before.length)
      check(
        JSON.stringify(after) === JSON.stringify(before),
        "An existing homepage is preserved byte for byte",
      );
    await bootstrapLocalHomepageOnce({ config, database });
    check(
      JSON.stringify(
        (
          await client.query(
            "SELECT to_jsonb(h.*) value FROM homepage_publication_heads h",
          )
        ).rows,
      ) === JSON.stringify(after),
      "Reopening does not replace the homepage",
    );
    if (sessions.length)
      check(
        (
          await client.query(
            "SELECT count(*)::int n FROM admin_sessions WHERE id=ANY($1::uuid[]) AND revoked_at IS NOT NULL",
            [sessions],
          )
        ).rows[0].n === sessions.length,
        "Every temporary bootstrap session was revoked",
      );
    const reviews = (
      await client.query(
        "SELECT count(DISTINCT t.locale)::int n,bool_and(r.reviewer_id<>t.editor_id) AS independent FROM homepage_publication_heads h JOIN homepage_revision_translations t ON t.homepage_revision_id=h.homepage_revision_id JOIN homepage_translation_reviews r ON r.homepage_translation_id=t.id AND r.status='APPROVED'",
      )
    ).rows[0];
    check(
      reviews.n === SUPPORTED_LOCALES.length && reviews.independent,
      "All seven languages have actual independent approval",
    );
    const bootstrap = (
      await client.query(
        "SELECT state FROM local_experience.homepage_bootstrap WHERE id=1",
      )
    ).rows[0]?.state;
    if (bootstrap?.posterAssetVersion === 2) {
      const assets = Object.values(bootstrap.posterAssets);
      check(
        assets.length === 2 &&
          new Set(assets.map((asset) => asset.sourceAssetId)).size === 2,
        "Desktop and mobile use independent actual originals",
      );
      const masters = (
        await client.query(
          "SELECT j.id,j.status,j.source_asset_id,j.output_asset_id,s.checksum_sha256 FROM media_processing_jobs j JOIN media_assets s ON s.id=j.source_asset_id WHERE j.id=ANY($1::uuid[])",
          [assets.map((asset) => asset.jobId)],
        )
      ).rows;
      check(
        masters.length === 2 &&
          assets.every((asset) =>
            masters.some(
              (job) =>
                job.id === asset.jobId &&
                job.status === "SUCCEEDED" &&
                job.source_asset_id === asset.sourceAssetId &&
                job.output_asset_id === asset.assetId &&
                job.checksum_sha256 === asset.sourceChecksum,
            ),
          ),
        "Independent strict Worker committed both exact original-to-master chains",
      );
      check(
        bootstrap.sessionIds.length === 0,
        "Persistent bootstrap has no outstanding temporary sessions",
      );
      check(
        (
          await client.query(
            "SELECT count(*)::int n FROM content_publications WHERE media_metadata_revision_id=ANY($1::uuid[]) AND proof_version=2 AND action='PUBLISH'",
            [assets.map((asset) => asset.metadata.revisionId)],
          )
        ).rows[0].n === 2,
        "Both poster masters passed the unmodified full publication gate",
      );
    }
    for (const locale of SUPPORTED_LOCALES) {
      const response = await globalThis.fetch(
        `http://127.0.0.1:${config.ports.api}/api/v1/storefront-homepage?locale=${locale}`,
        { signal: globalThis.AbortSignal.timeout(30000) },
      );
      const body = storefrontHomepageResponseSchema.parse(
        await response.json(),
      );
      check(
        response.status === 200 && body.outcome === "SUCCESS",
        "Published homepage renders in " + locale,
      );
      check(
        body.slots.some(
          (slot) => slot.kind === "HERO_IDOL" && slot.status === "AVAILABLE",
        ),
        "Actual hero artist resolves in " + locale,
      );
    }
    return {
      schemaVersion: 1,
      status: "PASS",
      checks,
      realPostgres: true,
      realHttp: true,
      preservedOnReopen: true,
    };
  } finally {
    await client.end();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const instance = process.argv[2];
  if (!instance)
    throw new Error("Pass the explicitly running local instance name");
  const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
  console.log(
    JSON.stringify(await verifyLocalHomepage({ workspaceRoot, instance })),
  );
}

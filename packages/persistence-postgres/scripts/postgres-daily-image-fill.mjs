#!/usr/bin/env node
// Migration 0041 (daily image fill, user decision 2026-09-27): the processing recipe accepts
// COVER_ALLOW_ENLARGE only from 0041, existing recipes survive the upgrade, and the rollback
// refuses to discard filled processing history while an empty 0041 still rolls back and re-applies.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const hex = (value) => createHash("sha256").update(value).digest("hex");
let assertions = 0;
let stage = "migrate to 0040";
const check = (condition, label) => {
  stage = label;
  assert.ok(condition, label);
  assertions++;
};
const migrate = (clientConfig, command) =>
  runMigrations({ clientConfig, workspaceRoot, command });
const head = async (client) =>
  (await client.query("SELECT max(version) v FROM public.schema_migrations"))
    .rows[0].v;

/** Inserts one queued job; replica mode skips triggers and foreign keys, never CHECK constraints. */
async function insertJob(client, fit) {
  const id = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `INSERT INTO public.media_processing_jobs(id,schema_version,source_asset_id,source_metadata_revision_id,source_checksum_sha256,profile_version,role,fit,focal_x,focal_y,command_hash,requested_by,reason,status,attempt_count,next_attempt_at,created_at,updated_at,generation)
       VALUES($1,1,$2,$3,$4,1,'PORTRAIT',$5,0.5,0.3,$6,$7,'daily image fill probe','PENDING',0,now(),now(),now(),1)`,
      [
        id,
        randomUUID(),
        randomUUID(),
        hex(`source:${id}`),
        fit,
        hex(`command:${id}`),
        randomUUID(),
      ],
    );
    await client.query("COMMIT");
    return { id, code: null, constraint: null };
  } catch (error) {
    await client.query("ROLLBACK");
    return {
      id,
      code: error?.code ?? "UNKNOWN",
      constraint: error?.constraint ?? null,
    };
  }
}

try {
  await withEphemeralPostgres(async (clientConfig) => {
    const client = new Client(clientConfig);
    await client.connect();
    try {
      await migrate(clientConfig, { direction: "up", targetVersion: "0040" });
      const early = await insertJob(client, "COVER_ALLOW_ENLARGE");
      check(
        early.code === "23514" &&
          early.constraint === "media_processing_jobs_fit_check",
        "0040 refuses the daily fill recipe",
      );
      check(
        (await insertJob(client, "CONTAIN")).code === null,
        "0040 keeps its contain history",
      );

      stage = "upgrade with existing processing history";
      await migrate(clientConfig, { direction: "up", targetVersion: "0041" });
      check((await head(client)) === "0041", "upgrade reaches 0041");
      const filled = await insertJob(client, "COVER_ALLOW_ENLARGE");
      check(filled.code === null, "0041 accepts the daily fill recipe");
      check(
        (await insertJob(client, "FILL")).code === "23514",
        "unknown recipes stay rejected",
      );

      stage = "rollback refusal";
      let refused = false;
      try {
        await migrate(clientConfig, {
          direction: "down",
          confirmVersion: "0041",
        });
      } catch {
        refused = true;
      }
      check(refused, "rollback refuses to discard filled processing history");
      check((await head(client)) === "0041", "the refused rollback is atomic");

      // Remove only the probe row (replica mode bypasses the append-only guard) for an empty down/up.
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        "DELETE FROM public.media_processing_jobs WHERE id=$1",
        [filled.id],
      );
      await client.query("COMMIT");
      await migrate(clientConfig, {
        direction: "down",
        confirmVersion: "0041",
      });
      check((await head(client)) === "0040", "an empty 0041 rolls back");
      check(
        (await insertJob(client, "COVER_ALLOW_ENLARGE")).code === "23514",
        "rollback restores the strict recipe list",
      );
      await migrate(clientConfig, { direction: "up", targetVersion: "0041" });
      check((await head(client)) === "0041", "0041 re-applies after rollback");
    } catch (error) {
      // The harness replaces callback errors; report only a safe classification first.
      console.error(
        JSON.stringify({
          suite: "daily-image-fill",
          stage,
          code: error?.code ?? error?.name ?? "UNKNOWN",
        }),
      );
      throw error;
    } finally {
      await client.end();
    }
  });
  console.log(
    JSON.stringify({ suite: "daily-image-fill", status: "PASS", assertions }),
  );
} catch {
  console.error(
    JSON.stringify({ suite: "daily-image-fill", status: "FAIL", stage }),
  );
  process.exitCode = 1;
}

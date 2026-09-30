import assert from "node:assert/strict";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import {
  assertCatalogMatches,
  captureDatabaseCatalog,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
await withEphemeralPostgres(async (clientConfig) => {
  const migrate = (command) =>
    runMigrations({ clientConfig, workspaceRoot, command });
  const initial = await migrate({ direction: "up", targetVersion: "0061" });
  assert.equal(initial.currentVersion, "0061");
  assert.equal(initial.appliedVersions.length, 61);
  const client = new Client(clientConfig);
  await client.connect();
  try {
    const capture = () =>
      captureDatabaseCatalog({
        query: async (text, values = []) => {
          const result = await client.query(text, [...values]);
          return { rows: result.rows };
        },
      });
    const before = await capture();
    assert.equal(
      (
        await client.query(
          "SELECT public.wish_recipient_allowed(gen_random_uuid(),gen_random_uuid()) allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.deepEqual(
      (await migrate({ direction: "down", confirmVersion: "0061" }))
        .revertedVersions,
      ["0061"],
    );
    const baseline = await migrate({
      direction: "down",
      confirmVersion: "0060",
    });
    assert.equal(baseline.currentVersion, "0059");
    assert.equal(
      (await client.query("SELECT to_regclass('public.wish_bindings') binding"))
        .rows[0].binding,
      null,
    );
    assert.equal(
      (
        await client.query(
          "SELECT to_regclass('public.wish_gallery_entries') gallery",
        )
      ).rows[0].gallery,
      null,
    );
    const restored = await migrate({ direction: "up", targetVersion: "0061" });
    assert.deepEqual(restored.appliedVersions, ["0060", "0061"]);
    assert.equal(restored.currentVersion, "0061");
    assertCatalogMatches(await capture(), before);
    console.log(
      JSON.stringify({
        result: "PASS",
        database: "real isolated PostgreSQL",
        registeredHead: restored.currentVersion,
        checks: [
          "continuous registered 0001–0061 migrations",
          "unknown variant fails closed",
          "normal runner 0061 to 0059 to 0061",
          "restored exact database catalog",
        ],
      }),
    );
  } finally {
    await client.end();
  }
});

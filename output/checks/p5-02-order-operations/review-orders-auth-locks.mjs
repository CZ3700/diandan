import { createRequire } from "node:module";
import { URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { withEphemeralPostgres } from "../../../packages/persistence-postgres/dist/index.js";
const require = createRequire(new URL("../../../packages/persistence-postgres/package.json", import.meta.url));
const { Client } = require("pg");
await withEphemeralPostgres(async (config) => {
  const setup = new Client(config), revoke = new Client(config), authorize = new Client(config);
  await Promise.all([setup.connect(), revoke.connect(), authorize.connect()]);
  try {
    await setup.query("CREATE TABLE review_identities(id int PRIMARY KEY); CREATE TABLE review_sessions(id int PRIMARY KEY,admin_identity_id int REFERENCES review_identities(id),digest text); INSERT INTO review_identities VALUES(1); INSERT INTO review_sessions VALUES(1,1,'owned-fixture')");
    await revoke.query("BEGIN");
    await authorize.query("BEGIN");
    await revoke.query("SELECT id FROM review_identities WHERE id=1 FOR UPDATE");
    const authorization = authorize.query("SELECT i.id actor_id,s.id session_id FROM review_sessions s JOIN review_identities i ON i.id=s.admin_identity_id WHERE s.digest=$1 FOR SHARE OF s,i", ["owned-fixture"]).then(() => ({ kind: "authorize", ok: true }), (error) => ({ kind: "authorize", ok: false, code: error.code }));
    await delay(200);
    const revocation = revoke.query("SELECT id FROM review_sessions WHERE id=1 FOR UPDATE").then(() => ({ kind: "revoke", ok: true }), (error) => ({ kind: "revoke", ok: false, code: error.code }));
    const first = await Promise.race([authorization, revocation]);
    await (first.kind === "authorize" ? authorize : revoke).query("ROLLBACK");
    const outcomes = await Promise.all([authorization, revocation]);
    const result = { schemaVersion: 1, scope: "Synthetic isolated PG tables with exact application lock-query shape; no business data or database clock changes", actualPostgres: true, first, outcomes };
    console.log(JSON.stringify(result));
    await writeFile(new URL("./review-orders-auth-locks.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
  } finally {
    await Promise.all([authorize.query("ROLLBACK").catch(() => {}), revoke.query("ROLLBACK").catch(() => {})]);
    await Promise.all([setup.end(), authorize.end(), revoke.end()]);
  }
});

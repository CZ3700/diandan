#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import {
  adminOrdersAccessSchema,
  adminAccessRevokeCommandSchema,
} from "@fan-support/contracts";
import { withEphemeralPostgres, runMigrations } from "../dist/index.js";
import { authorizeAdminOrders } from "../dist/admin-orders-authorization.js";
import { createAdminAccessRepository } from "../dist/admin-access-repository.js";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const scope = { trackOperation: (work) => work(), markRollbackOnly: () => {} };
let checks = 0;
const outcomes = [];
let status = "FAIL";
const output = new URL(
  `../../../output/checks/p5-02-order-operations/persistence/auth-locks-${new Date().toISOString().replaceAll(":", "-")}.json`,
  import.meta.url,
);
await mkdir(new URL("./", output), { recursive: true });
try {
  await withEphemeralPostgres(async (config) => {
    await runMigrations({
      clientConfig: config,
      workspaceRoot,
      command: { direction: "up" },
    });
    const observer = new Client(config),
      revoker = new Client(config),
      reader = new Client(config);
    await Promise.all([
      observer.connect(),
      revoker.connect(),
      reader.connect(),
    ]);
    try {
      for (const revokeAll of [false, true]) {
        const actor = randomUUID(),
          sessionId = randomUUID();
        const access = adminOrdersAccessSchema.parse({
          schemaVersion: 1,
          sessionTokenDigest: randomBytes(32).toString("hex"),
          csrfTokenDigest: randomBytes(32).toString("hex"),
          requestId: randomUUID(),
          correlationId: randomUUID(),
        });
        await observer.query(
          "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'https://lock-order.example.test',$2,'ACTIVE')",
          [actor, randomBytes(32)],
        );
        await observer.query(
          "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()+interval '1 hour')",
          [
            sessionId,
            actor,
            Buffer.from(access.sessionTokenDigest, "hex"),
            Buffer.from(access.csrfTokenDigest, "hex"),
          ],
        );
        await revoker.query("BEGIN");
        await reader.query("BEGIN");
        await revoker.query(
          "SELECT id FROM admin_identities WHERE id=$1 FOR UPDATE",
          [actor],
        );
        const readerPid = (await reader.query("SELECT pg_backend_pid() pid"))
          .rows[0].pid;
        const pendingRead = (async () => {
          try {
            const result = await authorizeAdminOrders(reader, access, {
              permission: "orders.read",
            });
            await reader.query("COMMIT");
            return { result };
          } catch (error) {
            await reader.query("ROLLBACK");
            return { errorCode: error.code ?? error.failure?.error?.code };
          }
        })();
        let waiting = false;
        for (let poll = 0; poll < 100 && !waiting; poll++) {
          waiting =
            (
              await observer.query(
                "SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",
                [readerPid],
              )
            ).rows[0]?.waiting === true;
          if (!waiting) await delay(20);
        }
        assert.ok(
          waiting,
          "authorization reaches the held canonical identity lock",
        );
        checks++;
        const command = adminAccessRevokeCommandSchema.parse({
          schemaVersion: 1,
          requestId: randomUUID(),
          sessionTokenDigest: access.sessionTokenDigest,
          csrfTokenDigest: access.csrfTokenDigest,
          revokeAll,
        });
        let revoked;
        try {
          revoked = {
            result: await createAdminAccessRepository(revoker, scope).revoke(
              command,
            ),
          };
          await revoker.query("COMMIT");
        } catch (error) {
          await revoker.query("ROLLBACK");
          revoked = { errorCode: error.code ?? error.failure?.error?.code };
        }
        const authorized = await pendingRead;
        const outcome = {
          revokeAll,
          authorization: authorized.errorCode ?? authorized.result?.code,
          revocation: revoked.errorCode ?? revoked.result?.kind,
        };
        outcomes.push(outcome);
        console.log(JSON.stringify(outcome));
        assert.equal(
          revoked.result?.kind,
          "LOGGED_OUT",
          "existing logout commits without a deadlock",
        );
        checks++;
        assert.equal(
          authorized.result?.code,
          "UNAUTHENTICATED",
          "waiting authorization observes committed revocation without retry",
        );
        checks++;
      }
    } finally {
      await Promise.all([reader.end(), revoker.end(), observer.end()]);
    }
  });
  status = "PASS";
  console.log(JSON.stringify({ status, checks }));
} finally {
  await writeFile(
    output,
    `${JSON.stringify({ status, checks, outcomes, scope: "Actual complete schema, shared order authorization and existing logout repository; no business rows or clock mutation." }, null, 2)}\n`,
  );
}

/** Dedicated, no-delivery TEST receiver process. Only receipts/hashes are persisted. */
import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import { Pool } from "pg";
import {
  notificationEmailDispatchSchema,
  notificationGatewayProfileSchema,
  notificationGatewayReceiptSchema,
} from "@fan-support/contracts";
import { tlsHarness } from "../../../packages/notification-provider/src/harness.tls.ts";

const sha = (value) => createHash("sha256").update(value).digest("hex");
let pool,
  server,
  profile,
  profileHash,
  table,
  authorization,
  dropNext = false;
const fail = (code) => ({
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  outcome: "FAILURE",
  error: { schemaVersion: 1, code, recovery: "NONE" },
});
function receiptFor(email, requestHash, result) {
  return notificationGatewayReceiptSchema.parse({
    schemaVersion: 1,
    protocol: profile.protocol,
    profileHash,
    notificationId: email.notification.id,
    idempotencyKey: email.notification.idempotencyKey,
    requestHash,
    result,
  });
}
async function accept(email, requestHash) {
  const key = email.notification.idempotencyKey;
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [key],
    );
    const prior = (
      await connection.query(
        `SELECT request_hash,receipt,retained_until>clock_timestamp() retained FROM ${table} WHERE idempotency_key=$1 FOR UPDATE`,
        [key],
      )
    ).rows[0];
    if (prior?.retained) {
      await connection.query("COMMIT");
      return {
        receipt:
          prior.request_hash === requestHash
            ? prior.receipt
            : receiptFor(email, requestHash, fail("IDEMPOTENCY_CONFLICT")),
        accepted: false,
      };
    }
    if (prior)
      await connection.query(`DELETE FROM ${table} WHERE idempotency_key=$1`, [
        key,
      ]);
    // The same database instant checks the cutoff and records acceptance after the key lock.
    // The TEST side effect is this row only; a real gateway needs atomic provider admission.
    const inserted = await connection.query(
      `WITH moment AS MATERIALIZED (SELECT clock_timestamp() now)
      INSERT INTO ${table}(idempotency_key,request_hash,receipt,retained_until)
      SELECT $1,$2,jsonb_build_object('schemaVersion',1,'protocol','fan-support-mail-v1','profileHash',$3::text,'notificationId',$4::text,'idempotencyKey',$1::text,'requestHash',$2::text,'result',jsonb_build_object('schemaVersion',1,'operation','SEND_NOTIFICATION','outcome','SUCCESS','value',jsonb_build_object('status','ACCEPTED','providerReference',$5::text,'acceptedAt',to_char(moment.now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))),moment.now+($7::integer*interval '1 second')
      FROM moment WHERE moment.now<$6::timestamptz AND $6::timestamptz<=moment.now+($7::integer*interval '1 second') RETURNING receipt`,
      [
        key,
        requestHash,
        profileHash,
        email.notification.id,
        `test-mail/${email.notification.id}`,
        email.dispatchNotAfter,
        profile.idempotencyRetentionSeconds,
      ],
    );
    await connection.query("COMMIT");
    return {
      receipt:
        inserted.rows[0]?.receipt ??
        receiptFor(email, requestHash, fail("CONFIGURATION_ERROR")),
      accepted: inserted.rowCount === 1,
    };
  } catch {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw new Error("TEST receiver transaction unavailable");
  } finally {
    connection.release();
  }
}
async function handle(request, response) {
  try {
    const supplied = Buffer.from(String(request.headers.authorization ?? "")),
      expected = Buffer.from(authorization);
    if (
      request.method !== "POST" ||
      request.url !== "/v1/notification-commands" ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      response.writeHead(403);
      response.end();
      return;
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 3000000) {
        response.writeHead(413);
        response.end();
        return;
      }
      chunks.push(chunk);
    }
    const body = new TextDecoder("utf8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    const input = JSON.parse(body);
    const email = notificationEmailDispatchSchema.safeParse(input.email);
    if (
      !email.success ||
      input.schemaVersion !== 1 ||
      input.protocol !== profile.protocol ||
      input.profileHash !== profileHash ||
      input.environment !== "TEST" ||
      input.from?.email !== profile.fromEmail ||
      input.from?.name !== profile.fromName ||
      input.replyTo !== profile.replyToEmail ||
      Object.keys(input).sort().join(",") !==
        "email,environment,from,profileHash,protocol,replyTo,schemaVersion" ||
      request.headers["idempotency-key"] !==
        email.data.notification.idempotencyKey
    ) {
      response.writeHead(400);
      response.end();
      return;
    }
    const accepted = await accept(email.data, sha(body));
    if (dropNext && accepted.receipt.result.outcome === "SUCCESS") {
      dropNext = false;
      request.socket.destroy();
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(accepted.receipt));
  } catch {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
}

process.on("message", async (message) => {
  try {
    if (message.command === "start") {
      if (
        !/^p406_mail_[a-f0-9]{32}$/u.test(message.schema) ||
        message.environment !== "TEST" ||
        typeof message.authorization !== "string"
      )
        throw new Error("TEST configuration rejected");
      table = `"${message.schema}".receipts`;
      authorization = `Bearer ${message.authorization}`;
      pool = new Pool({ ...message.database, max: 8 });
      server = await tlsHarness(
        (request, response) => {
          void handle(request, response);
        },
        { port: message.port ?? 0 },
      );
      profile = notificationGatewayProfileSchema.parse({
        ...message.profile,
        apiOrigin: server.origin,
      });
      if (profile.environment !== "TEST")
        throw new Error("TEST profile rejected");
      profileHash = sha(JSON.stringify(profile));
      process.send({
        kind: "ready",
        pid: process.pid,
        origin: server.origin,
        certificateAuthority: server.certificateAuthority,
        profileHash,
      });
    } else if (message.command === "drop-next") {
      dropNext = true;
      process.send({ kind: "armed" });
    } else if (message.command === "stop") {
      await server?.close();
      await pool?.end();
      process.send({ kind: "stopped" });
      process.exit(0);
    }
  } catch {
    process.send?.({ kind: "failed", code: "TEST_RECEIVER_UNAVAILABLE" });
  }
});
process.on("disconnect", () => {
  void (async () => {
    await server?.close();
    await pool?.end();
    process.exit(0);
  })();
});

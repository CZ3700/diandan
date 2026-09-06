import { randomUUID, randomBytes } from "node:crypto";
import { createResourceAuthorizationRepository } from "../dist/resource-authorization-repository.js";
import { createResourceManagementRepository } from "../dist/resource-management-repository.js";

/** Only this test query adapter models a delayed or backwards wall clock; the host clock is untouched. */
export async function verifyResourceTimeBoundaries({
  client,
  fixtures,
  seeds,
  equal,
  success,
}) {
  const scope = {
    markRollbackOnly: () => undefined,
    trackOperation: (work) => work(),
  };
  if (process.env["RESOURCE_TIME_CASE"] !== "expiry") {
    await client.query("BEGIN");
    try {
      const tx = (
        await client.query(
          `SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`,
        )
      ).rows[0].now;
      await client.query("SELECT pg_sleep(0.01)");
      const authorization = createResourceAuthorizationRepository(
        {
          query: (sql, values) => client.query(sql, values),
          release: () => undefined,
        },
        scope,
      );
      const principal = success(
        await authorization.authorize({
          schemaVersion: 1,
          permission: "content.media.upload",
          sessionTokenDigest: seeds[0].sessionTokenDigest,
          csrfTokenDigest: seeds[0].csrfTokenDigest,
        }),
        "authorize resource session with causal timestamp",
      ).principal;
      equal(
        principal.authorizedAt,
        tx,
        "resource authorization has a stable transaction time despite delayed wall clock read",
      );
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  await client.query("BEGIN");
  try {
    const at = (
      await client.query(`SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now,
      to_char((transaction_timestamp()+interval '900 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires`)
    ).rows[0];
    const uploadId = randomUUID();
    const adapter = {
      release: () => undefined,
      query: (sql, values) =>
        client.query(
          sql.includes("resource-management:reserve-upload")
            ? sql.replaceAll(
                "clock_timestamp()",
                "(clock_timestamp()-interval '1 second')",
              )
            : sql,
          values,
        ),
    };
    const resources = createResourceManagementRepository(adapter, scope);
    const ticket = success(
      await resources.reserveUpload({
        schemaVersion: 1,
        uploadId,
        objectKey: `uploads/v1/${uploadId}`,
        checksumSha256: randomBytes(32).toString("hex"),
        byteSize: 1024,
        mimeType: "image/png",
        rightsReference: "rights:clock-fixture",
        expectedVersion: 0,
        createdAt: at.now,
        expiresAt: at.expires,
        actorId: fixtures.editor,
        sessionId: fixtures.sessions.editor,
        requestId: randomUUID(),
        reasonCode: "RESOURCE_CLOCK_FIXTURE",
      }),
      "reserve caps expiry against actual wall clock",
    ).value;
    equal(
      (
        await client.query(
          "SELECT $1::timestamptz<$2::timestamptz AS shorter",
          [ticket.expiresAt, at.expires],
        )
      ).rows[0].shorter,
      true,
      "database can only shorten requested upload expiry after a clock rollback",
    );
    equal(
      ticket.createdAt,
      at.now,
      "shortening expiry never changes canonical creation time",
    );
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

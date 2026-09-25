import { randomUUID } from "node:crypto";
import { createOrderAccessUseCases } from "@fan-support/application";

/** The injected exception occurs inside the real transaction after repository writes, before PostgreSQL COMMIT. */
export async function verifyOrderAccessRollback({ context, link, check }) {
  const real = context.persistence.orderAccessTransactionManager;
  let injected = false;
  const useCases = createOrderAccessUseCases({
    transactions: {
      runInOrderAccessTransaction: (work) =>
        real.runInOrderAccessTransaction(async (repository) => {
          await work(repository);
          injected = true;
          throw new Error("OWNED_TEST_ACCESS_BEFORE_COMMIT");
        }),
    },
  });
  const counts = async () =>
    (
      await context.client.query(
        "SELECT t.status,(SELECT count(*)::int FROM order_access_sessions s WHERE s.exchanged_token_id=t.id) AS sessions,(SELECT count(*)::int FROM order_access_audits a WHERE a.token_id=t.id) AS audits FROM order_access_tokens t WHERE t.token_digest=decode($1,'hex')",
        [link.access.tokenDigest],
      )
    ).rows[0];
  const before = await counts();
  const session = await context.credentials.issueSession();
  const result = await useCases.exchange({
    schemaVersion: 1,
    tokenCandidates: [link.access],
    sessionCredential: session.access,
    sessionTtlSeconds: context.configuration.sessionTtlSeconds,
    requestId: randomUUID(),
    correlationId: randomUUID(),
    taskName: "order-access-rollback",
  });
  check(
    injected &&
      result.outcome === "FAILURE" &&
      result.code === "TEMPORARY_UNAVAILABLE",
    "Real pre-COMMIT injection returns a safe temporary access failure",
  );
  check(
    JSON.stringify(await counts()) === JSON.stringify(before),
    "Rollback preserves the unconsumed link and writes no partial session or access audit",
  );
  return {
    actualPostgresRollback: true,
    injectedBoundary: "BEFORE_COMMIT",
    actualNetworkDisconnect: false,
  };
}

import { Pool } from "pg";
import { parsePersistenceTransactionFailure } from "@fan-support/persistence-port";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";

/** A real conflicting row lock reaches the nested public preflight reader. */
export async function verifyPublicationReadFailureCases({
  client,
  clientConfig,
  fixtures,
  check,
}) {
  let observeFailure = false;
  let rollbacks = 0;
  const backendPids = [];
  const driverFailures = [];
  const persistence = createPostgresPersistenceWithPoolFactory(
    clientConfig,
    { catalogPublicMediaBaseUrl: "https://media.example.test" },
    (config) => {
      const pool = new Pool({ ...config, max: 1 });
      return {
        end: () => pool.end(),
        on: (event, listener) => pool.on(event, listener),
        off: (event, listener) => pool.off(event, listener),
        connect: async () => {
          const connection = await pool.connect();
          backendPids.push(
            (await connection.query("SELECT pg_backend_pid() AS pid")).rows[0]
              .pid,
          );
          return {
            release: (error) => connection.release(error),
            query: async (sql, values) => {
              const text = typeof sql === "string" ? sql : sql.text;
              // TEST-only timeout on the failing transaction; production SQL
              // and its locks run unchanged and PostgreSQL generates 55P03.
              if (observeFailure && text.startsWith("BEGIN ISOLATION LEVEL")) {
                const result = await connection.query(sql, values);
                await connection.query("SET LOCAL lock_timeout = '150ms'");
                await connection.query("SET LOCAL statement_timeout = '5s'");
                return result;
              }
              try {
                const result = await connection.query(sql, values);
                if (observeFailure && text === "ROLLBACK") rollbacks++;
                return result;
              } catch (error) {
                if (observeFailure)
                  driverFailures.push({
                    code: /^[0-9A-Z]{5}$/u.test(error.code ?? "")
                      ? error.code
                      : "UNKNOWN",
                    preflightOwnerLock:
                      text.includes("FROM public.idols o") &&
                      text.endsWith("FOR SHARE"),
                  });
                throw error;
              }
            },
          };
        },
      };
    },
  );
  let lockHeld = false;
  try {
    const { rows } = await client.query(
      "SELECT handle FROM public.idols WHERE id=$1",
      [fixtures.targets.idol.idolId],
    );
    check(rows.length, 1, "public failure probe uses the real published idol");
    const command = {
      schemaVersion: 1,
      locator: { kind: "IDOL", handle: rows[0].handle },
      locale: "en",
    };
    const run = (work) =>
      persistence.publishedContentTransactionManager.runInPublishedContentTransaction(
        work,
      );
    const read = () =>
      run(({ publishedContent }) => publishedContent.load(command));
    const baseline = await read();
    check(
      baseline.outcome,
      "SUCCESS",
      "public read succeeds before contention",
    );

    await client.query("BEGIN");
    lockHeld = true;
    await client.query("SELECT id FROM public.idols WHERE id=$1 FOR UPDATE", [
      fixtures.targets.idol.idolId,
    ]);
    observeFailure = true;
    let repositoryFailure, transactionFailure;
    try {
      await run(async ({ publishedContent }) => {
        try {
          return await publishedContent.load(command);
        } catch (error) {
          repositoryFailure = parsePersistenceTransactionFailure(error);
          throw error;
        }
      });
    } catch (error) {
      transactionFailure = parsePersistenceTransactionFailure(error);
    } finally {
      observeFailure = false;
      await client.query("ROLLBACK");
      lockHeld = false;
    }

    check(
      driverFailures,
      [{ code: "55P03", preflightOwnerLock: true }],
      "the real PostgreSQL lock timeout originates inside public preflight",
    );
    check(rollbacks, 1, "failed content transaction rolls back exactly once");
    const canonical = {
      schemaVersion: 1,
      operation: "RUN_TRANSACTION",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 250,
      },
    };
    check(
      transactionFailure,
      canonical,
      "the transaction runner preserves its first tracked infrastructure failure",
    );
    check(
      repositoryFailure,
      canonical,
      "the nested public repository preserves the canonical lock failure",
    );
    const activity = await client.query(
      "SELECT state,xact_start FROM pg_stat_activity WHERE pid=$1",
      [backendPids.at(-1)],
    );
    check(
      activity.rows,
      [{ state: "idle", xact_start: null }],
      "failed public read leaves no open transaction in its pooled connection",
    );
    const recovered = await read();
    check(
      recovered.outcome,
      "SUCCESS",
      "public read recovers after lock release",
    );
    check(
      recovered.context.publication,
      baseline.context.publication,
      "recovery retains the same immutable publication proof",
    );
    check(
      [backendPids.length, new Set(backendPids).size],
      [3, 1],
      "baseline, failed read and recovery use the same healthy pooled connection",
    );
  } finally {
    if (lockHeld) await client.query("ROLLBACK");
    await persistence.close();
  }
}

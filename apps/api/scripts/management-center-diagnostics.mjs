import { Pool } from "pg";
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPostgresPersistenceWithPoolFactory } from "../../../packages/persistence-postgres/dist/postgres-persistence.js";

/** Failure-only local TEST diagnostics: no SQL parameter values, credentials, or intent text. */
export function observedManagementPersistence(output) {
  const seen = new Set();
  return (database, options) =>
    createPostgresPersistenceWithPoolFactory(database, options, (config) => {
      const pool = new Pool(config);
      return {
        async connect() {
          const client = await pool.connect();
          return {
            async query(statement, values) {
              try {
                return await client.query(statement, values);
              } catch (error) {
                const sql =
                  typeof statement === "string" ? statement : statement.text;
                const diagnostic = managementDatabaseDiagnostic(sql, error);
                const key = JSON.stringify(diagnostic);
                if (!seen.has(key)) {
                  seen.add(key);
                  await appendFile(
                    path.join(output, "management-database-errors.jsonl"),
                    key + "\n",
                  );
                }
                throw error;
              }
            },
            release: (destroy) => client.release(destroy),
          };
        },
        end: () => pool.end(),
        on: (event, listener) => pool.on(event, listener),
        off: (event, listener) => pool.off(event, listener),
      };
    });
}
/** PostgreSQL error messages and SQL text can contain values, so neither is logged. */
export function managementDatabaseDiagnostic(statement, error) {
  const keyword = statement.trim().split(/\s/u, 1)[0]?.toUpperCase();
  const managementStage = statement.startsWith(
    "UPDATE public.management_operations SET ",
  )
    ? [
        ["checkpoint=$2", "CHECKPOINT"],
        ["status='RUNNING'", "CLAIM"],
        ["status='SUCCEEDED'", "COMPLETE"],
        ["status='FAILED'", "AUTHORIZATION_EXPIRED"],
        ["session_id=$2", "REAUTHORIZE"],
        ["status=$2", "DEFER_OR_FAIL"],
      ].find(([fragment]) => statement.includes(fragment))?.[1]
    : undefined;
  const frame =
    typeof error.where === "string"
      ? /PL\/pgSQL function ([a-z_][a-z_0-9]*)\([^\n]*\) line ([0-9]+) at/u.exec(
          error.where,
        )
      : null;
  return {
    code: /^[0-9A-Z]{5}$/u.test(error.code ?? "") ? error.code : "UNKNOWN",
    operation: [
      "BEGIN",
      "COMMIT",
      "ROLLBACK",
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "WITH",
    ].includes(keyword)
      ? keyword
      : "QUERY",
    ...(frame
      ? { functionName: frame[1], functionLine: Number(frame[2]) }
      : {}),
    ...(managementStage ? { managementStage } : {}),
  };
}
export function observeManagementOperations({ client, output, own }) {
  let pending = Promise.resolve(),
    running = false;
  const sample = () => {
    if (running) return;
    running = true;
    pending = (async () => {
      const rows = (
        await client.query(
          "SELECT id,status,version,failure_code,checkpoint,updated_at,clock_timestamp() AS observed_at FROM public.management_operations ORDER BY created_at",
        )
      ).rows;
      const jobs = (
        await client.query(
          "SELECT id,status,attempt_count,output_asset_id,error_code FROM public.media_processing_jobs WHERE id IN (SELECT (j->>'jobId')::uuid FROM public.management_operations o CROSS JOIN LATERAL jsonb_array_elements(o.checkpoint->'jobs') j)",
        )
      ).rows;
      await writeFile(
        path.join(output, "management-state.json"),
        JSON.stringify({ operations: rows, jobs }, null, 2) + "\n",
      );
    })()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  const timer = globalThis.setInterval(sample, 1000);
  timer.unref();
  sample();
  own("safe management diagnostics", async () => {
    globalThis.clearInterval(timer);
    await pending;
  });
}

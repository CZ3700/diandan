import assert from "node:assert/strict";
import { Pool } from "pg";
import { createPostgresPersistenceWithPoolFactory } from "../../../packages/persistence-postgres/dist/postgres-persistence.js";

const tables = {
  IDOL: [
    "idol_revision_translations",
    "idol_translation_copy_evidence",
    "display_name",
  ],
  GIFT: [
    "gift_revision_translations",
    "gift_translation_copy_evidence",
    "title",
  ],
  HOMEPAGE: [
    "homepage_revision_translations",
    "homepage_translation_copy_evidence",
    "hero_title",
  ],
  POLICY: [
    "policy_revision_translations",
    "policy_translation_copy_evidence",
    "title",
  ],
  MEDIA_METADATA: [
    "media_metadata_revision_translations",
    "media_metadata_translation_copy_evidence",
    "alt",
  ],
};
/** TEST only. Intercepts actual SQL SELECT leaves, never final repositories/DTOs or persisted rows. */
export function createRegressionSeoFaults() {
  let active;
  const missingIds = new Set(),
    events = [];
  function transform(sql, values, result, transactionMissingIds = missingIds) {
    if (
      !active ||
      values?.[0] !== active.revisionId ||
      typeof sql !== "string" ||
      !sql.startsWith("SELECT ")
    )
      return result;
    const [table, copies, field] = tables[active.kind];
    const main =
      sql.includes(`FROM public.${table} t `) &&
      sql.includes("to_jsonb(t.*) AS translation,to_jsonb(r.*) AS review,") &&
      sql.endsWith("FOR SHARE OF t");
    const copyJoin =
      active.mode === "MISSING" &&
      sql.includes(`FROM public.${copies} e`) &&
      sql.includes(`JOIN public.${table} t ON t.id=e.target_translation_id`);
    if (!main && !copyJoin) return result;
    const rows = [];
    let affectedRows = 0;
    for (const row of result.rows) {
      if (copyJoin) {
        if (transactionMissingIds.has(row.evidence?.target_translation_id)) {
          affectedRows++;
          continue;
        }
      } else if (row.translation?.locale === active.locale) {
        affectedRows++;
        if (active.mode === "SQL_ERROR")
          throw new Error("TEST_SQL_TRANSLATION_READ_UNAVAILABLE");
        if (active.mode === "MISSING") {
          transactionMissingIds.add(row.translation.id);
          continue;
        }
        if (active.mode === "REVIEW_MISSING") {
          rows.push({ ...row, review: null });
          continue;
        }
        if (active.mode === "TAMPER") {
          rows.push({
            ...row,
            translation: {
              ...row.translation,
              [field]: "UNTRUSTED_TRANSLATION_CANARY",
            },
          });
          continue;
        }
        if (active.mode === "DUPLICATE") rows.push(row);
      }
      rows.push(row);
    }
    if (affectedRows === 0) return result;
    events.push({
      kind: active.kind,
      revisionId: active.revisionId,
      locale: active.locale,
      mode: active.mode,
      leaf: main ? "TRANSLATION_REVIEW_JOIN" : "COPY_EVIDENCE_JOIN",
      affectedRows,
    });
    return { ...result, rows, rowCount: rows.length };
  }
  return {
    set(value) {
      assert.ok(
        tables[value.kind] &&
          [
            "MISSING",
            "REVIEW_MISSING",
            "TAMPER",
            "DUPLICATE",
            "SQL_ERROR",
          ].includes(value.mode),
      );
      active = { ...value };
      missingIds.clear();
    },
    clear() {
      active = undefined;
      missingIds.clear();
    },
    events: () => [...events],
    transform,
    createReadPersistence(config, options) {
      return createPostgresPersistenceWithPoolFactory(
        config,
        options,
        (normalized) => {
          const pool = new Pool(normalized);
          return {
            async connect() {
              const client = await pool.connect();
              const transactionMissingIds = new Set();
              return {
                query: async (sql, values) =>
                  transform(
                    sql,
                    values,
                    await client.query(sql, values),
                    transactionMissingIds,
                  ),
                release: (destroy) => client.release(destroy),
              };
            },
            end: () => pool.end(),
            on: (event, listener) => {
              pool.on(event, listener);
            },
            off: (event, listener) => {
              pool.off(event, listener);
            },
          };
        },
      );
    },
  };
}

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

const nowDefault = () => globalThis.performance.now();
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

/** Per-owned-pool observation; never modifies pg globals or persists values, SQL, or rows. */
export function createCatalogQueryObserver({ now = nowDefault } = {}) {
  let active = null;
  return {
    wrapClient(client) {
      return {
        async query(text, values) {
          const target = active;
          if (!target) return client.query(text, values);
          const start = now();
          const entry = {
            sequence: target.length + 1,
            statementHash: createHash("sha256").update(text).digest("hex"),
            kind: text.startsWith("WITH version_state AS")
              ? "DISCOVERY_AND_VERSION"
              : /^(BEGIN|COMMIT|ROLLBACK|SET)\b/u.test(text)
                ? "TRANSACTION_CONTROL"
                : "HYDRATION",
            status: "RUNNING",
          };
          target.push(entry);
          try {
            const result = await client.query(text, values);
            entry.durationMs = now() - start;
            entry.status = "PASS";
            entry.rows = Array.isArray(result?.rows) ? result.rows.length : 0;
            entry.rowJsonBytes = bytes(result?.rows ?? []);
            return result;
          } catch (error) {
            entry.durationMs = now() - start;
            entry.status = "FAIL";
            entry.rows = 0;
            entry.rowJsonBytes = 0;
            entry.sqlState = /^[A-Z0-9]{5}$/u.test(error?.code ?? "")
              ? error.code
              : null;
            throw error;
          }
        },
        release: (destroy) => client.release(destroy),
      };
    },
    async capture(work) {
      assert.equal(active, null, "catalog measurements must not overlap");
      const queries = [];
      active = queries;
      const start = now();
      try {
        const value = await work();
        return { status: "PASS", durationMs: now() - start, value, queries };
      } catch (error) {
        return { status: "FAIL", durationMs: now() - start, error, queries };
      } finally {
        active = null;
      }
    },
  };
}

export function summarizeCatalogSamples(samples) {
  assert.ok(samples.length > 0, "catalog samples must not be empty");
  assert.ok(
    samples.every((value) => value.status === "PASS"),
    "failed sample cannot be discarded",
  );
  const result = { samples: samples.length };
  for (const key of [
    "durationMs",
    "queryCount",
    "queryMs",
    "returnedRowJsonBytes",
    "publicResponseBytes",
  ]) {
    const values = samples.map((value) => value[key]).sort((a, b) => a - b);
    assert.ok(values.every((value) => Number.isFinite(value) && value >= 0));
    const middle = Math.floor(values.length / 2);
    result[key] = {
      min: values[0],
      median:
        values.length % 2
          ? values[middle]
          : (values[middle - 1] + values[middle]) / 2,
      p95: values[Math.ceil(values.length * 0.95) - 1],
      max: values.at(-1),
    };
  }
  return result;
}

/** Node timings are inclusive; retain raw EXPLAIN and never add parent and child durations. */
export function selectVersionPlan(plan) {
  assert.equal(plan.length, 1);
  const source = plan[0];
  assert.ok(source.Plan && Number.isFinite(source["Execution Time"]));
  const versionCteScans = [],
    sequentialScans = [];
  function visit(node) {
    if (node["CTE Name"] === "version_state")
      versionCteScans.push({
        actualTotalMs: node["Actual Total Time"],
        actualLoops: node["Actual Loops"],
      });
    if (node["Node Type"] === "Seq Scan")
      sequentialScans.push({
        relation: node["Relation Name"],
        actualRows: node["Actual Rows"],
        actualLoops: node["Actual Loops"],
        actualTotalMs: node["Actual Total Time"],
      });
    for (const child of node.Plans ?? []) visit(child);
  }
  visit(source.Plan);
  return {
    executionMs: source["Execution Time"],
    planningMs: source["Planning Time"],
    versionCteScans,
    sequentialScans,
  };
}

export function catalogVersionProbe(statement) {
  const boundary = statement.text.indexOf(", visible AS (");
  assert.ok(
    boundary > 0 && statement.text.startsWith("WITH version_state AS"),
    "unknown discovery statement cannot be rewritten as a probe",
  );
  const text =
    statement.text.slice(0, boundary) +
    " SELECT catalog_version FROM version_state";
  assert.doesNotMatch(
    text,
    /\$\d/u,
    "version probe must not borrow discovery bindings",
  );
  return { text, values: [] };
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  createCatalogQueryObserver,
  summarizeCatalogSamples,
  selectVersionPlan,
  catalogVersionProbe,
} from "./catalog-performance.mjs";

test("query observation preserves calls and rejects overlapping measurement", async () => {
  let tick = 0;
  const observer = createCatalogQueryObserver({ now: () => tick++ });
  const calls = [];
  const client = observer.wrapClient({
    async query(...args) {
      calls.push(args);
      return { rows: [{ value: "private text must stay outside evidence" }] };
    },
    release(destroy) {
      calls.push(["release", destroy]);
    },
  });
  const query = "SELECT value FROM public.gifts WHERE id=$1";
  const measured = await observer.capture(async () => {
    await assert.rejects(
      observer.capture(async () => null),
      /overlap/u,
    );
    return client.query(query, ["private-parameter"]);
  });
  client.release(true);
  assert.deepEqual(calls, [
    [query, ["private-parameter"]],
    ["release", true],
  ]);
  assert.equal(measured.queries.length, 1);
  assert.equal(measured.queries[0].durationMs, 1);
  assert.equal(measured.queries[0].rows, 1);
  assert.ok(measured.queries[0].rowJsonBytes > 0);
  assert.doesNotMatch(JSON.stringify(measured.queries), /private/u);
  assert.equal(measured.status, "PASS");
});

test("version probe preserves the exact version expression and refuses unknown boundaries", () => {
  const expression =
    "WITH version_state AS (SELECT encode(sha256(convert_to('[]','UTF8')),'hex') catalog_version)";
  assert.deepEqual(
    catalogVersionProbe({
      text: expression + ", visible AS (SELECT $1) SELECT * FROM visible",
      values: ["en"],
    }),
    {
      text: expression + " SELECT catalog_version FROM version_state",
      values: [],
    },
  );
  assert.throws(() => catalogVersionProbe({ text: "SELECT 1" }));
  assert.throws(() =>
    catalogVersionProbe({
      text: "WITH version_state AS (SELECT $1), visible AS (SELECT 1)",
    }),
  );
});

test("failed queries remain counted with safe SQLSTATE and original error is available only to caller", async () => {
  const observer = createCatalogQueryObserver();
  const error = Object.assign(new Error("sensitive payload"), {
    code: "40001",
  });
  const client = observer.wrapClient({
    async query() {
      throw error;
    },
  });
  const measured = await observer.capture(() => client.query("SELECT 1"));
  assert.equal(measured.status, "FAIL");
  assert.equal(measured.error, error);
  assert.equal(measured.queries[0].status, "FAIL");
  assert.equal(measured.queries[0].sqlState, "40001");
  assert.doesNotMatch(JSON.stringify(measured.queries), /sensitive/u);
  assert.equal((await observer.capture(async () => 1)).status, "PASS");
});

test("summaries retain the slow sample and reject missing or failed observations", () => {
  const samples = [10, 1000, 20].map((durationMs) => ({
    status: "PASS",
    durationMs,
    queryCount: 3,
    queryMs: durationMs / 2,
    returnedRowJsonBytes: 128,
    publicResponseBytes: 64,
  }));
  const value = summarizeCatalogSamples(samples);
  assert.deepEqual(value.durationMs, {
    min: 10,
    median: 20,
    p95: 1000,
    max: 1000,
  });
  assert.equal(value.samples, 3);
  assert.throws(() => summarizeCatalogSamples([]));
  assert.throws(() =>
    summarizeCatalogSamples([...samples, { status: "FAIL" }]),
  );
});

test("EXPLAIN isolates version subtree without counting parent cumulative times twice", () => {
  const root = {
    "Node Type": "Result",
    "Actual Total Time": 50,
    "Actual Loops": 1,
    Plans: [
      {
        "Node Type": "Aggregate",
        "Parent Relationship": "InitPlan",
        "Subplan Name": "InitPlan 1 (returns $0)",
        "Actual Total Time": 4,
        "Actual Loops": 1,
        Plans: [
          {
            "Node Type": "Seq Scan",
            "Relation Name": "gifts",
            "Actual Total Time": 2,
            "Actual Loops": 1,
          },
        ],
      },
      {
        "Node Type": "CTE Scan",
        "CTE Name": "version_state",
        "Actual Total Time": 10,
        "Actual Loops": 1,
      },
    ],
  };
  const value = selectVersionPlan([
    { Plan: root, "Execution Time": 52, "Planning Time": 1 },
  ]);
  assert.equal(value.executionMs, 52);
  assert.deepEqual(value.versionCteScans, [
    { actualTotalMs: 10, actualLoops: 1 },
  ]);
  assert.equal(value.sequentialScans[0].relation, "gifts");
  assert.throws(() => selectVersionPlan([]));
});

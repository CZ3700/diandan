import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import {
  giftBrowseQuerySchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { createCatalogDirectoryUseCases } from "@fan-support/application";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";
import { buildGiftBrowseQuery } from "../dist/gift-browse-sql.js";
import {
  createCatalogQueryObserver,
  summarizeCatalogSamples,
  catalogVersionProbe,
  selectVersionPlan,
} from "./catalog-performance.mjs";

/** Real read adapter with a private observer attached only to the owned measurement pool. */
export async function measureCatalogPerformance({
  database,
  client,
  publicMediaBaseUrl,
  output,
  expectedProofVersion,
  expectedTotal,
  locales = SUPPORTED_LOCALES,
  attempts = 3,
  runtime,
}) {
  assert.ok([1, 3].includes(expectedProofVersion));
  assert.ok(Number.isInteger(expectedTotal) && expectedTotal >= 120);
  assert.ok(Number.isInteger(attempts) && attempts >= 3);
  await mkdir(output, { recursive: true });
  const observer = createCatalogQueryObserver();
  const persistence = createPostgresPersistenceWithPoolFactory(
    database,
    { catalogPublicMediaBaseUrl: publicMediaBaseUrl },
    (config) => {
      const pool = new Pool(config);
      return {
        connect: async () => observer.wrapClient(await pool.connect()),
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
  let proofVersions;
  const { browseGifts: browse } = createCatalogDirectoryUseCases({
    transactions: {
      runInContentReadTransaction: (work) =>
        persistence.contentReadTransactionManager.runInContentReadTransaction(
          (repositories) =>
            work({
              ...repositories,
              catalogDirectory: {
                ...repositories.catalogDirectory,
                browseGifts: async (command) => {
                  const snapshot =
                    await repositories.catalogDirectory.browseGifts(command);
                  proofVersions =
                    snapshot.outcome === "SUCCESS"
                      ? snapshot.items.map((item) =>
                          item.schemaVersion === 3 ? 3 : 1,
                        )
                      : [];
                  return snapshot;
                },
              },
            }),
        ),
    },
  });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    expectedProofVersion,
    expectedTotal,
    environment: "OWNED_EPHEMERAL_POSTGRES",
    runtime,
    postgresVersion: (await client.query("SHOW server_version")).rows[0]
      .server_version,
    nodeVersion: process.version,
    attempts,
    locales,
    samples: [],
    aggregates: [],
    probes: [],
    conditions: {
      applicationAndProofVerification:
        "Unmodified normal gift-browse use case and SERIALIZABLE PostgreSQL adapter",
      timing:
        "Monotonic end-to-end application duration; all attempts retained including first; PostgreSQL caches may be warm after fixture publication",
      bytes:
        "UTF-8 JSON of returned PostgreSQL rows and public response, not protocol wire bytes; observer serialization overhead is included in total duration",
      versionProbe:
        "Exact original version_state expression executed independently after application samples; EXPLAIN ANALYZE adds overhead and is not subtracted from normal samples",
      latencyContext:
        "8 second storefront fetch timeout is a failure ceiling, not a new performance target",
      fieldCwvEvidence: false,
    },
  };
  const save = () =>
    writeFile(
      path.join(output, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  await save();
  try {
    for (const locale of locales)
      for (const pageSize of [12, 48])
        for (const page of [1, 2]) {
          const query = giftBrowseQuerySchema.parse({
            schemaVersion: 1,
            locale,
            pageSize,
            page,
          });
          const group = [];
          for (let attempt = 1; attempt <= attempts; attempt++) {
            proofVersions = [];
            const captured = await observer.capture(() => browse(query));
            const result = captured.value;
            const sample = {
              locale,
              pageSize,
              page,
              attempt,
              status: captured.status,
              durationMs: captured.durationMs,
              queryCount: captured.queries.length,
              queryMs: captured.queries.reduce(
                (sum, entry) => sum + entry.durationMs,
                0,
              ),
              returnedRowJsonBytes: captured.queries.reduce(
                (sum, entry) => sum + entry.rowJsonBytes,
                0,
              ),
              publicResponseBytes: result
                ? Buffer.byteLength(JSON.stringify(result), "utf8")
                : 0,
              outcome: result?.outcome ?? "THREW",
              itemCount: result?.items?.length ?? 0,
              totalItems: result?.pageInfo?.totalItems ?? null,
              proofVersions: [...new Set(proofVersions)],
              catalogVersion: result?.catalogVersion ?? null,
              queries: captured.queries,
            };
            if (
              result?.outcome !== "SUCCESS" ||
              sample.totalItems !== expectedTotal ||
              sample.itemCount !== pageSize ||
              proofVersions.some((version) => version !== expectedProofVersion)
            )
              sample.status = "FAIL";
            report.samples.push(sample);
            await save();
            assert.equal(
              sample.status,
              "PASS",
              "catalog sample must contain the expected complete proven window",
            );
            group.push(sample);
          }
          report.aggregates.push({
            locale,
            pageSize,
            page,
            ...summarizeCatalogSamples(group),
          });
          await save();
          console.log(
            `Catalog performance ${expectedProofVersion}/${expectedTotal}/${locale}/${pageSize}/${page}: ${group.map((sample) => sample.durationMs.toFixed(1)).join(",")} ms`,
          );
        }
    const statement = buildGiftBrowseQuery(
      giftBrowseQuerySchema.parse({
        schemaVersion: 1,
        locale: locales[0],
        page: 1,
        pageSize: 12,
      }),
    );
    for (const [kind, query] of [
      ["DISCOVERY_AND_VERSION", statement],
      ["VERSION_ONLY", catalogVersionProbe(statement)],
    ]) {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const plan = (
          await client.query(
            "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query.text,
            query.values,
          )
        ).rows[0]["QUERY PLAN"];
        const filename = `${kind.toLowerCase()}-${attempt}.json`;
        await writeFile(
          path.join(output, filename),
          JSON.stringify(plan, null, 2) + "\n",
        );
        report.probes.push({
          kind,
          attempt,
          file: filename,
          ...selectVersionPlan(plan),
        });
        await save();
      }
    }
    report.status = "PASS";
    report.allWithinCurrentBffTimeout = report.samples.every(
      (sample) => sample.durationMs < 8000,
    );
    report.scope =
      "Cost observation, successful proof-preserving reads and bounded public response; not field CWV or a new latency release budget";
    await save();
    return report;
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      kind:
        error?.name === "AssertionError" ? "ASSERTION" : "MEASUREMENT_FAILURE",
    };
    await save();
    throw error;
  } finally {
    await persistence.close();
  }
}

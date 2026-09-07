import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  SUPPORTED_LOCALES,
  idolDirectoryResponseSchema,
  storefrontHomepageResponseSchema,
  storefrontSeoResponseSchema,
} from "@fan-support/contracts";

/** Reproduce normal homepage/metadata overlap. Each failing group is retained; no request is retried. */
export async function runConcurrentReadRounds({
  locales,
  read,
  check,
  save = async () => undefined,
}) {
  const rounds = [];
  for (const locale of locales) {
    const requests = [
      {
        kind: "homepage",
        path: `/api/v1/storefront-homepage?locale=${locale}`,
      },
      { kind: "directory", path: `/api/v1/idols?locale=${locale}&limit=12` },
      { kind: "seo", path: "/api/v1/storefront-seo/entity?kind=HOMEPAGE" },
    ];
    for (const [index, order] of [
      [0, 1, 2],
      [2, 0, 1],
      [1, 2, 0],
    ].entries()) {
      const startedAt = new Date().toISOString();
      const results = await Promise.all(
        order.map(async (requestIndex, position) => {
          await delay(position * index * 10);
          return read(requests[requestIndex]);
        }),
      );
      rounds.push({ locale, startedAt, delayStepMs: index * 10, results });
      await save(rounds);
      for (const result of results) {
        check(
          result.status === 200,
          "concurrent public read succeeds without retry",
        );
        check(
          result.valid,
          "concurrent public read retains its successful strict DTO",
        );
      }
    }
  }
  return rounds;
}

export async function verifyAcceptanceConcurrentReads({
  base,
  client,
  output,
  check,
  progress,
}) {
  const schemas = {
    homepage: storefrontHomepageResponseSchema,
    directory: idolDirectoryResponseSchema,
    seo: storefrontSeoResponseSchema,
  };
  const deadlocks = async () =>
    Number(
      (
        await client.query(
          "SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()",
        )
      ).rows[0].deadlocks,
    );
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    scope:
      "Owned TEST PostgreSQL, three normal concurrent public reads with varied request order",
    beforeDeadlocks: await deadlocks(),
    rounds: [],
  };
  const reportPath = path.join(
    output,
    `concurrent-public-reads-${Date.now()}.json`,
  );
  const save = async () =>
    writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  progress("seven-locale concurrent homepage, directory and SEO proof reads");
  try {
    report.rounds = await runConcurrentReadRounds({
      locales: SUPPORTED_LOCALES,
      check,
      save: async (rounds) => {
        report.rounds = rounds;
        await save();
      },
      read: async (request) => {
        const started = globalThis.performance.now();
        try {
          const response = await globalThis.fetch(base + request.path, {
            redirect: "manual",
            signal: globalThis.AbortSignal.timeout(8_000),
          });
          const parsed = schemas[request.kind].safeParse(await response.json());
          return {
            request,
            status: response.status,
            elapsedMs: Math.round(globalThis.performance.now() - started),
            valid: parsed.success && parsed.data.outcome === "SUCCESS",
            code:
              parsed.success && parsed.data.outcome === "FAILURE"
                ? parsed.data.code
                : null,
          };
        } catch (error) {
          return {
            request,
            status: null,
            valid: false,
            elapsedMs: Math.round(globalThis.performance.now() - started),
            errorKind: ["TimeoutError", "AbortError", "SyntaxError"].includes(
              error.name,
            )
              ? error.name
              : "TRANSPORT_UNAVAILABLE",
          };
        }
      },
    });
    report.afterDeadlocks = await deadlocks();
    check(
      report.afterDeadlocks === report.beforeDeadlocks,
      "normal concurrent public reads introduce no PostgreSQL deadlock",
    );
    report.status = "PASS";
    return report;
  } catch (error) {
    report.status = "FAIL";
    report.afterDeadlocks = await deadlocks();
    throw error;
  } finally {
    await save();
  }
}

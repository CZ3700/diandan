#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { withAcceptanceFixture } from "./storefront-acceptance-runtime.mjs";
import { createAcceptanceReadDiagnostics } from "./storefront-acceptance-diagnostics.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const outputRoot = path.join(
  workspaceRoot,
  "output/checks/p3-06-storefront-acceptance",
);

function signals() {
  const queue = [];
  let waiting;
  const handlers = Object.entries({
    SIGUSR1: "full",
    SIGHUP: "smoke",
    SIGUSR2: "pause",
    SIGALRM: "performance",
    SIGTERM: "stop",
    SIGINT: "stop",
  }).map(([signal, action]) => [
    signal,
    () => {
      if (waiting) {
        const resolve = waiting;
        waiting = undefined;
        resolve(action);
      } else queue.push(action);
    },
  ]);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  return {
    next: () =>
      queue.length
        ? Promise.resolve(queue.shift())
        : new Promise((resolve) => {
            waiting = resolve;
          }),
    close: () => {
      for (const [signal, handler] of handlers)
        process.removeListener(signal, handler);
    },
  };
}

/** Verification functions are injected independently; readiness is never described as completed P3-06 acceptance. */
export async function runAcceptanceFixture(
  database,
  s3,
  {
    serve = false,
    ui = false,
    performance = false,
    verifyProtocol = async (context) =>
      (
        await import(
          `./storefront-acceptance-protocol.mjs?attempt=${Date.now()}`
        )
      ).verifyAcceptanceProtocol(context),
    verifyBrowser = async (context) =>
      (
        await import(`./storefront-acceptance-matrix.mjs?attempt=${Date.now()}`)
      ).verifyAcceptanceBrowser(context),
  } = {},
) {
  const output = path.join(
    outputRoot,
    `run-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`,
  );
  await mkdir(output, { recursive: true });
  let assertions = 0;
  const check = (condition, label) => {
    assertions++;
    assert.ok(condition, label);
  };
  const progress = (stage) => console.log(`Acceptance fixture: ${stage}`);
  const control = signals();
  const started = globalThis.performance.now();
  const diagnostics =
    process.env.FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS === "1"
      ? createAcceptanceReadDiagnostics({ output })
      : undefined;
  try {
    return await withAcceptanceFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      diagnostics,
      verify: async (context) => {
        await writeFile(
          path.join(output, "fixture-manifest.json"),
          JSON.stringify(context.manifest, null, 2) + "\n",
        );
        progress(
          "existing public protocol baseline over the same real fixture",
        );
        let protocol,
          protocolAttempt = 0;
        while (!protocol) {
          diagnostics?.beginPhase("protocol");
          try {
            protocolAttempt++;
            protocol = await verifyProtocol(context);
          } catch (error) {
            await writeFile(
              path.join(
                output,
                `protocol-attempt-${protocolAttempt}-failure.json`,
              ),
              JSON.stringify(safeFailure(error), null, 2) + "\n",
            );
            console.error(
              `Acceptance protocol diagnostic ${JSON.stringify(safeFailure(error))}`,
            );
            if (!serve) throw error;
            console.log(
              `STOREFRONT_ACCEPTANCE_PROTOCOL_WAITING ownerPID=${process.pid}; SIGUSR1 reloads protocol with same owned seed; SIGTERM cleans up`,
            );
            let action;
            do {
              action = await control.next();
            } while (!["full", "stop"].includes(action));
            if (action === "stop") throw error;
          }
        }
        const report = {
          schemaVersion: 1,
          status: "PASS",
          scope:
            "Real fixture, public protocol and SEO proof/validators; not complete P3-06 acceptance",
          generatedAt: new Date().toISOString(),
          assertions,
          setupApiRequests: context.content.requestCount(),
          durationMs: Math.round(globalThis.performance.now() - started),
          actualPostgres: true,
          actualTlsS3: true,
          actualImageWorker: true,
          browserEvidence: false,
          seoCacheAcceptance: false,
          performanceAcceptance: false,
          humanOperationsEvidence: false,
          voiceOverEvidence: false,
          productionReleaseEvidence: false,
          protocol,
        };
        await writeFile(
          path.join(output, "protocol-results.json"),
          JSON.stringify(report, null, 2) + "\n",
        );
        console.log(
          `PASS acceptance protocol baseline (${assertions} assertions); ${output}`,
        );
        if (!serve && !ui && !performance) return report;
        let action = performance && !ui ? "performance" : ui ? "full" : "smoke",
          attempt = 0,
          next;
        while (action !== "stop") {
          if (action === "pause") {
            await next?.stop();
            console.log(
              `STOREFRONT_ACCEPTANCE_NEXT_PAUSED ownerPID=${process.pid}`,
            );
          } else {
            const attemptOutput = path.join(
              output,
              `browser-attempt-${++attempt}`,
            );
            diagnostics?.beginPhase(`browser-attempt-${attempt}`);
            await mkdir(attemptOutput, { recursive: true });
            try {
              const before = assertions;
              const running = await context.startStorefront();
              next = running.next;
              const browser =
                action === "performance"
                  ? null
                  : await verifyBrowser({
                      ...context,
                      ...running,
                      output: attemptOutput,
                      ui: action === "full",
                    });
              const measured =
                action === "performance" || (performance && action === "full")
                  ? await (
                      await import(
                        `./storefront-acceptance-performance.mjs?attempt=${Date.now()}`
                      )
                    ).verifyAcceptancePerformance({
                      ...context,
                      ...running,
                      output: attemptOutput,
                    })
                  : null;
              await writeFile(
                path.join(attemptOutput, "results.json"),
                JSON.stringify(
                  {
                    schemaVersion: 1,
                    status: "PASS",
                    scope: "Compiled TEST browser verification callback",
                    attempt,
                    assertions: assertions - before,
                    generatedAt: new Date().toISOString(),
                    browser,
                    performance: measured,
                  },
                  null,
                  2,
                ) + "\n",
              );
              console.log(`PASS acceptance browser callback; ${attemptOutput}`);
            } catch (error) {
              await writeFile(
                path.join(attemptOutput, "failure.json"),
                JSON.stringify(safeFailure(error), null, 2) + "\n",
              );
              if (!serve) throw error;
              console.error(
                `Acceptance retained diagnostic ${JSON.stringify(safeFailure(error))}`,
              );
            }
          }
          if (!serve) break;
          console.log(
            `STOREFRONT_ACCEPTANCE_WAITING ${context.origin}/zh-CN ownerPID=${process.pid}; SIGUSR1 rebuild/UI, SIGHUP rebuild/smoke, SIGALRM rebuild/performance, SIGUSR2 pause owned Next, SIGTERM cleanup`,
          );
          action = await control.next();
        }
        return report;
      },
    });
  } finally {
    control.close();
  }
}

function safeFailure(error) {
  return {
    name: error?.name,
    code:
      typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
        ? error.code
        : null,
    assertion: error?.name === "AssertionError" ? error.message : null,
    issues:
      error?.name === "ZodError"
        ? error.issues.map(({ code, path }) => ({ code, path }))
        : [],
    causes:
      error instanceof AggregateError ? error.errors.map(safeFailure) : [],
  };
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const internal = process.argv.find((value) =>
      value.startsWith("--run-storefront-acceptance"),
    );
    const serve = internal
      ? internal.includes("-serve")
      : process.argv.includes("--serve");
    const ui = internal
      ? internal.includes("-ui")
      : process.argv.includes("--ui");
    const production = internal
      ? internal.includes("-production")
      : process.argv.includes("--production");
    const performance = internal
      ? internal.includes("-performance")
      : process.argv.includes("--performance");
    for (const argument of process.argv.slice(2))
      assert.ok(
        argument === internal ||
          ["--serve", "--ui", "--production", "--performance"].includes(
            argument,
          ),
        "Unknown acceptance harness option",
      );
    assert.ok(
      !(serve || ui || performance) || production,
      "Browser and preview modes require --production compiled TEST artifacts",
    );
    if (internal) {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) =>
        runAcceptanceFixture(database, s3, {
          serve,
          ui,
          performance,
        }),
      );
    } else {
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: `--run-storefront-acceptance${serve ? "-serve" : ""}${ui ? "-ui" : ""}${production ? "-production" : ""}${performance ? "-performance" : ""}`,
          timeoutMs: serve ? 6600000 : 1500000,
        }),
      );
    }
  } catch (error) {
    console.error(
      `FAIL acceptance fixture ${JSON.stringify(safeFailure(error))}`,
    );
    process.exitCode = 1;
  }
}

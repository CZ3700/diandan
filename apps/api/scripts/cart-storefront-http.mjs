#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { withCartStorefrontFixture } from "./cart-storefront-runtime.mjs";
import { verifyCartEditRollbackProtection } from "../../../packages/persistence-postgres/scripts/cart-edit-rollback-proof.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const root = path.join(workspaceRoot, "output/checks/p4-02-cart-storefront");
function safeFailure(error) {
  return {
    schemaVersion: 1,
    status: "FAIL",
    kind: error?.name === "AssertionError" ? "ASSERTION" : "RUNTIME",
    code:
      typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code)
        ? error.code
        : null,
  };
}
function signals() {
  const queue = [];
  let waiting;
  const handlers = Object.entries({
    SIGUSR1: "ui",
    SIGHUP: "smoke",
    SIGUSR2: "pause",
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
  for (const [name, handler] of handlers) process.on(name, handler);
  return {
    next: () =>
      queue.length
        ? Promise.resolve(queue.shift())
        : new Promise((resolve) => {
            waiting = resolve;
          }),
    close: () => {
      for (const [name, handler] of handlers)
        process.removeListener(name, handler);
    },
  };
}
function observePostgres() {
  const original = Client.prototype.query;
  Client.prototype.query = function (...args) {
    const result = original.apply(this, args);
    if (!result?.catch) return result;
    return result.catch((error) => {
      const sql = typeof args[0] === "string" ? args[0] : args[0]?.text;
      const guard =
        /PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(
          error?.where ?? "",
        )?.[1] ?? null;
      console.error(
        `Cart storefront PostgreSQL ${JSON.stringify({ operation: sql === "COMMIT" ? "COMMIT" : "STATEMENT", code: /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : null, guard, constraint: /^[a-z_][a-z_0-9]{0,127}$/u.test(error?.constraint ?? "") ? error.constraint : null })}`,
      );
      throw error;
    });
  };
  return () => {
    Client.prototype.query = original;
  };
}
export async function runCartStorefront(
  database,
  s3,
  { ui = false, serve = false } = {},
) {
  const output = path.join(
    root,
    `run-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true });
  let assertions = 0,
    stage = "seed";
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (value) => {
    stage = value;
    console.log(`Cart storefront: ${value}`);
  };
  const control = signals();
  const restore = observePostgres();
  const save = (file, value) =>
    writeFile(path.join(output, file), JSON.stringify(value, null, 2) + "\n");
  try {
    return await withCartStorefrontFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      verify: async (context) => {
        await save("fixture-manifest.json", context.manifest);
        const before = assertions;
        progress("real cart edit protocol");
        const protocol = await (
          await import("./cart-storefront-protocol.mjs")
        ).verifyCartStorefrontProtocol(context);
        const rollback = await verifyCartEditRollbackProtection({
          clientConfig: database,
          workspaceRoot,
        });
        await save("protocol-results.json", {
          schemaVersion: 1,
          status: "PASS",
          assertions: assertions - before,
          setupAssertions: before,
          setupRequests: context.content.requestCount(),
          protocol,
          rollback,
          actualPostgres: true,
          actualTlsS3: true,
          actualKmsAdapter: true,
          actualAwsKms: false,
          browserEvidence: false,
        });
        console.log(
          `PASS cart storefront HTTP ${assertions} assertions; ${output}`,
        );
        if (!ui && !serve) return;
        let action = ui ? "ui" : "smoke",
          attempt = 0,
          next;
        while (action !== "stop") {
          if (action === "pause") {
            await next?.stop();
            console.log(`CART_STOREFRONT_NEXT_PAUSED ownerPID=${process.pid}`);
          } else {
            const attemptOutput = path.join(
              output,
              `browser-attempt-${++attempt}`,
            );
            await mkdir(attemptOutput, { recursive: true });
            try {
              const running = await context.startStorefront();
              next = running.next;
              const browser = await (
                await import(`./cart-storefront-browser.mjs?attempt=${attempt}`)
              ).verifyCartStorefrontBrowser({
                ...context,
                ...running,
                output: attemptOutput,
                ui: action === "ui",
              });
              await writeFile(
                path.join(attemptOutput, "results.json"),
                JSON.stringify(
                  { schemaVersion: 1, status: "PASS", browser },
                  null,
                  2,
                ) + "\n",
              );
              console.log(`PASS cart storefront browser ${attemptOutput}`);
            } catch (error) {
              await writeFile(
                path.join(attemptOutput, "failure.json"),
                JSON.stringify({ ...safeFailure(error), stage }, null, 2) +
                  "\n",
              );
              if (!serve) throw error;
              console.error(
                `Cart browser retained failure ${JSON.stringify(safeFailure(error))}`,
              );
            }
          }
          if (!serve) break;
          console.log(
            `CART_STOREFRONT_READY ${context.origin}/zh-CN/cart ownerPID=${process.pid}; SIGUSR1 rebuild/UI, SIGHUP rebuild/smoke, SIGUSR2 pause, SIGTERM cleanup`,
          );
          action = await control.next();
        }
      },
    });
  } catch (error) {
    await save("failure.json", { ...safeFailure(error), stage, assertions });
    throw error;
  } finally {
    restore();
    control.close();
  }
}
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const internal = process.argv.find((value) =>
      /^--run-cart-storefront(?:-production)?(?:-ui)?(?:-serve)?$/u.test(value),
    );
    const ui = internal
      ? internal.includes("-ui")
      : process.argv.includes("--ui");
    const serve = internal
      ? internal.includes("-serve")
      : process.argv.includes("--serve");
    const production = internal
      ? internal.includes("-production")
      : process.argv.includes("--production");
    for (const value of process.argv.slice(2))
      assert.ok(
        value === internal ||
          ["--ui", "--serve", "--production"].includes(value),
        "Unknown cart storefront option",
      );
    assert.ok(
      !(ui || serve) || production,
      "Cart browser requires a production-compiled TEST artifact",
    );
    if (internal) {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) =>
        runCartStorefront(database, s3, { ui, serve }),
      );
    } else
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: `--run-cart-storefront${production ? "-production" : ""}${ui ? "-ui" : ""}${serve ? "-serve" : ""}`,
          timeoutMs: serve ? 3_300_000 : 1_200_000,
        }),
      );
  } catch (error) {
    console.error(`FAIL cart storefront ${JSON.stringify(safeFailure(error))}`);
    process.exitCode = 1;
  }
}

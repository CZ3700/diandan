import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import ts from "typescript";
import { expect } from "@playwright/test";
import { observeRum } from "./rum-browser.mjs";
import {
  hideRumDocument,
  withNativeRumContext,
} from "./rum-browser-lifecycle.mjs";

// Explicit manual browser regression; excluded from *.test.mjs lightweight suites.
const [flag, output] = process.argv.slice(2);
assert.equal(flag, "--output");
assert.ok(
  output && path.isAbsolute(output),
  "Use a fresh absolute output directory",
);
await mkdir(output, { recursive: false });
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const require = createRequire(path.join(root, "apps/storefront/package.json"));
const vitals = await readFile(
  path.join(path.dirname(require.resolve("web-vitals")), "web-vitals.js"),
);
const source = await readFile(
  path.join(root, "apps/storefront/src/storefront/rum-client.ts"),
  "utf8",
);
const client = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const report = {
  status: "RUNNING",
  scope: "CONTROLLED_ACTUAL_PRODUCT_COLLECTOR_LIFECYCLE_REGRESSION",
  metricsInjected: false,
  fieldEvidence: false,
  productionSinkEvidence: false,
  cells: [],
  server: [],
};
const server = createServer(async (request, response) => {
  if (request.url === "/client.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(client);
    return;
  }
  if (request.url === "/vitals.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(vitals);
    return;
  }
  if (request.url === "/contract.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end('export const RUM_ENDPOINT="/api/storefront/rum";');
    return;
  }
  if (request.url === "/api/storefront/rum") {
    let body = "";
    for await (const part of request) body += part;
    report.server.push(JSON.parse(body));
    // Exercise actual delayed HTTP acknowledgement while the original document lives.
    await delay(80);
    response.writeHead(204);
    response.end();
    return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Owned lifecycle regression</title><style>body{font:24px sans-serif;margin:20px}input{font:inherit;max-width:100%}</style><h1>Local performance lifecycle</h1><label>Search <input type="search"></label><script type="importmap">{"imports":{"@fan-support/contracts/rum-browser":"/contract.js","web-vitals":"/vitals.js"}}</script><script type="module">import { startBrowserRum } from '/client.js'; await startBrowserRum({locale:'en',samplePermille:1000});document.documentElement.dataset.rumReady='true';</script></html>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    for (const excluded of [false, true]) {
      const cell = { viewport, excluded, status: "RUNNING" };
      report.cells.push(cell);
      await withNativeRumContext({}, async (context, browser, launch) => {
        cell.browserVersion = browser.version();
        cell.launch = launch;
        const page = await context.newPage();
        await page.setViewportSize(viewport);
        await page.emulateMedia({ reducedMotion: "no-preference" });
        const observed = observeRum(page, origin);
        cell.exchanges = observed.exchanges;
        cell.errors = observed.errors;
        cell.requests = observed.requests;
        await page.goto(origin + (excluded ? "/en/order-access" : "/en"), {
          waitUntil: "networkidle",
        });
        await expect(page.locator("html")).toHaveAttribute(
          "data-rum-ready",
          "true",
        );
        cell.actualViewport = await page.evaluate(() => ({
          width: globalThis.innerWidth,
          height: globalThis.innerHeight,
        }));
        assert.deepEqual(cell.actualViewport, viewport);
        await context.addCookies([
          { name: "test_rum_privacy", value: "synthetic", url: origin },
        ]);
        await page.getByRole("searchbox").click();
        await page
          .getByRole("searchbox")
          .pressSequentially("Read only interaction", { delay: 50 });
        cell.lifecycle = await hideRumDocument(page);
        if (excluded) await delay(10_000);
        else
          await expect
            .poll(
              async () => {
                await observed.settle();
                return [
                  ...new Set(
                    observed.exchanges.map(
                      (entry) => entry.measurement.metric.name,
                    ),
                  ),
                ].sort();
              },
              { timeout: 10_000 },
            )
            .toEqual(["CLS", "INP", "LCP"]);
        await observed.settle();
        cell.postAttempts = observed.postAttempts;
        assert.equal(
          observed.postAttempts,
          excluded ? 0 : observed.exchanges.length,
        );
        assert.deepEqual(observed.errors, []);
      });
      cell.status = "PASS";
    }
  }
  const exchanges = report.cells.flatMap((cell) => cell.exchanges);
  assert.equal(report.server.length, exchanges.length);
  for (const exchange of exchanges)
    assert.deepEqual(
      report.server.find(
        (entry) =>
          entry.metric.measurementKey ===
            exchange.measurement.metric.measurementKey &&
          entry.metric.revision === exchange.measurement.metric.revision,
      ),
      exchange.measurement,
    );
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.errorName = error.name;
  report.controlledFailure = error.message;
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      cells: report.cells.length,
      records: report.server.length,
    }),
  );
}

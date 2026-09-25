import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { verifyRumDashboard } from "./rum-browser.mjs";

// Explicit file-only browser regression reuses the production acceptance function.
// It neither regenerates metric observations nor changes the preserved failed run.
const { values } = parseArgs({
  options: { input: { type: "string" }, output: { type: "string" } },
});
assert.ok(values.input && path.isAbsolute(values.input));
assert.ok(values.output && path.isAbsolute(values.output));
const directory = values.output;
await mkdir(directory, { recursive: false });
const inputFiles = ["rum-report.json", "rum-dashboard.html"];
const identities = async () =>
  Promise.all(
    inputFiles.map(async (name) => ({
      name,
      sha256: createHash("sha256")
        .update(await readFile(path.join(values.input, name)))
        .digest("hex"),
    })),
  );
const before = await identities();
const cliReport = JSON.parse(
  await readFile(path.join(values.input, "rum-report.json"), "utf8"),
);
const provenance = {
  status: "RUNNING",
  input: before,
  scope: "EXISTING_ACTUAL_CLI_HTML_ONLY",
  metricsInjected: false,
  fullNextIntegration: false,
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  provenance.browserVersion = browser.version();
  const result = await verifyRumDashboard(
    browser,
    directory,
    values.input,
    cliReport,
  );
  assert.equal(result.status, "PASS");
  assert.equal(result.cells.length, 2);
  for (const cell of result.cells) {
    assert.equal(cell.filters.length, 23);
    assert.equal(cell.emptyWindow, "INSUFFICIENT");
  }
  assert.deepEqual(
    await identities(),
    before,
    "Preserved actual CLI inputs are read-only",
  );
  provenance.status = "PASS";
} catch (error) {
  provenance.status = "FAIL";
  provenance.errorName = error.name;
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(
    path.join(directory, "input-provenance.json"),
    JSON.stringify(provenance, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({ status: provenance.status, scope: provenance.scope }),
  );
}

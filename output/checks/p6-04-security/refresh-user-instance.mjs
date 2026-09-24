import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.join(root, "output/checks/p6-04-security");
const instance = "acceptance-e143d720dd1a4357a3c3";
const configPath = path.join(root, "node_modules/.cache/fan-support-local-experience", instance, "config.json");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const baseline = JSON.parse(await readFile(path.join(output, "start.json"), "utf8"));
const beforeBytes = await readFile(configPath);
assert.equal(hash(beforeBytes), baseline.privateConfigSha256);
const config = JSON.parse(beforeBytes);
const run = async (command) => {
  const result = await promisify(execFile)(process.execPath, ["scripts/local-experience.mjs", command, "--instance", instance], { cwd: root, env: process.env, timeout: 360000, maxBuffer: 8 * 1024 * 1024 });
  await writeFile(path.join(output, `user-instance-${command}-final.txt`), result.stdout + result.stderr, { flag: "wx" });
  return result.stdout;
};
const before = JSON.parse(await run("status"));
assert.equal(before.ready, true);
assert.equal(before.instanceId, config.instanceId);
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), status: "RUNNING", instanceId: before.instanceId, beforeRunId: before.runId, action: "NORMAL_STOP_AND_START", resetPerformed: false, requests: [] };
try {
  await run("stop");
  await run("start");
  const afterResult = await promisify(execFile)(process.execPath, ["scripts/local-experience.mjs", "status", "--instance", instance], { cwd: root, env: process.env });
  const after = JSON.parse(afterResult.stdout);
  await writeFile(path.join(output, "user-instance-status-after.txt"), afterResult.stdout, { flag: "wx" });
  assert.equal(after.ready, true);
  assert.equal(after.instanceId, before.instanceId);
  assert.notEqual(after.runId, before.runId);
  assert.equal(Object.values(after.services).every(Boolean), true);
  report.afterRunId = after.runId;
  report.services = after.services;
  const ca = await readFile(config.tls.caCertificatePath);
  for (const app of ["storefront", "admin"]) {
    const url = new URL("/zh-CN", config.origins[app]);
    const statusCode = await new Promise((resolve, reject) => {
      const request = https.get(url, { ca, rejectUnauthorized: true, lookup(_host, options, callback) { if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]); else callback(null, "127.0.0.1", 4); } }, (response) => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
      request.setTimeout(60000, () => request.destroy(new Error("Owned TLS smoke timeout")));
      request.on("error", reject);
    });
    assert.equal(statusCode, 200);
    report.requests.push({ app, method: "GET", pathname: "/zh-CN", statusCode, certificateVerified: true });
  }
  report.privateConfigSha256 = hash(await readFile(configPath));
  assert.equal(report.privateConfigSha256, baseline.privateConfigSha256);
  report.nextVersions = {};
  for (const app of ["admin", "storefront"]) {
    const manifest = JSON.parse(await readFile(path.join(root, "apps", app, "node_modules/next/package.json"), "utf8"));
    assert.equal(manifest.version, "16.3.6");
    report.nextVersions[app] = manifest.version;
  }
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(output, "user-instance-refresh.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, resetPerformed: false }));
}

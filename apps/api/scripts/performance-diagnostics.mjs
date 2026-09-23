import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { createPerformanceLighthouseConfig } from "./performance-content.mjs";
import { aggregateAcceptanceLighthouse } from "./storefront-acceptance-performance.mjs";

/** Nine fixed diagnostic samples; original options and aggregator, never formal acceptance. */
export async function collectPerformanceDiagnostics({
  origin,
  gateway,
  targets,
  output,
  progress,
}) {
  await mkdir(output, { recursive: true });
  const { default: lighthouse } = await import("lighthouse");
  const require = createRequire(import.meta.url);
  const lighthouseRequire = createRequire(require.resolve("lighthouse"));
  const launcher = await import(lighthouseRequire.resolve("chrome-launcher"));
  const certificate = new X509Certificate(
    await readFile(gateway.certificatePath),
  );
  const pin = createHash("sha256")
    .update(certificate.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    formal: false,
    samples: [],
    aggregates: [],
    realUserEvidence: false,
  };
  const save = () =>
    writeFile(
      path.join(output, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  await save();
  const chrome = await launcher.launch({
    chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    handleSIGINT: false,
    logLevel: "silent",
    chromeFlags: [
      "--headless=new",
      `--ignore-certificate-errors-spki-list=${pin}`,
      "--host-resolver-rules=MAP media.example.invalid 127.0.0.1",
      "--no-proxy-server",
    ],
  });
  try {
    for (const target of targets) {
      const runs = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        progress(
          `DIAGNOSTIC Lighthouse ${target.locale}/${target.kind} ${attempt}/3`,
        );
        const name = `${target.locale}-${target.kind}-mobile-${attempt}`;
        const result = await lighthouse(
          origin + target.path,
          {
            port: chrome.port,
            logLevel: "error",
            output: ["json", "html"],
            onlyCategories: [
              "performance",
              "accessibility",
              "best-practices",
              "seo",
              "storefront",
            ],
            formFactor: "mobile",
            throttlingMethod: "simulate",
          },
          createPerformanceLighthouseConfig(target, origin + target.path),
        );
        assert.ok(result, "Diagnostic must retain an actual report");
        await writeFile(
          path.join(output, `${name}.json`),
          JSON.stringify(result.lhr, null, 2) + "\n",
        );
        const html = Array.isArray(result.report)
          ? result.report.find((value) => value.trimStart().startsWith("<!"))
          : result.report;
        if (html) await writeFile(path.join(output, `${name}.html`), html);
        report.samples.push({
          locale: target.locale,
          kind: target.kind,
          attempt,
          file: `${name}.json`,
          html: html ? `${name}.html` : null,
        });
        await save();
        assert.equal(result.lhr.lighthouseVersion, "13.4.1");
        assert.equal(
          result.lhr.audits["performance-current-content"]?.score,
          1,
          "Current content must exist in the same diagnostic navigation",
        );
        runs.push(result.lhr);
      }
      report.aggregates.push({
        locale: target.locale,
        kind: target.kind,
        ...aggregateAcceptanceLighthouse(runs),
      });
      await save();
    }
    report.status = "DIAGNOSTIC_COLLECTED";
    return report;
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      name: error?.name,
      assertion: error?.name === "AssertionError" ? error.message : null,
    };
    throw error;
  } finally {
    await chrome.kill();
    await save();
  }
}

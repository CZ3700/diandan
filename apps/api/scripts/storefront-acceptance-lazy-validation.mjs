import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { withAcceptanceBrowser } from "./storefront-acceptance-browser.mjs";

/** Identify emitted export registrations, never guessed hashes or valid-response substitutes. */
export async function findAcceptanceValidationChunks(directory) {
  // The gift directory no longer has a draft to validate (L2-17): its choices are links.
  const exports = { artist: "prepareArtistSearch" };
  const found = { artist: [] };
  for (const filename of await readdir(directory)) {
    if (!filename.endsWith(".js")) continue;
    const bytes = await readFile(path.join(directory, filename));
    const source = bytes.toString("utf8");
    for (const [kind, name] of Object.entries(exports)) {
      if (!source.includes(`.s(["${name}",0,`)) continue;
      found[kind].push({
        path: `/_next/static/chunks/${filename}`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        export: name,
      });
    }
  }
  for (const [kind, chunks] of Object.entries(found))
    assert.equal(chunks.length, 1, `one emitted ${kind} validation export`);
  return found;
}

function createBarrier() {
  let release;
  let requested;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const seen = new Promise((resolve) => {
    requested = resolve;
  });
  return { pending, seen, release, requested };
}

/** Real compiled TEST pages; only the identified script may be delayed or fail. */
export async function verifyAcceptanceLazyValidation({
  origin,
  fixtures,
  gateway,
  outputDirectory,
  sourceSha256,
  chunksDirectory = path.resolve("apps/storefront/.next/static/chunks"),
}) {
  await mkdir(outputDirectory, { recursive: true });
  const chunks = await findAcceptanceValidationChunks(chunksDirectory);
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    sourceSha256,
    scope:
      "Compiled TEST Chrome async-validation regression; actual API/script bytes; fault injection only. No Lighthouse, VoiceOver, BFCache or production claim.",
    startedAt: new Date().toISOString(),
    chunks,
    cases: [],
  };
  const save = () =>
    writeFile(
      path.join(outputDirectory, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  await withAcceptanceBrowser({ gateway }, async (browser) => {
    report.browserVersion = browser.version();
    async function run(name, kind, verify) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const record = {
        name,
        kind,
        status: "RUNNING",
        assertions: 0,
        scripts: [],
        queries: [],
        observations: {},
      };
      report.cases.push(record);
      page.on("request", (request) => {
        const url = new globalThis.URL(request.url());
        if (request.resourceType() === "script")
          record.scripts.push(url.pathname);
        if (
          url.pathname === "/api/storefront/idols" &&
          url.searchParams.has("q")
        )
          record.queries.push(url.searchParams.get("q"));
      });
      const check = (condition, message) => {
        assert.ok(condition, message);
        record.assertions += 1;
      };
      let release = () => {};
      try {
        const response = await page.goto(`${origin}/en/idols`, {
          waitUntil: "networkidle",
        });
        check(response?.status() === 200, "actual compiled page HTTP 200");
        check(
          !record.scripts.includes(chunks[kind][0].path),
          "validation export is absent from fresh initial traffic",
        );
        record.initialScripts = [...record.scripts];
        const gate = createBarrier();
        release = gate.release;
        let mode = "delay";
        await page.route(`${origin}${chunks[kind][0].path}`, async (route) => {
          gate.requested();
          if (mode === "failure")
            return route.fulfill({
              status: 503,
              contentType: "text/plain",
              body: "TEST injected script failure",
            });
          if (mode === "delay") await gate.pending;
          return route.continue();
        });
        const pending = async () => {
          let timeout;
          try {
            await Promise.race([
              gate.seen,
              new Promise((_, reject) => {
                timeout = globalThis.setTimeout(
                  () =>
                    reject(
                      new Error(
                        "expected validation chunk request not observed",
                      ),
                    ),
                  10_000,
                );
              }),
            ]);
          } finally {
            globalThis.clearTimeout(timeout);
          }
          check(
            record.scripts.includes(chunks[kind][0].path),
            "real first interaction requests identified emitted validation chunk",
          );
        };
        await page.locator("[data-artist-search]").waitFor();
        await verify({
          page,
          check,
          record,
          pending,
          release: gate.release,
          mode: (value) => {
            mode = value;
          },
        });
        record.status = "PASS";
      } catch (error) {
        record.status = "FAIL";
        record.error = { name: error.name, message: error.message };
      } finally {
        release();
        record.finalUrl = page.url();
        await page
          .screenshot({
            path: path.join(outputDirectory, `${name}.png`),
            fullPage: true,
          })
          .catch(() => {});
        await context.close();
        await save();
      }
    }
    for (const cancel of ["escape", "clear", "ime"]) {
      await run(
        `artist-delay-${cancel}`,
        "artist",
        async ({ page, check, pending, release, record }) => {
          const search = page.locator("[data-artist-search]");
          await search.fill("Mira");
          await pending();
          if (cancel === "escape") await search.press("Escape");
          if (cancel === "clear") await search.fill("");
          if (cancel === "ime")
            await search.dispatchEvent("compositionstart", { data: "海" });
          release();
          await page.waitForTimeout(850);
          check(
            !record.queries.includes("Mira"),
            "cancelled pending import cannot issue obsolete search API request",
          );
          check(
            (await search.getAttribute("aria-expanded")) === "false",
            "cancelled search does not reopen stale suggestions",
          );
          check(
            new globalThis.URL(page.url()).searchParams.get("anchorId") ===
              null,
            "cancelled search does not navigate",
          );
        },
      );
    }
    await run(
      "artist-delay-latest-wins",
      "artist",
      async ({ page, check, pending, release, record }) => {
        const search = page.locator("[data-artist-search]");
        await search.fill("Mira");
        await pending();
        await search.fill("Kai");
        await page.waitForTimeout(350);
        release();
        await page
          .locator(`[data-artist-result="${fixtures.artists[1].id}"]`)
          .waitFor();
        check(
          !record.queries.includes("Mira") && record.queries.includes("Kai"),
          "only the newest query reaches the actual API after module loading",
        );
        check(
          (await page
            .locator(`[data-artist-result="${fixtures.artists[0].id}"]`)
            .count()) === 0,
          "obsolete artist cannot become active in suggestions",
        );
      },
    );
    await run(
      "artist-script-failure-retry",
      "artist",
      async ({ page, check, pending, mode, record }) => {
        mode("failure");
        await page.locator("[data-artist-search]").fill("Mira");
        await pending();
        const suggestions = page
          .locator("[data-artist-search-results]")
          .locator("..");
        const retry = suggestions.getByRole("button");
        await retry.waitFor();
        check(
          await suggestions.getByRole("status").isVisible(),
          "module failure is explicitly visible to search user",
        );
        mode("real");
        await retry.click();
        await page
          .locator(`[data-artist-result="${fixtures.artists[0].id}"]`)
          .waitFor({ timeout: 10_000 });
        check(
          record.queries.includes("Mira"),
          "offered retry recovers actual first-import failure with a real API response",
        );
      },
    );
  });
  report.status = report.cases.every((item) => item.status === "PASS")
    ? "PASS"
    : "FAIL";
  report.finishedAt = new Date().toISOString();
  await save();
  assert.equal(
    report.status,
    "PASS",
    "all actual lazy-validation regressions pass; failures retained in results.json",
  );
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [origin, manifest, certificatePath, outputDirectory, sourceManifest] =
    process.argv.slice(2);
  assert.ok(
    origin && manifest && certificatePath && outputDirectory && sourceManifest,
    "origin fixture certificate output sourceManifest required",
  );
  const source = JSON.parse(await readFile(sourceManifest, "utf8"));
  const result = await verifyAcceptanceLazyValidation({
    origin,
    fixtures: JSON.parse(await readFile(manifest, "utf8")),
    gateway: { certificatePath },
    outputDirectory,
    sourceSha256: source.sha256 ?? source.sourceSha256,
  });
  globalThis.console.log(
    `${result.status}: ${result.cases.length} compiled async-validation cases`,
  );
}

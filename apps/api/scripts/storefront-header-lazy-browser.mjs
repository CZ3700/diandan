import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { withAcceptanceBrowser } from "./storefront-acceptance-browser.mjs";

const HEADER_PRODUCT_PATHS = [
  "apps/storefront/src/storefront/site-header.tsx",
  "apps/storefront/src/storefront/site-header-language.tsx",
  "apps/storefront/src/storefront/site-header-language-menu.tsx",
  "packages/ui/src/menu.tsx",
  "packages/ui/src/selection-controls.tsx",
];

/** Bind the run to root's exact candidate algorithm and the current owned product bytes. */
export async function readHeaderSourceManifest(
  filename,
  workspaceRoot = process.cwd(),
) {
  const bytes = await readFile(filename);
  const source = JSON.parse(bytes.toString("utf8"));
  assert.equal(
    source.algorithm,
    "sha256(sorted relative path + NUL + content sha256 + newline)",
  );
  assert.ok(
    source.files &&
      typeof source.files === "object" &&
      !Array.isArray(source.files),
  );
  const entries = Object.entries(source.files).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  assert.equal(source.fileCount, entries.length);
  for (const [, digest] of entries) assert.match(digest, /^[a-f0-9]{64}$/u);
  const aggregate = createHash("sha256")
    .update(
      entries.map(([filename, digest]) => `${filename}\0${digest}\n`).join(""),
    )
    .digest("hex");
  assert.equal(
    source.sha256,
    aggregate,
    "candidate aggregate must match the declared file hashes",
  );
  const verifiedProductFiles = {};
  for (const filename of HEADER_PRODUCT_PATHS) {
    const actual = createHash("sha256")
      .update(await readFile(path.join(workspaceRoot, filename)))
      .digest("hex");
    assert.equal(
      actual,
      source.files[filename],
      "Header product bytes must match the compiled candidate",
    );
    verifiedProductFiles[filename] = actual;
  }
  return {
    sourceSha256: source.sha256,
    sourceManifestSha256: createHash("sha256").update(bytes).digest("hex"),
    verifiedProductFiles,
  };
}

/** Locate the actual emitted lazy export; no guessed chunk names or synthetic success. */
export async function findHeaderLanguageChunk(directory) {
  const matches = [];
  for (const filename of await readdir(directory)) {
    if (!filename.endsWith(".js")) continue;
    const bytes = await readFile(path.join(directory, filename));
    if (!/\.s\(\[[^\]]*"HeaderLanguageMenu",/u.test(bytes.toString("utf8")))
      continue;
    matches.push({
      path: `/_next/static/chunks/${filename}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  assert.equal(
    matches.length,
    1,
    "exactly one compiled HeaderLanguageMenu export",
  );
  return matches[0];
}

function barrier() {
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

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error("EXPECTED_HEADER_CHUNK_TIMEOUT")),
          10_000,
        );
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function verifyHeaderLazyBrowser({
  origin,
  fixtures,
  gateway,
  outputDirectory,
  sourceSha256,
  sourceManifestSha256,
  verifiedProductFiles,
  chunksDirectory = path.resolve("apps/storefront/.next/static/chunks"),
}) {
  await mkdir(outputDirectory, { recursive: true });
  const chunk = await findHeaderLanguageChunk(chunksDirectory);
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    scope:
      "Actual compiled TEST Chrome header menu. Fresh browser contexts; only actual lazy script is delayed or returns injected 503. No performance, VoiceOver or physical-device claim.",
    sourceSha256,
    sourceManifestSha256,
    verifiedProductFiles,
    browserClosed: false,
    chunk,
    startedAt: new Date().toISOString(),
    cases: [],
  };
  const save = () =>
    writeFile(
      path.join(outputDirectory, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  const query = new globalThis.URLSearchParams(fixtures.markets[0]);
  query.set("idol", fixtures.artists[0].id);
  const url = `${origin}/en?${query}`;
  try {
    await withAcceptanceBrowser({ gateway }, async (browser) => {
      report.browserVersion = browser.version();
      async function run(name, verify, mobile = false) {
        const record = {
          name,
          status: "RUNNING",
          stage: "new-context",
          assertions: 0,
          scripts: [],
          observations: {},
        };
        report.cases.push(record);
        const context = await browser.newContext({
          viewport: mobile
            ? { width: 390, height: 844 }
            : { width: 1440, height: 900 },
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        let release = () => {};
        const check = (condition, message) => {
          assert.ok(condition, message);
          record.assertions++;
        };
        try {
          page.on("request", (request) => {
            if (request.resourceType() === "script")
              record.scripts.push(new globalThis.URL(request.url()).pathname);
          });
          record.stage = "initial";
          const response = await page.goto(url, { waitUntil: "networkidle" });
          check(response?.status() === 200, "actual public page HTTP 200");
          const drawerTrigger = page.locator(".storefront-mobile-menu button");
          if (mobile) await drawerTrigger.click();
          const language = page.locator(
            mobile
              ? ".storefront-drawer-nav [data-storefront-language]"
              : ".storefront-desktop-language [data-storefront-language]",
          );
          const trigger = language.locator(".fs-menu__trigger");
          await trigger.waitFor({ state: "visible" });
          await page.waitForFunction(
            (selector) =>
              globalThis.document
                .querySelector(selector)
                ?.getAttribute("aria-expanded") === "false",
            mobile
              ? ".storefront-drawer-nav .fs-menu__trigger"
              : ".storefront-desktop-language .fs-menu__trigger",
          );
          check(
            !record.scripts.includes(chunk.path),
            "lazy menu is absent from actual initial requests",
          );
          record.initialScripts = [...record.scripts];
          const gate = barrier();
          release = gate.release;
          let mode = "real";
          await page.route(`${origin}${chunk.path}`, async (route) => {
            gate.requested();
            if (mode === "failure")
              return route.fulfill({
                status: 503,
                contentType: "text/plain",
                body: "TEST injected menu script failure",
              });
            if (mode === "delay") await gate.pending;
            return route.continue();
          });
          const popup = page.locator(".fs-menu__popup");
          const items = popup.getByRole("menuitemradio");
          const open = async (key) => {
            await trigger.focus();
            await page.keyboard.press(key);
            await popup.waitFor({ state: "visible" });
            check(
              (await items.count()) === SUPPORTED_LOCALES.length,
              "all canonical language options remain available",
            );
          };
          const edge = async (index) => {
            await page.waitForFunction((expected) => {
              const options = [
                ...globalThis.document.querySelectorAll(
                  '.fs-menu__popup [role="menuitemradio"]',
                ),
              ];
              return (
                options.indexOf(globalThis.document.activeElement) === expected
              );
            }, index);
            record.observations.focusedIndex = await items.evaluateAll(
              (options) => options.indexOf(globalThis.document.activeElement),
            );
            check(
              record.observations.focusedIndex === index,
              "first keyboard activation focuses the correct edge",
            );
          };
          record.stage = name;
          await verify({
            page,
            context,
            record,
            check,
            language,
            trigger,
            drawerTrigger,
            popup,
            items,
            open,
            edge,
            pending: () => bounded(gate.seen),
            mode: (next) => {
              mode = next;
            },
            release,
          });
          check(
            page.url().startsWith(origin),
            "all navigation stays on the actual TEST origin",
          );
          record.status = "PASS";
          record.screenshot = `${name}.png`;
          await page.screenshot({
            path: path.join(outputDirectory, record.screenshot),
            fullPage: true,
          });
        } catch (error) {
          record.status = "FAIL";
          record.errorKind =
            error instanceof Error ? error.name : "UnknownError";
          record.observations.active = await page
            .evaluate(() => ({
              tag: globalThis.document.activeElement?.tagName,
              role: globalThis.document.activeElement?.getAttribute("role"),
              menuIndex: [
                ...globalThis.document.querySelectorAll(
                  '.fs-menu__popup [role="menuitemradio"]',
                ),
              ].indexOf(globalThis.document.activeElement),
            }))
            .catch(() => null);
          await page
            .screenshot({
              path: path.join(outputDirectory, `${name}-failure.png`),
              fullPage: true,
            })
            .catch(() => undefined);
        } finally {
          release();
          await save();
          await context.close();
        }
      }
      for (const key of ["ArrowUp", "ArrowDown", "Enter", "Space"]) {
        await run(
          `cold-${key.toLowerCase()}`,
          async ({ open, edge, page, trigger, popup, check }) => {
            await open(key);
            if (key.startsWith("Arrow"))
              await edge(key === "ArrowUp" ? SUPPORTED_LOCALES.length - 1 : 0);
            await page.keyboard.press("Escape");
            await popup.waitFor({ state: "hidden" });
            check(
              await trigger.evaluate(
                (node) => node === globalThis.document.activeElement,
              ),
              "Escape restores the actual menu trigger",
            );
          },
        );
      }
      await run(
        "repeated-open-close",
        async ({ open, page, popup, trigger, check }) => {
          for (let cycle = 0; cycle < 3; cycle++) {
            await open("Enter");
            await page.keyboard.press("Escape");
            await popup.waitFor({ state: "hidden" });
            check(
              await trigger.evaluate(
                (node) => node === globalThis.document.activeElement,
              ),
              "each close retains trigger keyboard focus",
            );
          }
        },
      );
      for (const key of ["Escape", "Tab"]) {
        await run(
          `delay-${key.toLowerCase()}`,
          async ({
            page,
            mode,
            trigger,
            language,
            pending,
            release,
            check,
          }) => {
            mode("delay");
            await trigger.focus();
            await page.keyboard.press("ArrowDown");
            await pending();
            const old = await trigger.elementHandle();
            check(
              (await language.getAttribute("data-language-state")) ===
                "loading",
              "actual chunk delay keeps visible loading state",
            );
            await page.keyboard.press(key);
            const active = await page.evaluateHandle(
              () => globalThis.document.activeElement,
            );
            release();
            await page.waitForLoadState("networkidle");
            await page.waitForTimeout(150);
            check(
              await old.evaluate((node) => node.isConnected),
              "cancelled loading keeps the original native trigger",
            );
            check(
              await active.evaluate(
                (node) => node === globalThis.document.activeElement,
              ),
              "late resolution does not lose or reclaim the user's current focus",
            );
            check(
              (await page.locator(".fs-menu__popup:visible").count()) === 0,
              "cancelled chunk cannot open a popup",
            );
          },
        );
      }
      await run(
        "failure-retry",
        async ({
          page,
          mode,
          trigger,
          pending,
          language,
          popup,
          check,
          record,
        }) => {
          mode("failure");
          await trigger.click();
          await pending();
          await page.waitForFunction(
            () =>
              globalThis.document
                .querySelector(
                  ".storefront-desktop-language [data-storefront-language]",
                )
                ?.getAttribute("data-language-state") === "error",
          );
          check(
            await language.getByRole("status").isVisible(),
            "real script 503 has visible error feedback",
          );
          mode("real");
          await language.getByRole("status").getByRole("button").click();
          await page.waitForFunction(
            () =>
              globalThis.document.querySelector(".fs-menu__popup") !== null ||
              globalThis.document.querySelector(
                '.storefront-desktop-language [data-storefront-language] [role="status"] a',
              ) !== null,
          );
          const reload = language.getByRole("status").getByRole("link");
          if (await reload.count()) {
            check(
              (await reload.getAttribute("href")) === url,
              "explicit reload preserves exact commerce URL",
            );
            record.observations.recovery = "explicit-full-page-reload";
            await reload.click();
            await trigger.waitFor({ state: "visible" });
            await trigger.click();
          } else record.observations.recovery = "same-document-retry";
          await popup.waitFor({ state: "visible" });
          check(
            (await popup.getByRole("menuitemradio").count()) ===
              SUPPORTED_LOCALES.length,
            "retry eventually restores the real language menu",
          );
        },
      );
      await run(
        "mobile-first-arrow",
        async ({ open, edge, page, popup, check }) => {
          await open("ArrowDown");
          await edge(0);
          await page.keyboard.press("Escape");
          await popup.waitFor({ state: "hidden" });
          check(
            await page.locator(".storefront-drawer-nav").isVisible(),
            "closing child menu keeps the parent drawer open",
          );
        },
        true,
      );
      await run(
        "mobile-close-delayed",
        async ({
          page,
          mode,
          trigger,
          pending,
          release,
          drawerTrigger,
          check,
        }) => {
          mode("delay");
          await trigger.click();
          await pending();
          await page.locator(".fs-drawer__popup .fs-overlay__close").click();
          await page
            .locator(".storefront-drawer-nav")
            .waitFor({ state: "hidden" });
          release();
          await page.waitForLoadState("networkidle");
          check(
            (await page.locator(".fs-menu__popup:visible").count()) === 0,
            "closing parent cancels delayed child portal",
          );
          check(
            await drawerTrigger.evaluate(
              (node) => node === globalThis.document.activeElement,
            ),
            "drawer close retains its original trigger focus",
          );
        },
        true,
      );
      await run(
        "locale-navigation",
        async ({ open, items, page, context, check }) => {
          await open("ArrowDown");
          await Promise.all([
            page.waitForURL(
              (next) => next.pathname === `/${SUPPORTED_LOCALES[1]}`,
            ),
            items.nth(1).click(),
          ]);
          const destination = new globalThis.URL(page.url());
          check(
            destination.search === new globalThis.URL(url).search,
            "language selection preserves all commerce query fields",
          );
          const cookies = await context.cookies(origin);
          check(
            cookies.some((cookie) => cookie.value === SUPPORTED_LOCALES[1]),
            "actual language navigation writes the presentation preference",
          );
        },
      );
    });
    report.browserClosed = true;
  } finally {
    report.status =
      report.browserClosed &&
      report.cases.length === 11 &&
      report.cases.every((item) => item.status === "PASS")
        ? "PASS"
        : "FAIL";
    report.finishedAt = new Date().toISOString();
    await save();
  }
  assert.equal(
    report.status,
    "PASS",
    "all compiled header cases pass; any failures remain in results.json",
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
  const source = await readHeaderSourceManifest(sourceManifest);
  const report = await verifyHeaderLazyBrowser({
    origin,
    fixtures: JSON.parse(await readFile(manifest, "utf8")),
    gateway: { certificatePath },
    outputDirectory,
    ...source,
  });
  globalThis.console.log(
    `${report.status}: ${report.cases.length} actual compiled header cases`,
  );
}

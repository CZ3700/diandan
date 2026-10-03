import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { withAcceptanceBrowser } from "./storefront-acceptance-browser.mjs";
import { readHeaderSourceManifest } from "./storefront-header-lazy-browser.mjs";

export async function findDrawerChunk(directory) {
  const chunks = [];
  for (const filename of await readdir(directory)) {
    if (!filename.endsWith(".js")) continue;
    const bytes = await readFile(path.join(directory, filename));
    if (/\.s\(\[[^\]]*"StorefrontDrawer",/u.test(bytes.toString("utf8")))
      chunks.push({
        path: `/_next/static/chunks/${filename}`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
  }
  assert.equal(chunks.length, 1, "one actual StorefrontDrawer export chunk");
  return chunks[0];
}

export async function readDrawerSource(
  filename,
  workspaceRoot = process.cwd(),
) {
  const source = JSON.parse(await readFile(filename, "utf8"));
  const result = await readHeaderSourceManifest(filename, workspaceRoot);
  for (const file of [
    "apps/storefront/src/storefront/lazy-drawer.tsx",
    "apps/storefront/src/storefront/lazy-drawer-module.tsx",
    "apps/storefront/src/storefront/gift-recipient.tsx",
    "apps/storefront/src/storefront/gift-filters-client.tsx",
    "packages/ui/src/overlay.tsx",
  ]) {
    const digest = createHash("sha256")
      .update(await readFile(path.join(workspaceRoot, file)))
      .digest("hex");
    assert.equal(
      digest,
      source.files[file],
      "Drawer product must equal the frozen compiled inputs",
    );
    result.verifiedProductFiles[file] = digest;
  }
  return result;
}

function createBarrier() {
  let release, requested;
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
          () => reject(new Error("DRAWER_CHUNK_NOT_REQUESTED")),
          10_000,
        );
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function verifyDrawerLazyBrowser({
  origin,
  fixtures,
  gateway,
  outputDirectory,
  source,
  chunksDirectory = path.resolve("apps/storefront/.next/static/chunks"),
}) {
  const chunk = await findDrawerChunk(chunksDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    scope:
      "Actual compiled TEST Chrome Drawer activation/cancellation/recovery. Real HTTP/script bytes; only identified script delay/503. English UI; no performance, physical touch-device or VoiceOver claim.",
    ...source,
    chunk,
    startedAt: new Date().toISOString(),
    browserClosed: false,
    cases: [],
  };
  const save = () =>
    writeFile(
      path.join(outputDirectory, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  const query = new globalThis.URLSearchParams(fixtures.markets[0]);
  const gift = fixtures.gifts[0];
  assert.ok(gift?.handle, "fixture has an actual published gift handle");
  const surfaces = {
    menu: {
      url: `${origin}/en?${query}`,
      trigger: ".storefront-mobile-menu .fs-overlay-trigger",
      failure: ".storefront-mobile-menu [data-drawer-load-failure]",
    },
    recipient: {
      url: `${origin}/en/gifts/${gift.handle}?${query}`,
      trigger: "[data-gift-recipient-picker] .fs-overlay-trigger",
      failure: "[data-gift-recipient-picker] [data-drawer-load-failure]",
    },
  };
  try {
    await withAcceptanceBrowser({ gateway }, async (browser) => {
      report.browserVersion = browser.version();
      async function run(name, surfaceName, verify) {
        const surface = surfaces[surfaceName];
        const record = {
          name,
          surface: surfaceName,
          status: "RUNNING",
          stage: "initial",
          assertions: 0,
          scripts: [],
          observations: {},
        };
        report.cases.push(record);
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
          reducedMotion: "reduce",
          hasTouch: true,
          isMobile: true,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        let release = () => {};
        const check = (condition, message) => {
          record.lastAssertion = message;
          assert.ok(condition, message);
          record.assertions++;
        };
        try {
          page.on("request", (request) => {
            if (request.resourceType() === "script")
              record.scripts.push(new globalThis.URL(request.url()).pathname);
          });
          const response = await page.goto(surface.url, {
            waitUntil: "networkidle",
          });
          check(response?.status() === 200, "actual public page returns 200");
          const trigger = page.locator(surface.trigger);
          await trigger.waitFor({ state: "visible" });
          check(
            !record.scripts.includes(chunk.path),
            "shared Drawer chunk absent before actual activation",
          );
          record.initialScripts = [...record.scripts];
          const gate = createBarrier();
          release = gate.release;
          let mode = "real",
            failures = 0;
          await page.route(`${origin}${chunk.path}`, async (route) => {
            gate.requested();
            if (mode === "failure") {
              failures++;
              return route.fulfill({
                status: 503,
                contentType: "text/plain",
                body: "TEST injected Drawer script failure",
              });
            }
            if (mode === "delay") await gate.pending;
            return route.continue();
          });
          const popup = page.locator(".fs-drawer__popup");
          const activate = async (method) => {
            if (method === "touch") await trigger.tap();
            else if (method === "click") await trigger.click();
            else {
              await trigger.focus();
              await page.keyboard.press(method);
            }
          };
          const opened = async (touch = false) => {
            await popup.waitFor({ state: "visible" });
            await page.waitForFunction((touch) => {
              const popup =
                globalThis.document.querySelector(".fs-drawer__popup");
              return touch
                ? popup === globalThis.document.activeElement
                : popup?.contains(globalThis.document.activeElement);
            }, touch);
            check(
              await popup.evaluate(
                (node, touch) =>
                  touch
                    ? node === globalThis.document.activeElement
                    : node.contains(globalThis.document.activeElement),
                touch,
              ),
              "first open retains the original focus policy",
            );
          };
          const trappedFocus = async (label) => {
            const initial = await popup.evaluate((node) => ({
              inside: node.contains(globalThis.document.activeElement),
              guard:
                globalThis.document.activeElement?.hasAttribute(
                  "data-base-ui-focus-guard",
                ) === true,
              guardType:
                globalThis.document.activeElement?.getAttribute("data-type"),
            }));
            record.observations.focusTransitions ??= [];
            record.observations.focusTransitions.push({ label, ...initial });
            // Existing P2 assertFocusInside uses the same bounded 500ms guard settling.
            // A guard is never itself a passing final location.
            if (
              !initial.inside &&
              initial.guard &&
              initial.guardType === "inside"
            ) {
              await page.waitForFunction(
                () => {
                  const active = globalThis.document.activeElement;
                  return (
                    globalThis.document
                      .querySelector(".fs-drawer__popup")
                      ?.contains(active) &&
                    !active?.hasAttribute("data-base-ui-focus-guard")
                  );
                },
                undefined,
                { timeout: 500 },
              );
            }
            check(
              await popup.evaluate(
                (node) =>
                  node.contains(globalThis.document.activeElement) &&
                  !globalThis.document.activeElement?.hasAttribute(
                    "data-base-ui-focus-guard",
                  ),
              ),
              label,
            );
          };
          const close = async () => {
            await page.keyboard.press("Escape");
            await popup.waitFor({ state: "hidden" });
            check(
              await trigger.evaluate(
                (node) => node === globalThis.document.activeElement,
              ),
              "closing restores the associated trigger",
            );
          };
          record.stage = name;
          await verify({
            page,
            context,
            trigger,
            popup,
            activate,
            opened,
            close,
            trappedFocus,
            check,
            record,
            surface,
            release,
            pending: () => bounded(gate.seen),
            mode: (value) => {
              mode = value;
            },
            failureCount: () => failures,
          });
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
              popup:
                globalThis.document.activeElement?.classList.contains(
                  "fs-drawer__popup",
                ),
              inside: !!globalThis.document
                .querySelector(".fs-drawer__popup")
                ?.contains(globalThis.document.activeElement),
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
      for (const surface of Object.keys(surfaces)) {
        for (const method of ["click", "touch", "Enter", "Space"]) {
          await run(
            `${surface}-cold-${method.toLowerCase()}`,
            surface,
            async ({ page, activate, opened, close, trappedFocus }) => {
              await activate(method);
              await opened(method === "touch");
              await page.keyboard.press("Tab");
              await trappedFocus("Tab stays inside the modal focus trap");
              await page.keyboard.press("Shift+Tab");
              await trappedFocus(
                "reverse Tab stays inside the modal focus trap",
              );
              await close();
              await activate(method);
              await opened(method === "touch");
              await close();
            },
          );
        }
        for (const key of ["Escape", "Tab"]) {
          await run(
            `${surface}-delay-${key.toLowerCase()}`,
            surface,
            async ({
              page,
              mode,
              activate,
              pending,
              trigger,
              release,
              popup,
              check,
            }) => {
              mode("delay");
              await activate("Enter");
              await pending();
              check(
                (await trigger.getAttribute("aria-busy")) === "true",
                "waiting leaves an announced focusable native trigger",
              );
              const original = await trigger.elementHandle();
              await page.keyboard.press(key);
              const active = await page.evaluateHandle(
                () => globalThis.document.activeElement,
              );
              release();
              await page.waitForLoadState("networkidle");
              await page.waitForTimeout(100);
              check(
                await original.evaluate((node) => node.isConnected),
                "cancellation preserves the original native trigger",
              );
              check(
                await active.evaluate(
                  (node) => node === globalThis.document.activeElement,
                ),
                "late chunk completion does not lose or reclaim focus",
              );
              check(
                !(await popup.isVisible()),
                "cancelled load cannot mount a modal",
              );
              mode("real");
              await trigger.click();
              await popup.waitFor({ state: "visible" });
            },
          );
        }
        await run(
          `${surface}-failure-retry`,
          surface,
          async ({
            page,
            mode,
            activate,
            pending,
            surface,
            popup,
            check,
            failureCount,
          }) => {
            mode("failure");
            await activate("click");
            await pending();
            const failure = page.locator(surface.failure);
            await failure.waitFor({ state: "visible" });
            check(
              failureCount() > 0,
              "the actual identified script received 503",
            );
            mode("real");
            await failure.getByRole("button").click();
            await popup.waitFor({ state: "visible" });
            check(
              !(await failure.isVisible()),
              "local retry restores the actual Drawer and clears error",
            );
          },
        );
      }
      // The gift directory no longer has a filter drawer (L2-17); the recipient picker is
      // the drawer whose recovery reloads a page with its own query.
      await run(
        "consecutive-failure-reload",
        "recipient",
        async ({
          page,
          mode,
          activate,
          pending,
          surface,
          trigger,
          popup,
          check,
        }) => {
          mode("failure");
          await activate("click");
          await pending();
          const failure = page.locator(surface.failure);
          await failure.waitFor({ state: "visible" });
          await failure.getByRole("button").click();
          const reload = failure.getByRole("link");
          await reload.waitFor({ state: "visible" });
          check(
            (await reload.getAttribute("href")) === surface.url,
            "second failure offers exact same-context full-page recovery",
          );
          mode("real");
          await reload.click();
          await page.waitForLoadState("networkidle");
          await trigger.click();
          await popup.waitFor({ state: "visible" });
          check(
            await popup.locator("[data-recipient-option]").first().isVisible(),
            "explicit recovery restores the actual recipient choices",
          );
        },
      );
      await run(
        "nested-language-menu",
        "menu",
        async ({ page, activate, opened, popup, check }) => {
          await activate("Enter");
          await opened();
          const language = popup.locator(".fs-menu__trigger");
          await language.focus();
          await page.keyboard.press("ArrowDown");
          const menu = page.locator(".fs-menu__popup");
          await menu.waitFor({ state: "visible" });
          await page.keyboard.press("Escape");
          await menu.waitFor({ state: "hidden" });
          check(
            await popup.isVisible(),
            "nested Menu close does not close the Drawer",
          );
          check(
            await language.evaluate(
              (node) => node === globalThis.document.activeElement,
            ),
            "nested close restores the language trigger",
          );
        },
      );
    });
    report.browserClosed = true;
  } finally {
    report.status =
      report.browserClosed &&
      report.cases.length === 23 &&
      report.cases.every((item) => item.status === "PASS")
        ? "PASS"
        : "FAIL";
    report.finishedAt = new Date().toISOString();
    await save();
  }
  assert.equal(
    report.status,
    "PASS",
    "all actual Drawer cases pass; failures retained in results.json",
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
    "origin fixture public certificate output sourceManifest required",
  );
  const result = await verifyDrawerLazyBrowser({
    origin,
    fixtures: JSON.parse(await readFile(manifest, "utf8")),
    gateway: { certificatePath },
    outputDirectory,
    source: await readDrawerSource(sourceManifest),
  });
  globalThis.console.log(
    `${result.status}: ${result.cases.length} actual Drawer cases`,
  );
}

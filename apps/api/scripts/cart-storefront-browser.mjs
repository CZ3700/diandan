import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cartRuntimeCurrentResponseSchema,
  cartEditResponseSchema,
  cartEditorResponseSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { withAcceptanceBrowser } from "./storefront-acceptance-browser.mjs";

/** Actual compiled UI and its same-origin BFF; no private drafts, credentials, HAR or trace are persisted. */
export async function verifyCartStorefrontBrowser({
  origin,
  gateway,
  fixtures,
  proxy,
  client,
  output,
  check,
  ui,
}) {
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    scope:
      "Production-compiled storefront under local TEST runtime, real PostgreSQL/API/TLS media and TEST KMS boundary",
    browserVersion: null,
    cases: [],
    screenshots: [],
    axe: [],
    pageErrors: 0,
    touchTargets: [],
    focusCycles: [],
    drawerVisualStates: [],
    actualAwsKms: false,
    privatePlaintextPersisted: false,
    physicalDeviceEvidence: false,
  };
  const canaries = [
    `TEST_${randomUUID()}_🌟`,
    `NAME_${randomUUID().slice(0, 8)}`,
    `EDIT_${randomUUID()}_礼`,
  ];
  let page,
    stage = "START",
    locale = "en",
    viewport;
  const save = () =>
    writeFile(
      path.join(output, "browser-results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  const phase = (value) => {
    stage = value;
    console.log(`Cart browser: ${value}`);
  };
  const plainSafe = async () =>
    !(await page
      .locator("body")
      .evaluate(
        (body, values) =>
          values.some((value) => body.innerText.includes(value)),
        canaries,
      ));
  async function capture(name) {
    check(
      await plainSafe(),
      "private canaries never appear in public cart text or a screenshot",
    );
    await page.screenshot({
      path: path.join(output, `${name}.png`),
      fullPage: true,
      mask: [
        page.locator(
          "[data-cart-personalization] textarea, [data-cart-personalization] input:not([type=radio])",
        ),
      ],
    });
    report.screenshots.push(`${name}.png`);
  }
  async function axe(name) {
    check(
      await plainSafe(),
      "private text is absent before accessibility analysis",
    );
    const require = createRequire(
      new globalThis.URL("../../../package.json", import.meta.url),
    );
    const { default: AxeBuilder } = require("@axe-core/playwright");
    const result = await new AxeBuilder({ page }).analyze();
    const safe = (entries) =>
      entries.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map(({ target }) => target),
      }));
    report.axe.push({
      name,
      violations: safe(result.violations),
      incomplete: safe(result.incomplete),
    });
    check(result.violations.length === 0, `${name} has zero axe violations`);
  }
  const cartPath = "/api/storefront/cart";
  async function observe(method, suffix, action, expected = 200) {
    const waiting = page.waitForResponse((response) => {
      const url = new globalThis.URL(response.url());
      return (
        url.origin === origin &&
        url.pathname === cartPath + suffix &&
        response.request().method() === method
      );
    });
    await action();
    const response = await waiting;
    const raw = await response.json();
    const schema = suffix.endsWith("/editor")
      ? cartEditorResponseSchema
      : ["PATCH", "DELETE"].includes(method)
        ? cartEditResponseSchema
        : cartRuntimeCurrentResponseSchema;
    const parsed = schema.safeParse(raw);
    check(
      response.status() === expected && parsed.success,
      "real cart BFF action has the expected status and strict response schema",
    );
    check(
      response.headers()["cache-control"] === "private, no-store",
      "real BFF action stays private and uncached",
    );
    if (!suffix.endsWith("/editor"))
      check(
        canaries.every((value) => !JSON.stringify(raw).includes(value)),
        "ordinary browser cart replies contain no private canary",
      );
    return parsed.data;
  }
  async function read(page_ = page, selectedLocale = locale) {
    const response = await page_.evaluate(
      async ({ locale }) => {
        const result = await globalThis.fetch(
          `/api/storefront/cart?presentationLocale=${locale}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        return { status: result.status, data: await result.json() };
      },
      { locale: selectedLocale },
    );
    check(
      response.status === 200,
      "same-origin browser can restore the established cart cookie",
    );
    const parsed = cartRuntimeCurrentResponseSchema.parse(response.data);
    check(
      parsed.outcome === "SUCCESS",
      "restored browser cart is an actual successful business view",
    );
    return parsed.cart;
  }
  async function goto(url) {
    const response = await page.goto(url, { waitUntil: "networkidle" });
    check(response?.status() === 200, "real storefront page returns HTTP 200");
    return response;
  }
  async function settledImages() {
    const loaded = await page
      .locator("main img")
      .evaluateAll(async (images) => {
        for (const image of images) image.loading = "eager";
        return Promise.all(
          images.map(async (image) => {
            try {
              await image.decode();
              return image.naturalWidth > 0;
            } catch {
              return false;
            }
          }),
        );
      });
    check(
      loaded.length >= 4 && loaded.every(Boolean),
      "real cart images decode from published media",
    );
  }
  async function touchTargets(locator, kind, minimumCount = 1) {
    const targets = await locator.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    );
    report.touchTargets.push({
      locale,
      viewport: viewport.width,
      kind,
      targets,
    });
    check(
      targets.length >= minimumCount &&
        targets.every(({ width, height }) => width >= 44 && height >= 44),
      `${kind} actual click targets are at least 44 by 44 CSS pixels`,
    );
  }
  async function containedFocus() {
    const dialog = page.getByRole("dialog");
    const state = await dialog.evaluate((element) => ({
      inside: element.contains(globalThis.document.activeElement),
      guard:
        globalThis.document.activeElement?.hasAttribute(
          "data-base-ui-focus-guard",
        ) === true,
      type: globalThis.document.activeElement?.getAttribute("data-type"),
    }));
    check(
      state.inside || (state.guard && state.type === "inside"),
      "cart drawer rejects focus outside the modal except its identified inside sentinel",
    );
    if (!state.inside)
      await page.waitForFunction(
        () =>
          globalThis.document
            .querySelector('[role="dialog"]')
            ?.contains(globalThis.document.activeElement),
        undefined,
        { timeout: 500 },
      );
    check(
      await dialog.evaluate((element) =>
        element.contains(globalThis.document.activeElement),
      ),
      "cart drawer focus settles inside the modal",
    );
  }
  try {
    return await withAcceptanceBrowser({ gateway }, async (browser) => {
      report.browserVersion = browser.version();
      for (viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ]) {
        const context = await browser.newContext({
          viewport,
          reducedMotion: viewport.width === 390 ? "reduce" : "no-preference",
        });
        try {
          page = await context.newPage();
          page.on("pageerror", () => {
            report.pageErrors++;
          });
          locale = "en";
          phase(`fresh-${viewport.width}`);
          const first = await goto(`${origin}/en/cart`);
          await page.locator(".cart-empty").waitFor();
          check(
            first.headers()["cache-control"]?.includes("no-store"),
            "cart HTML is not cached",
          );
          check(
            (
              await page.locator('meta[name="robots"]').getAttribute("content")
            )?.includes("noindex"),
            "cart HTML is not indexable",
          );
          check(
            !(await context.cookies()).some(
              (cookie) => cookie.name === "__Host-fan-cart",
            ),
            "empty read does not invent a new cart cookie",
          );
          await capture(`en-${viewport.width}-empty`);
          if (!ui) {
            report.cases.push({
              name: "empty-smoke",
              viewport: viewport.width,
            });
            continue;
          }
          const gift = fixtures.gifts[0];
          const giftUrl = (artist, targetLocale = "en") =>
            `${origin}/${targetLocale}/gifts/${gift.handle}?${new globalThis.URLSearchParams({ ...fixtures.markets[0], idol: artist.id, variant: gift.variants[0].id })}`;
          let backgroundCartReads = 0;
          const countCartReads = (request) => {
            const url = new globalThis.URL(request.url());
            if (
              request.method() === "GET" &&
              url.origin === origin &&
              url.pathname === cartPath
            )
              backgroundCartReads++;
          };
          page.on("request", countCartReads);
          const freshBrowse = await goto(giftUrl(fixtures.artists[0]));
          check(
            backgroundCartReads === 0,
            "browsing without a cart cookie does not restore an absent cart",
          );
          check(
            freshBrowse.headers()["cache-control"]?.includes("private") &&
              freshBrowse.headers()["cache-control"]?.includes("no-store"),
            "public browse HTML with a restoration hint stays private and uncached",
          );
          report.cases.push({
            name: "first-visitor-browse-without-cart-read",
            viewport: viewport.width,
            cartReads: backgroundCartReads,
          });
          const firstCartTrigger = page
            .locator("[data-cart-trigger] button")
            .first();
          await page.locator("form[data-cart-add]").waitFor();
          await firstCartTrigger.focus();
          check(
            backgroundCartReads === 0,
            "no cart restoration request occurs before the first explicit opening",
          );
          const emptyCart = await observe(
            "GET",
            "",
            () => page.keyboard.press("Enter"),
            404,
          );
          check(
            emptyCart.outcome === "FAILURE" &&
              emptyCart.code === "CART_NOT_FOUND",
            "first opening uses the strictly validated absent-cart response",
          );
          await page.locator("[data-cart-drawer] .cart-empty").waitFor();
          check(
            backgroundCartReads === 1,
            "first keyboard opening still reads and validates the current cart",
          );
          check(
            !(await context.cookies()).some(
              (value) => value.name === "__Host-fan-cart",
            ),
            "explicit empty-cart reading does not create a session cookie",
          );
          await containedFocus();
          await page.keyboard.press("Escape");
          await page.getByRole("dialog").waitFor({ state: "hidden" });
          check(
            await firstCartTrigger.evaluate(
              (element) => element === globalThis.document.activeElement,
            ),
            "closing the first empty cart returns keyboard focus",
          );
          const form = page.locator("form[data-cart-add]");
          await form.waitFor();
          await capture(`en-${viewport.width}-add-form`);
          await touchTargets(
            form.locator(".cart-name-choice label"),
            "add-radio-labels",
            2,
          );
          await touchTargets(
            form.locator("[data-quantity-action]"),
            "add-quantity-buttons",
            2,
          );
          await touchTargets(
            form.locator("[data-cart-add-state]"),
            "add-submit",
          );
          const quantity = form.locator("[data-quantity-input]");
          const initialQuantity = Number(await quantity.inputValue());
          await form.locator('[data-quantity-action="increase"]').click();
          check(
            Number(await quantity.inputValue()) === initialQuantity + 1,
            "quantity increment responds to an actual click",
          );
          await form.locator('[data-quantity-action="decrease"]').click();
          check(
            Number(await quantity.inputValue()) === initialQuantity,
            "quantity decrement responds to an actual click",
          );
          await form.locator(".cart-name-choice label").nth(1).click();
          check(
            await form.locator('input[type="radio"]').nth(1).isChecked(),
            "radio label is an actual clickable selection target",
          );
          await form.locator("[data-cart-name]").fill(canaries[1]);
          await form.locator("[data-cart-message]").fill(canaries[0]);
          const added = await observe("POST", "/items", () =>
            form.locator("button[data-cart-add-state]").click(),
          );
          const firstId = added.cartItemId;
          await page.locator('[data-cart-add-state="confirmed"]').waitFor();
          check(
            (await form.locator("[role=status]").innerText()) !== "",
            "successful add provides a live announcement",
          );
          check(
            (await page.locator("[data-cart-drawer]").count()) === 0,
            "add feedback does not steal focus by automatically opening the drawer",
          );
          check(
            (await form.locator("[data-cart-message]").inputValue()) === "",
            "successful add clears its private draft",
          );
          const cookie = (await context.cookies()).find(
            (value) => value.name === "__Host-fan-cart",
          );
          check(
            cookie?.httpOnly &&
              cookie.secure &&
              cookie.sameSite === "Lax" &&
              cookie.path === "/" &&
              cookie.domain === "localhost",
            "Chrome natively stores the same-origin secure HttpOnly host cart cookie",
          );
          check(
            await page.evaluate(
              () => !globalThis.document.cookie.includes("__Host-fan-cart"),
            ),
            "cart token is inaccessible to document JavaScript",
          );
          backgroundCartReads = 0;
          const returningBrowse = await goto(giftUrl(fixtures.artists[1]));
          await page.locator("[data-cart-count]").waitFor();
          check(
            backgroundCartReads === 1 &&
              (await page.locator("[data-cart-count]").innerText()) ===
                added.cart.items
                  .reduce((sum, item) => sum + BigInt(item.quantity), 0n)
                  .toLocaleString("en"),
            "an established cart restores its real badge once on a browse page",
          );
          const returningCache = returningBrowse.headers()["cache-control"];
          check(
            returningCache?.includes("private") &&
              returningCache.includes("no-store") &&
              !(await returningBrowse.text()).includes(cookie.value),
            "restoration serializes no cart credential and cannot enter a shared HTML cache",
          );
          page.off("request", countCartReads);
          report.cases.push({
            name: "returning-visitor-browse-restores-cart-badge",
            viewport: viewport.width,
            cartReads: backgroundCartReads,
          });
          const second = await observe("POST", "/items", () =>
            page.locator("[data-cart-add-state]").click(),
          );
          const secondId = second.cartItemId;
          check(
            firstId !== secondId && second.cart.items.length === 2,
            "same variant for two artists stays in independent cart rows",
          );
          const baseline = second.cart;
          for (locale of SUPPORTED_LOCALES) {
            phase(`matrix-${locale}-${viewport.width}`);
            await goto(`${origin}/${locale}/cart`);
            await page.locator(`[data-cart-item="${firstId}"]`).waitFor();
            check(
              (await page.locator("html").getAttribute("lang")) === locale,
              "cart document preserves requested language",
            );
            const restored = await read();
            check(
              restored.market === baseline.market &&
                restored.currency === baseline.currency &&
                restored.items.length === 2 &&
                restored.items.every((item) =>
                  baseline.items.some(
                    (old) =>
                      old.id === item.id &&
                      old.quantity === item.quantity &&
                      old.price.current.lineTotalMinor ===
                        item.price.current.lineTotalMinor,
                  ),
                ),
              "seven languages preserve exact cart rows, quantities, amounts and market",
            );
            check(
              (await page.locator("[data-cart-editor]").count()) === 0,
              "normal cart restoration never opens or reads a private editor",
            );
            check(
              await page.evaluate(
                () =>
                  globalThis.document.documentElement.scrollWidth <=
                  globalThis.innerWidth,
              ),
              "cart page has no horizontal overflow",
            );
            await touchTargets(
              page.locator("[data-cart-quantity] [data-quantity-action]"),
              "cart-quantity-buttons",
              4,
            );
            await touchTargets(
              page.locator(
                "[data-cart-quantity-save], [data-cart-editor-open], [data-cart-remove]",
              ),
              "cart-save-edit-remove",
              6,
            );
            await touchTargets(
              page.locator("[data-cart-trigger] button"),
              "cart-header-trigger",
            );
            await settledImages();
            await capture(`${locale}-${viewport.width}-cart`);
            await axe(`${locale}-${viewport.width}-cart`);
            const trigger = page.locator("[data-cart-trigger] button").first();
            await trigger.click();
            await page
              .locator("[data-cart-drawer] [data-cart-item]")
              .first()
              .waitFor();
            // Popup visibility precedes the primitive's first autofocus frame.
            // Subsequent keyboard steps still use the immediate strict check below.
            await page.waitForFunction(
              () =>
                globalThis.document
                  .querySelector('[role="dialog"]')
                  ?.contains(globalThis.document.activeElement),
              undefined,
              { timeout: 500 },
            );
            await containedFocus();
            if (locale === "en") {
              const focusableCount = await page
                .getByRole("dialog")
                .locator("a[href], button, input, select, textarea, [tabindex]")
                .evaluateAll(
                  (elements) =>
                    elements.filter(
                      (element) =>
                        element.tabIndex >= 0 &&
                        !element.matches(":disabled") &&
                        element.getClientRects().length > 0,
                    ).length,
                );
              const steps = Math.max(20, focusableCount + 1);
              for (const key of [
                ...Array(steps).fill("Tab"),
                ...Array(steps).fill("Shift+Tab"),
              ]) {
                await page.keyboard.press(key);
                await containedFocus();
              }
              report.focusCycles.push({
                locale,
                viewport: viewport.width,
                focusableCount,
                stepsEachDirection: steps,
                status: "PASS",
              });
            }
            // Visual audits observe the completed transition, without changing it.
            await page.waitForFunction(
              () => {
                const popup =
                  globalThis.document.querySelector('[role="dialog"]');
                if (
                  !popup ||
                  popup.hasAttribute("data-starting-style") ||
                  popup.hasAttribute("data-ending-style")
                )
                  return false;
                const style = globalThis.getComputedStyle(popup);
                const transform = new globalThis.DOMMatrixReadOnly(
                  style.transform === "none" ? undefined : style.transform,
                );
                return (
                  style.opacity === "1" &&
                  transform.isIdentity &&
                  popup
                    .getAnimations()
                    .every((animation) => animation.playState === "finished")
                );
              },
              undefined,
              { timeout: 1000 },
            );
            report.drawerVisualStates.push({
              locale,
              viewport: viewport.width,
              ...(await page.getByRole("dialog").evaluate((element) => {
                const style = globalThis.getComputedStyle(element);
                return {
                  opacity: style.opacity,
                  transform: style.transform,
                  runningAnimations: element
                    .getAnimations()
                    .filter((animation) => animation.playState === "running")
                    .length,
                };
              })),
            });
            await capture(`${locale}-${viewport.width}-drawer`);
            await axe(`${locale}-${viewport.width}-drawer`);
            await page.keyboard.press("Escape");
            await page.getByRole("dialog").waitFor({ state: "hidden" });
            await page.waitForFunction(() =>
              globalThis.document
                .querySelector("[data-cart-trigger]")
                ?.contains(globalThis.document.activeElement),
            );
            report.cases.push({
              name: "cart-and-drawer",
              locale,
              viewport: viewport.width,
            });
            await save();
          }
          locale = "en";
          await goto(`${origin}/en/cart`);
          const row = () => page.locator(`[data-cart-item="${firstId}"]`);
          await row().waitFor();
          phase(`private-edit-conflict-${viewport.width}`);
          const editPath = `/items/${firstId}`;
          const editor = await observe("POST", `${editPath}/editor`, () =>
            row().locator("[data-cart-editor-open]").click(),
          );
          check(
            editor.content.fanMessage === canaries[0] &&
              editor.content.displayName === canaries[1],
            "explicit UI editor receives exact original private values",
          );
          await touchTargets(
            row().locator(".cart-name-choice label"),
            "editor-radio-labels",
            2,
          );
          await touchTargets(
            row().locator("[data-cart-editor-save], [data-cart-editor-close]"),
            "editor-save-close",
            2,
          );
          await row().locator("[data-cart-message]").fill(canaries[2]);
          const otherPage = await context.newPage();
          try {
            await otherPage.goto(`${origin}/en/cart`, {
              waitUntil: "networkidle",
            });
            const otherRow = otherPage.locator(`[data-cart-item="${firstId}"]`);
            await otherRow.locator("[data-cart-quantity] input").fill("2");
            await otherRow.locator("[data-cart-quantity-save]").click();
            await otherPage.waitForFunction(
              ({ id, version }) =>
                globalThis.document
                  .querySelector(`[data-cart-item="${id}"]`)
                  ?.getAttribute("data-cart-item-version") !== String(version),
              { id: firstId, version: editor.itemVersion },
            );
            const conflict = await observe(
              "PATCH",
              editPath,
              () => row().locator("[data-cart-editor-save]").click(),
              409,
            );
            check(
              conflict.code === "VERSION_CONFLICT",
              "stale private draft cannot silently overwrite an externally updated row",
            );
            check(
              (await row().locator("[data-cart-message]").inputValue()) ===
                canaries[2],
              "conflict preserves the unsaved draft for an explicit choice",
            );
            await page.waitForFunction(
              ({ id, version }) =>
                globalThis.document
                  .querySelector(`[data-cart-item="${id}"]`)
                  ?.getAttribute("data-cart-item-version") === String(version),
              { id: firstId, version: editor.itemVersion + 1 },
            );
            await row().locator("[data-cart-editor-close]").click();
            const current = await observe("POST", `${editPath}/editor`, () =>
              row().locator("[data-cart-editor-open]").click(),
            );
            check(
              current.content.fanMessage === canaries[0],
              "reopening reads authoritative private content rather than an uncommitted conflict draft",
            );
          } finally {
            await otherPage.close();
          }
          await row().locator("[data-cart-message]").fill(canaries[2]);
          await observe("PATCH", editPath, () =>
            row().locator("[data-cart-editor-save]").click(),
          );
          await row()
            .locator("[data-cart-editor]")
            .waitFor({ state: "hidden" });
          await capture(`en-${viewport.width}-private-saved`);
          phase(`quantity-rollback-and-network-recovery-${viewport.width}`);
          const before = await read();
          const oldQuantity = before.items.find(
            (item) => item.id === firstId,
          ).quantity;
          await row().locator("[data-cart-quantity] input").fill("4");
          proxy.arm({
            method: "PATCH",
            path: `/api/v1/cart/items/${firstId}`,
            mode: "BEFORE",
          });
          const failed = await observe(
            "PATCH",
            editPath,
            () => row().locator("[data-cart-quantity-save]").click(),
            503,
          );
          check(
            failed.outcome === "FAILURE",
            "failed optimistic quantity has an explicit error",
          );
          await row().getByRole("alert").waitFor();
          check(
            (await row().locator("[data-cart-quantity] input").inputValue()) ===
              String(oldQuantity),
            "failed quantity restores the confirmed value",
          );
          await capture(`en-${viewport.width}-quantity-error`);
          const retry = await observe("PATCH", editPath, () =>
            row().locator("[data-cart-quantity-save]").click(),
          );
          check(
            retry.cart.items.find((item) => item.id === firstId).quantity === 4,
            "explicit retry applies the intended quantity",
          );
          const requests = [];
          const record = (request) => {
            if (
              request.method() === "PATCH" &&
              new globalThis.URL(request.url()).pathname === cartPath + editPath
            )
              requests.push({
                key: request.headers()["idempotency-key"],
                body: request.postData(),
              });
          };
          page.on("request", record);
          try {
            await row().locator("[data-cart-quantity] input").fill("5");
            proxy.arm({
              method: "PATCH",
              path: `/api/v1/cart/items/${firstId}`,
              mode: "AFTER_COMMIT",
            });
            const unknown = await observe(
              "PATCH",
              editPath,
              () => row().locator("[data-cart-quantity-save]").click(),
              503,
            );
            check(
              unknown.code === "TRANSACTION_OUTCOME_UNKNOWN",
              "lost committed response is an explicitly unknown outcome",
            );
            const recovered = await observe("PATCH", editPath, () =>
              row().locator("[data-cart-quantity-save]").click(),
            );
            check(
              recovered.action === "REPLAYED" &&
                recovered.cart.items.find((item) => item.id === firstId)
                  .quantity === 5,
              "same-document recovery reads the already committed edit",
            );
            check(
              requests.length === 2 &&
                requests[0].key === requests[1].key &&
                requests[0].body === requests[1].body,
              "retry preserves exact body and idempotency key",
            );
          } finally {
            page.off("request", record);
          }
          phase(`delete-focus-privacy-${viewport.width}`);
          await row().locator("[data-cart-remove]").focus();
          const removed = await observe("DELETE", editPath, () =>
            page.keyboard.press("Enter"),
          );
          check(
            removed.cart.items.length === 1 &&
              removed.cart.items[0].id === secondId,
            "keyboard removal preserves the other artist row",
          );
          await row().waitFor({ state: "hidden" });
          await page.waitForFunction(
            (id) =>
              globalThis.document.querySelector(
                `[data-cart-item="${id}"] [data-cart-remove]`,
              ) === globalThis.document.activeElement,
            secondId,
          );
          check(
            (await page.locator("[data-cart-announcement]").innerText()) !== "",
            "keyboard deletion has a stable live announcement",
          );
          check(
            await plainSafe(),
            "private values remain absent after edit and removal",
          );
          const storage = await page.evaluate(
            async (values) => ({
              leaked: [globalThis.localStorage, globalThis.sessionStorage].some(
                (storage) =>
                  Object.values(storage).some((value) =>
                    values.some((privateValue) => value.includes(privateValue)),
                  ),
              ),
              databases: (await globalThis.indexedDB.databases()).length,
            }),
            [...canaries, cookie.value],
          );
          check(
            !storage.leaked && storage.databases === 0,
            "private drafts and credentials never enter browser persistence",
          );
          const db = await client.query(
            "SELECT count(*)::int AS count FROM cart_item_mutation_receipts WHERE cart_item_id=$1",
            [firstId],
          );
          check(
            db.rows[0].count === 5,
            "browser actions produce exactly five real mutations despite failures and replay",
          );
          await capture(`en-${viewport.width}-removed`);
          await axe(`en-${viewport.width}-removed`);
          await page
            .locator(`[data-cart-item="${secondId}"] [data-cart-remove]`)
            .focus();
          await observe("DELETE", `/items/${secondId}`, () =>
            page.keyboard.press("Enter"),
          );
          await page.locator(".cart-empty").waitFor();
          await page.waitForFunction(
            () =>
              globalThis.document.querySelector("[data-cart-root]") ===
              globalThis.document.activeElement,
          );
          await capture(`en-${viewport.width}-last-removed`);
          report.cases.push({
            name: "fresh-add-private-conflict-quantity-recovery-delete",
            viewport: viewport.width,
            reducedMotion: viewport.width === 390,
            mutationReceipts: db.rows[0].count,
          });
        } catch (error) {
          if (
            page &&
            !page.isClosed() &&
            (await plainSafe().catch(() => false))
          )
            await capture("failure-current-screen").catch(() => undefined);
          throw error;
        } finally {
          await context.close();
        }
      }
      check(
        report.pageErrors === 0,
        "all cart browser cases have zero page runtime errors",
      );
      report.status = "PASS";
      await save();
      return report;
    });
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      stage,
      locale,
      viewport: viewport?.width ?? null,
      kind: error?.name === "AssertionError" ? "ASSERTION" : "BROWSER",
    };
    if (page && !page.isClosed() && (await plainSafe().catch(() => false)))
      await capture("failure-current-screen").catch(() => undefined);
    await save();
    throw error;
  }
}

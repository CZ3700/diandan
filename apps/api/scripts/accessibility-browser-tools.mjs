import assert from "node:assert/strict";
import path from "node:path";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { expect } from "@playwright/test";
import {
  assertAccessibilityFocus,
  assertAccessibilityMeasurement,
} from "../../../scripts/accessibility-matrix.mjs";

const require = createRequire(
  new URL("../../../package.json", import.meta.url),
);
const { default: AxeBuilder } = require("@axe-core/playwright");
const privateSelectors =
  "[data-cart-name], [data-cart-message], [data-checkout-email], [data-private-panel], [data-private-content]";

export async function openAccessibilityMailbox(page, url) {
  const origin = new URL(url).origin;
  const exchange = page.waitForResponse(
    (response) =>
      response.url() === `${origin}/session` &&
      response.request().method() === "POST",
  );
  const [, response] = await Promise.all([
    page.goto(url, { waitUntil: "domcontentloaded" }),
    exchange,
  ]);
  assert(
    response.status() === 204,
    "Mailbox capability exchanges for the independent viewer session",
  );
  await expect(page.locator('a[href="/"]')).toBeVisible();
}

export async function settleAccessibilityOrderRoute(
  page,
  { origin, locale, publicOrderId },
) {
  const pathname = `/${locale}/orders/${publicOrderId}`;
  await page.waitForURL(
    (url) =>
      url.origin === origin && url.pathname === pathname && url.hash === "",
    { timeout: 90000, waitUntil: "domcontentloaded" },
  );
  await expect(page.locator('[data-order-payment-status="PAID"]')).toBeVisible({
    timeout: 90000,
  });
}

/** Evidence contains geometry and stable labels, never input values or private DOM. */
export function createAccessibilityBrowserTools({ report, output }) {
  async function reach(page, locator, label, maximum = 240) {
    await expect(locator).toHaveCount(1);
    await expect(locator).toBeVisible();
    let reached = false;
    for (let count = 0; count <= maximum; count++) {
      reached = await locator.evaluate(
        (element) => element === globalThis.document.activeElement,
      );
      if (reached) break;
      if (count < maximum) await page.keyboard.press("Tab");
    }
    assert(reached, "Control is reachable by sequential keyboard navigation");
    const focus = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = globalThis.getComputedStyle(element);
      const left = Math.max(0, rect.left),
        right = Math.min(globalThis.innerWidth, rect.right);
      const top = Math.max(0, rect.top),
        bottom = Math.min(globalThis.innerHeight, rect.bottom);
      const visible =
        right > left &&
        bottom > top &&
        style.visibility === "visible" &&
        Number(style.opacity) > 0;
      const above = visible
        ? globalThis.document.elementFromPoint(
            (left + right) / 2,
            (top + bottom) / 2,
          )
        : null;
      let ring = false;
      for (
        let node = element, depth = 0;
        node && depth < 3;
        node = node.parentElement, depth++
      ) {
        const computed = globalThis.getComputedStyle(node);
        ring ||=
          (computed.outlineStyle !== "none" &&
            Number.parseFloat(computed.outlineWidth) > 0) ||
          computed.boxShadow !== "none";
      }
      return {
        reached: element === globalThis.document.activeElement,
        visible,
        unobscured:
          above !== null && (above === element || element.contains(above)),
        focusVisible: element.matches(":focus-visible"),
        outline: ring,
        width: rect.width,
        height: rect.height,
      };
    });
    report.keyboard.push({ scenario: report.stage, label, ...focus });
    assertAccessibilityFocus(focus);
    return focus;
  }
  async function activate(page, locator, label, key = "Enter") {
    await reach(page, locator, label);
    await page.keyboard.press(key);
  }
  async function type(page, locator, value, label) {
    await reach(page, locator, label);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(value);
    await expect(locator).toHaveValue(value);
  }
  async function select(page, locator, value, label) {
    const options = await locator.locator("option").evaluateAll((entries) =>
      entries.map((option) => ({
        value: option.value,
        label: option.label,
        disabled: option.disabled,
      })),
    );
    const available = options.filter((option) => !option.disabled);
    const index = available.findIndex((option) => option.value === value);
    assert(index >= 0, "Requested configured option exists");
    await reach(page, locator, label);
    // Native select type-ahead also works in macOS headless Chrome, whose
    // platform popup does not process synthetic arrow-key menu navigation.
    await page.keyboard.type(available[index].label);
    await page.keyboard.press("Tab");
    await expect(locator).toHaveValue(value);
  }
  async function modal(page, trigger, label) {
    await activate(page, trigger, `${label}-open`);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const count = await dialog
      .locator(
        'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
      )
      .count();
    assert(count > 0, "Dialog contains keyboard controls");
    for (const direction of ["Tab", "Shift+Tab"]) {
      for (let step = 0; step < count + 2; step++) {
        await page.keyboard.press(direction);
        await expect
          .poll(() =>
            dialog.evaluate((element) =>
              element.contains(globalThis.document.activeElement),
            ),
          )
          .toBe(true);
      }
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() =>
        trigger.evaluate(
          (element) => element === globalThis.document.activeElement,
        ),
      )
      .toBe(true);
    report.dialogs.push({
      scenario: report.stage,
      label,
      forwardAndReverseContained: true,
      escapeRestoresTrigger: true,
    });
  }
  async function inspect(page, cell, name) {
    assert(
      (await page
        .locator("[data-private-panel], [data-private-content]")
        .count()) === 0,
      "Private operator panels are closed before any axe inspection or screenshot",
    );
    await page.evaluate(() => globalThis.document.fonts.ready);
    const images =
      name === "home"
        ? page.locator("#gifts [data-gift-link] img")
        : name === "gift"
          ? page.locator(".gift-main-image img")
          : null;
    if (images) {
      assert(
        (await images.count()) > 0,
        "Expected published image set is not empty",
      );
      const scroll = await page.evaluate(() => ({
        x: globalThis.scrollX,
        y: globalThis.scrollY,
      }));
      for (const image of await images.all()) {
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            image.evaluate(
              (element) => element.complete && element.naturalWidth > 0,
            ),
          )
          .toBe(true);
      }
      await page.evaluate(({ x, y }) => globalThis.scrollTo(x, y), scroll);
    }
    const measurement = await page.evaluate(() => ({
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
      documentWidth: globalThis.document.documentElement.scrollWidth,
      bodyWidth: globalThis.document.body.scrollWidth,
      locale: globalThis.document.documentElement.lang,
      reducedMotion: globalThis.matchMedia("(prefers-reduced-motion: reduce)")
        .matches,
      scrollBehavior: globalThis.getComputedStyle(
        globalThis.document.documentElement,
      ).scrollBehavior,
      transformAnimations: globalThis.document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect
              ?.getKeyframes()
              .some(
                (frame) =>
                  frame.transform !== undefined && frame.transform !== "none",
              ),
        ).length,
    }));
    const result = await new AxeBuilder({ page }).analyze();
    const summarize = (values) =>
      values.map(({ id, impact, nodes }) => ({
        id,
        impact,
        count: nodes.length,
        targets: nodes.map(({ target }) => target),
      }));
    const axe = {
      engineVersion: result.testEngine.version,
      violations: summarize(result.violations),
      incomplete: summarize(result.incomplete),
    };
    const record = { name, passed: false, measurement, axe };
    cell.screens.push(record);
    const file = `${cell.id}-${name}.png`;
    if (cell.mode === "native-zoom") {
      const mask = await page.addStyleTag({
        content: `${privateSelectors}{visibility:hidden!important}`,
      });
      const session = await page.context().newCDPSession(page);
      try {
        const captured = await session.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        });
        await writeFile(
          path.join(output, file),
          Buffer.from(captured.data, "base64"),
        );
      } finally {
        await mask.evaluate((element) => element.remove());
        await session.detach();
      }
    } else
      await page.screenshot({
        path: path.join(output, file),
        fullPage: true,
        mask: [page.locator(privateSelectors)],
      });
    report.screenshots.push(file);
    assertAccessibilityMeasurement(measurement, {
      ...cell,
      width: cell.mode === "native-zoom" ? null : cell.width,
    });
    assert(
      !axe.violations.some(({ impact }) =>
        ["critical", "serious"].includes(impact),
      ),
      "No critical or serious axe findings",
    );
    record.passed = true;
    return record;
  }
  return { reach, activate, type, select, modal, inspect };
}

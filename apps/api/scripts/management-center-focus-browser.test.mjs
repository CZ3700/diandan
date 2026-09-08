import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import ts from "typescript";

test("management focus transfer preserves deliberate keyboard movement", async () => {
  const root = fileURLToPath(new globalThis.URL("../../../", import.meta.url));
  const output = path.join(
    root,
    "output/checks/p3-06-management-center",
    `focus-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true });
  const source = await readFile(
    path.join(root, "apps/admin/src/management-center/focus.ts"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const css = await readFile(
    path.join(root, "apps/admin/src/management-center/management-center.css"),
    "utf8",
  );
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    scope: "REAL_CHROME_CONTROLLED_FOCUS_NO_NEXT_NO_PG",
    cases: [],
    screenshots: [],
  };
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    await page.setContent(
      `<main class="mc-shell" style="display:block;padding:24px;background:#0a0a0c;color:#f6f3ee;min-height:800px;--color-accent:#d8b26e;--focus-ring-width:3px;--focus-ring-offset:4px"><button id="open" type="button">添加艺人</button><h1 id="title" tabindex="-1">艺人资料</h1><label for="photo">选择图片</label><input id="photo" type="file"><button id="save" type="button">提交</button><p id="success" tabindex="-1">已发布</p></main>`,
    );
    await page.addStyleTag({ content: css });
    await page.addScriptTag({
      content: `(() => { const exports = {}; ${compiled}
      const queue = [];
      window.requestAnimationFrame = (callback) => { queue.push(callback); return queue.length; };
      window.flushManagementFocus = () => { for (const callback of queue.splice(0)) callback(0); };
      window.queueManagementFocus = exports.scheduleManagementFocus;
      document.querySelector('#open').onclick = () => exports.scheduleManagementFocus(() => document.querySelector('#title'));
    })();`,
    });
    await page.keyboard.press("Tab");
    await expect(page.locator("#open")).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.locator("#photo")).toBeFocused();
    await page.evaluate(() => globalThis.flushManagementFocus());
    await page.screenshot({
      path: path.join(output, "keyboard-after-delayed-focus.png"),
    });
    report.screenshots.push("keyboard-after-delayed-focus.png");
    await expect(page.locator("#photo")).toBeFocused();
    assert.equal(
      await page.locator("#photo").evaluate((node) => {
        const style = globalThis.getComputedStyle(node);
        return (
          node.matches(":focus-visible") &&
          parseFloat(style.outlineWidth) > 0 &&
          style.outlineStyle !== "none"
        );
      }),
      true,
    );
    report.cases.push("keyboard-file-focus-retained-with-visible-ring");

    await page.locator("#open").focus();
    await page.keyboard.press("Enter");
    await page.evaluate(() => globalThis.flushManagementFocus());
    await expect(page.locator("#title")).toBeFocused();
    report.cases.push("normal-entry-still-focuses-heading");

    await page.locator("#save").focus();
    await page.evaluate(() => {
      globalThis.queueManagementFocus(() =>
        globalThis.document.querySelector("#success"),
      );
      globalThis.document.querySelector("#save").remove();
      globalThis.flushManagementFocus();
    });
    await expect(page.locator("#success")).toBeFocused();
    report.cases.push("removed-trigger-still-focuses-success-notice");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.failure = "CONTROLLED_FOCUS_ASSERTION_FAILED";
    throw error;
  } finally {
    await browser.close();
    report.browserClosed = true;
    await writeFile(
      path.join(output, "results.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(`MANAGEMENT_FOCUS_EVIDENCE ${output}`);
  }
});

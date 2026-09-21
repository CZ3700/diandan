import { URL } from "node:url";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";

/** Focused reproduction: ordinary real login/list behavior without financial mutations or screenshots. */
export async function verifyFinanceAuthentication({
  adminOrigin,
  issuer,
  authenticate,
  output,
  check,
}) {
  const report = { status: "RUNNING", completed: 0, failures: [], steps: [] };
  let browser,
    step = null;
  try {
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [
        `--host-resolver-rules=MAP ${new URL(adminOrigin).hostname} 127.0.0.1,MAP ${new URL(issuer).hostname} 127.0.0.1`,
        "--no-proxy-server",
      ],
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", () =>
      report.failures.push({ step, kind: "PAGE_ERROR" }),
    );
    for (let index = 0; index < 42; index++) {
      const locale = SUPPORTED_LOCALES[index % SUPPORTED_LOCALES.length],
        role = index % 2 ? "MANAGER" : "ORDER_OPERATOR";
      step = { index, locale, role };
      console.log(`Finance authentication step ${JSON.stringify(step)}`);
      await authenticate(page, role, locale);
      await page.locator('[data-management-section="ORDERS"]').click();
      await expect(page.locator("[data-orders-workspace]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await page.locator("[data-orders-reload]").waitFor();
      const response = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/admin/orders-list",
      );
      await page.locator("[data-orders-reload]").click();
      check(
        (await response).status() === 200,
        "fresh authenticated account reads order list",
      );
      await expect(page.locator("[data-orders-workspace]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      check(
        (await page.locator(".mc-account button").count()) === 1,
        "ordinary order read retains authenticated account",
      );
      report.steps.push({ ...step, passed: true });
      report.completed++;
    }
    check(
      report.failures.length === 0,
      "authentication stress has no page error",
    );
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.failures.push({
      step,
      kind: error?.name === "TimeoutError" ? "TIMEOUT" : "ASSERTION_OR_RUNTIME",
    });
    throw error;
  } finally {
    await browser?.close();
    await writeFile(
      path.join(output, "authentication-stress.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
}

import assert from "node:assert/strict";
import { URL } from "node:url";
import { expect } from "@playwright/test";
import { adminOrdersResponseSchema } from "@fan-support/contracts";

/** Hold only this real request so both loading and completed focus are observable. */
export async function searchAccessibilityOrder({
  page,
  tools,
  publicOrderId,
  report,
  cellId,
}) {
  const workspace = page.locator("[data-orders-workspace]");
  const heading = workspace.locator("h1");
  await expect(workspace).toHaveAttribute("aria-busy", "false");
  await tools.type(
    page,
    page.locator("[data-orders-search]"),
    publicOrderId,
    "order-search",
  );
  await tools.reach(
    page,
    page.locator("[data-orders-apply]"),
    "apply-order-search",
  );
  const evidence = {
    cellId,
    beforeSubmitButtonFocus: true,
    requestMatched: false,
    pendingHeadingFocus: false,
    responseValidated: false,
    completedHeadingFocus: false,
    nextTabInsideWorkspace: false,
  };
  (report.orderSearches ??= []).push(evidence);
  const endpoint = new URL("/api/admin/orders-list", page.url()).href;
  let request, routeFinished;
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const handler = async (route) => {
    let matches = false;
    try {
      matches =
        route.request().method() === "POST" &&
        route.request().postDataJSON()?.query === publicOrderId;
    } catch {
      /* A different request is never accepted as the target query. */
    }
    if (!matches || request) return route.fallback();
    request = route.request();
    routeFinished = held
      .then(() => route.fallback())
      .then(
        () => ({ passed: true }),
        () => ({ passed: false }),
      );
    await routeFinished;
  };
  await page.route(endpoint, handler);
  try {
    await page.keyboard.press("Enter");
    await expect.poll(() => Boolean(request), { timeout: 30000 }).toBe(true);
    evidence.requestMatched = true;
    await expect(workspace).toHaveAttribute("aria-busy", "true");
    evidence.pendingHeadingFocus = await heading.evaluate(
      (element) => element === globalThis.document.activeElement,
    );
    assert(
      evidence.pendingHeadingFocus,
      "Order search loading retains the stable workspace heading",
    );
    const responsePromise = request.response();
    release();
    const response = await responsePromise;
    assert(
      response?.status() === 200,
      "The new order search responds successfully",
    );
    const parsed = adminOrdersResponseSchema.safeParse(await response.json());
    assert(
      parsed.success,
      "The new order search response satisfies its canonical schema",
    );
    const result = parsed.data;
    assert(
      result.outcome === "SUCCESS" &&
        result.kind === "LIST" &&
        result.items.length === 1 &&
        result.items[0].publicOrderId === publicOrderId,
      "The new search response contains exactly the requested order",
    );
    evidence.responseValidated = true;
    await expect(workspace).toHaveAttribute("aria-busy", "false");
    await expect(workspace.locator('[role="alert"]')).toHaveCount(0);
    await expect(page.locator("[data-orders-search]")).toHaveValue(
      publicOrderId,
    );
    const row = workspace.locator("[data-order-id]");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-order-id", result.items[0].orderId);
    await expect(row).toContainText(publicOrderId);
    evidence.completedHeadingFocus = await heading.evaluate(
      (element) => element === globalThis.document.activeElement,
    );
    assert(
      evidence.completedHeadingFocus,
      "Completed search retains the stable workspace heading",
    );
    await page.keyboard.press("Tab");
    evidence.nextTabInsideWorkspace = await workspace.evaluate((element) => {
      const focused = globalThis.document.activeElement;
      return (
        element.contains(focused) &&
        focused.matches(
          'input,button,a[href],select,textarea,[tabindex="0"]',
        ) &&
        !focused.hasAttribute("disabled")
      );
    });
    assert(
      evidence.nextTabInsideWorkspace,
      "Next Tab reaches a real control in the refreshed workspace",
    );
    return row;
  } finally {
    release();
    const [released, finished] = await Promise.allSettled([
      routeFinished,
      request?.response().then((response) => response?.finished()),
    ]);
    await page.unroute(endpoint, handler);
    assert(
      released.status === "fulfilled" &&
        (released.value === undefined || released.value.passed) &&
        finished.status === "fulfilled",
      "The held order search request was released successfully",
    );
  }
}

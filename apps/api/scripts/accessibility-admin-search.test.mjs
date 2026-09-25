import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "@playwright/test";
import { searchAccessibilityOrder } from "./accessibility-admin-search.mjs";
import { createAccessibilityBrowserTools } from "./accessibility-browser-tools.mjs";

const origin = "https://admin.example.test";
const publicOrderId = "01950000-0000-4000-8000-000000000001";
const orderId = "01950000-0000-4000-8000-000000000002";
let browser;
before(async () => {
  browser = await chromium.launch({ channel: "chrome", headless: true });
});
after(async () => browser?.close());

async function fixture({ restoreFocus = true, wrongResponse = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const report = { keyboard: [], orderSearches: [] };
  const response = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LIST",
    page: 1,
    pageSize: 12,
    totalItems: 1,
    items: [
      {
        orderId,
        publicOrderId: wrongResponse ? orderId : publicOrderId,
        version: 1,
        presentationLocale: "en",
        orderStatus: "OPEN",
        paymentStatus: "PAID",
        disputeStatus: "NONE",
        fulfillmentStatus: "DELIVERED",
        currency: "USD",
        totalAmountMinor: 2400,
        itemCount: 1,
        pendingReviewCount: 0,
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
      },
    ],
  };
  await context.route(origin + "/**", (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ json: response });
    const form =
      '<form><input data-orders-search aria-label="Search"><button data-orders-apply>Apply</button></form><button data-order-id="' +
      orderId +
      '">' +
      publicOrderId +
      "</button>";
    return route.fulfill({
      contentType: "text/html",
      body: [
        "<style>:focus-visible{outline:3px solid black;outline-offset:2px}</style>",
        '<section data-orders-workspace aria-busy="false"><h1 tabindex="-1">Orders</h1><div id="results"></div></section><script>',
        'const workspace=document.querySelector("section");const heading=document.querySelector("h1");const results=document.querySelector("#results");',
        "function render(){results.innerHTML=" +
          JSON.stringify(form) +
          ';results.querySelector("form").onsubmit=async(event)=>{',
        'event.preventDefault();const query=results.querySelector("input").value;workspace.setAttribute("aria-busy","true");results.innerHTML=\'<p role="status">Loading</p>\';',
        restoreFocus ? "heading.focus();" : "",
        'await fetch("/api/admin/orders-list",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({schemaVersion:1,page:1,pageSize:12,query,fulfillment:"ALL",moderation:"ALL"})});',
        'render();results.querySelector("input").value=query;workspace.setAttribute("aria-busy","false");}}render();</script>',
      ].join(""),
    });
  });
  await page.goto(origin);
  return {
    context,
    page,
    report,
    tools: createAccessibilityBrowserTools({ report }),
  };
}

test("order search proves its new response and stable loading focus before reaching the current row", async () => {
  const state = await fixture();
  try {
    const row = await searchAccessibilityOrder({
      ...state,
      publicOrderId,
      cellId: "en-mobile",
    });
    assert.equal(state.report.orderSearches.length, 1);
    assert.equal(state.report.orderSearches[0].pendingHeadingFocus, true);
    assert.equal(state.report.orderSearches[0].completedHeadingFocus, true);
    assert.equal(state.report.orderSearches[0].nextTabInsideWorkspace, true);
    assert.equal(state.report.orderSearches[0].responseValidated, true);
    await state.tools.activate(state.page, row, "current-result");
  } finally {
    await state.context.close();
  }
});

test("order search fails when removing the search form loses focus during the current request", async () => {
  const state = await fixture({ restoreFocus: false });
  try {
    await assert.rejects(
      () =>
        searchAccessibilityOrder({
          ...state,
          publicOrderId,
          cellId: "en-mobile",
        }),
      /loading.*heading/u,
    );
  } finally {
    await state.context.close();
  }
});

test("an old matching DOM row cannot authorize a response for a different order", async () => {
  const state = await fixture({ wrongResponse: true });
  try {
    await assert.rejects(
      () =>
        searchAccessibilityOrder({
          ...state,
          publicOrderId,
          cellId: "en-mobile",
        }),
      /requested order/u,
    );
  } finally {
    await state.context.close();
  }
});

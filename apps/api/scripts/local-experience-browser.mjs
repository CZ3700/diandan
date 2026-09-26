import assert from "node:assert/strict";
import sharp from "sharp";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, URL, URLSearchParams } from "node:url";
import { chromium, expect } from "@playwright/test";
import {
  managementCenterResponseSchema,
  checkoutPreflightResponseSchema,
  publicOrderIdSchema,
  publicOrderNoSchema,
  policyKindSchema,
  adminOrdersResponseSchema,
  marketSchema,
  currencySchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { localExperienceConfigSchema } from "./local-experience-config.mjs";
import { createManagementResponseObserver } from "./management-center-response-observer.mjs";
import {
  verifyLocalPaymentOperations,
  readLocalPaymentSnapshot,
} from "./local-experience-browser-operations.mjs";
import {
  verifyLocalCancellation,
  readLocalCanceledOrder,
  cancelLocalExistingOrder,
} from "./local-experience-browser-cancel.mjs";
import { waitForLocalGiftForm } from "./local-experience-browser-checkout.mjs";
import { readLocalRefundResult } from "./local-experience-browser-refund.mjs";
import { observeLocalBrowserPayment } from "./local-experience-browser-payment-observer.mjs";

const require = createRequire(
  new URL("../../../package.json", import.meta.url),
);
const { default: AxeBuilder } = require("@axe-core/playwright");
const field = (name) => `[data-management-field="${name}"]`;
const keys = new Set([
  "management-context",
  "management-list",
  "management-prepare-upload",
  "management-submit",
  "management-read-operation",
  "management-retry-operation",
]);

/** Operates only on a running acceptance instance. Never seeds, resets or stops it. */
export async function verifyLocalExperienceBrowser({
  workspaceRoot,
  instance,
  resumeFacts,
  contentFacts,
  deferPoster = false,
  posterOnly = false,
  operationsOnly = false,
  commerceOnly = false,
  paidOrder,
  refundOrder,
  cancelOrder,
  contextOnly = false,
}) {
  if (!/^(?:test|acceptance)-[a-z0-9-]+$/u.test(instance))
    throw new Error(
      "Browser acceptance requires a dedicated test-/acceptance- instance",
    );
  if (paidOrder !== undefined) {
    publicOrderIdSchema.parse(paidOrder);
    assert(
      contentFacts &&
        deferPoster &&
        commerceOnly &&
        !resumeFacts &&
        !operationsOnly &&
        !posterOnly,
      "Existing-order diagnostics require content facts and commerce-only/defer-poster mode",
    );
  }
  if (refundOrder !== undefined) publicOrderIdSchema.parse(refundOrder);
  if (cancelOrder !== undefined) {
    publicOrderIdSchema.parse(cancelOrder);
    assert(
      contentFacts,
      "Final operations diagnostic requires prior browser facts",
    );
  }
  if (contextOnly)
    assert(contentFacts, "Context readback requires prior browser facts");
  const stateDirectory = path.join(
    workspaceRoot,
    "node_modules/.cache/fan-support-local-experience",
    instance,
  );
  const config = localExperienceConfigSchema.parse(
    JSON.parse(
      await readFile(path.join(stateDirectory, "config.json"), "utf8"),
    ),
  );
  assert.equal(config.workspaceRoot, workspaceRoot);
  const output = path.join(
    workspaceRoot,
    "output/playwright/p5-08-local-experience",
    `${instance}-${Date.now()}`,
  );
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    mode: contextOnly
      ? "CONTEXT_READBACK"
      : cancelOrder
        ? "FINAL_OPERATIONS"
        : refundOrder
          ? "REFUND_READBACK"
          : operationsOnly
            ? "OPERATIONS"
            : paidOrder
              ? "ORDER_OPERATIONS"
              : posterOnly
                ? "POSTER"
                : commerceOnly
                  ? "COMMERCE"
                  : deferPoster
                    ? "COMMERCE_WITHOUT_POSTER"
                    : resumeFacts
                      ? "RESTART"
                      : "FULL",
    status: "RUNNING",
    contentSource: resumeFacts
      ? "PERSISTED_RESTART_FACTS"
      : contentFacts
        ? "EXISTING_ACCEPTANCE_UPLOADS"
        : "NEW_BROWSER_UPLOADS",
    instance,
    stage: "START",
    screenshots: [],
    accessibility: [],
    cases: [],
    pageErrors: [],
    observations: [],
    network: [],
    paymentCreates: [],
    paymentReads: [],
    orderQueries: [],
    consoleErrors: [],
    assertions: 0,
    facts: null,
  };
  const check = (condition, label) => {
    report.assertions += 1;
    assert(condition, label);
  };
  function requireCompleteFacts(facts) {
    check(
      facts?.schemaVersion === 1 && facts.instanceId === config.instanceId,
      "Complete facts belong to this instance",
    );
    check(
      facts.commerceContext?.schemaVersion === 1 &&
        marketSchema.safeParse(facts.commerceContext.market).success &&
        currencySchema.safeParse(facts.commerceContext.currency).success,
      "Complete facts preserve canonical market and currency independently of locale",
    );
    for (const key of [
      "artistId",
      "artistHandle",
      "giftId",
      "giftHandle",
      "posterRevisionId",
      "publicOrderId",
      "orderId",
    ])
      check(
        typeof facts[key] === "string" && facts[key].length > 0,
        `Complete facts include ${key}`,
      );
    check(
      facts.canceledOrder?.orderStatus === "CANCELED" &&
        typeof facts.canceledOrder?.orderId === "string" &&
        typeof facts.canceledOrder?.publicOrderId === "string",
      "Complete facts include the actual canceled order",
    );
    check(
      facts.paymentConfiguration?.schemaVersion === 1 &&
        typeof facts.paymentConfiguration.currentRevisionId === "string" &&
        typeof facts.paymentConfiguration.currentPublicationId === "string" &&
        Number.isSafeInteger(facts.paymentConfiguration.generation) &&
        typeof facts.paymentConfiguration.configurationHash === "string",
      "Complete facts include the final payment configuration head",
    );
    for (const section of ["ARTISTS", "GIFTS", "POSTERS"])
      check(
        /^[a-f0-9]{64}$/u.test(facts.contentSnapshot?.[section] ?? ""),
        `Complete facts include the exact ${section} publication and media snapshot`,
      );
    check(
      facts.refundSnapshot?.status === "SUCCEEDED" &&
        facts.refundSnapshot.orderId === facts.orderId &&
        facts.refundSnapshot.publicOrderId === facts.publicOrderId &&
        facts.refundSnapshot.capturedAmountMinor ===
          facts.refundSnapshot.refundedAmountMinor,
      "Complete facts include the exact successful full refund",
    );
    check(
      facts.paymentReadEvidence?.creates === 1 &&
        typeof facts.paymentReadEvidence.attemptId === "string" &&
        facts.paymentReadEvidence.returnReadStatuses?.length > 0,
      "Complete facts include automatic return reads and one original payment-create POST",
    );
  }
  const stage = (value) => {
    report.stage = value;
    console.log(JSON.stringify({ instance, stage: value }));
  };
  const certificate = new X509Certificate(
    await readFile(config.tls.certificatePath),
  );
  const pin = createHash("sha256")
    .update(certificate.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      `--ignore-certificate-errors-spki-list=${pin}`,
      `--host-resolver-rules=${Object.values(config.origins)
        .map((origin) => `MAP ${new URL(origin).hostname} 127.0.0.1`)
        .join(",")}`,
      "--no-proxy-server",
    ],
  });
  function observeContext(context, surface) {
    context.setDefaultTimeout(30000);
    context.on("page", (page) => {
      page.on("pageerror", () =>
        report.pageErrors.push({
          surface,
          stage: report.stage,
          code: "PAGE_ERROR",
        }),
      );
    });
  }
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const customerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  adminContext.setDefaultTimeout(30000);
  customerContext.setDefaultTimeout(30000);
  observeContext(adminContext, "admin");
  observeContext(customerContext, "storefront");
  const admin = await adminContext.newPage(),
    customer = await customerContext.newPage();
  const paymentObserver = observeLocalBrowserPayment({
    page: customer,
    config,
    report,
  });
  for (const [surface, page] of [
    ["admin", admin],
    ["storefront", customer],
  ]) {
    const requests = new Map();
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.resourceType() !== "script" && !pathname.startsWith("/api/"))
        return;
      const entry = {
        surface,
        stage: report.stage,
        path: pathname,
        state: "pending",
      };
      requests.set(request, entry);
      report.network.push(entry);
    });
    page.on("response", (response) => {
      const entry = requests.get(response.request());
      if (entry)
        Object.assign(entry, { state: "response", status: response.status() });
    });
    page.on("requestfailed", (request) => {
      const entry = requests.get(request);
      if (entry)
        Object.assign(entry, {
          state: "failed",
          error: request.failure()?.errorText,
        });
    });
    page.on("console", (message) => {
      if (report.stage !== "LOGIN" || message.type() !== "error") return;
      report.consoleErrors.push({
        surface,
        type: message.type(),
        text: message
          .text()
          .replace(/(?:https?|wss?):\/\/[^\s"']+/gu, (value) => {
            try {
              return new URL(value).pathname;
            } catch {
              return "[URL]";
            }
          })
          .replace(/[A-Za-z0-9_-]{40,}/gu, "[REDACTED]")
          .slice(0, 120),
      });
    });
  }
  const observed = { operations: new Map(), lists: new Map() };
  const observer = createManagementResponseObserver({
    page: admin,
    origin: config.origins.admin,
    keys,
    schema: managementCenterResponseSchema,
    check,
    onFailure: (failure) => report.observations.push(failure),
    accept: (value) => {
      if (value.kind === "OPERATION")
        observed.operations.set(value.operation.operationId, value.operation);
      if (value.kind === "LIST") observed.lists.set(value.section, value);
    },
  });
  const navigate = async (page, url) => {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    check(response?.status() === 200, "Actual browser document responds 200");
  };
  async function login(locale = "en", role = "manager", page = admin) {
    await navigate(page, `${config.origins.admin}/${locale}`);
    const loginForm = page.locator('form[action="/api/admin/auth/begin"]');
    await expect(
      page
        .locator(
          '[data-management-section]:enabled, form[action="/api/admin/auth/begin"]',
        )
        .first(),
    ).toBeVisible({ timeout: 30000 });
    if (await loginForm.count()) {
      await loginForm.locator("button[type=submit]").click();
      await page.locator("select[name=actor]").waitFor({ timeout: 30000 });
      await page.locator("select[name=actor]").selectOption(role);
      await page.locator("button[type=submit]").click();
    }
    await page
      .locator("[data-management-section]:enabled")
      .first()
      .waitFor({ timeout: 60000 });
  }
  async function capture(page, name) {
    check(
      (await page
        .locator("[data-private-panel], [data-private-content]")
        .count()) === 0,
      "Screenshot excludes private operator panels",
    );
    check(
      (
        await page
          .locator(
            "[data-cart-name], [data-cart-message], [data-checkout-email]",
          )
          .evaluateAll((elements) => elements.some((element) => element.value))
      ).valueOf() === false,
      "Screenshot excludes populated private fields",
    );
    const location = new URL(page.url());
    const route = location.pathname.split("/").filter(Boolean);
    const requiredImages = [];
    if (location.origin === config.origins.storefront && route.length === 1) {
      const artistId = report.facts?.artistId;
      const artistHandle = report.facts?.artistHandle;
      check(
        Boolean(artistId && artistHandle),
        "Homepage capture has an expected published artist",
      );
      await expect(page.locator(".storefront-hero #hero-title")).toBeVisible({
        timeout: 60000,
      });
      await expect(page.locator(".storefront-hero #hero-title")).toHaveText(
        /\S/u,
      );
      await expect(page.locator(".storefront-hero-image img")).toBeVisible();
      const heroLink = page.locator(".storefront-hero-caption a");
      await expect(heroLink).toBeVisible();
      check(
        new URL(await heroLink.getAttribute("href"), location.origin)
          .pathname === `/${route[0]}/idols/${artistHandle}`,
        "Homepage hero links to the published artist identity",
      );
      await expect(
        page.locator(`[data-artist-card="${artistId}"] img`),
      ).toBeVisible();
      await expect(
        page.locator("[data-artist-directory-status]"),
      ).toHaveAttribute("data-loading", "false");
      await expect(
        page.locator("[data-artist-directory-status][data-error]"),
      ).toHaveCount(0);
      await expect(
        page.locator(
          ".storefront-state, .storefront-image-fallback, main [aria-busy=true]",
        ),
      ).toHaveCount(0);
      requiredImages.push(
        ".storefront-hero-image img",
        `[data-artist-card="${artistId}"] img`,
      );
    } else if (
      location.origin === config.origins.storefront &&
      route.length === 3 &&
      route[1] === "gifts"
    ) {
      check(
        Boolean(report.facts?.giftId && report.facts?.artistId),
        "Gift capture has expected published identities",
      );
      await expect(
        page.locator(`[data-gift-detail="${report.facts.giftId}"] h1`),
      ).toBeVisible({ timeout: 60000 });
      await expect(
        page.locator(`[data-selected-recipient="${report.facts.artistId}"]`),
      ).toBeVisible();
      await expect(
        page.locator("[data-gift-purchase] button[data-cart-add-state]"),
      ).toBeVisible();
      await expect(
        page
          .locator("[data-market-choices] [data-market][data-currency]")
          .first(),
      ).toBeVisible();
      let detailPolicyPaths;
      for (const scope of ["[data-gift-detail]", "footer"]) {
        const group = page.locator(
          `${scope} .gift-deferred-policies .gift-policy-links`,
        );
        await expect(group).toHaveCount(1);
        await expect(group.locator("a")).toHaveCount(
          policyKindSchema.options.length,
        );
        const paths = (
          await group
            .locator("a")
            .evaluateAll((links) =>
              links.map((link) => new URL(link.href).pathname),
            )
        ).sort();
        check(
          new Set(paths).size === policyKindSchema.options.length &&
            paths.every((pathname) =>
              pathname.startsWith(`/${route[0]}/policies/`),
            ),
          "Each actual policy group has complete distinct localized policy identities",
        );
        if (detailPolicyPaths)
          check(
            JSON.stringify(paths) === JSON.stringify(detailPolicyPaths),
            "Gift detail and footer expose the same complete policy set",
          );
        else detailPolicyPaths = paths;
      }
      await expect(
        page.locator(
          ".storefront-state, [data-gift-context-pending], [data-gift-recipient-pending], main [aria-busy=true]",
        ),
      ).toHaveCount(0);
      requiredImages.push(
        ".gift-main-image img",
        `[data-selected-recipient="${report.facts.artistId}"] img`,
      );
    }
    const scroll = await page.evaluate(() => ({
      x: globalThis.scrollX,
      y: globalThis.scrollY,
    }));
    for (const picture of await page.locator("img").all()) {
      if (!(await picture.isVisible())) continue;
      await picture.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          picture.evaluate((element) =>
            Boolean(element.complete && element.naturalWidth > 0),
          ),
        )
        .toBe(true);
      check(true, "Rendered screenshot image loaded successfully");
    }
    for (const selector of requiredImages)
      check(
        await page
          .locator(selector)
          .evaluateAll(
            (elements) =>
              elements.length > 0 &&
              elements.every(
                (element) => element.complete && element.naturalWidth > 0,
              ),
          ),
        "Required published image remains loaded; empty/fallback image sets cannot pass",
      );
    await page.evaluate(({ x, y }) => globalThis.scrollTo(x, y), scroll);
    const filename = `${name}.png`;
    await page.screenshot({
      path: path.join(output, filename),
      fullPage: true,
      animations: "disabled",
    });
    const axe = await new AxeBuilder({ page }).analyze();
    const serious = axe.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact),
    );
    report.screenshots.push(filename);
    report.accessibility.push({
      name,
      violations: axe.violations.map(({ id, impact }) => ({ id, impact })),
      incomplete: axe.incomplete.map(({ id }) => id),
    });
    check(
      serious.length === 0,
      "No serious or critical automated accessibility violations",
    );
    check(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth + 1,
      ),
      "Page fits its viewport",
    );
  }
  async function begin(section) {
    await admin.locator(`[data-management-section="${section}"]`).click();
    await admin.locator(`[data-management-list="${section}"]`).waitFor();
    await admin.locator("[data-management-new]").click();
    await admin.locator("[data-management-form]").waitFor();
  }
  async function publish(kind) {
    await observer.settled();
    const before = new Set(observed.operations.keys());
    await admin.locator("[data-management-submit]").click();
    await expect
      .poll(
        () =>
          [...observed.operations.values()].find(
            (operation) =>
              !before.has(operation.operationId) &&
              operation.kind === kind &&
              operation.status !== "PROCESSING",
          )?.status,
        { timeout: 180000, intervals: [250, 500] },
      )
      .toBe("PUBLISHED");
    await admin.locator("[data-management-list]").waitFor({ timeout: 30000 });
    await observer.settled();
    return [...observed.operations.values()].find(
      (operation) =>
        !before.has(operation.operationId) && operation.kind === kind,
    ).result;
  }
  async function selectOrder(publicId) {
    async function listAfter(action, expectedQuery) {
      const [response] = await Promise.all([
        admin.waitForResponse(
          (value) =>
            new URL(value.url()).pathname === "/api/admin/orders-list" &&
            value.request().method() === "POST",
        ),
        action(),
      ]);
      const command = response.request().postDataJSON();
      const result = adminOrdersResponseSchema.parse(await response.json());
      report.orderQueries.push({
        stage: report.stage,
        query:
          command.query === "" ||
          publicOrderIdSchema.safeParse(command.query).success
            ? command.query
            : "[NON_ID_QUERY]",
        outcome: result.outcome,
        ...(result.outcome === "FAILURE" ? { code: result.code } : {}),
        ...(result.outcome === "SUCCESS" && result.kind === "LIST"
          ? {
              items: result.items.map(({ orderId, publicOrderId }) => ({
                orderId,
                publicOrderId,
              })),
            }
          : {}),
      });
      check(
        response.status() === 200 &&
          result.outcome === "SUCCESS" &&
          result.kind === "LIST",
        "Order search uses a successful canonical list response",
      );
      if (expectedQuery !== undefined)
        check(
          command.query === expectedQuery,
          "Actual order search submits the requested public order identity",
        );
      await expect(admin.locator("[data-orders-workspace]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      return result;
    }
    const section = admin.locator('[data-management-section="ORDERS"]');
    if ((await section.getAttribute("aria-current")) !== "page")
      await listAfter(() => section.click());
    await admin.locator("[data-orders-workspace]").waitFor({ timeout: 30000 });
    const back = admin.locator("[data-orders-back]");
    if (await back.count()) await listAfter(() => back.click());
    await admin.locator("[data-orders-search]").waitFor({ timeout: 30000 });
    await expect(admin.locator("[data-orders-workspace]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await admin.locator("[data-orders-search]").fill(publicId);
    await expect(admin.locator("[data-orders-search]")).toHaveValue(publicId);
    const result = await listAfter(
      () => admin.locator("[data-orders-apply]").click(),
      publicId,
    );
    const match = result.items.find((item) => item.publicOrderId === publicId);
    check(
      match !== undefined,
      "Canonical order list contains the requested order",
    );
    // Rows show the public number support reads out; the UUID stays internal.
    const row = admin.locator(`[data-order-id="${match.orderId}"]`);
    await expect(row).toHaveCount(1, { timeout: 30000 });
    await expect(row).toContainText(match.publicOrderNo);
    const orderId = match.orderId;
    await row.click();
    await admin.locator(`[data-orders-detail="${orderId}"]`).waitFor();
    await expect(admin.locator("[data-finance-panel]")).toHaveAttribute(
      "aria-busy",
      "false",
      { timeout: 30000 },
    );
    return orderId;
  }
  async function managementItem(section, id) {
    await observer.settled();
    observed.lists.delete(section);
    await admin.locator(`[data-management-section="${section}"]`).click();
    await expect.poll(() => observed.lists.has(section)).toBe(true);
    let list = observed.lists.get(section);
    let item = list.items.find((entry) => entry.id === id);
    while (!item && list.page * list.pageSize < list.totalItems) {
      const previousPage = list.page;
      await admin.locator("[data-management-next]").click();
      await expect
        .poll(() => observed.lists.get(section)?.page)
        .toBe(previousPage + 1);
      list = observed.lists.get(section);
      item = list.items.find((entry) => entry.id === id);
    }
    check(
      Boolean(item?.image),
      `${section} retains the published media reference`,
    );
    check(
      section !== "POSTERS" || item.current === true,
      "The exact uploaded poster revision remains the current head",
    );
    return item;
  }
  function commerceContext(price) {
    check(
      Boolean(price),
      "The exact published gift has a canonical price context",
    );
    return {
      schemaVersion: 1,
      market: marketSchema.parse(price.market),
      currency: currencySchema.parse(price.currency),
    };
  }
  async function contentSnapshot(facts) {
    const snapshot = {};
    for (const [section, id] of Object.entries({
      ARTISTS: facts.artistId,
      GIFTS: facts.giftId,
      POSTERS: facts.posterRevisionId,
    })) {
      const item = await managementItem(section, id);
      snapshot[section] = createHash("sha256")
        .update(JSON.stringify(item))
        .digest("hex");
    }
    return snapshot;
  }
  async function paymentOperations() {
    stage("PAYMENT_CONFIGURATION");
    const reviewerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    observeContext(reviewerContext, "reviewer");
    try {
      const reviewer = await reviewerContext.newPage();
      await login("en", "reviewer", reviewer);
      return await verifyLocalPaymentOperations({
        manager: admin,
        reviewer,
        config,
        check,
        capture,
        report,
      });
    } finally {
      await reviewerContext.close();
    }
  }
  try {
    stage("LOGIN");
    await login();
    if (contextOnly) {
      const previous = JSON.parse(await readFile(contentFacts, "utf8"));
      report.facts = previous.facts ?? previous;
      check(
        report.facts.instanceId === config.instanceId,
        "Context readback belongs to the same instance",
      );
      stage("CANONICAL_CONTEXT_READBACK");
      const item = await managementItem("GIFTS", report.facts.giftId);
      report.facts.commerceContext = commerceContext(item.price);
      requireCompleteFacts(report.facts);
      report.cases.push("canonical-price-context-read-from-management-ui");
    } else if (cancelOrder) {
      const previous = JSON.parse(await readFile(contentFacts, "utf8"));
      report.facts = previous.facts ?? previous;
      check(
        report.facts.instanceId === config.instanceId,
        "Final operations belong to the same persistent instance",
      );
      stage("CANCEL_EXISTING_ORDER");
      // Reproduce the actual transition from the previously processed detail.
      await selectOrder(report.facts.publicOrderId);
      report.facts.canceledOrder = await cancelLocalExistingOrder({
        admin,
        config,
        publicOrderId: cancelOrder,
        selectOrder,
        capture,
        check,
      });
      report.facts.paymentConfiguration = await paymentOperations();
      report.facts.contentSnapshot = await contentSnapshot(report.facts);
      requireCompleteFacts(report.facts);
      report.cases.push(
        "existing-unpaid-order-cancel-and-payment-configuration-content-snapshot",
      );
    } else if (refundOrder) {
      stage("REFUND_READBACK");
      await selectOrder(refundOrder);
      report.facts = {
        schemaVersion: 1,
        instanceId: config.instanceId,
        refundSnapshot: await readLocalRefundResult({ admin, config, check }),
      };
      await capture(admin, "existing-order-refund-readback");
      report.cases.push("existing-refund-readback-without-new-refund-command");
    } else if (operationsOnly) {
      const prior = contentFacts
        ? JSON.parse(await readFile(contentFacts, "utf8"))
        : {};
      report.facts = {
        ...(prior.facts ?? prior),
        schemaVersion: 1,
        instanceId: config.instanceId,
        paymentConfiguration: await paymentOperations(),
      };
    } else if (resumeFacts) {
      const facts = JSON.parse(await readFile(resumeFacts, "utf8"));
      requireCompleteFacts(facts);
      report.facts = facts;
      check(
        facts.instanceId === config.instanceId,
        "Restart evidence refers to this same persistent instance",
      );
      stage("RESTART_READBACK");
      await selectOrder(facts.publicOrderId);
      await expect(
        admin.locator('[data-finance-refund-status="SUCCEEDED"]'),
      ).toHaveCount(1);
      const persistedRefund = await readLocalRefundResult({
        admin,
        config,
        check,
      });
      check(
        JSON.stringify(persistedRefund) ===
          JSON.stringify(facts.refundSnapshot),
        "Restart preserves the exact refund identity, currency and amount",
      );
      await navigate(
        customer,
        `${config.origins.storefront}/en/gifts/${facts.giftHandle}?${new URLSearchParams({ idol: facts.artistId, market: facts.commerceContext.market, currency: facts.commerceContext.currency })}`,
      );
      await customer.locator("button[data-cart-add-state]").waitFor();
      await capture(customer, "restart-storefront-gift");
      await capture(admin, "restart-admin-refund");
      const persistedContent = await contentSnapshot(facts);
      check(
        JSON.stringify(persistedContent) ===
          JSON.stringify(facts.contentSnapshot),
        "Restart preserves exact artist, gift, current poster and their media references",
      );
      await navigate(customer, `${config.origins.storefront}/en`);
      await capture(customer, "restart-storefront-homepage");
      if (facts.canceledOrder) {
        const canceled = await readLocalCanceledOrder({
          admin,
          config,
          publicOrderId: facts.canceledOrder.publicOrderId,
          selectOrder,
          check,
        });
        check(
          JSON.stringify(canceled) === JSON.stringify(facts.canceledOrder),
          "Restart preserves the canceled order",
        );
      }
      if (facts.paymentConfiguration) {
        const current = await readLocalPaymentSnapshot({
          page: admin,
          config,
          check,
        });
        check(
          JSON.stringify(current) ===
            JSON.stringify(facts.paymentConfiguration),
          "Restart preserves the exact published payment configuration head",
        );
      }
      report.facts = facts;
      report.cases.push("restart-order-refund-gift-kept");
    } else {
      const suffix = randomUUID().slice(0, 8),
        images = path.join(workspaceRoot, "apps/storefront/public/ui-brand");
      let artist, gift;
      if (contentFacts) {
        const previous = JSON.parse(await readFile(contentFacts, "utf8"));
        const facts = previous.facts ?? previous;
        check(
          facts.instanceId === config.instanceId,
          "Content belongs to this persistent instance",
        );
        check(
          facts.artistId && facts.giftId,
          "Resume requires published artist and gift facts",
        );
        artist = { targetId: facts.artistId, handle: facts.artistHandle };
        gift = { targetId: facts.giftId, handle: facts.giftHandle };
        report.facts = { ...facts };
        await admin.locator('[data-management-section="GIFTS"]').click();
        await admin.locator('[data-management-list="GIFTS"]').waitFor();
        await observer.settled();
      } else {
        stage("UPLOAD_ARTIST");
        await begin("ARTISTS");
        await admin
          .locator(field("image"))
          .setInputFiles(path.join(images, "performer-daylight-mobile.webp"));
        await admin.locator(field("name")).fill(`Local artist ${suffix}`);
        await admin
          .locator(field("description"))
          .fill("Synthetic artist for the local TEST experience.");
        artist = await publish("SAVE_ARTIST");
        report.facts = {
          schemaVersion: 1,
          instanceId: config.instanceId,
          artistId: artist.targetId,
          artistHandle: artist.handle,
        };
        console.log(
          JSON.stringify({
            stage: "ARTIST_PUBLISHED",
            artistId: artist.targetId,
          }),
        );
        stage("UPLOAD_GIFT");
        await begin("GIFTS");
        await admin
          .locator(field("image"))
          .setInputFiles(path.join(images, "gift-ruby-bouquet.webp"));
        await admin.locator(field("name")).fill(`Local gift ${suffix}`);
        await admin
          .locator(field("description"))
          .fill("A synthetic gift prepared by the local TEST studio.");
        await admin.locator(field("giftKind")).selectOption("PHYSICAL");
        await admin.locator(field("price")).fill("24");
        gift = await publish("SAVE_GIFT");
        Object.assign(report.facts, {
          giftId: gift.targetId,
          giftHandle: gift.handle,
        });
      }
      const price = observed.lists
        .get("GIFTS")
        .items.find((item) => item.id === gift.targetId).price;
      report.facts.commerceContext = commerceContext(price);
      let poster = { revisionId: report.facts.posterRevisionId ?? null };
      if (!deferPoster) {
        stage("WAIT_INITIAL_HOMEPAGE");
        await expect
          .poll(
            async () => {
              await login();
              await admin
                .locator('[data-management-section="POSTERS"]')
                .click();
              await admin.locator('[data-management-list="POSTERS"]').waitFor();
              return admin.locator("[data-management-new]").isEnabled();
            },
            { timeout: 180000, intervals: [1000, 5000] },
          )
          .toBe(true);
        stage("UPLOAD_POSTER");
        await begin("POSTERS");
        await admin
          .locator(field("image"))
          .setInputFiles(path.join(images, "performer-daylight-desktop.webp"));
        poster = await publish("REPLACE_POSTER");
        report.facts.posterRevisionId = poster.revisionId;
      }
      const query = new URLSearchParams({
        idol: artist.targetId,
        market: price.market,
        currency: price.currency,
      });
      stage("SEVEN_LOCALE_MATRIX");
      if (!commerceOnly) {
        for (const locale of SUPPORTED_LOCALES)
          for (const width of [390, 1440]) {
            await customer.setViewportSize({
              width,
              height: width === 390 ? 844 : 900,
            });
            await navigate(
              customer,
              `${config.origins.storefront}/${locale}/gifts/${gift.handle}?${query}`,
            );
            await customer
              .locator("button[data-cart-add-state]")
              .waitFor({ timeout: 30000 });
            await expect(customer.locator("html")).toHaveAttribute(
              "lang",
              locale,
            );
            await capture(customer, `${locale}-${width}-published-gift`);
            if (!deferPoster) {
              await navigate(
                customer,
                `${config.origins.storefront}/${locale}`,
              );
              await capture(customer, `${locale}-${width}-published-homepage`);
            }
            await admin.setViewportSize({
              width,
              height: width === 390 ? 844 : 900,
            });
            await login(locale);
            await capture(admin, `${locale}-${width}-management`);
            report.cases.push(`${locale}-${width}-published-content`);
          }
      }
      if (!posterOnly) {
        let publicOrderId = paidOrder;
        if (!publicOrderId) {
          stage("GUEST_CHECKOUT");
          await customer.setViewportSize({ width: 390, height: 844 });
          await navigate(
            customer,
            `${config.origins.storefront}/en/gifts/${gift.handle}?${query}`,
          );
          await waitForLocalGiftForm(customer);
          await customer
            .locator("[data-cart-message]")
            .fill("SYNTHETIC_PRIVATE_MESSAGE_FOR_LOCAL_ACCEPTANCE");
          await customer
            .locator("[data-cart-message-locale]")
            .selectOption("en");
          await customer.locator("button[data-cart-add-state]").click();
          await customer
            .locator('[data-cart-add-state="confirmed"]')
            .waitFor({ timeout: 30000 });
          await navigate(customer, `${config.origins.storefront}/en/cart`);
          await customer.locator("[data-cart-checkout]").click();
          await customer.locator("[data-checkout-email]").waitFor();
          await customer.locator("[data-checkout-email]").focus();
          await customer.keyboard.press("Tab");
          check(
            await customer.evaluate(
              () =>
                globalThis.document.activeElement !== globalThis.document.body,
            ),
            "Checkout keyboard advances to an actual control",
          );
          await capture(customer, "en-390-checkout-empty");
          stage("CREATE_CHECKOUT");
          await customer
            .locator("[data-checkout-email]")
            .fill(`local-${suffix}@example.test`);
          for (const policy of await customer
            .locator("[data-checkout-policy]")
            .all())
            await policy.check();
          const createdCheckout = customer.waitForResponse((response) => {
            const url = new URL(response.url());
            return (
              url.origin === config.origins.storefront &&
              url.pathname === "/api/storefront/checkout/sessions" &&
              response.request().method() === "POST"
            );
          });
          await customer.locator("[data-checkout-confirm]").click();
          const createdResponse = await createdCheckout;
          check(
            createdResponse.status() === 200,
            "Actual guest checkout succeeds",
          );
          const checkout = checkoutPreflightResponseSchema.parse(
            await createdResponse.json(),
          );
          check(
            checkout.outcome === "SUCCESS" && "checkout" in checkout,
            "Checkout satisfies the canonical contract",
          );
          report.facts.publicOrderId = checkout.checkout.publicOrderId;
          report.facts.checkoutSessionId = checkout.checkout.id;
          stage("TEST_PAYMENT");
          await customer
            .locator("[data-payment-country]")
            .waitFor({ timeout: 30000 });
          await customer.locator("[data-payment-country]").selectOption("US");
          await customer.locator("[data-payment-create]").click();
          await customer
            .locator("[data-payment-continue]")
            .waitFor({ timeout: 30000 });
          await capture(customer, "en-390-test-payment-ready");
          await customer.locator("[data-payment-continue]").click();
          await customer
            .locator("[data-test-psp-capture]")
            .waitFor({ timeout: 30000 });
          await customer.locator("[data-test-psp-capture]").click();
          stage("PAYMENT_RETURN");
          await customer
            .locator("[data-order-number]")
            .waitFor({ timeout: 90000 });
          report.cases.push(
            "payment-return-automatically-reads-trusted-server-state",
          );
          publicOrderId = await customer
            .locator("[data-order-root]")
            .getAttribute("data-order-id");
          check(
            publicOrderIdSchema.safeParse(publicOrderId).success &&
              publicOrderNoSchema.safeParse(
                (
                  await customer.locator("[data-order-number]").innerText()
                ).trim(),
              ).success,
            "Paid order shows its public number while the UUID stays internal",
          );
          report.facts.publicOrderId = publicOrderId;
          await expect(
            customer.locator('[data-order-payment-status="PAID"]'),
          ).toBeVisible();
          await paymentObserver.settled();
          const returnReads = report.paymentReads.filter(
            (entry) => entry.stage === "PAYMENT_RETURN",
          );
          check(
            returnReads.length > 0 &&
              returnReads.every(
                (entry) =>
                  entry.attemptId === returnReads[0].attemptId &&
                  entry.checkoutSessionId === report.facts.checkoutSessionId,
              ),
            "Automatic return polling reads only the original checkout and attempt",
          );
          check(
            report.paymentCreates.length === 1 &&
              report.paymentCreates[0].checkoutSessionId ===
                report.facts.checkoutSessionId,
            "The entire payment journey sends exactly one payment-create POST",
          );
          report.facts.paymentReadEvidence = {
            creates: report.paymentCreates.length,
            attemptId: returnReads[0].attemptId,
            returnFirstStatus: returnReads[0].status,
            returnReadStatuses: returnReads.map(({ status, recovery }) => ({
              status,
              recovery,
            })),
          };
          await capture(customer, "en-390-paid-order");
        }
        report.facts.publicOrderId = publicOrderId;
        stage("MAIL_ORDER_ACCESS");
        const mailbox = await customerContext.newPage();
        const mailboxSession = mailbox.waitForResponse(
          (response) =>
            response.url() === `${config.origins.mail}/session` &&
            response.request().method() === "POST",
          { timeout: 30000 },
        );
        await navigate(
          mailbox,
          `${config.origins.mail}/#token=${config.services.mail.viewerToken}`,
        );
        check(
          (await mailboxSession).status() === 204,
          "Mailbox exchanges the fragment for an HTTP-only cookie",
        );
        await mailbox.locator('a[href="/"]').waitFor({ timeout: 30000 });
        // Mail shows the public number; the order UUID is only inside the link fragment.
        const orderMail = mailbox.locator(
          `article a[href*="/order-access#"][href*="order=${publicOrderId}"]`,
        );
        await expect
          .poll(
            async () => {
              await mailbox.reload({ waitUntil: "domcontentloaded" });
              return orderMail.count();
            },
            { timeout: 60000, intervals: [500, 1000] },
          )
          .toBeGreaterThan(0);
        await orderMail.first().click();
        await mailbox
          .locator("[data-order-number]")
          .waitFor({ timeout: 30000 });
        check(
          new URL(mailbox.url()).hash === "",
          "Mail order token is cleared from browser address",
        );
        check(
          (await mailbox
            .locator("[data-order-root]")
            .getAttribute("data-order-id")) === publicOrderId,
          "Mail link opens the same paid order",
        );
        await mailbox.close();
        stage("REVIEW_PREPARE_DELIVER");
        await login("en");
        const orderId = await selectOrder(publicOrderId);
        report.facts.orderId = orderId;
        await admin.locator("[data-message-open]").first().click();
        await admin.locator("[data-private-content]").waitFor();
        await admin.locator("[data-message-confirm]").check();
        await admin.locator("[data-message-approve]").click();
        await admin.locator("[data-order-prepare]").first().waitFor();
        await admin.locator("[data-order-prepare]").first().click();
        await admin.locator("[data-order-deliver]").first().waitFor();
        await admin.locator("[data-order-deliver]").first().click();
        await admin.locator('[data-proof-panel="DELIVER"]').waitFor();
        // V2 §4-6: one private studio photo uploads, attaches, then the line is delivered.
        await admin.locator("[data-proof-files]").setInputFiles({
          name: "delivery.jpg",
          mimeType: "image/jpeg",
          buffer: await sharp({
            create: {
              width: 1200,
              height: 900,
              channels: 3,
              background: { r: 120, g: 96, b: 150 },
            },
          })
            .jpeg()
            .toBuffer(),
        });
        await admin.locator("[data-proof-privacy-confirm]").check();
        await admin.locator('[data-proof-submit="DELIVER"]').click();
        await expect(admin.locator("[data-proof-panel]")).toHaveCount(0, {
          timeout: 60000,
        });
        await expect(admin.locator("[data-order-deliver]")).toHaveCount(0);
        await expect(admin.locator("[data-order-proofs]")).toContainText("1/3");
        await capture(admin, "en-1440-delivered-order");
        stage("FAN_DELIVERY_PHOTO");
        const photoPage = await customerContext.newPage();
        await navigate(
          photoPage,
          `${config.origins.storefront}/en/orders/${publicOrderId}`,
        );
        const thumbnail = photoPage.locator("[data-order-proofs] img").first();
        await thumbnail.waitFor({ timeout: 30000 });
        await expect
          .poll(() =>
            thumbnail.evaluate(
              (image) => image.complete && image.naturalWidth > 0,
            ),
          )
          .toBe(true);
        check(
          new URL(
            await thumbnail.getAttribute("src"),
            config.origins.storefront,
          ).origin === config.origins.storefront,
          "Delivery photos load only from the same-origin order session proxy",
        );
        await photoPage.locator("[data-order-proofs] button").first().click();
        const fullPhoto = photoPage.getByRole("dialog").locator("img");
        await expect
          .poll(() =>
            fullPhoto.evaluate(
              (image) => image.complete && image.naturalWidth > 0,
            ),
          )
          .toBe(true);
        await capture(photoPage, "en-390-delivery-photo");
        await photoPage.keyboard.press("Escape");
        await expect(photoPage.getByRole("dialog")).toHaveCount(0);
        await photoPage.close();
        stage("REFUND");
        await admin.locator("[data-finance-refund]").click();
        await admin.locator("[data-finance-mode]").selectOption("FULL");
        await admin.locator("[data-finance-confirm]").check();
        await admin.locator("[data-finance-submit]").click();
        report.facts.refundSnapshot = await readLocalRefundResult({
          admin,
          config,
          check,
        });
        await capture(admin, "en-1440-refunded-order");
        if (paidOrder) {
          report.cases.push("existing-paid-order-mail-review-deliver-refund");
        } else {
          stage("CANCEL_UNPAID_ORDER");
          const canceledOrder = await verifyLocalCancellation({
            browser,
            config,
            giftUrl: `${config.origins.storefront}/en/gifts/${gift.handle}?${query}`,
            admin,
            selectOrder,
            navigate,
            capture,
            check,
            observeContext,
          });
          report.cases.push("same-instance-unpaid-order-canceled");
          const paymentConfiguration = await paymentOperations();
          report.facts = {
            ...report.facts,
            schemaVersion: 1,
            instanceId: config.instanceId,
            artistId: artist.targetId,
            artistHandle: artist.handle,
            giftId: gift.targetId,
            giftHandle: gift.handle,
            posterRevisionId: poster.revisionId,
            publicOrderId,
            orderId,
            canceledOrder,
            paymentConfiguration,
          };
          if (!deferPoster)
            report.facts.contentSnapshot = await contentSnapshot(report.facts);
          await writeFile(
            path.join(output, "facts.json"),
            JSON.stringify(report.facts, null, 2) + "\n",
          );
          report.cases.push("same-instance-payment-mail-review-deliver-refund");
        }
      }
    }
    await observer.settled();
    await paymentObserver.settled();
    check(report.pageErrors.length === 0, "No browser application errors");
    check(
      report.observations.length === 0,
      "Management response observations completed",
    );
    const complete = ["FULL", "RESTART"].includes(report.mode);
    if (complete) requireCompleteFacts(report.facts);
    report.status = complete ? "PASS" : "PARTIAL_PASS";
    stage("COMPLETE");
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      name: error.name,
      timeout: /Timeout|timed out/iu.test(error.message),
      assertion: error.name === "AssertionError",
      sourceLine:
        error.stack?.match(/local-experience-browser\.mjs:(\d+):\d+/u)?.[1] ??
        null,
      adminPath: new URL(admin.url()).pathname,
      storefrontPath: new URL(customer.url()).pathname,
      controls: await admin
        .locator(
          "[data-management-section], [data-management-list], [data-management-form], [data-management-error], [data-management-status]",
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            tag: node.tagName,
            section: node.getAttribute("data-management-section"),
            list: node.getAttribute("data-management-list"),
            status: node.getAttribute("data-management-status"),
          })),
        )
        .catch(() => []),
      operations: [...observed.operations.values()].map(
        ({ kind, status, failure }) => ({ kind, status, failure }),
      ),
    };
    if (report.stage.startsWith("UPLOAD_"))
      await admin
        .screenshot({
          path: path.join(output, "failure-upload.png"),
          fullPage: true,
        })
        .catch(() => undefined);
    // Playwright's raw cause can include capability URLs and populated private fields.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(
      `Local experience browser failed at ${report.stage}; see safe report ${output}`,
    );
  } finally {
    observer.dispose();
    await paymentObserver.settled();
    paymentObserver.dispose();
    await browser.close();
    if (report.facts)
      await writeFile(
        path.join(output, "facts.json"),
        JSON.stringify(report.facts, null, 2) + "\n",
        { mode: 0o600 },
      );
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return {
    output,
    status: report.status,
    mode: report.mode,
    assertions: report.assertions,
    cases: report.cases.length,
    factsPath: path.join(output, "facts.json"),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    instance = args[args.indexOf("--instance") + 1],
    resumeIndex = args.indexOf("--resume-facts"),
    contentIndex = args.indexOf("--content-facts"),
    paidOrderIndex = args.indexOf("--paid-order"),
    refundOrderIndex = args.indexOf("--refund-order"),
    cancelOrderIndex = args.indexOf("--cancel-order");
  if (!args.includes("--instance"))
    throw new Error(
      "Pass --instance test-... for an already running acceptance instance",
    );
  console.log(
    JSON.stringify(
      await verifyLocalExperienceBrowser({
        workspaceRoot: path.resolve(
          fileURLToPath(new URL("../../..", import.meta.url)),
        ),
        instance,
        deferPoster: args.includes("--defer-poster"),
        posterOnly: args.includes("--poster-only"),
        operationsOnly: args.includes("--operations-only"),
        commerceOnly: args.includes("--commerce-only"),
        contextOnly: args.includes("--context-only"),
        ...(cancelOrderIndex >= 0
          ? { cancelOrder: args[cancelOrderIndex + 1] }
          : {}),
        ...(refundOrderIndex >= 0
          ? { refundOrder: args[refundOrderIndex + 1] }
          : {}),
        ...(paidOrderIndex >= 0 ? { paidOrder: args[paidOrderIndex + 1] } : {}),
        ...(resumeIndex >= 0
          ? { resumeFacts: path.resolve(args[resumeIndex + 1]) }
          : {}),
        ...(contentIndex >= 0
          ? { contentFacts: path.resolve(args[contentIndex + 1]) }
          : {}),
      }),
    ),
  );
}

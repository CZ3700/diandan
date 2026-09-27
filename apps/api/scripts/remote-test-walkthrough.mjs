// Operator walkthrough of a publicly exposed TEST instance (docs/runbooks/remote-test-environment.md).
// Runs from the operator's machine against real DNS and TLS. Credentials come only from the
// environment; screenshots and the report never contain them or any private field value.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const field = (name) => `[data-management-field="${name}"]`;

export async function walkRemoteTestInstance({
  baseDomain,
  authUser,
  authPassword,
  mailToken,
  seed = true,
  giftKind = "PHYSICAL",
  output,
}) {
  const origin = (label) => `https://${label}.${baseDomain}`;
  const report = { schemaVersion: 1, baseDomain, steps: [], consoleErrors: 0 };
  const step = (name, detail = {}) => {
    report.steps.push({ name, at: new Date().toISOString(), ...detail });
    console.log(JSON.stringify({ step: name, ...detail }));
  };
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = (viewport, withAuth) =>
      browser.newContext({
        viewport,
        ...(withAuth
          ? { httpCredentials: { username: authUser, password: authPassword } }
          : {}),
      });
    const shot = (page, name) =>
      page.screenshot({ path: path.join(output, `${name}.png`) });
    const watch = (page) =>
      page.on("console", (message) => {
        if (message.type() === "error") report.consoleErrors++;
      });

    // 1. Public storefront, both acceptance viewports.
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      const ctx = await context(viewport, false);
      const page = await ctx.newPage();
      watch(page);
      const response = await page.goto(`${origin("storefront")}/en`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      expect(response?.status()).toBe(200);
      await page.locator("main").first().waitFor();
      await shot(page, `storefront-home-${viewport.width}`);
      step("STOREFRONT_HOME", { width: viewport.width });
      await ctx.close();
    }

    // 2. Admin behind the edge's Basic Auth, signed in through the TEST OIDC picker.
    const adminContext = await context({ width: 1440, height: 900 }, true);
    const admin = await adminContext.newPage();
    watch(admin);
    await admin.goto(`${origin("admin")}/en`, { timeout: 120000 });
    const loginForm = admin.locator('form[action="/api/admin/auth/begin"]');
    await admin
      .locator(
        '[data-management-section]:enabled, form[action="/api/admin/auth/begin"]',
      )
      .first()
      .waitFor({ timeout: 120000 });
    if (await loginForm.count()) {
      await loginForm.locator("button[type=submit]").click();
      await admin.locator("select[name=actor]").waitFor({ timeout: 60000 });
      await admin.locator("select[name=actor]").selectOption("manager");
      await admin.locator("button[type=submit]").click();
    }
    await admin
      .locator("[data-management-section]:enabled")
      .first()
      .waitFor({ timeout: 120000 });
    await shot(admin, "admin-workspace");
    step("ADMIN_SIGNED_IN");

    const images = path.join(workspaceRoot, "apps/storefront/public/ui-brand");
    async function create(section, fill, name) {
      await admin.locator(`[data-management-section="${section}"]`).click();
      await admin.locator(`[data-management-list="${section}"]`).waitFor();
      await admin.locator("[data-management-new]").click();
      await admin.locator("[data-management-form]").waitFor();
      await fill();
      await admin.locator("[data-management-submit]").click();
      // Upload goes to the public presign host, then the server processes and publishes it.
      await expect(
        admin.locator(`[data-management-list="${section}"]`),
      ).toContainText(name, { timeout: 240000 });
    }
    // The purchase below buys the gift seeded here, so its kind decides which path is exercised.
    let seededGiftName = null;
    if (seed) {
      const suffix = new Date().toISOString().slice(5, 16).replace(/\D/gu, "");
      const artistName = `Demo artist ${suffix}`;
      await create(
        "ARTISTS",
        async () => {
          await admin
            .locator(field("image"))
            .setInputFiles(path.join(images, "performer-daylight-mobile.webp"));
          await admin.locator(field("name")).fill(artistName);
          await admin
            .locator(field("description"))
            .fill("Synthetic artist for the remote TEST environment.");
        },
        artistName,
      );
      step("ARTIST_PUBLISHED");
      const giftName = `Demo ${giftKind.toLowerCase()} gift ${suffix}`;
      seededGiftName = giftName;
      await create(
        "GIFTS",
        async () => {
          await admin
            .locator(field("image"))
            .setInputFiles(path.join(images, "gift-ruby-bouquet.webp"));
          await admin.locator(field("name")).fill(giftName);
          await admin
            .locator(field("description"))
            .fill("A synthetic gift for the remote TEST environment.");
          await admin.locator(field("giftKind")).selectOption(giftKind);
          await admin.locator(field("price")).fill("24");
        },
        giftName,
      );
      step("GIFT_PUBLISHED", { giftKind });
      // The server publishes the initial homepage once an artist exists; the workspace only
      // reflects it after a reload, so poll the posters list like the acceptance script does.
      await expect
        .poll(
          async () => {
            await admin.goto(`${origin("admin")}/en`, { timeout: 120000 });
            await admin
              .locator("[data-management-section]:enabled")
              .first()
              .waitFor({ timeout: 120000 });
            await admin.locator('[data-management-section="POSTERS"]').click();
            await admin.locator('[data-management-list="POSTERS"]').waitFor();
            return admin.locator("[data-management-new]").isEnabled();
          },
          { timeout: 300000, intervals: [2000, 5000] },
        )
        .toBe(true);
      await admin.locator("[data-management-new]").click();
      await admin.locator("[data-management-form]").waitFor();
      await admin
        .locator(field("image"))
        .setInputFiles(path.join(images, "performer-daylight-desktop.webp"));
      await admin.locator("[data-management-submit]").click();
      await admin
        .locator("[data-management-list]")
        .waitFor({ timeout: 240000 });
      step("POSTER_SUBMITTED");
    }

    // 3. Guest purchase with the TEST PSP, then the order page.
    const customerContext = await context({ width: 390, height: 844 }, false);
    const customer = await customerContext.newPage();
    watch(customer);
    await customer.goto(`${origin("storefront")}/en/gifts`, {
      timeout: 120000,
    });
    const giftLink = (
      seededGiftName
        ? customer.locator("[data-gift-link]", { hasText: seededGiftName })
        : customer.locator("[data-gift-link]")
    ).first();
    await giftLink.waitFor({ timeout: 120000 });
    await giftLink.click();
    await customer
      .locator("[data-gift-detail] h1")
      .waitFor({ timeout: 120000 });
    // Development servers compile on first visit; act only after the page has hydrated,
    // otherwise the recipient dialog falls back to its no-JavaScript navigation.
    await customer.waitForLoadState("networkidle", { timeout: 120000 });
    const recipient = customer
      .locator("[data-gift-recipient-picker] button")
      .first();
    await recipient.click();
    await customer.locator("[data-recipient-option]").first().click();
    await customer.waitForLoadState("networkidle", { timeout: 120000 });
    await customer.locator("[data-cart-message]").waitFor({ timeout: 60000 });
    await customer
      .locator("[data-cart-message]")
      .fill("Remote TEST walkthrough message");
    await customer.locator("[data-cart-message-locale]").selectOption("en");
    await customer.locator("button[data-cart-add-state]").click();
    await customer
      .locator('[data-cart-add-state="confirmed"]')
      .waitFor({ timeout: 60000 });
    step("ADDED_TO_CART");
    await customer.goto(`${origin("storefront")}/en/cart`);
    await customer.locator("[data-cart-checkout]").click();
    await customer.locator("[data-checkout-email]").waitFor({ timeout: 60000 });
    await customer
      .locator("[data-checkout-email]")
      .fill(`walkthrough-${Date.now()}@example.test`);
    for (const policy of await customer.locator("[data-checkout-policy]").all())
      await policy.check();
    await customer.locator("[data-checkout-confirm]").click();
    await customer.locator("[data-payment-create]").waitFor({ timeout: 60000 });
    await customer.locator("[data-payment-create]").click();
    await customer
      .locator("[data-payment-continue]")
      .waitFor({ timeout: 60000 });
    await customer.locator("[data-payment-continue]").click();
    await customer
      .locator("[data-test-psp-capture]")
      .waitFor({ timeout: 60000 });
    step("TEST_PAYMENT_PAGE", {
      host: new URL(customer.url()).hostname,
    });
    await customer.locator("[data-test-psp-capture]").click();
    await customer.locator("[data-order-number]").waitFor({ timeout: 120000 });
    await expect(
      customer.locator('[data-order-payment-status="PAID"]'),
    ).toBeVisible({ timeout: 60000 });
    const publicOrderId = await customer
      .locator("[data-order-root]")
      .getAttribute("data-order-id");
    await customer.waitForLoadState("networkidle");
    await shot(customer, "order-paid-390");
    // Development servers surface console errors as an "Issues" badge testers can see.
    const devIssues = await customer.evaluate(() =>
      Number(
        [...globalThis.document.querySelectorAll("nextjs-portal")]
          .map((portal) => portal.shadowRoot?.textContent ?? "")
          .join(" ")
          .match(/(\d+)\s*Issues?/u)?.[1] ?? 0,
      ),
    );
    step("ORDER_PAID", { devIssues });

    // 4. Captured mail behind Basic Auth; its secure link opens the same order.
    const mailContext = await context({ width: 1440, height: 900 }, true);
    const mailbox = await mailContext.newPage();
    watch(mailbox);
    await mailbox.goto(`${origin("mail")}/#token=${mailToken}`, {
      timeout: 60000,
    });
    await mailbox.locator('a[href="/"]').waitFor({ timeout: 60000 });
    const orderMail = mailbox.locator(
      `article a[href*="/order-access#"][href*="order=${publicOrderId}"]`,
    );
    await expect
      .poll(
        async () => {
          await mailbox.reload({ waitUntil: "domcontentloaded" });
          return orderMail.count();
        },
        { timeout: 120000, intervals: [1000, 2000] },
      )
      .toBeGreaterThan(0);
    await orderMail.first().click();
    await mailbox.locator("[data-order-number]").waitFor({ timeout: 60000 });
    step("MAIL_LINK_OPENS_ORDER");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    // Screenshots of every open page show where the journey stopped; private fields stay empty.
    let index = 0;
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page
          .screenshot({ path: path.join(output, `failure-${index++}.png`) })
          .catch(() => undefined);
    report.failure = {
      name: error?.name ?? "Error",
      // Playwright messages hold selectors and timeouts, never field values or secrets.
      message: String(error?.message ?? "").slice(0, 400),
    };
    throw error;
  } finally {
    await browser.close();
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env;
  for (const name of [
    "REMOTE_TEST_BASE_DOMAIN",
    "REMOTE_TEST_AUTH_PASSWORD",
    "REMOTE_TEST_MAIL_TOKEN",
  ])
    if (!env[name]) {
      console.error(`${name} is required`);
      process.exit(2);
    }
  const output = path.join(
    workspaceRoot,
    "output/checks/remote-test",
    new Date().toISOString().replaceAll(":", "-"),
  );
  try {
    const report = await walkRemoteTestInstance({
      baseDomain: env.REMOTE_TEST_BASE_DOMAIN,
      authUser: env.REMOTE_TEST_AUTH_USER ?? "tester",
      authPassword: env.REMOTE_TEST_AUTH_PASSWORD,
      mailToken: env.REMOTE_TEST_MAIL_TOKEN,
      seed: !process.argv.includes("--no-seed"),
      giftKind:
        process.argv
          .find((arg) => arg.startsWith("--gift-kind="))
          ?.slice("--gift-kind=".length) ?? "PHYSICAL",
      output,
    });
    console.log(`PASS remote TEST walkthrough; ${output}`);
    process.exitCode = report.status === "PASS" ? 0 : 1;
  } catch {
    console.error(`FAIL remote TEST walkthrough; see ${output}/report.json`);
    process.exitCode = 1;
  }
}

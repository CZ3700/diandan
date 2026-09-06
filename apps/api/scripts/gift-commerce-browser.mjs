import { createHash, X509Certificate, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  SUPPORTED_LOCALES,
  giftCommerceResponseSchema,
} from "@fan-support/contracts";
import { adminMessage } from "@fan-support/i18n";
import { revokeAdminContentLocaleGrant } from "../../../packages/persistence-postgres/scripts/postgres-admin-content-fixtures.mjs";
const evidenceRoot = fileURLToPath(
  new URL("../../../output/playwright/p3-03-gift-commerce/", import.meta.url),
);

/** Isolated synthetic identities. Browser traces, HAR, storage persistence and capability logging are intentionally absent. */
export async function verifyGiftCommerceBrowser({
  origin,
  credentials,
  fixtures,
  check,
  configPath,
  client,
  serve,
  ui,
}) {
  let step = "launch";
  let diagnosticPage;
  const operations = [];
  const accessibility = {
    schemaVersion: 1,
    status: "PENDING",
    environment: "Next development server",
    reducedMotion: "reduce",
    axe: [],
    reflow: [],
    keyboard: [],
    flows: [],
  };
  const certificate = new X509Certificate(
    await readFile(path.join(path.dirname(configPath), "server.crt")),
  );
  const pin = createHash("sha256")
    .update(certificate.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: !serve,
    args: [`--ignore-certificate-errors-spki-list=${pin}`],
  });
  async function call(
    page,
    operation,
    body,
    { mutation = false, headers = {} } = {},
  ) {
    return page.evaluate(
      async ({ operation, body, mutation, headers, key }) => {
        const bootstrap = await globalThis.fetch("/api/admin/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const session = await bootstrap.json();
        if (bootstrap.status !== 200)
          return { status: bootstrap.status, body: { code: session.code } };
        const response = await globalThis.fetch(`/api/admin/${operation}`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": session.csrfToken,
            ...(mutation ? { "idempotency-key": key } : {}),
            ...headers,
          },
          body: JSON.stringify(body),
        });
        return {
          status: response.status,
          body: await response.json(),
          private: (response.headers.get("cache-control") ?? "").includes(
            "no-store",
          ),
        };
      },
      { operation, body, mutation, headers, key: randomUUID() },
    );
  }
  async function settleEditor(page) {
    await expect(page.getByTestId("content-editor")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await page
      .getByRole("combobox", { name: "Gift type", exact: true })
      .waitFor();
  }
  async function selectGift(page, locale = "en") {
    diagnosticPage = page;
    step = `select ${locale} navigate`;
    await page.goto(`${origin}/${locale}`);
    step = `select ${locale} gift navigation`;
    await page
      .locator("nav")
      .getByRole("button", { name: adminMessage(locale, "gifts"), exact: true })
      .click();
    step = `select ${locale} directory ready`;
    await expect(page.getByTestId("content-directory")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    step = `select ${locale} gift row`;
    await page
      .getByTestId("content-directory")
      .getByRole("button", { name: /Studio Wish/ })
      .click();
    await expect(page.getByTestId("content-editor")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await page
      .getByRole("combobox", {
        name: adminMessage(locale, "giftType"),
        exact: true,
      })
      .waitFor();
  }
  async function clickOperation(page, operation, locator) {
    const pending = page.waitForResponse(
      (response) => response.url() === `${origin}/api/admin/${operation}`,
    );
    await locator.click();
    const response = await pending;
    const parsed = giftCommerceResponseSchema.safeParse(await response.json());
    if (response.status() !== 200)
      console.error(
        `Commerce browser operation ${JSON.stringify({ operation, status: response.status(), code: parsed.success && parsed.data.outcome === "FAILURE" ? parsed.data.code : "UNAVAILABLE" })}`,
      );
    check(
      response.status() === 200,
      `browser ${operation} reaches actual API successfully`,
    );
    return parsed.success ? parsed.data : null;
  }
  async function scan(page, screen) {
    const { default: AxeBuilder } = createRequire(
      new URL("../../../package.json", import.meta.url),
    )("@axe-core/playwright");
    const result = await new AxeBuilder({ page }).analyze();
    const violations = result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodeCount: nodes.length,
    }));
    accessibility.axe.push({
      screen,
      engineVersion: result.testEngine.version,
      passes: result.passes.length,
      violations,
      incomplete: result.incomplete.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map((node) =>
          node.target
            .flat()
            .map((value) =>
              typeof value === "string" &&
              value.length <= 512 &&
              /^[a-zA-Z0-9_#.:>\s,+~()\\-]+$/u.test(value) &&
              !/(token|csrf|session|blob|https?|x-amz)/iu.test(value)
                ? value
                : "SELECTOR_OMITTED",
            ),
        ),
      })),
    });
    check(
      !violations.some(({ impact }) =>
        ["serious", "critical"].includes(impact),
      ),
      `${screen} axe has no serious or critical violations`,
    );
  }
  async function reflow(page, screen, width, height) {
    const old = page.viewportSize();
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => {
      await globalThis.document.fonts.ready;
      await new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      );
    });
    const size = await page.evaluate(() => ({
      viewport: globalThis.innerWidth,
      document: globalThis.document.documentElement.scrollWidth,
      body: globalThis.document.body.scrollWidth,
    }));
    accessibility.reflow.push({
      screen,
      ...size,
      method:
        width === 720
          ? "equivalent 200% reflow: 1440x900 CSS viewport reduced to 720x450; no native browser zoom"
          : "320 CSS pixel viewport",
      nativeBrowserZoom: false,
    });
    check(
      size.document <= width + 1 && size.body <= width + 1,
      `${screen} fits ${width} CSS pixels`,
    );
    await page.setViewportSize(old);
  }
  async function keyboard(page, locator, screen) {
    let reached = false;
    for (let count = 0; count < 100; count++) {
      await page.keyboard.press("Tab");
      reached = await locator.evaluate(
        (element) => element === globalThis.document.activeElement,
      );
      if (reached) break;
    }
    const focus = reached
      ? await locator.evaluate((element) => ({
          visible: element.matches(":focus-visible"),
          width: Number.parseFloat(
            globalThis.getComputedStyle(element).outlineWidth,
          ),
        }))
      : null;
    accessibility.keyboard.push({ screen, reached, focus });
    check(
      reached && focus?.visible && focus.width > 0,
      `${screen} has visible keyboard focus`,
    );
  }
  try {
    const contexts = {};
    for (const actor of ["editor", "reviewer", "manager", "denied"]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      });
      contexts[actor] = context;
      context.on("response", (response) => {
        const url = new URL(response.url());
        if (url.origin !== origin || !url.pathname.startsWith("/api/admin/"))
          return;
        void response
          .json()
          .then((body) =>
            operations.push({
              operation: url.pathname.slice("/api/admin/".length),
              status: response.status(),
              code:
                typeof body?.code === "string" && /^[A-Z_]+$/u.test(body.code)
                  ? body.code
                  : null,
            }),
          )
          .catch(() => undefined);
      });
      await context.addCookies([
        ...["session", "csrf"].map((kind) => ({
          name: `__Host-fan-admin-${kind}`,
          value: credentials[actor][kind === "session" ? "token" : "csrf"],
          domain: "localhost",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Strict",
        })),
      ]);
    }
    const page = await contexts.manager.newPage();
    await page.goto(`${origin}/en`);
    const cookies = await contexts.manager.cookies(origin);
    check(
      cookies.length === 2 &&
        cookies.every(
          (cookie) =>
            cookie.httpOnly && cookie.secure && cookie.sameSite === "Strict",
        ),
      "commerce browser retains Secure HttpOnly Strict credentials on localhost",
    );
    check(
      await page.evaluate(() => globalThis.document.cookie === ""),
      "commerce credentials cannot be read through document.cookie",
    );
    step = "protocol";
    const context = await call(page, "commerce-context", { schemaVersion: 1 });
    check(
      context.status === 200 &&
        context.body.permissions.includes("pricing.manage") &&
        context.private,
      "same-origin commerce context discovers current pricing capability",
    );
    const gift = await call(page, "gift-read", {
      schemaVersion: 1,
      giftId: fixtures.commerce.giftId,
      locale: "en",
    });
    check(
      gift.status === 200 &&
        gift.body.value.latestProfile.profile.giftKind === "VIRTUAL",
      "BFF reads latest kind independently from published historical kind",
    );
    const prices = await call(page, "prices-read", {
      schemaVersion: 1,
      ...fixtures.commerce.configured,
      revision: null,
      page: 1,
      pageSize: 10,
    });
    check(
      prices.status === 200 && prices.body.items.length === 2,
      "BFF reads actual price publication history",
    );
    const inventory = await call(page, "inventory-read", {
      schemaVersion: 1,
      giftVariantId: fixtures.commerce.variantIds[0],
      inventoryLocationId: null,
      view: "BALANCES",
      page: 1,
      pageSize: 10,
    });
    check(
      inventory.status === 200 &&
        inventory.body.item === null &&
        inventory.body.items.length === 0,
      "BFF explains procurement without a stock ledger",
    );
    const invalid = await call(
      page,
      "commerce-context",
      { schemaVersion: 1 },
      { headers: { "x-csrf-token": "A".repeat(43) } },
    );
    check(invalid.status === 403, "actual BFF rejects changed CSRF");
    const editorPage = await contexts.editor.newPage();
    await editorPage.goto(`${origin}/en`);
    const deniedWrite = await call(
      editorPage,
      "inventory-location-create",
      {
        schemaVersion: 1,
        code: "UNAUTHORIZED",
        expectedVersion: 0,
        reasonCode: "BROWSER_FORBIDDEN",
      },
      { mutation: true },
    );
    check(
      deniedWrite.status === 403 && deniedWrite.body.code === "FORBIDDEN",
      "content editor cannot perform inventory management through BFF",
    );
    const reviewerPage = await contexts.reviewer.newPage();
    await reviewerPage.goto(`${origin}/en`);
    const deniedGift = await call(
      reviewerPage,
      "gift-create",
      {
        schemaVersion: 1,
        handle: "not-permitted",
        expectedBaseVersion: 0,
        reasonCode: "BROWSER_FORBIDDEN",
      },
      { mutation: true },
    );
    check(
      deniedGift.status === 403,
      "review role cannot bypass gift management capability",
    );
    const bffCreate = await call(
      editorPage,
      "gift-create",
      {
        schemaVersion: 1,
        handle: "browser-protocol-gift",
        expectedBaseVersion: 0,
        reasonCode: "BROWSER_CREATE",
      },
      { mutation: true },
    );
    check(
      bffCreate.status === 200 && bffCreate.body.action === "CREATE_GIFT",
      "actual secure browser BFF creates an empty audited gift",
    );
    check(
      await page.evaluate(
        () =>
          globalThis.localStorage.length === 0 &&
          globalThis.sessionStorage.length === 0,
      ),
      "browser stores neither commerce credentials nor capabilities",
    );
    if (!ui && !serve) return browser;
    await mkdir(evidenceRoot, { recursive: true });
    if (serve) {
      await selectGift(page);
      return browser;
    }
    step = "seven-language actual gift editors";
    for (const locale of SUPPORTED_LOCALES) {
      for (const [device, width, height] of [
        ["desktop", 1440, 900],
        ["mobile", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await selectGift(page, locale);
        await page.evaluate(() => globalThis.document.fonts.ready);
        check(
          await page.evaluate(
            ({ locale, width }) =>
              globalThis.document.documentElement.lang === locale &&
              globalThis.document.documentElement.scrollWidth <= width + 1,
            { locale, width },
          ),
          "seven-language gift editor preserves locale and viewport width",
        );
        await page.screenshot({
          path: path.join(evidenceRoot, `${locale}-${device}.png`),
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await selectGift(page);
    step = "editor accessibility preview";
    await scan(page, "gift editor");
    await reflow(page, "gift editor", 320, 844);
    await reflow(page, "gift editor", 720, 450);
    const previewLink = page.getByRole("link", {
      name: "Desktop preview",
      exact: true,
    });
    await keyboard(page, previewLink, "gift preview link");
    const popup = page.waitForEvent("popup");
    await page.keyboard.press("Enter");
    const preview = await popup;
    await preview.locator(".admin-preview-content img").first().waitFor();
    await expect
      .poll(() =>
        preview
          .locator(".admin-preview-content img")
          .evaluateAll(
            (images) =>
              images.length > 0 &&
              images.every(
                (image) =>
                  image.complete &&
                  image.naturalWidth > 0 &&
                  image.src.startsWith("blob:"),
              ),
          ),
      )
      .toBe(true);
    check(
      !/(token|csrf)/u.test(preview.url()),
      "gift preview URL contains no capability",
    );
    await scan(preview, "gift preview");
    await preview.screenshot({
      path: path.join(evidenceRoot, "en-preview.png"),
      fullPage: true,
    });
    await preview.close();
    const commerce = page.locator("details.admin-commerce");
    await commerce.locator("summary").click();
    step = "price management UI";
    await commerce.getByRole("button", { name: "Prices", exact: true }).click();
    const pricePanel = commerce.getByRole("region", {
      name: "Prices",
      exact: true,
    });
    await pricePanel
      .getByRole("combobox", { name: "Market", exact: true })
      .selectOption(fixtures.commerce.configured.market);
    await expect(pricePanel).toHaveAttribute("aria-busy", "false");
    await pricePanel
      .getByRole("combobox", { name: "Variants", exact: true })
      .selectOption(fixtures.commerce.variantIds[0]);
    await pricePanel.getByLabel("Amount · USD", { exact: true }).fill("17.25");
    await pricePanel
      .getByLabel("Effective from", { exact: true })
      .fill("2026-01-01T00:00");
    await clickOperation(
      page,
      "price-revision-create",
      pricePanel.getByRole("button", {
        name: "Save price revision",
        exact: true,
      }),
    );
    await expect(pricePanel).toHaveAttribute("aria-busy", "false");
    await clickOperation(
      page,
      "price-book-publish",
      pricePanel.getByRole("button", { name: "Publish prices", exact: true }),
    );
    await expect(pricePanel).toHaveAttribute("aria-busy", "false");
    await scan(page, "price management");
    await reflow(page, "price management", 320, 844);
    await reflow(page, "price management", 720, 450);
    await page.screenshot({
      path: path.join(evidenceRoot, "en-prices.png"),
      fullPage: true,
    });
    accessibility.flows.push("UI saved and published actual price revision");
    step = "inventory management UI";
    await commerce
      .getByRole("button", { name: "Inventory", exact: true })
      .click();
    const inventoryPanel = commerce.getByRole("region", {
      name: "Inventory",
      exact: true,
    });
    await inventoryPanel
      .getByRole("combobox", { name: "Variants", exact: true })
      .selectOption(fixtures.commerce.variantIds[1]);
    await expect(inventoryPanel).toHaveAttribute("aria-busy", "false");
    await inventoryPanel
      .getByLabel("Quantity change (+/−)", { exact: true })
      .fill("3");
    await clickOperation(
      page,
      "inventory-adjust",
      inventoryPanel.getByRole("button", {
        name: "Apply stock adjustment",
        exact: true,
      }),
    );
    await expect(inventoryPanel).toHaveAttribute("aria-busy", "false");
    await scan(page, "inventory management");
    await reflow(page, "inventory management", 320, 844);
    await page.screenshot({
      path: path.join(evidenceRoot, "en-inventory.png"),
      fullPage: true,
    });
    await inventoryPanel
      .getByRole("combobox", { name: "Variants", exact: true })
      .selectOption(fixtures.commerce.variantIds[0]);
    await expect(inventoryPanel).toHaveAttribute("aria-busy", "false");
    check(
      await inventoryPanel
        .getByText(
          "No stock balance is required. The studio prepares each paid order.",
          { exact: false },
        )
        .isVisible(),
      "procurement UI explains repeated studio preparation",
    );
    check(
      (await inventoryPanel
        .getByLabel("Quantity change (+/−)", { exact: true })
        .count()) === 0,
      "procurement UI does not invent manual balance input",
    );
    accessibility.flows.push(
      "UI adjusted tracked balance; procurement excludes stock input",
    );
    step = "actual UI gift creation";
    await page.getByRole("button", { name: "← Gifts", exact: true }).click();
    await page.getByRole("button", { name: "New gift", exact: true }).click();
    await page
      .getByLabel("URL handle", { exact: true })
      .fill("browser-created-gift");
    await clickOperation(
      page,
      "gift-create",
      page
        .locator("form.admin-create")
        .getByRole("button", { name: "New gift", exact: true }),
    );
    await settleEditor(page);
    const newCommerce = page.locator("details.admin-commerce");
    await newCommerce.getByLabel("SKU", { exact: true }).fill("BROWSER-WISH");
    await newCommerce
      .getByRole("combobox", { name: "Selling policy", exact: true })
      .selectOption("PROCURE_ON_DEMAND");
    await clickOperation(
      page,
      "gift-variant-save",
      newCommerce.getByRole("button", { name: "Save variant", exact: true }),
    );
    await settleEditor(page);
    await page.screenshot({
      path: path.join(evidenceRoot, "en-created.png"),
      fullPage: true,
    });
    accessibility.flows.push(
      "UI created an empty gift and procurement variant through audited commands",
    );
    step = "gift text editing and independent review";
    await selectGift(editorPage);
    const title = editorPage.getByLabel("Title", { exact: true }).first();
    await title.fill("Studio Wish — a thoughtful new chapter");
    editorPage.once("dialog", (dialog) => dialog.dismiss());
    await editorPage
      .getByRole("button", { name: "← Gifts", exact: true })
      .click();
    check(
      await editorPage.getByTestId("content-editor").isVisible(),
      "dirty gift navigation cancellation retains edits",
    );
    const saved = await clickOperation(
      editorPage,
      "gift-content-save",
      editorPage.getByRole("button", {
        name: "Save new revision",
        exact: true,
      }),
    );
    await settleEditor(editorPage);
    check(
      saved?.action === "SAVE_GIFT_CONTENT",
      "gift UI saves immutable content with classification wrapper",
    );
    const submitted = editorPage.waitForResponse(
      (response) => response.url() === `${origin}/api/admin/review-submit`,
    );
    await editorPage
      .getByRole("button", { name: "Submit for review", exact: true })
      .last()
      .click();
    check(
      (await submitted).status() === 200,
      "gift English translation submits for independent review",
    );
    await selectGift(reviewerPage);
    const refreshedReview = reviewerPage.waitForResponse(async (response) => {
      if (
        response.url() !== `${origin}/api/admin/translation-read` ||
        response.status() !== 200
      )
        return false;
      const value = await response.json();
      return value.target?.revisionId === saved.giftRevisionId;
    });
    const approved = reviewerPage.waitForResponse(
      (response) => response.url() === `${origin}/api/admin/review-approve`,
    );
    await reviewerPage
      .getByRole("button", { name: "Approve translation", exact: true })
      .click();
    check(
      (await approved).status() === 200,
      "independent reviewer approves actual gift English translation",
    );
    step = "render current saved gift review matrix";
    const refreshedBody = await (await refreshedReview).json();
    check(
      refreshedBody.target.revisionId === saved.giftRevisionId &&
        refreshedBody.cells.filter((cell) => cell.status === "STALE").length ===
          6,
      "current saved revision has six stale canonical translations after English approval",
    );
    await expect(
      reviewerPage
        .locator(".admin-locale-matrix")
        .getByText("Source changed", { exact: true }),
    ).toHaveCount(6);
    check(
      true,
      "English gift change renders all six stale translations for current saved revision",
    );
    accessibility.flows.push(
      "Dirty edit cancel, content save, independent English review, six stale translations",
    );
    step = "Japanese-only content reviewer without commerce role";
    const detailTarget = {
      kind: "GIFT_DETAILS",
      revisionId: saved.giftRevisionId,
      locale: "ja",
    };
    const detail = await call(editorPage, "alias-review-read", {
      schemaVersion: 1,
      target: detailTarget,
    });
    check(
      detail.status === 200,
      "editor reads actual Japanese detail review context",
    );
    const submittedDetail = await call(
      editorPage,
      "alias-review-submit",
      {
        schemaVersion: 1,
        target: detailTarget,
        expectedVersion: detail.body.context.sequence,
        expectedContentHash: detail.body.context.contentHash,
        expectedSourceHash: detail.body.context.sourceHash,
        reasonCode: "BROWSER_DETAIL_REVIEW",
      },
      { mutation: true },
    );
    check(
      submittedDetail.status === 200,
      "Japanese details enter independent review",
    );
    for (const locale of SUPPORTED_LOCALES.filter((value) => value !== "ja"))
      await revokeAdminContentLocaleGrant(client, {
        adminIdentityId: fixtures.identities.reviewer,
        locale,
        actorId: fixtures.identities.manager,
      });
    const removed = await client.query(
      "DELETE FROM role_permissions WHERE role_id IN(SELECT role_id FROM admin_identity_roles WHERE admin_identity_id=$1) AND permission_id IN(SELECT id FROM permissions WHERE permission_key='commerce.read') RETURNING role_id",
      [fixtures.identities.reviewer],
    );
    check(
      removed.rowCount === 1,
      "same reviewer session loses commerce read capability",
    );
    await reviewerPage.goto(`${origin}/ja`);
    await reviewerPage
      .locator("nav")
      .getByRole("button", { name: adminMessage("ja", "gifts"), exact: true })
      .click();
    await expect(reviewerPage.getByTestId("content-directory")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await reviewerPage
      .getByTestId("content-directory")
      .getByRole("button", { name: /Studio Wish/ })
      .click();
    await expect(reviewerPage.getByTestId("content-editor")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const detailSummary = reviewerPage
      .locator("summary")
      .filter({ hasText: new RegExp(`^${adminMessage("ja", "details")}$`) });
    if (
      !(await detailSummary.evaluate((element) => element.parentElement.open))
    )
      await detailSummary.click();
    const scoped = reviewerPage.getByRole("region", {
      name: adminMessage("ja", "detailsReview"),
      exact: true,
    });
    await expect(
      scoped.getByText(
        "Our studio arranges every delivery to the artist · ja",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      scoped.getByText(
        "Our studio arranges every delivery to the artist · en",
        { exact: true },
      ),
    ).toBeVisible();
    check(
      (await reviewerPage
        .getByRole("combobox", {
          name: adminMessage("ja", "giftType"),
          exact: true,
        })
        .count()) === 0 &&
        (await reviewerPage.locator("details.admin-commerce").count()) === 0,
      "content-only reviewer receives no gift classification or commercial editing controls",
    );
    const otherLocale = await call(reviewerPage, "alias-review-read", {
      schemaVersion: 1,
      target: { ...detailTarget, locale: "th" },
    });
    check(
      otherLocale.status === 403,
      "Japanese-only reviewer cannot read unrelated Thai detail content",
    );
    const approvedDetail = reviewerPage.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/admin/alias-review-approve`,
    );
    await scoped
      .getByRole("button", {
        name: adminMessage("ja", "detailsReview"),
        exact: true,
      })
      .click();
    check(
      (await approvedDetail).status() === 200,
      "Japanese-only content reviewer approves details with actual English source and no commerce authority",
    );
    await expect(reviewerPage.getByTestId("content-editor")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    accessibility.flows.push(
      "Japanese-only reviewer without commerce capability reads own details and actual English source, rejects Thai, independently approves",
    );
    accessibility.status = "PASS";
    await writeFile(
      path.join(evidenceRoot, "accessibility.json"),
      JSON.stringify(accessibility, null, 2) + "\n",
    );
    return browser;
  } catch (error) {
    if (ui && diagnosticPage)
      await diagnosticPage
        .screenshot({
          path: path.join(evidenceRoot, "en-desktop.png"),
          fullPage: true,
        })
        .catch(() => undefined);
    if (ui)
      await writeFile(
        path.join(evidenceRoot, "accessibility.json"),
        JSON.stringify({ ...accessibility, status: "FAIL", step }, null, 2) +
          "\n",
      ).catch(() => undefined);
    console.error(
      `Gift browser diagnostic ${JSON.stringify({ step, operations: operations.slice(-18), name: ["Error", "TypeError", "TimeoutError", "AssertionError"].includes(error?.name) ? error.name : "UNAVAILABLE" })}`,
    );
    await browser.close();
    throw error;
  }
}

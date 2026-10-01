import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  SUPPORTED_LOCALES,
  CART_RUNTIME_MAX_QUANTITY,
  managementCenterResponseSchema,
} from "@fan-support/contracts";
import { createManagementResponseObserver } from "./management-center-response-observer.mjs";

const requireFromRoot = createRequire(
  new globalThis.URL("../../../package.json", import.meta.url),
);
const { default: AxeBuilder } = requireFromRoot("@axe-core/playwright");
const field = (name) => `[data-management-field="${name}"]`;
const item = (id) => `[data-management-item="${id}"]`;
const operationKeys = new Set([
  "management-context",
  "management-list",
  "management-prepare-upload",
  "management-submit",
  "management-read-operation",
  "management-retry-operation",
]);

/** Local publication latency only; the two actual responsive URLs stay out of evidence. */
export function posterVisibilityEvidence({
  operationKind,
  elapsedMs,
  previousImages,
  publicImages,
  expectedImages,
}) {
  return {
    operationKind,
    elapsedMs,
    budgetMs: 60_000,
    pass:
      Number.isFinite(elapsedMs) &&
      elapsedMs >= 0 &&
      elapsedMs <= 60_000 &&
      previousImages.length === 2 &&
      publicImages.length === 2 &&
      publicImages.every(
        (url, index) =>
          typeof url === "string" &&
          url.length > 0 &&
          url !== previousImages[index],
      ) &&
      (expectedImages === undefined ||
        JSON.stringify(publicImages) === JSON.stringify(expectedImages)),
  };
}

/** Real TEST operator only. No credential, signed URL, request body, HAR or trace is saved. */
export async function verifyManagementCenterBrowser({
  adminOrigin,
  storefrontOrigin,
  credentials,
  gateway,
  sourceImages,
  client,
  check,
  output,
  configPath,
}) {
  const directory = path.join(
    output,
    `browser-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
  );
  await mkdir(directory, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    environment: "LOCAL_TEST_SINGLE_OPERATOR",
    startedAt: new Date().toISOString(),
    assertions: 0,
    cases: [],
    screenshots: [],
    axe: [],
    reflow: [],
    operations: [],
    uploads: [],
    publicPages: [],
    posterVisibility: [],
    pageErrors: [],
    observationFailures: [],
    limitations: [
      "Desktop Chrome with emulated viewports; not a physical phone",
      "Automated accessibility is not a screen-reader or human translation approval",
      "No payment, real customer data, operator timing or production deployment",
      "Public gift checks cover the current add-to-cart entry and quantity contract; this content fixture does not compose cart, checkout or payment runtimes",
      "Poster visibility measures actual submit click through local TEST public HTML and responsive image readback; it is not a production CDN propagation claim",
    ],
  };
  const assert = (condition, label) => {
    check(condition, label);
    report.assertions += 1;
  };
  let step = "browser-start";
  let lateObservationFailure;
  // Only fixed check stages and non-content page facts may enter failure evidence.
  let publicCheck = null;
  const certificates = [
    ...new Set([
      gateway.certificatePath,
      path.join(path.dirname(configPath), "server.crt"),
    ]),
  ];
  const pins = await Promise.all(
    certificates.map(async (filename) => {
      const certificate = new X509Certificate(await readFile(filename));
      return createHash("sha256")
        .update(certificate.publicKey.export({ type: "spki", format: "der" }))
        .digest("base64");
    }),
  );
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      `--ignore-certificate-errors-spki-list=${pins.join(",")}`,
      "--host-resolver-rules=MAP media.example.invalid 127.0.0.1",
      "--no-proxy-server",
    ],
  });
  report.browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const publicContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const publicPage = await publicContext.newPage();
  const observed = {
    context: null,
    lists: new Map(),
    operations: new Map(),
    grants: [],
    submits: 0,
    putAttempts: 0,
  };
  for (const [surface, target] of [
    ["admin", page],
    ["storefront", publicPage],
  ]) {
    target.on("pageerror", (error) =>
      report.pageErrors.push({
        surface,
        name: error.name,
        detail: "Runtime message omitted",
      }),
    );
  }
  page.on("request", (request) => {
    const url = new globalThis.URL(request.url());
    if (
      url.origin === adminOrigin &&
      url.pathname === "/api/admin/management-submit"
    )
      observed.submits += 1;
    if (request.method() === "PUT" && url.origin !== adminOrigin)
      observed.putAttempts += 1;
  });
  const observer = createManagementResponseObserver({
    page,
    origin: adminOrigin,
    keys: operationKeys,
    schema: managementCenterResponseSchema,
    check: assert,
    onFailure: (failure) => report.observationFailures.push(failure),
    accept: (value) => {
      if (value.kind === "CONTEXT") observed.context = value;
      if (value.kind === "LIST") observed.lists.set(value.section, value);
      if (value.kind === "OPERATION")
        observed.operations.set(value.operation.operationId, value.operation);
      if (value.kind === "UPLOAD_GRANT") observed.grants.push(value);
    },
  });
  async function settledResponses() {
    const deadline = Date.now() + 45_000;
    let started;
    do {
      started = observer.started;
      // Let the clicked render's effects issue their actual requests before
      // considering an old visible list settled or leaving its document.
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            );
          }),
      );
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("MANAGEMENT_OBSERVER_DRAIN_TIMEOUT");
      await observer.settled(remaining);
    } while (observer.started !== started);
  }
  async function navigate(locale = "zh-CN") {
    await settledResponses();
    const response = await page.goto(`${adminOrigin}/${locale}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    assert(
      response?.status() === 200,
      `${locale} actual admin entry responds HTTP 200`,
    );
    await page
      .locator('[data-management-list="ARTISTS"]')
      .waitFor({ timeout: 45_000 });
    await settledResponses();
  }
  async function section(value) {
    await page.locator(`[data-management-section="${value}"]`).click();
    await page
      .locator(`[data-management-list="${value}"]`)
      .waitFor({ timeout: 45_000 });
    await settledResponses();
  }
  async function begin(value) {
    await section(value);
    await page.locator("[data-management-new]").click();
    await page.locator("[data-management-form]").waitFor();
  }
  async function back() {
    await page.locator(".mc-back").click();
    await page.locator("[data-management-list]").waitFor({ timeout: 45_000 });
    await settledResponses();
  }
  async function findItem(sectionName, id) {
    await section(sectionName);
    for (let index = 0; index < 100; index += 1) {
      const candidate = page.locator(item(id));
      if (await candidate.count()) return candidate;
      const next = page.locator("[data-management-next]");
      if (!(await next.count()) || !(await next.isEnabled())) break;
      await next.click();
      await page.locator(`[data-management-list="${sectionName}"]`).waitFor();
      await settledResponses();
    }
    throw new Error("EXPECTED_ITEM_NOT_IN_REAL_PAGINATED_LIST");
  }
  async function pictures(target, selector) {
    const images = target.locator(selector);
    const count = await images.count();
    assert(count > 0, `${step} has an actual image element`);
    for (let index = 0; index < count; index += 1) {
      const image = images.nth(index);
      await image.scrollIntoViewIfNeeded();
      await expect(image).toHaveJSProperty("complete", true, {
        timeout: 30_000,
      });
      assert(
        await image.evaluate(
          (node) => node.naturalWidth > 0 && node.naturalHeight > 0,
        ),
        `${step} image ${index} decodes real bytes`,
      );
    }
  }
  async function panel(label, target = page, takeScreenshot = true) {
    if (target === publicPage && publicCheck) publicCheck.stage = "LAYOUT";
    await target.evaluate(async () => {
      await globalThis.document.fonts.ready;
      await new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      );
    });
    const reflow = await target.evaluate(() => ({
      viewport: globalThis.innerWidth,
      document: globalThis.document.documentElement.scrollWidth,
      body: globalThis.document.body.scrollWidth,
    }));
    report.reflow.push({ label, ...reflow });
    assert(
      reflow.document <= reflow.viewport + 1 &&
        reflow.body <= reflow.viewport + 1,
      `${label} no horizontal overflow`,
    );
    const photoInput = target.locator(field("image"));
    if (await photoInput.count()) {
      const visibleLabel = await target
        .locator("#management-image-label")
        .innerText();
      await expect(photoInput).toHaveAccessibleName(visibleLabel);
      assert(
        await photoInput.evaluate((node) => node.labels.length === 1),
        `${label} photo input has one associated label and the exact visible accessible name`,
      );
    }
    if (target === publicPage && publicCheck)
      publicCheck.stage = "ACCESSIBILITY";
    const axe = await new AxeBuilder({ page: target })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const safeRule = (rule) => ({
      id: rule.id,
      impact: rule.impact,
      nodeCount: rule.nodes.length,
      targets: rule.nodes.map((node) =>
        node.target.map((selector) =>
          typeof selector === "string" &&
          !/token|csrf|session|blob:|https?:|x-amz/iu.test(selector)
            ? selector
            : "[omitted]",
        ),
      ),
    });
    report.axe.push({
      label,
      violations: axe.violations.map(safeRule),
      incomplete: axe.incomplete.map(safeRule),
    });
    assert(
      axe.violations.length === 0,
      `${label} axe has zero violations; incomplete retained separately`,
    );
    if (takeScreenshot) {
      if (target === publicPage && publicCheck)
        publicCheck.stage = "SCREENSHOT";
      const filename = `${label}.png`;
      await target.screenshot({
        path: path.join(directory, filename),
        fullPage: true,
      });
      report.screenshots.push(filename);
    }
  }
  async function tabTo(selector) {
    for (let index = 0; index < 80; index += 1) {
      await page.keyboard.press("Tab");
      if (
        await page
          .locator(selector)
          .evaluate((node) => node === globalThis.document.activeElement)
      ) {
        const focus = await page.locator(selector).evaluate((node) => {
          const style = globalThis.getComputedStyle(node),
            box = node.getBoundingClientRect();
          return (
            (parseFloat(style.outlineWidth) > 0 &&
              style.outlineStyle !== "none") ||
            (style.boxShadow !== "none" && box.width > 0)
          );
        });
        assert(focus, `${selector} has a visible keyboard focus treatment`);
        return;
      }
    }
    throw new Error("KEYBOARD_TARGET_NOT_REACHED");
  }
  async function operationAfter(action, kind) {
    const before = new Set(observed.operations.keys());
    const count = observed.submits;
    await action();
    await page
      .locator(
        "[data-management-success], [data-management-status=FAILED], [data-management-error]",
      )
      .first()
      .waitFor({ timeout: 180_000 });
    await settledResponses();
    const failed = await page
      .locator("[data-management-status=FAILED], [data-management-error]")
      .count();
    assert(
      failed === 0,
      `${kind} reaches committed publication instead of error`,
    );
    const operation = [...observed.operations.values()].find(
      (entry) => !before.has(entry.operationId) && entry.kind === kind,
    );
    assert(
      operation?.status === "PUBLISHED" && operation.result !== null,
      `${kind} observed terminal response is PUBLISHED`,
    );
    assert(
      observed.submits - count === 1,
      `${kind} one user action creates one submit request`,
    );
    const rows = await client.query(
      "SELECT status,target_id,result FROM public.management_operations WHERE id=$1",
      [operation.operationId],
    );
    assert(
      rows.rows.length === 1 &&
        rows.rows[0].status === "SUCCEEDED" &&
        rows.rows[0].target_id === operation.result.targetId,
      `${kind} is durable in actual PostgreSQL`,
    );
    assert(
      JSON.stringify(rows.rows[0].result) ===
        JSON.stringify(operation.result) ||
        (rows.rows[0].result?.publicationId ===
          operation.result.publicationId &&
          rows.rows[0].result?.revisionId === operation.result.revisionId),
      `${kind} browser publication identifies its committed PG result`,
    );
    report.operations.push({
      operationId: operation.operationId,
      kind,
      status: operation.status,
      ...operation.result,
    });
    await page.locator("[data-management-list]").waitFor({ timeout: 45_000 });
    await settledResponses();
    return operation;
  }
  async function mediaProof(operation, imagePath, roles) {
    const checksum = createHash("sha256")
      .update(await readFile(imagePath))
      .digest("hex");
    const rows = await client.query(
      `SELECT job.role,job.status,asset.processing_status,asset.rights_status,source.checksum_sha256
      FROM public.management_operations operation
      JOIN LATERAL jsonb_array_elements(operation.checkpoint->'jobs') checkpoint_job ON true
      JOIN public.media_processing_jobs job ON job.id=(checkpoint_job->>'jobId')::uuid AND job.source_asset_id=(operation.checkpoint->>'sourceAssetId')::uuid
      JOIN public.media_assets source ON source.id=job.source_asset_id
      JOIN public.media_assets asset ON asset.id=job.output_asset_id
      WHERE operation.id=$1 ORDER BY job.role`,
      [operation.operationId],
    );
    assert(
      rows.rows.length >= roles.length,
      `${operation.kind} actual worker produced every required role`,
    );
    for (const role of roles)
      assert(
        rows.rows.some(
          (row) =>
            row.role === role &&
            row.status === "SUCCEEDED" &&
            row.processing_status === "READY" &&
            row.rights_status === "APPROVED" &&
            row.checksum_sha256 === checksum,
        ),
        `${operation.kind} ${role} READY derives from actual selected file hash`,
      );
    report.uploads.push({
      operationId: operation.operationId,
      checksumSha256: checksum,
      requiredRoles: roles,
    });
  }
  async function fillContent({ name, description, image, giftKind, price }) {
    if (image) await page.locator(field("image")).setInputFiles(image);
    await page.locator(field("name")).fill(name);
    await page.locator(field("description")).fill(description);
    if (giftKind) await page.locator(field("giftKind")).selectOption(giftKind);
    if (price) await page.locator(field("price")).fill(price);
  }
  async function currentPoster() {
    await section("POSTERS");
    const list = observed.lists.get("POSTERS");
    const current = list?.items.find(
      (entry) => entry.kind === "POSTER" && entry.current,
    );
    assert(
      Boolean(current?.image),
      "current homepage poster has a real published image",
    );
    return current;
  }
  async function homeImages() {
    publicCheck = {
      locale: "zh-CN",
      kind: "homepage",
      viewport: publicPage.viewportSize(),
      stage: "HTTP",
      httpStatus: null,
    };
    const response = await publicPage.goto(`${storefrontOrigin}/zh-CN`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    publicCheck.httpStatus = response?.status() ?? null;
    assert(
      response?.status() === 200,
      "public homepage is HTTP 200 after poster publication",
    );
    publicCheck.stage = "IMAGE";
    await publicPage
      .locator(".storefront-hero-image picture")
      .waitFor({ timeout: 45_000 });
    await pictures(publicPage, ".storefront-hero-image img");
    const images = await publicPage
      .locator(".storefront-hero-image picture")
      .evaluate((picture) => {
        const getOriginal = (src) => {
          const url = new globalThis.URL(src, globalThis.location.href);
          return url.pathname === "/_next/image"
            ? url.searchParams.get("url")
            : url.href;
        };
        return [...picture.querySelectorAll("source,img")].map((node) =>
          getOriginal(
            (node.getAttribute("srcset") ?? node.getAttribute("src"))
              .split(", ")[0]
              .replace(/ \d+w$/u, ""),
          ),
        );
      });
    publicCheck = null;
    return images;
  }
  try {
    await context.addCookies(
      ["session", "csrf"].map((name) => ({
        name: `__Host-fan-admin-${name}`,
        value: name === "session" ? credentials.token : credentials.csrf,
        domain: new globalThis.URL(adminOrigin).hostname,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Strict",
      })),
    );
    step = "initial-entry-and-session";
    await navigate();
    const cookies = await context.cookies(adminOrigin);
    assert(
      cookies.length === 2 &&
        cookies.every(
          (cookie) =>
            cookie.httpOnly &&
            cookie.secure &&
            cookie.sameSite === "Strict" &&
            cookie.path === "/",
        ),
      "single real operator retains secure HttpOnly cookies",
    );
    assert(
      await page.evaluate(() => globalThis.document.cookie === ""),
      "operator credentials are inaccessible to browser JavaScript",
    );
    assert(
      (await page.locator("[data-management-section]").count()) === 3,
      "default management entry exposes only artists, gifts and posters",
    );
    assert(
      observed.context?.defaults?.priceScope !== null &&
        observed.context?.defaults?.priceScope !== undefined,
      "actual configured TEST price scope exists",
    );
    assert(
      observed.context?.poster.available === true,
      "real initial homepage is available for poster replacement",
    );
    const scope = observed.context.defaults.priceScope;
    const suffix = randomUUID().slice(0, 8);
    const artistName = `测试艺人 ${suffix}`;
    const description = "本地测试资料：照片和原文通过同一管理入口发布。";
    const originalPoster = await currentPoster();
    report.cases.push({ name: step, status: "PASS" });

    step = "artist-validation-upload-retry-and-single-submit";
    await begin("ARTISTS");
    const beforeInvalid = observed.submits;
    await page.locator("[data-management-submit]").click();
    await expect(page.locator(field("image"))).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    assert(
      observed.submits === beforeInvalid,
      "incomplete form sends no business mutation",
    );
    await fillContent({
      name: artistName,
      description,
      image: sourceImages.artist,
    });
    await pictures(page, ".mc-photo-picker img");
    let failUpload = true;
    const uploadRoute = async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      if (failUpload) {
        failUpload = false;
        return route.abort("failed");
      }
      return route.continue();
    };
    const uploadUrl = (url) => url.origin !== adminOrigin;
    await context.route(uploadUrl, uploadRoute);
    await page.locator("[data-management-submit]").click();
    await page.locator("[data-management-error]").waitFor();
    assert(
      !failUpload && observed.submits === beforeInvalid,
      "failed actual signed PUT is visible and does not submit a publication",
    );
    await panel("zh-CN-1440-upload-error");
    await context.unroute(uploadUrl, uploadRoute);
    await page.locator(field("name")).fill(artistName);
    const artist = await operationAfter(
      () => page.locator("[data-management-submit]").click({ clickCount: 2 }),
      "SAVE_ARTIST",
    );
    await mediaProof(artist, sourceImages.artist, [
      "PORTRAIT",
      "HERO_DESKTOP",
      "HERO_MOBILE",
    ]);
    const artistItem = observed.lists
      .get("ARTISTS")
      .items.find((entry) => entry.id === artist.result.targetId);
    assert(
      artistItem?.name === artistName &&
        artistItem.description === description &&
        artistItem.sourceLocale === "zh-CN",
      "artist list preserves submitted original name, description and source language",
    );
    const artistImage = artistItem.image.url;
    const uploadCount = observed.putAttempts;
    await (await findItem("ARTISTS", artist.result.targetId)).click();
    await page.locator(field("description")).fill(`${description} 已更新。`);
    const editedArtist = await operationAfter(
      () => page.locator("[data-management-submit]").click(),
      "SAVE_ARTIST",
    );
    assert(
      editedArtist.result.targetId === artist.result.targetId &&
        observed.putAttempts === uploadCount,
      "editing artist text preserves identity without reuploading an image",
    );
    assert(
      observed.lists
        .get("ARTISTS")
        .items.find((entry) => entry.id === artist.result.targetId)?.image
        .url === artistImage,
      "artist text edit keeps the actual current photo",
    );
    report.cases.push({ name: step, status: "PASS" });

    step = "four-gift-types-and-real-price";
    const gifts = [];
    for (const [index, giftKind] of [
      "VIRTUAL",
      "PHYSICAL",
      "WISH",
      "MERCHANDISE",
    ].entries()) {
      await begin("GIFTS");
      const price = String(20 + index);
      await fillContent({
        name: `测试礼物 ${giftKind} ${suffix}`,
        description,
        image: sourceImages.gift,
        giftKind,
        price,
      });
      assert(
        (await page.locator(field("policy")).inputValue()) ===
          "PROCURE_ON_DEMAND",
        `${giftKind} defaults to repeatable on-demand sale`,
      );
      const result = await operationAfter(
        () => page.locator("[data-management-submit]").click(),
        "SAVE_GIFT",
      );
      await mediaProof(result, sourceImages.gift, ["GIFT_PRIMARY"]);
      const gift = observed.lists
        .get("GIFTS")
        .items.find((entry) => entry.id === result.result.targetId);
      const digits = new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency: scope.currency,
      }).resolvedOptions().maximumFractionDigits;
      assert(
        gift?.giftKind === giftKind &&
          gift.sourceLocale === "zh-CN" &&
          gift.price?.market === scope.market &&
          gift.price.currency === scope.currency &&
          gift.price.amountMinor === Number(price) * 10 ** digits,
        `${giftKind} list returns actual configured scope and exact entered price`,
      );
      assert(
        gift.inventory?.policy === "PROCURE_ON_DEMAND" &&
          gift.eligibility.rule === "ALL_ACTIVE_ARTISTS" &&
          gift.canEdit,
        `${giftKind} repeatable inventory and recipient rule are editable and honest`,
      );
      const rows = await client.query(
        "SELECT v.inventory_policy,(SELECT count(*)::integer FROM public.inventory_items i WHERE i.gift_variant_id=v.id) AS inventory_items FROM public.gift_variants v WHERE v.gift_id=$1 AND v.status='active'",
        [result.result.targetId],
      );
      assert(
        rows.rows.length === 1 &&
          rows.rows[0].inventory_policy === "PROCURE_ON_DEMAND" &&
          rows.rows[0].inventory_items === 0,
        `${giftKind} PG needs no pretend inventory row`,
      );
      gifts.push({ operation: result, item: gift });
    }
    const oldGift = gifts[0].item;
    await (await findItem("GIFTS", oldGift.id)).click();
    const giftUploads = observed.putAttempts;
    await page.locator(field("price")).fill("29");
    const editedGift = await operationAfter(
      () => page.locator("[data-management-submit]").click(),
      "SAVE_GIFT",
    );
    const currentGift = observed.lists
      .get("GIFTS")
      .items.find((entry) => entry.id === oldGift.id);
    const digits = new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: scope.currency,
    }).resolvedOptions().maximumFractionDigits;
    assert(
      editedGift.result.targetId === oldGift.id &&
        currentGift.price.amountMinor === 29 * 10 ** digits,
      "editing gift price publishes the new exact amount on the same gift",
    );
    assert(
      observed.putAttempts === giftUploads &&
        currentGift.image.url === oldGift.image.url &&
        currentGift.giftKind === oldGift.giftKind,
      "gift price edit preserves image and type without another upload",
    );
    gifts[0] = { operation: editedGift, item: currentGift };
    report.cases.push({ name: step, status: "PASS" });

    step = "poster-replacement-and-history-restore";
    const initialPublicImages = await homeImages();
    const posters = [];
    for (const [label, filename] of [
      ["A", sourceImages.posterA],
      ["B", sourceImages.posterB],
    ]) {
      await begin("POSTERS");
      await page.locator(field("image")).setInputFiles(filename);
      const started = globalThis.performance.now();
      const operation = await operationAfter(
        () => page.locator("[data-management-submit]").click(),
        "REPLACE_POSTER",
      );
      await mediaProof(operation, filename, ["HERO_DESKTOP", "HERO_MOBILE"]);
      const current = await currentPoster();
      assert(
        current.sourceRevisionId === operation.result.revisionId &&
          current.image.url !==
            (posters.at(-1)?.item.image.url ?? originalPoster.image.url),
        `poster ${label} current history has new actual image`,
      );
      const publicImages = await homeImages();
      const previousImages =
        posters.at(-1)?.publicImages ?? initialPublicImages;
      const visibility = posterVisibilityEvidence({
        operationKind: "REPLACE_POSTER",
        elapsedMs: globalThis.performance.now() - started,
        previousImages,
        publicImages,
      });
      report.posterVisibility.push(visibility);
      assert(
        visibility.pass,
        `poster ${label} changes both actual public desktop and mobile compositions within sixty seconds of submission`,
      );
      posters.push({ operation, item: current, publicImages });
    }
    const previous = await findItem("POSTERS", posters[0].item.id);
    assert(
      await previous.isEnabled(),
      "previous authorized poster offers a real restore action",
    );
    const restoreStarted = globalThis.performance.now();
    await operationAfter(() => previous.click(), "RESTORE_POSTER");
    const restored = await currentPoster();
    assert(
      restored.image.url === posters[0].item.image.url,
      "restored current history shows poster A's exact image",
    );
    const restoredImages = await homeImages();
    const restoreVisibility = posterVisibilityEvidence({
      operationKind: "RESTORE_POSTER",
      elapsedMs: globalThis.performance.now() - restoreStarted,
      previousImages: posters[1].publicImages,
      publicImages: restoredImages,
      expectedImages: posters[0].publicImages,
    });
    report.posterVisibility.push(restoreVisibility);
    assert(
      restoreVisibility.pass,
      "restoring poster A restores its exact public desktop and mobile image URLs within sixty seconds of submission",
    );
    report.cases.push({ name: step, status: "PASS" });

    step = "seven-language-admin-matrix";
    for (const locale of SUPPORTED_LOCALES) {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await navigate(locale);
        for (const sectionName of ["ARTISTS", "GIFTS", "POSTERS"]) {
          await section(sectionName);
          await pictures(page, "[data-management-list] .mc-item-photo img");
          await page.evaluate(() => globalThis.scrollTo(0, 0));
          await panel(
            `${locale}-${viewport.width}-${sectionName.toLowerCase()}-list`,
          );
          const choice =
            sectionName === "ARTISTS"
              ? artist.result.targetId
              : sectionName === "GIFTS"
                ? gifts[0].operation.result.targetId
                : null;
          if (choice) await (await findItem(sectionName, choice)).click();
          else await page.locator("[data-management-new]").click();
          await page.locator("[data-management-form]").waitFor();
          assert(
            (await page
              .locator("[data-management-form] input[type=file]")
              .count()) === 1 &&
              (await page
                .locator("[data-management-form] button[type=submit]")
                .count()) === 1,
            `${locale} ${sectionName} has one photo input and one main submit action`,
          );
          if (choice)
            assert(
              (await page.locator(field("sourceLocale")).inputValue()) ===
                "zh-CN",
              `${locale} editing original content preserves its declared source language`,
            );
          await panel(
            `${locale}-${viewport.width}-${sectionName.toLowerCase()}-form`,
          );
          await back();
        }
      }
    }
    report.cases.push({ name: step, status: "PASS" });

    step = "keyboard-reduced-motion-and-list-error";
    await page.setViewportSize({ width: 390, height: 844 });
    await navigate();
    await tabTo('[data-management-section="GIFTS"]');
    await page.keyboard.press("Enter");
    await page.locator('[data-management-list="GIFTS"]').waitFor();
    await tabTo("[data-management-new]");
    await page.keyboard.press("Enter");
    await page.locator("[data-management-form]").waitFor();
    await tabTo(field("image"));
    assert(
      await page.evaluate(
        () => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      "real browser reduced-motion preference is active",
    );
    assert(
      await page
        .locator("[data-management-editor]")
        .evaluate(
          (node) => globalThis.getComputedStyle(node).animationName === "none",
        ),
      "editor entrance motion is removed under reduced motion",
    );
    await back();
    const failList = (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "MANAGEMENT_UNAVAILABLE",
        }),
      });
    await context.route(`${adminOrigin}/api/admin/management-list`, failList);
    await page.locator('[data-management-section="ARTISTS"]').click();
    await page.locator(".mc-error-state").waitFor();
    await panel("zh-CN-390-list-error");
    await context.unroute(`${adminOrigin}/api/admin/management-list`, failList);
    await page.locator(".mc-error-state button").click();
    await page.locator('[data-management-list="ARTISTS"]').waitFor();
    await settledResponses();
    report.cases.push({ name: step, status: "PASS" });

    step = "public-original-content-and-photo-provenance";
    for (const locale of SUPPORTED_LOCALES) {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await publicPage.setViewportSize(viewport);
        for (const [kind, handle, title, selector, gift] of [
          [
            "idols",
            artist.result.handle,
            artistName,
            ".storefront-artist-hero img",
          ],
          ...gifts.map(({ operation, item }) => [
            "gifts",
            operation.result.handle,
            item.name,
            ".gift-detail img",
            item,
          ]),
        ]) {
          publicCheck = {
            locale,
            kind,
            viewport,
            stage: "HTTP",
            httpStatus: null,
          };
          const url = new globalThis.URL(
            `/${locale}/${kind}/${handle}`,
            storefrontOrigin,
          );
          if (kind === "gifts") {
            url.searchParams.set("market", scope.market);
            url.searchParams.set("currency", scope.currency);
            url.searchParams.set("idol", artist.result.targetId);
          }
          const response = await publicPage.goto(url.href, {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
          });
          publicCheck.httpStatus = response?.status() ?? null;
          assert(
            response?.status() === 200,
            `${locale} ${kind} created through management is public HTTP 200`,
          );
          publicCheck.stage = "TITLE";
          await expect(publicPage.locator("h1")).toHaveText(title, {
            timeout: 45_000,
          });
          publicCheck.stage = "LANGUAGE";
          await expect(publicPage.locator("h1")).toHaveAttribute(
            "lang",
            "zh-CN",
          );
          publicCheck.stage = "IMAGE";
          await pictures(publicPage, selector);
          if (gift) {
            publicCheck.stage = "IDENTITY";
            await expect(
              publicPage.locator("[data-gift-detail]"),
            ).toHaveAttribute("data-gift-detail", gift.id);
            const offer = publicPage.locator("[data-gift-offer]");
            publicCheck.stage = "AVAILABILITY";
            await expect(offer).toHaveAttribute(
              "data-availability",
              "AVAILABLE",
            );
            publicCheck.stage = "INVENTORY_POLICY";
            await expect(offer).toHaveAttribute(
              "data-inventory-policy",
              "PROCURE_ON_DEMAND",
            );
            publicCheck.stage = "PRICE";
            const price = offer.locator(".gift-detail-price data");
            await expect(price).toHaveAttribute(
              "value",
              String(gift.price.amountMinor),
            );
            await expect(price).toHaveAttribute(
              "data-currency",
              gift.price.currency,
            );
            publicCheck.stage = "MARKET";
            await expect(
              publicPage.locator(".gift-option-heading p"),
            ).toHaveText(`${gift.price.currency} · ${gift.price.market}`);
            publicCheck.stage = "RECIPIENT";
            await expect(
              publicPage.locator(
                `[data-selected-recipient="${artist.result.targetId}"] a`,
              ),
            ).toHaveText(artistName);
            publicCheck.stage = "QUANTITY";
            const quantity = offer.getByRole("spinbutton");
            await expect(quantity).toBeEnabled();
            await expect(quantity).toHaveAttribute("aria-valuemin", "1");
            await expect(quantity).toHaveAttribute(
              "aria-valuemax",
              String(CART_RUNTIME_MAX_QUANTITY),
            );
            await quantity.press("End");
            await expect(quantity).toHaveValue(
              String(CART_RUNTIME_MAX_QUANTITY),
            );
            await expect(
              offer.locator('[data-quantity-action="increase"]'),
            ).toBeDisabled();
            await quantity.press("ArrowUp");
            await expect(quantity).toHaveValue(
              String(CART_RUNTIME_MAX_QUANTITY),
            );
            await quantity.press("Home");
            await expect(quantity).toHaveValue("1");
            await expect(
              offer.locator('[data-quantity-action="decrease"]'),
            ).toBeDisabled();
            assert(
              (await offer.locator("[data-stock-remaining]").count()) === 0,
              `${locale} ${gift.giftKind} on-demand offer does not claim fabricated stock`,
            );
            publicCheck.stage = "PURCHASE_ENTRY";
            const addForm = offer.locator("form[data-cart-add]");
            await expect(addForm).toHaveCount(1);
            await expect(
              addForm.locator('button[type="submit"]'),
            ).toBeEnabled();
            await expect(
              addForm.locator('button[type="submit"]'),
            ).toHaveAttribute("data-cart-add-state", "idle");
            await expect(
              addForm.locator("[data-cart-personalization]"),
            ).toBeEnabled();
            await expect(
              addForm.locator('input[type="radio"]').first(),
            ).toBeChecked();
            await expect(addForm.locator("[data-cart-name]")).toHaveCount(0);
            await expect(addForm.locator("[data-cart-message]")).toHaveValue(
              "",
            );
            await expect(
              addForm.locator("[data-cart-message-locale]"),
            ).toHaveValue(locale);
            await expect(
              publicPage.locator("[data-checkout-unavailable]"),
            ).toHaveCount(0);
            assert(
              (await addForm.locator('a[href*="/checkout"]').count()) === 0,
              `${locale} ${gift.giftKind} offers cart entry without bypassing cart validation`,
            );
            publicCheck.stage = "CONTENT";
            // L2-17: the description is read under the gift's name; there is no details section.
            await expect(
              publicPage.locator(
                ".gift-detail-summary .gift-short-description",
              ),
            ).toContainText(description);
            await expect(
              publicPage.locator(".gift-detail-information"),
            ).toHaveCount(0);
          } else {
            publicCheck.stage = "CONTENT";
            const artistDescription = publicPage.locator(
              ".storefront-artist-hero p[data-artist-description]",
            );
            await expect(artistDescription).toHaveCount(1);
            await expect(artistDescription).toHaveAttribute("lang", "zh-CN");
            const toggle = publicPage.locator(
              "[data-artist-description-toggle]",
            );
            await publicPage.evaluate(async () => {
              await globalThis.document.fonts.ready;
              await new Promise((resolve) =>
                globalThis.requestAnimationFrame(() =>
                  globalThis.requestAnimationFrame(resolve),
                ),
              );
            });
            const overflows = await artistDescription.evaluate((element) => {
              const lineHeight = Number.parseFloat(
                globalThis.getComputedStyle(element).lineHeight,
              );
              if (!Number.isFinite(lineHeight) || lineHeight <= 0)
                throw new Error(
                  "Artist description has no measurable line height",
                );
              return element.scrollHeight > lineHeight + 1;
            });
            if (overflows) {
              await expect(toggle).toBeVisible();
              await expect(toggle).toHaveAttribute("aria-expanded", "false");
              await toggle.click();
              await expect(toggle).toHaveAttribute("aria-expanded", "true");
            } else await expect(toggle).toHaveCount(0);
            await expect
              .poll(() =>
                artistDescription.evaluate(
                  (element) => element.clientHeight + 1 >= element.scrollHeight,
                ),
              )
              .toBe(true);
            await expect(artistDescription).toHaveText(
              `${description} 已更新。`,
            );
            await expect(publicPage.locator(".storefront-story")).toHaveCount(
              0,
            );
          }
          publicCheck.stage = "ROBOTS";
          const robots = await publicPage
            .locator('meta[name="robots"]')
            .getAttribute("content");
          if (locale !== "zh-CN")
            assert(
              robots?.includes("noindex"),
              `${locale} original Chinese content is honestly noindex before translation approval`,
            );
          report.publicPages.push({
            locale,
            kind,
            width: viewport.width,
            status: response.status(),
            sourceLocale: "zh-CN",
            ...(gift
              ? {
                  giftKind: gift.giftKind,
                  amountMinor: gift.price.amountMinor,
                  market: gift.price.market,
                  currency: gift.price.currency,
                  recipientId: artist.result.targetId,
                  availability: "AVAILABLE",
                  inventoryPolicy: "PROCURE_ON_DEMAND",
                  quantityCeiling: CART_RUNTIME_MAX_QUANTITY,
                  purchaseEntry: "ADD_TO_CART_FORM",
                  commerceTransactionVerified: false,
                }
              : { originalDescriptionUpdated: true }),
          });
          if (locale === "zh-CN")
            await panel(
              `${locale}-${viewport.width}-public-${kind}${gift ? `-${gift.giftKind.toLowerCase()}` : ""}`,
              publicPage,
            );
        }
        if (locale === "zh-CN") {
          await homeImages();
          publicCheck = {
            locale,
            kind: "homepage",
            viewport,
            stage: "LAYOUT",
            httpStatus: 200,
          };
          await panel(
            `${locale}-${viewport.width}-public-poster-restored`,
            publicPage,
          );
        }
      }
    }
    if (publicCheck) publicCheck.stage = "SESSION";
    assert(
      (await publicContext.cookies()).length === 0,
      "public customer pages require no operator session",
    );
    if (publicCheck) publicCheck.stage = "RESPONSE_OBSERVATION";
    await settledResponses();
    assert(
      report.observationFailures.length === 0,
      "all successful management BFF responses finish observation with valid bodies and schemas",
    );
    if (publicCheck) publicCheck.stage = "RUNTIME_ERRORS";
    assert(
      report.pageErrors.length === 0,
      "all management and public pages have no JavaScript runtime errors",
    );
    publicCheck = null;
    report.cases.push({ name: step, status: "PASS" });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      step,
      name: error?.name ?? "Error",
      ...(publicCheck ? { publicPage: { ...publicCheck } } : {}),
      detail:
        "Failure message omitted; inspect safe phase and last recorded assertions",
    };
    if (publicCheck)
      report.failure.publicPage.rendered = await publicPage
        .evaluate(() => ({
          headingCount: globalThis.document.querySelectorAll("h1").length,
          artistDetailPresent: Boolean(
            globalThis.document.querySelector(".storefront-artist-hero"),
          ),
          giftDetailPresent: Boolean(
            globalThis.document.querySelector("[data-gift-detail]"),
          ),
          routeStatePresent: Boolean(
            globalThis.document.querySelector(".storefront-state"),
          ),
          imageCount: globalThis.document.querySelectorAll("img").length,
        }))
        .catch(() => ({ unavailable: true }));
    const filename = publicCheck
      ? "failure-public-screen.png"
      : "failure-current-screen.png";
    const failurePage = publicCheck ? publicPage : page;
    await failurePage
      .screenshot({ path: path.join(directory, filename), fullPage: true })
      .then(() => report.screenshots.push(filename))
      .catch(() => {});
    throw error;
  } finally {
    try {
      await settledResponses();
    } catch {
      report.observationFailures.push({ stage: "DRAIN", code: "DRAIN_FAILED" });
    }
    try {
      observer.dispose();
    } catch {
      report.observationFailures.push({
        stage: "DRAIN",
        code: "UNSETTLED_AT_CLOSE",
      });
    }
    lateObservationFailure =
      report.status === "PASS" && report.observationFailures.length > 0;
    if (lateObservationFailure) {
      report.status = "FAIL";
      report.failure = {
        step: "final-response-observation",
        name: "ObservationFailure",
        detail: "Inspect safe observation failure stages",
      };
    }
    report.finishedAt = new Date().toISOString();
    report.counts = {
      cases: report.cases.length,
      screenshots: report.screenshots.length,
      axe: report.axe.length,
      incompleteRules: report.axe.reduce(
        (total, result) => total + result.incomplete.length,
        0,
      ),
      violations: report.axe.reduce(
        (total, result) => total + result.violations.length,
        0,
      ),
      observationFailures: report.observationFailures.length,
    };
    await browser.close();
    report.browserClosed = true;
    await writeFile(
      path.join(directory, "results.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  if (lateObservationFailure)
    throw new Error("MANAGEMENT_FINAL_OBSERVATION_FAILED");
  return { directory, ...report };
}

import { createHash, X509Certificate, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createWorkspaceImage } from "./admin-workspace-fixtures.mjs";

/** Credentials and signed capabilities stay in isolated browser/process memory; traces and HAR are disabled. */
export async function verifyAdminWorkspaceBrowser({
  origin,
  credentials,
  fixtures,
  check,
  configPath,
  serve,
  ui,
}) {
  let step;
  const previewResponses = [];
  const accessibility = {
    schemaVersion: 1,
    status: "PENDING",
    environment: "Next development server",
    reducedMotion: "reduce",
    axe: [],
    keyboard: [],
    reflow: [],
    identity: null,
  };
  const accessibilityPath = fileURLToPath(
    new URL(
      "../../../output/playwright/p3-02-admin/accessibility.json",
      import.meta.url,
    ),
  );
  async function scanAccessibility(page, screen) {
    // Resolve the repository's declared development tool through its public package entry.
    const requireFromRoot = createRequire(
      new URL("../../../package.json", import.meta.url),
    );
    const { default: AxeBuilder } = requireFromRoot("@axe-core/playwright");
    const result = await new AxeBuilder({ page }).analyze();
    if (screen === "editor") {
      check(
        (await page.locator(".admin-locale-matrix").getAttribute("role")) ===
          "group",
        "translation matrix exposes its actual named group semantics",
      );
      check(
        !result.incomplete.some(
          (rule) =>
            rule.id === "aria-prohibited-attr" &&
            rule.nodes.some((node) =>
              node.target.flat().includes(".admin-locale-matrix"),
            ),
        ),
        "translation matrix no longer has the prior aria-prohibited-attr incomplete result",
      );
    }
    const violations = result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodeCount: nodes.length,
    }));
    accessibility.axe.push({
      screen,
      engineVersion: result.testEngine.version,
      passes: result.passes.length,
      incomplete: result.incomplete.length,
      incompleteRules: result.incomplete.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map((node) =>
          node.target
            .flat()
            .map((selector) =>
              typeof selector === "string" &&
              selector.length <= 512 &&
              /^[a-zA-Z0-9_#.:>\s,+~()\\-]+$/u.test(selector) &&
              !/(token|csrf|session|blob|https?|x-amz)/iu.test(selector)
                ? selector
                : "SELECTOR_OMITTED",
            ),
        ),
      })),
      violations,
    });
    check(
      !violations.some(
        ({ impact }) => impact === "critical" || impact === "serious",
      ),
      `${screen} axe has no critical or serious violations`,
    );
  }
  async function verifyReflow(page, screen, width, height) {
    const previous = page.viewportSize();
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => {
      await globalThis.document.fonts.ready;
      await new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      );
    });
    const measurement = await page.evaluate(() => ({
      viewportWidth: globalThis.innerWidth,
      viewportHeight: globalThis.innerHeight,
      documentWidth: globalThis.document.documentElement.scrollWidth,
      bodyWidth: globalThis.document.body.scrollWidth,
      locale: globalThis.document.documentElement.lang,
    }));
    accessibility.reflow.push({
      screen,
      ...measurement,
      method:
        width === 720
          ? "equivalent 200% reflow: 1440x900 CSS viewport reduced to 720x450; no native browser zoom"
          : "320 CSS pixel narrow viewport",
      nativeBrowserZoom: false,
    });
    check(
      measurement.viewportWidth === width &&
        measurement.documentWidth <= width + 1 &&
        measurement.bodyWidth <= width + 1,
      `${screen} fits ${width} CSS pixels without horizontal overflow`,
    );
    await page.setViewportSize(previous);
  }
  async function tabTo(page, locator, screen) {
    let reached = false;
    for (let attempts = 0; attempts < 80; attempts++) {
      await page.keyboard.press("Tab");
      reached = await locator.evaluate(
        (element) => element === globalThis.document.activeElement,
      );
      if (reached) break;
    }
    const focus = reached
      ? await locator.evaluate((element) => {
          const style = globalThis.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            visible: element.matches(":focus-visible"),
            outlineWidth: Number.parseFloat(style.outlineWidth),
            outlineStyle: style.outlineStyle,
            inViewport:
              rect.right > 0 &&
              rect.left < globalThis.innerWidth &&
              rect.bottom > 0 &&
              rect.top < globalThis.innerHeight,
          };
        })
      : null;
    accessibility.keyboard.push({ screen, reached, focus });
    check(
      reached &&
        focus?.visible &&
        focus.outlineWidth > 0 &&
        focus.outlineStyle !== "none" &&
        focus.inViewport,
      `${screen} is reachable by Tab with visible focus`,
    );
  }
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
  try {
    step = "contexts";
    const contexts = {};
    for (const actor of ["editor", "reviewer", "manager", "denied"]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      });
      contexts[actor] = context;
      context.on("response", (response) => {
        const url = new URL(response.url());
        const operation = url.pathname.slice("/api/admin/".length);
        if (
          url.origin !== origin ||
          ![
            "preview-issue",
            "preview-content-read",
            "preview-media-read",
            "preview-revoke",
          ].includes(operation)
        )
          return;
        void response
          .json()
          .then((body) => {
            previewResponses.push({
              operation,
              status: response.status(),
              code:
                typeof body?.code === "string" && /^[A-Z_]+$/u.test(body.code)
                  ? body.code
                  : null,
              ...(operation === "preview-media-read" &&
              Array.isArray(body?.images)
                ? {
                    images: body.images.map((image) => ({
                      status:
                        image.status === "AVAILABLE"
                          ? "AVAILABLE"
                          : "UNAVAILABLE",
                      code:
                        typeof image.code === "string" &&
                        /^[A-Z_]+$/u.test(image.code)
                          ? image.code
                          : null,
                    })),
                  }
                : {}),
            });
          })
          .catch(() =>
            previewResponses.push({
              operation,
              status: response.status(),
              code: "INVALID_JSON",
            }),
          );
      });
      await context.addCookies([
        {
          name: "__Host-fan-admin-session",
          value: credentials[actor].token,
          domain: "localhost",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Strict",
        },
        {
          name: "__Host-fan-admin-csrf",
          value: credentials[actor].csrf,
          domain: "localhost",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
    }
    step = "navigation";
    const page = await contexts.editor.newPage();
    await page.goto(`${origin}/en`);
    const cookieProperties = await contexts.editor.cookies(origin);
    check(
      cookieProperties.length === 2 &&
        cookieProperties.every(
          (cookie) =>
            cookie.secure &&
            cookie.httpOnly &&
            cookie.sameSite === "Strict" &&
            cookie.path === "/",
        ),
      "real Chrome retains both Secure HttpOnly Host cookies on localhost",
    );
    check(
      await page.evaluate(() => globalThis.document.cookie === ""),
      "globalThis.document.cookie cannot read either credential",
    );
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
    step = "bootstrap";
    const session = await page.evaluate(async () => {
      const response = await globalThis.fetch("/api/admin/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const value = await response.json();
      return {
        status: response.status,
        kind: value.kind,
        permissions: value.permissions,
        hasCsrf: typeof value.csrfToken === "string",
        keys: Object.keys(value),
        private: (response.headers.get("cache-control") ?? "").includes(
          "no-store",
        ),
      };
    });
    if (session.status !== 200 || !session.hasCsrf || !session.private)
      console.error(
        `Workspace bootstrap diagnostic ${JSON.stringify({ status: session.status, kind: session.kind ?? null, hasCsrf: session.hasCsrf, private: session.private })}`,
      );
    check(
      session.status === 200 &&
        session.hasCsrf &&
        session.private &&
        session.kind === "ADMIN_SESSION",
      "real same-origin bootstrap supplies memory-only CSRF",
    );
    check(
      !session.keys.includes("sessionToken") &&
        !session.permissions.includes("content.publish"),
      "editor bootstrap exposes canonical limited capabilities",
    );
    step = "catalog";
    const listing = await call(page, "catalog-list", {
      schemaVersion: 1,
      kind: "IDOL",
      locale: "en",
      page: 1,
      pageSize: 10,
    });
    check(
      listing.status === 200 &&
        listing.body.items.length === 10 &&
        listing.body.totalItems === 14 &&
        listing.private,
      "real Next BFF lists current private catalog with pagination",
    );
    const second = await call(page, "catalog-list", {
      schemaVersion: 1,
      kind: "IDOL",
      locale: "en",
      page: 2,
      pageSize: 10,
    });
    check(
      second.status === 200 && second.body.items.length === 4,
      "private catalog second page is reachable",
    );
    const search = await call(page, "catalog-list", {
      schemaVersion: 1,
      kind: "IDOL",
      locale: "ja",
      q: "luna",
      page: 1,
      pageSize: 10,
    });
    check(
      search.status === 200 && search.body.totalItems === 1,
      "private catalog search resolves translated current drafts",
    );
    const changed = await call(
      page,
      "catalog-list",
      { schemaVersion: 1, kind: "IDOL", locale: "en", page: 1, pageSize: 10 },
      { headers: { "x-csrf-token": "x".repeat(42) + "A" } },
    );
    check(
      changed.status === 403 && changed.body.code === "CSRF_INVALID",
      "BFF rejects a changed CSRF token",
    );
    const denied = await contexts.denied.newPage();
    await denied.goto(`${origin}/en`);
    const forbidden = await call(denied, "catalog-list", {
      schemaVersion: 1,
      kind: "IDOL",
      locale: "en",
      page: 1,
      pageSize: 10,
    });
    check(
      forbidden.status === 403 && forbidden.body.code === "FORBIDDEN",
      "current no-permission identity cannot use discovery",
    );
    const target = { ...fixtures.idol, locale: "ja" };
    delete target.publishedRevisionId;
    step = "workspace";
    const workspace = await call(page, "translation-read", {
      schemaVersion: 1,
      target,
    });
    check(
      workspace.status === 200 &&
        workspace.body.kind === "TRANSLATION_WORKSPACE",
      "browser receives actual seven-language workspace",
    );
    step = "export";
    const exportResult = await call(
      page,
      "translation-export",
      {
        schemaVersion: 1,
        target: { owner: target.owner, revisionId: target.revisionId },
        locales: ["ja"],
        reasonCode: "BROWSER_EXPORT",
      },
      { mutation: true },
    );
    check(
      exportResult.status === 200 &&
        exportResult.body.kind === "TRANSLATION_EXPORT",
      "browser exports an audited translation package",
    );
    step = "upload";
    const image = await createWorkspaceImage(1600, 2000, 140),
      checksum = createHash("sha256").update(image).digest("hex");
    const grantResult = await call(
      page,
      "media-upload-begin",
      {
        schemaVersion: 1,
        checksumSha256: checksum,
        byteSize: image.length,
        mimeType: "image/jpeg",
        rightsReference: "rights:browser-original-fixture",
        expectedVersion: 0,
        reasonCode: "BROWSER_UPLOAD",
      },
      { mutation: true },
    );
    check(
      grantResult.status === 200 && grantResult.body.kind === "UPLOAD_GRANT",
      "real browser BFF issues a scoped upload capability",
    );
    const grant = grantResult.body.grant,
      network = await contexts.editor.newCDPSession(page),
      methods = new Map(),
      statuses = [];
    await network.send("Network.enable");
    network.on("Network.requestWillBeSent", (event) => {
      if (
        event.request.url === grant.url &&
        ["OPTIONS", "PUT"].includes(event.request.method)
      )
        methods.set(event.requestId, event.request.method);
    });
    network.on("Network.responseReceived", (event) => {
      const method = methods.get(event.requestId);
      if (method) statuses.push({ method, status: event.response.status });
    });
    const uploaded = await page.evaluate(
      async ({ grant, bytes }) => {
        try {
          const response = await globalThis.fetch(grant.url, {
            method: "PUT",
            headers: grant.headers,
            body: new Uint8Array(bytes),
            credentials: "omit",
            redirect: "error",
          });
          await response.arrayBuffer();
          return response.status;
        } catch {
          return 0;
        }
      },
      { grant, bytes: Array.from(image) },
    );
    await network.send("Runtime.evaluate", { expression: "true" });
    check(
      uploaded === 200 &&
        [...methods.values()].includes("OPTIONS") &&
        statuses.some(
          (value) => value.method === "PUT" && value.status === 200,
        ),
      "actual Next origin performs automatic CORS OPTIONS then TLS PUT",
    );
    await network.detach();
    const complete = await call(
      page,
      "media-upload-complete",
      {
        schemaVersion: 1,
        uploadId: grantResult.body.uploadId,
        expectedVersion: 1,
        reasonCode: "BROWSER_UPLOAD",
      },
      { mutation: true },
    );
    check(
      complete.status === 200 && complete.body.kind === "MUTATION",
      "browser completes actual uploaded image inspection",
    );
    check(
      await page.evaluate(
        () =>
          globalThis.localStorage.length === 0 &&
          globalThis.sessionStorage.length === 0,
      ),
      "browser credentials never enter persistent web storage",
    );
    const html = await page.content();
    check(
      !Object.values(credentials).some(
        (value) => html.includes(value.token) || html.includes(value.csrf),
      ),
      "credentials do not appear in HTML or serialized RSC",
    );
    if (!serve && !ui) {
      await browser.close();
      return { close: async () => undefined };
    }
    step = "seven-language layout";
    const screenshotRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../output/playwright/p3-02-admin",
    );
    await mkdir(screenshotRoot, { recursive: true });
    if (serve) {
      await page.goto(`${origin}/en`);
      await page.getByTestId("content-directory").waitFor();
      await page.bringToFront();
      await page.screenshot({
        path: path.join(screenshotRoot, "serve-desktop.png"),
        fullPage: true,
      });
      return { close: () => browser.close() };
    }
    for (const locale of SUPPORTED_LOCALES) {
      for (const [label, width, height] of [
        ["desktop", 1440, 900],
        ["mobile", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await page.goto(`${origin}/${locale}`);
        await page.getByTestId("content-directory").waitFor();
        await page.waitForFunction(
          () =>
            globalThis.document
              .querySelector('[data-testid="content-directory"]')
              ?.getAttribute("aria-busy") === "false",
        );
        check(
          await page.evaluate(
            ({ locale, width }) =>
              globalThis.document.documentElement.lang === locale &&
              globalThis.document.documentElement.scrollWidth <= width + 1,
            { locale, width },
          ),
          "seven-language admin layout uses correct SSR lang and fits the viewport",
        );
        await page.screenshot({
          path: path.join(screenshotRoot, `${locale}-${label}.png`),
          fullPage: true,
        });
      }
    }
    step = "directory accessibility and keyboard";
    await verifyReflow(page, "Portuguese directory", 320, 844);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/en`);
    await page.getByTestId("content-directory").waitFor();
    await page.waitForFunction(
      () =>
        globalThis.document
          .querySelector('[data-testid="content-directory"]')
          ?.getAttribute("aria-busy") === "false",
    );
    check(
      await page.evaluate(
        () => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      "real admin browser retains reduced motion preference",
    );
    await scanAccessibility(page, "directory");
    await verifyReflow(page, "directory", 720, 450);
    const searchInput = page.getByLabel("Search by name or handle", {
      exact: true,
    });
    await tabTo(page, searchInput, "directory search");
    await page.keyboard.type("Luna");
    const searched = page.waitForResponse(
      (response) => response.url() === `${origin}/api/admin/catalog-list`,
    );
    await page.keyboard.press("Enter");
    check(
      (await searched).status() === 200,
      "keyboard Enter submits catalog search",
    );
    const artistButton = page
      .getByTestId("content-directory")
      .getByRole("button", { name: /Luna Mira/ });
    await artistButton.waitFor();
    await tabTo(page, artistButton, "directory artist record");
    await page.keyboard.press("Enter");
    await page
      .getByRole("textbox", { name: /^Short biography/ })
      .first()
      .waitFor();
    await page.screenshot({
      path: path.join(screenshotRoot, "en-editor.png"),
      fullPage: true,
    });
    step = "editor accessibility and keyboard";
    await scanAccessibility(page, "editor");
    await verifyReflow(page, "editor", 320, 844);
    await verifyReflow(page, "editor", 720, 450);
    await tabTo(
      page,
      page.getByRole("textbox", { name: /^Short biography/ }).first(),
      "editor biography",
    );
    step = "actual scoped preview";
    await tabTo(
      page,
      page.getByRole("link", { name: "Desktop preview", exact: true }),
      "editor preview link",
    );
    const previewPromise = page.waitForEvent("popup");
    await page.keyboard.press("Enter");
    const preview = await previewPromise;
    await preview
      .locator(".admin-preview-content img")
      .first()
      .waitFor({ timeout: 30_000 });
    check(
      await preview
        .locator(".admin-preview-content img")
        .evaluateAll(
          (images) =>
            images.length === 3 &&
            images.every(
              (image) =>
                image.complete &&
                image.naturalWidth > 0 &&
                image.src.startsWith("blob:"),
            ),
        ),
      "actual scoped preview loads three private derivative blobs",
    );
    check(
      !preview.url().includes("token") && !preview.url().includes("csrf"),
      "preview navigation carries no credentials",
    );
    await preview.screenshot({
      path: path.join(screenshotRoot, "en-preview-desktop.png"),
      fullPage: true,
    });
    step = "preview accessibility and keyboard";
    await scanAccessibility(preview, "preview");
    await verifyReflow(preview, "preview", 320, 844);
    await verifyReflow(preview, "preview", 720, 450);
    await tabTo(
      preview,
      preview.getByRole("button", { name: "End preview", exact: true }),
      "preview end button",
    );
    await preview.keyboard.press("Enter");
    await preview.waitForFunction(
      () =>
        globalThis.document.querySelectorAll(".admin-preview-content img")
          .length === 0,
    );
    check(
      (await preview.locator(".admin-preview-content img").count()) === 0,
      "keyboard ends the preview and removes private images",
    );
    await preview.close();
    step = "real editor save";
    await page
      .getByRole("textbox", { name: /^Short biography/ })
      .first()
      .fill("A new chapter, carefully prepared for every supporter.");
    await page.getByText("Unsaved changes", { exact: true }).waitFor();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "← Artists", exact: true }).click();
    check(
      await page.getByTestId("content-editor").isVisible(),
      "canceling dirty navigation retains the editor",
    );
    const savedResponse = page.waitForResponse(
      (response) => response.url() === `${origin}/api/admin/authoring-copy`,
    );
    await page
      .getByRole("button", { name: "Save new revision", exact: true })
      .click();
    check(
      (await savedResponse).status() === 200,
      "actual editor saves a new canonical immutable revision",
    );
    await page
      .getByText("Unsaved changes", { exact: true })
      .waitFor({ state: "hidden" });
    check(
      (await page
        .getByRole("textbox", { name: /^Short biography/ })
        .first()
        .inputValue()) ===
        "A new chapter, carefully prepared for every supporter.",
      "saved canonical revision retains the edited text",
    );
    const submittedResponse = page.waitForResponse(
      (response) => response.url() === `${origin}/api/admin/review-submit`,
    );
    await page
      .getByRole("button", { name: "Submit for review", exact: true })
      .last()
      .click();
    check(
      (await submittedResponse).status() === 200,
      "actual editor submits English for independent review",
    );
    check(
      await page
        .getByRole("button", { name: "Approve translation", exact: true })
        .isDisabled(),
      "editor cannot approve own translation in the actual UI",
    );
    const reviewPage = await contexts.reviewer.newPage();
    await reviewPage.goto(`${origin}/en`);
    await reviewPage
      .getByLabel("Search by name or handle", { exact: true })
      .fill("Luna");
    await reviewPage
      .getByRole("button", { name: "Search", exact: true })
      .click();
    await reviewPage
      .getByTestId("content-directory")
      .getByRole("button", { name: /Luna Mira/ })
      .click();
    const approvedResponse = reviewPage.waitForResponse(
      (response) => response.url() === `${origin}/api/admin/review-approve`,
    );
    await reviewPage
      .getByRole("button", { name: "Approve translation", exact: true })
      .click();
    check(
      (await approvedResponse).status() === 200,
      "independent reviewer approves through the actual UI",
    );
    await reviewPage.screenshot({
      path: path.join(screenshotRoot, "en-reviewer.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Check publication readiness", exact: true })
      .click();
    await page
      .getByText("Publication needs attention", { exact: true })
      .waitFor();
    check(
      (await page
        .locator(".admin-locale-matrix")
        .getByText("Source changed", { exact: true })
        .count()) === 6,
      "English edit exposes six stale translations before publication",
    );
    await page.screenshot({
      path: path.join(screenshotRoot, "en-source-changed.png"),
      fullPage: true,
    });
    step = "independent identity edits survive refresh";
    await page
      .locator("summary")
      .filter({ hasText: /^Status$/ })
      .click();
    const accepting = page.getByRole("checkbox", {
      name: "Accept gifts",
      exact: true,
    });
    const initialAccepting = await accepting.isChecked();
    check(initialAccepting, "published fixture initially accepts gifts");
    await accepting.setChecked(!initialAccepting);
    const handle = page.getByRole("textbox", {
      name: "URL handle",
      exact: true,
    });
    await handle.fill("luna-mira-reframed");
    const renamed = page.waitForResponse(
      (response) => response.url() === `${origin}/api/admin/idol-rename`,
    );
    const refreshedOwner = page.waitForResponse(
      (response) => response.url() === `${origin}/api/admin/catalog-owner`,
    );
    await page
      .getByRole("button", { name: "Update handle", exact: true })
      .click();
    check(
      (await renamed).status() === 200,
      "actual identity form updates only the submitted handle",
    );
    check(
      (await refreshedOwner).status() === 200,
      "identity form reads the canonical owner after rename",
    );
    await page.waitForFunction(
      () =>
        globalThis.document
          .querySelector('[data-testid="content-editor"]')
          ?.getAttribute("aria-busy") === "false",
    );
    const retained = (await accepting.isChecked()) === !initialAccepting;
    check(
      retained && (await handle.inputValue()) === "luna-mira-reframed",
      "unsubmitted accepting-gifts edit survives canonical rename refresh",
    );
    accessibility.identity = {
      renameSucceeded: true,
      independentCheckboxRetained: retained,
    };
    accessibility.status = "PASS";
    await browser.close();
    return { close: async () => undefined };
  } catch (error) {
    accessibility.status = "FAIL";
    accessibility.failedStep = step;
    const line =
      typeof error?.stack === "string"
        ? error.stack.match(/admin-workspace-browser\.mjs:(\d+):\d+/u)?.[1]
        : undefined;
    console.error(
      `Workspace browser diagnostic ${JSON.stringify({ previewResponses, step, line: line ?? null, name: ["Error", "TypeError", "TimeoutError"].includes(error?.name) ? error.name : "UNAVAILABLE" })}`,
    );
    await browser.close();
    throw error;
  } finally {
    if (ui && !serve)
      await writeFile(
        accessibilityPath,
        JSON.stringify(accessibility, null, 2) + "\n",
      );
  }
}

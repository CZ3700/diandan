import { URL } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { createStructuredLogger } from "@fan-support/observability";
import { createDeliveryProofProcessor } from "@fan-support/media-image";
import { createS3MediaStorageAdapter } from "@fan-support/media-s3";
import {
  createAdminCatalogUseCases,
  createManagementCenterUseCases,
} from "@fan-support/application";
import { createApiApplication } from "../dist/bootstrap.js";
import {
  createLocalOidcAdminAccessComposition,
  createLocalAdminOrdersComposition,
} from "../dist/testing/index.js";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { seedAdminOrdersRoles } from "./admin-orders-fixtures.mjs";
import {
  reserveAdminAccessOrigin,
  startAdminAccessNext,
} from "./admin-access-next.mjs";
import { startTestOidcProvider } from "../../../packages/identity-oidc/src/test-support/https-idp.mjs";

/** Owned TLS OIDC and actual API; sessions are issued through the implemented access endpoints. */
export async function createAdminOrdersRuntime(context, options = {}) {
  const { database, client, check, own, persistence } = context,
    logs = [],
    secrets = new Set();
  const registerSecret = (value) => {
    if (typeof value === "string" && value) secrets.add(value);
  };
  const tokenPepper = randomBytes(32).toString("hex"),
    subjectPepper = randomBytes(32).toString("hex"),
    accessKey = randomBytes(32).toString("hex");
  [tokenPepper, subjectPepper, accessKey].forEach(registerSecret);
  const adminOrigin = await reserveAdminAccessOrigin();
  const idp = await startTestOidcProvider({
    redirectOrigins: [adminOrigin],
    acr: "urn:fixture:mfa",
    ...(options.beforeValidTokenResponse
      ? {
          beforeValidTokenResponse: ({ state }) =>
            options.beforeValidTokenResponse({ state, tokenPepper }),
        }
      : {}),
  });
  own("admin orders TLS identity provider", () => idp.stop());
  const { actors, permissions } = await seedAdminOrdersRoles(client, {
    issuer: idp.issuer,
    subjectPepper,
  });
  await options.seedAdditionalRoles?.({
    client,
    actors,
    permissions,
    issuer: idp.issuer,
    subjectPepper,
  });
  const settings = {
    schemaVersion: 1,
    issuer: idp.issuer,
    clientId: "local-admin-client",
    redirectUri: `${adminOrigin}/api/admin/auth/callback`,
    policyVersion: "local-orders-mfa-v1",
    loginTtlSeconds: 300,
    sessionTtlSeconds: 3600,
    maxAuthenticationAgeSeconds: 300,
  };
  const access = createLocalOidcAdminAccessComposition(
    {
      environment: "LOCAL_OIDC",
      database,
      settings,
      provider: {
        issuer: settings.issuer,
        clientId: settings.clientId,
        redirectUri: settings.redirectUri,
        clientAuthentication: { method: "NONE" },
        mfa: { acceptedAcrValues: ["urn:fixture:mfa"], requiredAmrValues: [] },
      },
      allowedOrigin: adminOrigin,
      accessKey,
      tokenPepper,
      subjectPepper,
    },
    { identityTransport: { fetch: idp.fetch } },
  );
  // Delivery proofs use the private SOURCE bucket of the same ephemeral S3 (V2 §4-6).
  const proofStorage = context.s3
    ? createS3MediaStorageAdapter({
        schemaVersion: 1,
        sourceBucket: context.s3.sourceBucket,
        derivativeBucket: context.s3.derivativeBucket,
        publicMediaOrigin: context.gateway.origin,
        maxUploadBytes: 33554432,
        region: "us-east-1",
        authentication: {
          mode: "static",
          endpoint: context.s3.endpoint,
          presignEndpoint: context.s3.endpoint,
          accessKeyId: context.s3.accessKeyId,
          secretAccessKey: context.s3.secretAccessKey,
          forcePathStyle: true,
        },
      })
    : undefined;
  const orders = createLocalAdminOrdersComposition({
    environment: "LOCAL_OIDC",
    database,
    keys: context.kms.adapter,
    tokenPepper,
    allowedOrigin: adminOrigin,
    publicMediaBaseUrl: context.gateway.origin,
    proofs: proofStorage
      ? {
          storage: proofStorage,
          processor: createDeliveryProofProcessor({
            storage: proofStorage,
            now: () => new Date(),
          }),
        }
      : undefined,
  });
  const additional =
    (await options.composeAdditional?.({ tokenPepper, adminOrigin })) ?? {};
  own("admin orders compositions", async () => {
    await orders.adminOrdersRuntime.stop();
    await access.adminAccessRuntime.stop();
  });
  const app = await createApiApplication(preflightEnvironment(database), {
    ...access,
    ...orders,
    ...additional,
    logger: createStructuredLogger({
      service: "api",
      write: (line) => logs.push(line),
    }),
    adminCatalogRoute: {
      allowedOrigin: adminOrigin,
      useCases: createAdminCatalogUseCases({
        transactions: persistence.adminCatalogTransactionManager,
        tokenPepper,
      }),
    },
    managementCenterRoute: {
      allowedOrigin: adminOrigin,
      useCases: createManagementCenterUseCases({
        transactions: persistence.managementCenterTransactionManager,
        tokenPepper,
        resourceManagement: {
          execute: async () => {
            throw new Error("Upload covered by management acceptance");
          },
        },
      }),
    },
  });
  own("admin orders API", () => app.close());
  await app.listen(0, "127.0.0.1");
  const apiOrigin = await app.getUrl();
  async function authCall(path, body) {
    const r = await globalThis.fetch(
      `${apiOrigin}/api/v1/admin/access/${path}`,
      {
        method: "POST",
        headers: {
          origin: adminOrigin,
          "x-admin-access-key": accessKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
      },
    );
    check(
      r.headers.get("cache-control") === "private, no-store",
      "admin identity HTTP private",
    );
    return r.json();
  }
  async function login(role = "manager", locale = "en") {
    idp.setSubject(actors[role].subject);
    idp.setMode("valid");
    const start = await authCall("begin", {
      schemaVersion: 1,
      requestId: randomUUID(),
      locale,
    });
    check(start.kind === "LOGIN_REDIRECT", "admin OIDC begin accepted");
    registerSecret(start.browserToken);
    const redirect = await idp.fetch(start.authorizationUrl, {
        redirect: "manual",
      }),
      location = redirect.headers.get("location");
    check(
      redirect.status === 302 && location,
      "owned OIDC provider accepts authorization request",
    );
    const target = new URL(location),
      code = target.searchParams.get("code"),
      state = target.searchParams.get("state");
    [code, state].forEach(registerSecret);
    const session = await authCall("callback", {
      schemaVersion: 1,
      requestId: randomUUID(),
      browserToken: start.browserToken,
      code,
      state,
    });
    check(
      session.kind === "SESSION_CREATED",
      "admin OIDC callback establishes platform session",
    );
    [session.sessionToken, session.csrfToken].forEach(registerSecret);
    return session;
  }
  async function command(
    session,
    path,
    body,
    { key, status = 200, privateResult = false, namespace = "orders" } = {},
  ) {
    const r = await globalThis.fetch(
      `${apiOrigin}/api/v1/admin/${namespace}/${path}`,
      {
        method: "POST",
        headers: {
          origin: adminOrigin,
          cookie: `__Host-fan-admin-session=${session.sessionToken}`,
          "x-csrf-token": session.csrfToken,
          "content-type": "application/json",
          ...(key ? { "idempotency-key": key } : {}),
        },
        body: JSON.stringify(body),
        redirect: "error",
      },
    );
    const text = await r.text(),
      parsed = JSON.parse(text);
    console.log(
      `Admin orders HTTP ${JSON.stringify({ path, status: r.status, code: parsed.outcome === "FAILURE" ? parsed.code : null })}`,
    );
    check(r.status === status, `orders ${path} expected HTTP ${status}`);
    check(
      r.headers.get("cache-control") === "private, no-store" &&
        r.headers.get("referrer-policy") === "no-referrer",
      "orders HTTP privacy headers",
    );
    if (!privateResult)
      check(
        [...secrets].every((secret) => !text.includes(secret)),
        "ordinary order response excludes all registered canaries",
      );
    return parsed;
  }
  let next;
  async function startBrowser() {
    next = await startAdminAccessNext({
      workspaceRoot: context.workspaceRoot,
      adminOrigin,
      apiOrigin,
      issuer: idp.issuer,
      accessKey,
      logs,
    });
    own("admin orders Next", () => next.stop());
  }
  const roles = {
    ORDER_OPERATOR: "order",
    MANAGER: "manager",
    CONTENT_EDITOR: "editor",
    LANGUAGE_REVIEWER: "reviewer",
  };
  async function authenticate(page, role, locale = "en") {
    const actor = actors[roles[role] ?? role];
    check(Boolean(actor), "browser selects known test role");
    idp.setSubject(actor.subject);
    idp.setMode("valid");
    await page.context().clearCookies();
    // A sign-in that never reaches the workspace is reported with the request
    // paths and statuses it made (no query strings, tokens or cookies).
    const seen = [];
    const record = (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith("/api/admin/") || url.origin !== adminOrigin)
        seen.push(
          `${response.request().method()} ${url.origin === adminOrigin ? "" : "idp:"}${url.pathname} ${response.status()}`,
        );
    };
    page.on("response", record);
    try {
      await page.goto(`${adminOrigin}/${locale}`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator('form[action="/api/admin/auth/begin"] button').click();
      await page.locator(".mc-account button").waitFor({ timeout: 60000 });
    } catch (error) {
      console.error(
        `Admin sign-in diagnostic ${JSON.stringify({
          role,
          locale,
          width: page.viewportSize()?.width ?? null,
          path: new URL(page.url()).pathname,
          loginButtons: await page
            .locator('form[action="/api/admin/auth/begin"] button')
            .count()
            .catch(() => null),
          alerts: (
            await page
              .locator('[role="alert"]')
              .allInnerTexts()
              .catch(() => [])
          ).map((text) => text.slice(0, 80)),
          responses: seen.slice(-12),
        })}`,
      );
      throw error;
    } finally {
      page.off("response", record);
    }
    for (const cookie of await page.context().cookies())
      registerSecret(cookie.value);
  }
  async function assertPrivacy() {
    await next?.stop();
    check(
      [...secrets].every(
        (secret) => !logs.some((line) => line.includes(secret)),
      ),
      "admin API and Next logs exclude registered credentials and private text",
    );
  }
  return {
    adminOrigin,
    apiOrigin,
    issuer: idp.issuer,
    actors,
    permissions,
    registerSecret,
    login,
    command,
    financeCommand: (session, path, body, options = {}) =>
      command(session, path, body, { ...options, namespace: "finance" }),
    startBrowser,
    authenticate,
    assertPrivacy,
  };
}

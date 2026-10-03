#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { Client } from "pg";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { createStructuredLogger } from "@fan-support/observability";
import { createApiApplication } from "../dist/bootstrap.js";
import { createProductionAdminComposition } from "../dist/production-admin-composition.js";
import { resolveAdminApiRuntimeConfig } from "../dist/admin-runtime-config.js";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { seedAdminAccessRoles } from "./admin-access-fixtures.mjs";
import { startTestOidcProvider } from "../../../packages/identity-oidc/src/test-support/https-idp.mjs";
import {
  reserveOwnedOrigin,
  startOwnedTlsProxy,
} from "./production-admin-oidc-fixture.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const output = path.join(
  workspaceRoot,
  "output/checks/l3-admin-oidc/backend",
  `integration-${new Date().toISOString().replaceAll(":", "-")}`,
);
await mkdir(output, { recursive: true, mode: 0o700 });
const checks = [];
function check(value, label) {
  checks.push({ label, passed: Boolean(value) });
  assert.ok(value, label);
}
let stage = "initialization";
const logs = [];
const startupChecks = [];
const secrets = new Set();
function registerSecret(value) {
  if (value) secrets.add(value);
}
try {
  await withEphemeralPostgres(async (database) => {
    stage = "migrations";
    await runMigrations({
      clientConfig: database,
      workspaceRoot,
      command: { direction: "up" },
    });
    const client = new Client(database);
    await client.connect();
    const close = [];
    const own = (name, stop) => close.unshift({ name, stop });
    own("observer", () => client.end());
    let cleanupFailed;
    try {
      const adminOrigin = await reserveOwnedOrigin("admin"),
        apiOrigin = await reserveOwnedOrigin("api");
      const tokenPepper = randomBytes(32).toString("hex"),
        subjectPepper = randomBytes(32).toString("hex"),
        accessKey = randomBytes(32).toString("hex"),
        clientSecret = randomBytes(32).toString("hex");
      for (const value of [tokenPepper, subjectPepper, accessKey, clientSecret])
        registerSecret(value);
      stage = "owned-idp";
      const idp = await startTestOidcProvider({
        redirectOrigins: [adminOrigin],
        acr: "urn:fixture:mfa",
        clientSecret,
      });
      own("identity-provider", () => idp.stop());
      stage = "role-fixture";
      const { actors, permissions } = await seedAdminAccessRoles(client, {
        issuer: idp.issuer,
        subjectPepper,
      });
      // Dedicated order/finance grants augment the existing synthetic content roles.
      for (const key of ["orders.read", "finance.manage"]) {
        const existing = await client.query(
          "SELECT id FROM permissions WHERE permission_key=$1",
          [key],
        );
        const id = existing.rows[0]?.id ?? randomUUID();
        permissions.set(key, id);
        if (!existing.rows.length)
          await client.query(
            "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Formal OIDC acceptance fixture')",
            [id, key],
          );
        const roles =
          key === "orders.read"
            ? [actors.order, actors.manager]
            : [actors.manager];
        for (const actor of roles)
          await client.query(
            "INSERT INTO role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
            [actor.roleId, id, actors.manager.id],
          );
      }
      const beforeIdentities = (
        await client.query(
          "SELECT count(*)::integer AS count FROM admin_identities",
        )
      ).rows[0].count;
      const config = resolveAdminApiRuntimeConfig({
        FAN_SUPPORT_ADMIN_ORIGIN: adminOrigin,
        FAN_SUPPORT_ADMIN_ACCESS_KEY: accessKey,
        FAN_SUPPORT_ADMIN_TOKEN_PEPPER: tokenPepper,
        FAN_SUPPORT_ADMIN_SUBJECT_PEPPER: subjectPepper,
        FAN_SUPPORT_ADMIN_OIDC_ISSUER: idp.issuer,
        FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET: clientSecret,
        FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON: JSON.stringify({
          schemaVersion: 1,
          clientId: "local-admin-client",
          clientAuthentication: "CLIENT_SECRET_BASIC",
          acceptedAcrValues: ["urn:fixture:mfa"],
          requiredAmrValues: [],
          policyVersion: "owned-mfa-v1",
          loginTtlSeconds: 300,
          sessionTtlSeconds: 3600,
          maxAuthenticationAgeSeconds: 300,
        }),
      });
      const unused = [];
      const unavailable = (name) => async () => {
        unused.push(name);
        throw new Error("Out-of-scope fixture service requested");
      };
      const persistence = () => {
        const pool = createPostgresPersistence(database, {
          catalogPublicMediaBaseUrl: "https://media.example.invalid",
        });
        own("postgres-pool", () => pool.close());
        return pool;
      };
      // Real production composition and real PG transactions; services outside auth/RBAC fail closed.
      stage = "production-composition";
      const composition = createProductionAdminComposition({
        config,
        resources: {
          persistence,
          paymentConfigurationPersistence: persistence,
          keys: {
            keyManagement: {
              encryptEnvelope: unavailable("encrypt"),
              decryptEnvelope: unavailable("decrypt"),
            },
            activePepperVersion: "owned-fixture",
            pepperVersions: ["owned-fixture"],
          },
          media: {
            storage: {
              createUploadGrant: unavailable("upload"),
              createDownloadGrant: unavailable("download"),
            },
            inspector: { inspect: unavailable("inspect") },
            proofProcessor: { process: unavailable("proof") },
            proofReader: { read: unavailable("proof-read") },
          },
        },
        payment: {
          deployedAccounts: [],
          providerDirectory: { getRegistrations: () => [] },
        },
        identityTransport: { fetch: idp.fetch },
      });
      const app = await createApiApplication(preflightEnvironment(database), {
        ...composition,
        logger: createStructuredLogger({
          service: "api",
          write: (line) => logs.push(line),
        }),
      });
      own("api", () => app.close());
      await app.listen(0, "127.0.0.1");
      const proxy = await startOwnedTlsProxy({
        origin: apiOrigin,
        target: await app.getUrl(),
      });
      own("api-tls", () => proxy.stop());
      async function post(route, body, headers = {}) {
        const response = await proxy.fetch(
          `${apiOrigin}/api/v1/admin/${route}`,
          {
            method: "POST",
            headers: {
              origin: adminOrigin,
              "content-type": "application/json",
              ...headers,
            },
            body: JSON.stringify(body),
          },
        );
        check(
          response.headers.get("cache-control") === "private, no-store",
          `${route} is private no-store`,
        );
        return { status: response.status, data: await response.json() };
      }
      const access = (action, body) =>
        post(`access/${action}`, body, { "x-admin-access-key": accessKey });
      const admin = (route, session, body, headers = {}) =>
        post(route, body, {
          cookie: `__Host-fan-admin-session=${session.sessionToken}`,
          "x-csrf-token": session.csrfToken,
          ...headers,
        });
      async function begin() {
        const result = await access("begin", {
          schemaVersion: 1,
          requestId: randomUUID(),
          locale: "en",
        });
        check(
          result.data.kind === "LOGIN_REDIRECT",
          "formal API creates login redirect",
        );
        registerSecret(result.data.browserToken);
        for (const key of ["state", "nonce", "code_challenge"])
          registerSecret(
            new URL(result.data.authorizationUrl).searchParams.get(key),
          );
        return result.data;
      }
      async function callback(start, patch = {}) {
        const authorization = new URL(start.authorizationUrl);
        for (const [key, value] of Object.entries(patch))
          authorization.searchParams.set(key, value);
        const response = await idp.fetch(authorization, { redirect: "manual" });
        const redirect = new URL(response.headers.get("location"));
        const code = redirect.searchParams.get("code"),
          state = redirect.searchParams.get("state");
        registerSecret(code);
        registerSecret(state);
        return {
          schemaVersion: 1,
          requestId: randomUUID(),
          browserToken: start.browserToken,
          code,
          state,
        };
      }
      async function complete(input) {
        const result = await access("callback", input);
        if (result.data.kind === "SESSION_CREATED") {
          registerSecret(result.data.sessionToken);
          registerSecret(result.data.csrfToken);
        }
        return result;
      }
      async function login(role = "manager") {
        idp.setMode("valid");
        idp.setClaims({});
        idp.setSubject(actors[role].subject);
        const input = await callback(await begin()),
          result = await complete(input);
        check(
          result.data.kind === "SESSION_CREATED",
          `${role} real signed MFA login`,
        );
        return { session: result.data, callback: input };
      }
      stage = "roles";
      const sessions = {};
      for (const role of [
        "manager",
        "order",
        "editor",
        "reviewer",
        "developer",
      ]) {
        const { session } = await login(role);
        sessions[role] = session;
        const read = await admin("session/read", session, { schemaVersion: 1 });
        check(
          read.status === 200 && read.data.actorId === actors[role].id,
          `${role} maps to platform identity`,
        );
        const orders = await admin("orders/list", session, {
          schemaVersion: 1,
          page: 1,
          pageSize: 10,
          query: "",
          fulfillment: "ALL",
          moderation: "ALL",
        });
        check(
          orders.status === (["manager", "order"].includes(role) ? 200 : 403),
          `${role} order read authorization`,
        );
        const finance = await admin("finance/list", session, {
          schemaVersion: 1,
          page: 1,
          pageSize: 10,
          query: "",
          filter: "ALL",
        });
        check(
          finance.status === (["manager", "order"].includes(role) ? 200 : 403),
          `${role} finance read authorization`,
        );
        if (finance.status === 200)
          check(
            finance.data.canManage === (role === "manager"),
            `${role} finance mutation capability`,
          );
        const cancel = await admin(
          "finance/cancel",
          session,
          {
            schemaVersion: 1,
            orderId: randomUUID(),
            expectedOrderVersion: 1,
            reasonCode: "FIXTURE_CHECK",
            confirmed: true,
          },
          { "idempotency-key": randomUUID() },
        );
        check(
          cancel.data.code === (role === "manager" ? "NOT_FOUND" : "FORBIDDEN"),
          `${role} finance mutation is authorized before order lookup`,
        );
      }
      check(
        idp.tokenAuthorization?.startsWith("Basic "),
        "server performs confidential client authentication",
      );
      check(
        idp.tokenBody.get("code_verifier")?.length >= 43,
        "S256 verifier reaches token endpoint",
      );
      stage = "login-rejections";
      const first = await login();
      check(
        (await complete(first.callback)).data.code === "LOGIN_RESTART_REQUIRED",
        "callback replay cannot create second session",
      );
      for (const kind of ["state", "binding", "pkce"]) {
        const c = await callback(
          await begin(),
          kind === "pkce"
            ? { code_challenge: randomBytes(32).toString("base64url") }
            : {},
        );
        if (kind === "state") c.state = randomBytes(32).toString("base64url");
        if (kind === "binding")
          c.browserToken = randomBytes(32).toString("base64url");
        const before = idp.tokenRequests,
          result = await complete(c);
        check(result.data.outcome === "FAILURE", `${kind} mismatch rejected`);
        check(
          idp.tokenRequests === before + (kind === "pkce" ? 1 : 0),
          `${kind} exchange count proves rejection boundary`,
        );
      }
      const concurrent = await callback(await begin());
      const results = await Promise.all([
        complete(concurrent),
        complete(concurrent),
      ]);
      check(
        results.filter((r) => r.data.kind === "SESSION_CREATED").length === 1,
        "concurrent callbacks create exactly one session",
      );
      for (const mode of ["no-mfa", "wrong-signature", "disconnect"]) {
        idp.setMode(mode);
        const c = await callback(await begin()),
          before = idp.tokenRequests;
        check(
          (await complete(c)).data.outcome === "FAILURE",
          `${mode} cannot create session`,
        );
        check(
          idp.tokenRequests === before + 1,
          `${mode} authorization code exchange never retries`,
        );
      }
      idp.setMode("valid");
      for (const [name, claims] of [
        ["nonce", { nonce: "wrong-nonce" }],
        ["audience", { aud: "wrong-client" }],
        [
          "old-authentication",
          { auth_time: Math.floor(Date.now() / 1000) - 1000 },
        ],
      ]) {
        idp.setClaims(claims);
        check(
          (await complete(await callback(await begin()))).data.outcome ===
            "FAILURE",
          `${name} proof rejected`,
        );
      }
      idp.setClaims({});
      idp.setSubject(randomUUID());
      check(
        (await complete(await callback(await begin()))).data.code ===
          "ACCESS_DENIED",
        "unknown valid identity cannot enroll itself",
      );
      check(
        (
          await client.query(
            "SELECT count(*)::integer AS count FROM admin_identities",
          )
        ).rows[0].count === beforeIdentities,
        "login creates no platform identity",
      );
      stage = "revocation-and-logout";
      const financeSession = sessions.manager;
      await client.query(
        "DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2",
        [actors.manager.roleId, permissions.get("finance.manage")],
      );
      const revokedFinance = await admin("finance/list", financeSession, {
        schemaVersion: 1,
        page: 1,
        pageSize: 10,
        query: "",
        filter: "ALL",
      });
      check(
        revokedFinance.status === 200 &&
          revokedFinance.data.canManage === false,
        "live session loses removed finance grant",
      );
      await client.query(
        "DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2",
        [actors.order.roleId, permissions.get("orders.read")],
      );
      check(
        (
          await admin("orders/list", sessions.order, {
            schemaVersion: 1,
            page: 1,
            pageSize: 10,
            query: "",
            fulfillment: "ALL",
            moderation: "ALL",
          })
        ).status === 403,
        "live order grant revocation enforced",
      );
      await client.query(
        "UPDATE admin_identities SET status='SUSPENDED',version=version+1 WHERE id=$1",
        [actors.editor.id],
      );
      check(
        (await admin("session/read", sessions.editor, { schemaVersion: 1 }))
          .status === 401,
        "suspended identity loses existing session",
      );
      const logout = {
        schemaVersion: 1,
        requestId: randomUUID(),
        sessionToken: first.session.sessionToken,
        csrfToken: first.session.csrfToken,
        revokeAll: false,
      };
      check(
        (
          await access("logout", {
            ...logout,
            csrfToken: randomBytes(32).toString("base64url"),
          })
        ).data.code === "CSRF_INVALID",
        "bad logout CSRF rejected",
      );
      check(
        (await admin("session/read", first.session, { schemaVersion: 1 }))
          .status === 200,
        "failed logout preserves session",
      );
      check(
        (await access("logout", logout)).data.kind === "LOGGED_OUT",
        "logout durably revokes session",
      );
      check(
        (await admin("session/read", first.session, { schemaVersion: 1 }))
          .status === 401,
        "logged-out token no longer accepted",
      );
      const manager = await login();
      async function revokeSessions() {
        check(
          (
            await access("logout", {
              schemaVersion: 1,
              requestId: randomUUID(),
              sessionToken: manager.session.sessionToken,
              csrfToken: manager.session.csrfToken,
              revokeAll: true,
            })
          ).data.kind === "LOGGED_OUT",
          "audited revoke all succeeds",
        );
      }
      if (process.argv.includes("--ui")) {
        stage = "production-next-browser";
        const { startProductionAdminNext, verifyInvalidProductionAdminStart } =
          await import("./production-admin-oidc-next.mjs");
        startupChecks.push(
          ...(await verifyInvalidProductionAdminStart(
            {
              workspaceRoot,
              adminOrigin,
              apiOrigin,
              issuer: idp.issuer,
              accessKey,
              caPath: proxy.caPath,
            },
            check,
          )),
        );
        await writeFile(
          path.join(output, "startup.json"),
          JSON.stringify({ schemaVersion: 1, startupChecks }, null, 2) + "\n",
        );
        const next = await startProductionAdminNext({
          workspaceRoot,
          adminOrigin,
          apiOrigin,
          issuer: idp.issuer,
          accessKey,
          caPath: proxy.caPath,
          logs,
        });
        own("production-next", () => next.stop());
        const { verifyProductionAdminBrowser } =
          await import("./production-admin-oidc-browser.mjs");
        const review = process.argv.includes("--review")
          ? await import(
              new URL(
                "../../../output/checks/l3-admin-oidc/review/browser-audit.mjs",
                import.meta.url,
              )
            )
          : {};
        await verifyProductionAdminBrowser({
          adminOrigin,
          issuer: idp.issuer,
          adminPin: next.pin,
          idpCa: idp.ca,
          idp,
          output,
          check,
          registerSecret,
          revokeSessions,
          review,
        });
      } else {
        await revokeSessions();
      }
      check(
        (await admin("session/read", manager.session, { schemaVersion: 1 }))
          .status === 401,
        "revoke all invalidates earlier manager session",
      );
      stage = "audit-and-privacy";
      check(
        unused.length === 0,
        "auth and RBAC require no media, KMS or PSP service calls",
      );
      const audit = await client.query(
        "SELECT action,outcome FROM audit_logs WHERE task_name='admin-access'",
      );
      check(
        audit.rows.some((row) => row.action === "ADMIN_LOGIN_SUCCEEDED"),
        "successful login audit exists",
      );
      check(
        audit.rows.some((row) => row.action === "ADMIN_LOGIN_REJECTED"),
        "rejected login audit exists",
      );
    } catch (error) {
      await writeFile(
        path.join(output, "internal-failure.json"),
        JSON.stringify(
          {
            stage,
            errorName: error?.name,
            code: error?.code,
            constraint: error?.constraint,
            frames:
              typeof error?.stack === "string"
                ? error.stack
                    .split("\n")
                    .filter((line) => line.trim().startsWith("at "))
                : [],
          },
          null,
          2,
        ) + "\n",
      );
      throw error;
    } finally {
      const cleanup = [];
      for (const resource of close) {
        try {
          await resource.stop();
          cleanup.push({ name: resource.name, passed: true });
        } catch {
          cleanup.push({ name: resource.name, passed: false });
        }
      }
      cleanupFailed = cleanup.some((row) => !row.passed);
      await writeFile(
        path.join(output, "cleanup.json"),
        JSON.stringify({ schemaVersion: 1, cleanup }, null, 2) + "\n",
      );
    }
    if (cleanupFailed) throw new Error("Fixture cleanup failed");
  });
  stage = "final-privacy-after-cleanup";
  const raw = logs.join("\n");
  check(
    [...secrets].every((secret) => !raw.includes(secret)),
    "runtime logs contain none of the generated credentials",
  );
  check(
    !/code=|state=|browserToken|sessionToken|csrfToken/u.test(raw),
    "runtime logs contain no callback query or secret fields",
  );
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        status: "PASS",
        environment: "PRODUCTION_ADMIN_COMPOSITION_OWNED_TLS_POSTGRES",
        productionRelease: false,
        startupChecks,
        checks,
        limitations: [
          "Owned synthetic IdP MFA claim is protocol evidence, not real IdP/account/recovery acceptance",
          "Ephemeral empty commerce database verifies role access and authorization-before-lookup, not refunds or fulfillment",
          "Media/KMS/PSP ports deliberately fail if called; no external resources used",
          "API bootstrap uses isolated test infrastructure settings with the actual production admin composition",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`PRODUCTION_ADMIN_OIDC_PASS ${checks.length} checks; ${output}`);
} catch (error) {
  await writeFile(
    path.join(output, "failure.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        stage,
        checks,
        errorName: error?.name,
        code: typeof error?.code === "string" ? error.code : undefined,
        constraint:
          typeof error?.constraint === "string" ? error.constraint : undefined,
        frames:
          typeof error?.stack === "string"
            ? error.stack
                .split("\n")
                .filter((line) => line.trim().startsWith("at "))
            : [],
      },
      null,
      2,
    ) + "\n",
  );
  console.error(`PRODUCTION_ADMIN_OIDC_FAILED ${stage}; ${output}`);
  process.exitCode = 1;
}

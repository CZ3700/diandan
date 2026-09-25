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
import {
  createAdminCatalogUseCases,
  createManagementCenterUseCases,
} from "@fan-support/application";
import { adminSessionPermissionSchema } from "@fan-support/contracts";
import { createApiApplication } from "../dist/bootstrap.js";
import { createLocalOidcAdminAccessComposition } from "../dist/index.js";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { seedAdminAccessRoles } from "./admin-access-fixtures.mjs";
import { startTestOidcProvider } from "../../../packages/identity-oidc/src/test-support/https-idp.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const output = path.join(
  workspaceRoot,
  "output/checks/p5-01-admin-access",
  `integration-${new Date().toISOString().replaceAll(":", "-")}`,
);
await mkdir(output, { recursive: true, mode: 0o700 });
const checks = [];
const check = (value, label) => {
  checks.push({ label, passed: Boolean(value) });
  assert.ok(value, label);
};
let stage = "initialization";
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
    let idp, app, persistence, composition, stopNext;
    let appClosed = false,
      cleanupFailed;
    const tokenPepper = randomBytes(32).toString("hex"),
      subjectPepper = randomBytes(32).toString("hex"),
      accessKey = randomBytes(32).toString("hex");
    const logs = [];
    const secrets = new Set([tokenPepper, subjectPepper, accessKey]);
    try {
      const browserMode = process.argv.includes("--ui");
      const { reserveAdminAccessOrigin, startAdminAccessNext } =
        await import("./admin-access-next.mjs");
      stage = "reserve-origin";
      const adminOrigin = await reserveAdminAccessOrigin();
      stage = "TLS-provider";
      idp = await startTestOidcProvider({
        redirectOrigins: [adminOrigin],
        acr: "urn:fixture:mfa",
      });
      stage = "role-seeding";
      const { actors, permissions } = await seedAdminAccessRoles(client, {
        issuer: idp.issuer,
        subjectPepper,
      });
      const settings = {
        schemaVersion: 1,
        issuer: idp.issuer,
        clientId: "local-admin-client",
        redirectUri: `${adminOrigin}/api/admin/auth/callback`,
        policyVersion: "local-mfa-v1",
        loginTtlSeconds: 300,
        sessionTtlSeconds: 3600,
        maxAuthenticationAgeSeconds: 300,
      };
      stage = "identity-composition";
      composition = createLocalOidcAdminAccessComposition(
        {
          environment: "LOCAL_OIDC",
          database,
          settings,
          provider: {
            issuer: settings.issuer,
            clientId: settings.clientId,
            redirectUri: settings.redirectUri,
            clientAuthentication: { method: "NONE" },
            mfa: {
              acceptedAcrValues: ["urn:fixture:mfa"],
              requiredAmrValues: [],
            },
          },
          allowedOrigin: adminOrigin,
          accessKey,
          tokenPepper,
          subjectPepper,
        },
        { identityTransport: { fetch: idp.fetch } },
      );
      persistence = createPostgresPersistence(database, {
        catalogPublicMediaBaseUrl: "https://media.example.invalid",
      });
      stage = "api-boot";
      app = await createApiApplication(preflightEnvironment(database), {
        ...composition,
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
                throw new Error(
                  "Upload is covered by the full management integration",
                );
              },
            },
          }),
        },
      });
      await app.listen(0, "127.0.0.1");
      const apiOrigin = await app.getUrl();
      async function access(action, body) {
        const response = await globalThis.fetch(
          `${apiOrigin}/api/v1/admin/access/${action}`,
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
          response.headers.get("cache-control") === "private, no-store",
          `${action} no-store`,
        );
        return { status: response.status, data: await response.json() };
      }
      async function begin(locale = "en") {
        const result = await access("begin", {
          schemaVersion: 1,
          requestId: randomUUID(),
          locale,
        });
        check(
          result.data.kind === "LOGIN_REDIRECT",
          "login authorization created",
        );
        secrets.add(result.data.browserToken);
        return result.data;
      }
      async function callback(start) {
        const redirect = await idp.fetch(start.authorizationUrl, {
          redirect: "manual",
        });
        const location = new URL(redirect.headers.get("location"));
        const code = location.searchParams.get("code"),
          state = location.searchParams.get("state");
        secrets.add(code);
        secrets.add(state);
        return {
          schemaVersion: 1,
          requestId: randomUUID(),
          browserToken: start.browserToken,
          code,
          state,
        };
      }
      async function login(role = "manager", locale = "en") {
        idp.setSubject(actors[role].subject);
        idp.setMode("valid");
        const c = await callback(await begin(locale));
        const result = await access("callback", c);
        check(
          result.data.kind === "SESSION_CREATED",
          `${role} authenticated with real OIDC`,
        );
        secrets.add(result.data.sessionToken);
        secrets.add(result.data.csrfToken);
        return { session: result.data, callback: c };
      }
      async function admin(route, session, body) {
        const r = await globalThis.fetch(`${apiOrigin}/api/v1/admin/${route}`, {
          method: "POST",
          headers: {
            origin: adminOrigin,
            cookie: `__Host-fan-admin-session=${session.sessionToken}`,
            "x-csrf-token": session.csrfToken,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
        return { status: r.status, data: await r.json() };
      }
      stage = "role-matrix";
      for (const [role, actor] of Object.entries(actors)) {
        const { session } = await login(role);
        const read = await admin("session/read", session, { schemaVersion: 1 });
        check(
          read.data.actorId === actor.id,
          `${role} resolves platform identity`,
        );
        const expected = adminSessionPermissionSchema.options.filter((p) =>
          actor.permissions.includes(p),
        );
        check(
          JSON.stringify(read.data.permissions) === JSON.stringify(expected),
          `${role} exact database permissions`,
        );
        const context = await admin("management/context", session, {
          schemaVersion: 1,
        });
        check(
          context.status ===
            (actor.permissions.includes("management.direct") ? 200 : 403),
          `${role} management authorization`,
        );
        const catalog = await admin("catalog/owners/list", session, {
          schemaVersion: 1,
          kind: "IDOL",
          locale: "en",
          page: 1,
          pageSize: 20,
        });
        // Route-specific locale authorization is also independently tested below through the canonical port.
        check(
          catalog.status ===
            (actor.permissions.includes("content.read") &&
            actor.locales.includes("en")
              ? 200
              : 403),
          `${role} catalog permission and locale boundary`,
        );
      }
      stage = "single-use-and-revocation";
      const first = await login();
      check(
        (await access("callback", first.callback)).data.code ===
          "LOGIN_RESTART_REQUIRED",
        "callback replay rejected",
      );
      const crossed = await callback(await begin());
      const before = idp.tokenRequests;
      check(
        (
          await access("callback", {
            ...crossed,
            browserToken: randomBytes(32).toString("base64url"),
          })
        ).data.code === "LOGIN_RESTART_REQUIRED",
        "cross-browser callback rejected",
      );
      check(
        idp.tokenRequests === before,
        "cross-browser rejection never redeems code",
      );
      const concurrent = await callback(await begin());
      const winners = await Promise.all([
        access("callback", concurrent),
        access("callback", concurrent),
      ]);
      for (const winner of winners) {
        if (winner.data.kind === "SESSION_CREATED") {
          secrets.add(winner.data.sessionToken);
          secrets.add(winner.data.csrfToken);
        }
      }
      check(
        winners.filter((r) => r.data.kind === "SESSION_CREATED").length === 1,
        "concurrent callback issues one session",
      );
      const badCsrf = await access("logout", {
        schemaVersion: 1,
        requestId: randomUUID(),
        sessionToken: first.session.sessionToken,
        csrfToken: randomBytes(32).toString("base64url"),
        revokeAll: false,
      });
      check(
        badCsrf.data.code === "CSRF_INVALID",
        "logout CSRF mismatch rejected",
      );
      check(
        (await admin("session/read", first.session, { schemaVersion: 1 }))
          .status === 200,
        "failed logout preserves live session",
      );
      const signedOut = await access("logout", {
        schemaVersion: 1,
        requestId: randomUUID(),
        sessionToken: first.session.sessionToken,
        csrfToken: first.session.csrfToken,
        revokeAll: false,
      });
      check(signedOut.data.kind === "LOGGED_OUT", "logout succeeds");
      check(
        (await admin("session/read", first.session, { schemaVersion: 1 }))
          .status === 401,
        "old session immediately rejected after logout",
      );
      stage = "identity-rejections";
      idp.setSubject(randomUUID());
      const unknown = await callback(await begin());
      check(
        (await access("callback", unknown)).data.code === "ACCESS_DENIED",
        "unknown verified identity cannot self-enroll",
      );
      idp.setSubject(actors.manager.subject);
      for (const mode of ["no-mfa", "wrong-signature", "disconnect"]) {
        idp.setMode(mode);
        const c = await callback(await begin());
        const before = idp.tokenRequests;
        check(
          (await access("callback", c)).data.outcome === "FAILURE",
          `${mode} cannot issue session`,
        );
        check(
          idp.tokenRequests === before + 1,
          `${mode} code exchange not retried`,
        );
      }
      idp.setMode("valid");
      stage = "live-role-revocation";
      const editor = await login("editor");
      await client.query(
        "DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2",
        [actors.editor.roleId, permissions.get("content.edit")],
      );
      check(
        !(
          await admin("session/read", editor.session, { schemaVersion: 1 })
        ).data.permissions.includes("content.edit"),
        "existing session observes role removal immediately",
      );
      await client.query(
        "UPDATE admin_identities SET status='SUSPENDED',version=version+1 WHERE id=$1",
        [actors.editor.id],
      );
      check(
        (await admin("session/read", editor.session, { schemaVersion: 1 }))
          .status === 401,
        "suspended identity cannot retain access",
      );
      stage = "browser";
      if (browserMode) {
        idp.setSubject(actors.manager.subject);
        const next = await startAdminAccessNext({
          workspaceRoot,
          adminOrigin,
          apiOrigin,
          issuer: idp.issuer,
          accessKey,
          logs,
        });
        stopNext = next.stop;
        const { verifyAdminAccessBrowser } =
          await import("./admin-access-browser.mjs");
        const report = await verifyAdminAccessBrowser({
          adminOrigin,
          issuer: idp.issuer,
          output,
          idp,
          registerSecret: (value) => secrets.add(value),
          revokeSessions: async () => {
            const { session } = await login("manager");
            const revoked = await access("logout", {
              schemaVersion: 1,
              requestId: randomUUID(),
              sessionToken: session.sessionToken,
              csrfToken: session.csrfToken,
              revokeAll: true,
            });
            check(
              revoked.data.kind === "LOGGED_OUT",
              "browser session revocation uses audited application path",
            );
          },
          check,
        });
        await writeFile(
          path.join(output, "browser.json"),
          JSON.stringify(report, null, 2) + "\n",
        );
      }
      stage = "privacy-and-audit";
      await stopNext?.();
      await app.close();
      appClosed = true;
      const logText = logs.join("\n");
      for (const secret of secrets)
        if (secret)
          check(
            !logText.includes(secret),
            "runtime logs contain no identity credentials",
          );
      check(
        !/code=|state=|browserToken|sessionToken|csrfToken/u.test(logText),
        "runtime logs do not contain credential fields or callback queries",
      );
      const audit = await client.query(
        "SELECT action,outcome FROM audit_logs WHERE task_name='admin-access'",
      );
      check(
        audit.rows.some((r) => r.action === "ADMIN_LOGIN_SUCCEEDED"),
        "login audit exists",
      );
      check(
        audit.rows.some((r) => r.action === "ADMIN_LOGIN_REJECTED"),
        "rejected login audit exists",
      );
      await writeFile(
        path.join(output, "validation.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            environment: "LOCAL_OIDC_TLS_POSTGRES",
            checks,
            productionRelease: false,
          },
          null,
          2,
        ) + "\n",
      );
    } catch (error) {
      await writeFile(
        path.join(output, "internal-failure.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            stage,
            errorName: error?.name,
            code: typeof error?.code === "string" ? error.code : undefined,
            constraint:
              typeof error?.constraint === "string"
                ? error.constraint
                : undefined,
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
      for (const [name, close] of [
        ["next", () => stopNext?.()],
        ["api", () => (appClosed ? undefined : app?.close())],
        ["access-pool", () => composition?.adminAccessRuntime.stop()],
        ["content-pool", () => persistence?.close()],
        ["identity-provider", () => idp?.stop()],
        ["observer-client", () => client.end()],
      ]) {
        try {
          await close();
          cleanup.push({ name, passed: true });
        } catch {
          cleanup.push({ name, passed: false });
        }
      }
      await writeFile(
        path.join(output, "cleanup.json"),
        JSON.stringify({ schemaVersion: 1, cleanup }, null, 2) + "\n",
      );
      cleanupFailed = cleanup.some((item) => !item.passed);
    }
    if (cleanupFailed)
      throw new Error("Local identity resource cleanup failed");
  });
  console.log(`ADMIN_ACCESS_PASS ${checks.length} checks; ${output}`);
} catch (error) {
  await writeFile(
    path.join(output, "failure.json"),
    JSON.stringify(
      { schemaVersion: 1, stage, checks, errorName: error?.name ?? "Error" },
      null,
      2,
    ) + "\n",
  );
  console.error(`ADMIN_ACCESS_FAILED ${stage}; ${output}`);
  process.exitCode = 1;
}

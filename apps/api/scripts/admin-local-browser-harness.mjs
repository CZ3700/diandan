// L3-10 browser acceptance: real PostgreSQL, the production API composition with built-in accounts,
// Admin Next in LOCAL_ACCOUNT development mode over local HTTPS, and Chrome.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { chromium } from "@playwright/test";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { totpCode } from "@fan-support/application";
import { createStructuredLogger } from "@fan-support/observability";
import { createApiApplication } from "../dist/bootstrap.js";
import { createProductionAdminComposition } from "../dist/production-admin-composition.js";
import { resolveAdminApiRuntimeConfig } from "../dist/admin-runtime-config.js";
import { createLocalExperienceKms } from "./local-experience-kms.mjs";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import {
  localAccountComposition,
  provisionFirstAdministrator,
} from "./admin-local-fixtures.mjs";
import {
  reserveAdminAccessOrigin,
  startAdminAccessNext,
} from "./admin-access-next.mjs";

const requireFromRoot = createRequire(
  new URL("../../../package.json", import.meta.url),
);
const { default: AxeBuilder } = requireFromRoot("@axe-core/playwright");
export const workspaceRoot = fileURLToPath(
  new URL("../../../", import.meta.url),
);
export const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
};

/** A code newer than the last accepted step and inside the ±1 window, waiting if needed. */
export async function freshCode(key, lastStep) {
  for (;;) {
    const now = Math.floor(Date.now() / 30_000);
    const target = Math.max(lastStep + 1, now - 1);
    if (target <= now + 1) return { code: totpCode(key, target), step: target };
    await delay(Math.min(30_000, (target - 1) * 30_000 - Date.now() + 50));
  }
}

/**
 * Runs `scenario` with the whole stack up and writes `report.json` (and the scenario's screenshots)
 * to `output/checks/<item>/<name>-<time>/`. Registered secrets never reach the report or logs.
 */
export async function runLocalAccountBrowserAcceptance(
  name,
  scenario,
  { item = "l3-10" } = {},
) {
  // --compiled: the already built admin with next start in the test tier (stg PREBUILT).
  const compiled = process.argv.includes("--compiled");
  const output = path.join(
    workspaceRoot,
    "output/checks",
    item,
    `${name}${compiled ? "-compiled" : ""}-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true });
  const checks = [];
  const axe = [];
  const secrets = new Set();
  const apiLogs = [];
  const nextLogs = [];
  const state = { stage: "initialization" };
  let innerError;
  const check = (value, label) => {
    checks.push({ stage: state.stage, label, passed: Boolean(value) });
    assert.ok(value, `${state.stage}: ${label}`);
  };
  const secret = (value) => {
    secrets.add(value);
    return value;
  };
  try {
    await withEphemeralPostgres(async (database) => {
      await runMigrations({
        clientConfig: database,
        workspaceRoot,
        command: { direction: "up" },
      });
      const client = new Client(database);
      await client.connect();
      const close = [];
      const own = (stop) => close.unshift(stop);
      own(() => client.end());
      let browser;
      try {
        state.stage = "services";
        const tokenPepper = secret(randomBytes(32).toString("hex")),
          subjectPepper = secret(randomBytes(32).toString("hex")),
          accessKey = secret(randomBytes(32).toString("hex"));
        const ownerPassword = secret(
          `owner ${randomBytes(9).toString("base64url")}`,
        );
        await provisionFirstAdministrator(client, {
          subjectPepper,
          password: ownerPassword,
        });
        const kms = createLocalExperienceKms({
          environment: "TEST",
          masterKey: randomBytes(32).toString("base64url"),
          macKey: randomBytes(32).toString("base64url"),
        });
        own(() => kms.close());
        const adminOrigin = await reserveAdminAccessOrigin();
        const { composition } = localAccountComposition({
          createProductionAdminComposition,
          resolveAdminApiRuntimeConfig,
          createPostgresPersistence,
          database,
          keyManagement: kms.adapter,
          adminOrigin,
          accessKey,
          tokenPepper,
          subjectPepper,
          own,
        });
        const app = await createApiApplication(preflightEnvironment(database), {
          ...composition,
          logger: createStructuredLogger({
            service: "api",
            write: (line) => apiLogs.push(line),
          }),
        });
        own(() => app.close());
        await app.listen(0, "127.0.0.1");
        const apiOrigin = new URL(await app.getUrl()).origin;
        const next = await startAdminAccessNext({
          workspaceRoot,
          adminOrigin,
          apiOrigin,
          accessKey,
          logs: nextLogs,
          mode: "LOCAL_ACCOUNT",
          compiled,
        });
        own(() => next.stop());
        async function api(route, body, headers = {}) {
          const response = await globalThis.fetch(
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
          return { status: response.status, data: await response.json() };
        }
        const access = async (action, body) =>
          (
            await api(
              `local-access/${action}`,
              { schemaVersion: 1, requestId: randomUUID(), ...body },
              { "x-admin-access-key": accessKey },
            )
          ).data;
        const as = (session) => ({
          cookie: `__Host-fan-admin-session=${session.sessionToken}`,
          "x-csrf-token": session.csrfToken,
        });
        /** A session straight from the API, registered as a secret. */
        async function signIn(loginName, password) {
          const result = await access("login", {
            locale: "en",
            loginName,
            password,
          });
          if (result.sessionToken) {
            secret(result.sessionToken);
            secret(result.csrfToken);
          }
          return result;
        }
        state.stage = "browser";
        browser = await chromium.launch({
          channel: "chrome",
          headless: true,
          args: [
            `--host-resolver-rules=MAP ${new URL(adminOrigin).hostname} 127.0.0.1`,
            "--no-proxy-server",
          ],
        });
        const unexpected = [];
        async function open(
          locale,
          viewport,
          { reducedMotion = "no-preference", session } = {},
        ) {
          const context = await browser.newContext({
            viewport: VIEWPORTS[viewport],
            reducedMotion,
            ignoreHTTPSErrors: true,
            acceptDownloads: true,
          });
          if (session)
            await context.addCookies(
              [
                ["__Host-fan-admin-session", session.sessionToken],
                ["__Host-fan-admin-csrf", session.csrfToken],
              ].map(([cookieName, value]) => ({
                name: cookieName,
                value,
                url: adminOrigin,
                secure: true,
                httpOnly: true,
                sameSite: "Strict",
              })),
            );
          await context.route("**/*", async (route) => {
            const target = new URL(route.request().url());
            if (target.origin !== adminOrigin) {
              unexpected.push(target.origin);
              await route.abort("blockedbyclient");
            } else if (target.pathname.startsWith("/api/admin/auth/begin")) {
              unexpected.push("OIDC_BEGIN");
              await route.abort("blockedbyclient");
            } else await route.continue();
          });
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) =>
            errors.push(String(error.message).slice(0, 200)),
          );
          await page.goto(`${adminOrigin}/${locale}`, {
            waitUntil: "domcontentloaded",
            timeout: 180_000,
          });
          return { context, page, errors };
        }
        async function audit(page, label) {
          const scan = await new AxeBuilder({ page }).analyze();
          axe.push({
            label,
            violations: scan.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.length,
            })),
          });
          check(
            scan.violations.every(
              (v) => !["serious", "critical"].includes(v.impact),
            ),
            `${label}: no serious or critical axe violations`,
          );
        }
        const fitsWidth = (page) =>
          page.evaluate(
            () =>
              globalThis.document.documentElement.scrollWidth <=
              globalThis.document.documentElement.clientWidth,
          );
        const shot = (page, fileName) =>
          page.screenshot({
            path: path.join(output, `${fileName}.png`),
            fullPage: true,
          });
        await scenario({
          check,
          secret,
          stage: (value) => {
            state.stage = value;
          },
          client,
          /** The instance key service, for fixtures that must seed decryptable private content. */
          keys: kms.adapter,
          adminOrigin,
          api,
          access,
          as,
          signIn,
          ownerPassword,
          open,
          audit,
          fitsWidth,
          shot,
          output,
        });
        state.stage = "evidence";
        check(
          unexpected.length === 0,
          "no request left the fixture origin or reached OIDC",
        );
        const logText = `${apiLogs.join("\n")}\n${nextLogs.join("\n")}`;
        for (const value of secrets)
          check(!logText.includes(value), "no secret in API or Next logs");
      } catch (error) {
        innerError = error;
        throw error;
      } finally {
        if (browser) await browser.close().catch(() => undefined);
        for (const stop of close)
          await Promise.resolve()
            .then(stop)
            .catch(() => undefined);
      }
    });
    const report = JSON.stringify(
      { result: "PASS", checks: checks.length, axe, detail: checks },
      null,
      2,
    );
    for (const value of secrets)
      assert.ok(!report.includes(value), "no secret in the report");
    await writeFile(path.join(output, "report.json"), report);
    console.log(
      JSON.stringify({
        result: "PASS",
        checks: checks.length,
        output: path.relative(workspaceRoot, output),
      }),
    );
  } catch (error) {
    let message = String((innerError ?? error)?.message);
    for (const value of secrets)
      message = message.replaceAll(value, "<secret>");
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify(
        { result: "FAIL", stage: state.stage, message, axe, detail: checks },
        null,
        2,
      ),
    );
    console.error(
      JSON.stringify({
        result: "FAIL",
        stage: state.stage,
        checks: checks.length,
        message: message.slice(0, 1500),
      }),
    );
    process.exitCode = 1;
  }
}

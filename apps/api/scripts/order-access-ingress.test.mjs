import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { createStructuredLogger } from "@fan-support/observability";
import { createApiApplication } from "../dist/bootstrap.js";
import { createCartHttpTestKms } from "./cart-http-kms.mjs";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { requestRawOrderAccess } from "./order-access-observers.mjs";
const runtime =
  await import("../dist/testing/order-access-composition.js").catch(
    () => undefined,
  );
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

async function withIngress(verify, exchangeMax = 10000) {
  assert.equal(
    typeof runtime?.createTestOrderAccessComposition,
    "function",
    "Actual order access API composition must exist",
  );
  await withEphemeralPostgres(async (database) => {
    await runMigrations({
      clientConfig: database,
      workspaceRoot,
      command: { direction: "up" },
    });
    const kms = createCartHttpTestKms(),
      logs = [];
    let app, composition;
    const origin = "https://store.example.test";
    const configuration = {
      schemaVersion: 1,
      publicStorefrontOrigin: origin,
      linkTtlSeconds: 600,
      sessionTtlSeconds: 600,
      rateLimit: {
        windowSeconds: 10,
        exchangeMax,
        bootstrapMax: 10000,
        readMax: 10000,
        revokeMax: 10000,
      },
    };
    try {
      composition = runtime.createTestOrderAccessComposition({
        environment: "TEST",
        database,
        publicMediaBaseUrl: "https://media.example.test",
        keyManagement: kms.adapter,
        activePepperVersion: "test-mac",
        pepperVersions: ["test-mac"],
        configuration,
      });
      app = await createApiApplication(
        { ...preflightEnvironment(database), FAN_SUPPORT_SITE_ORIGIN: origin },
        {
          ...composition,
          logger: createStructuredLogger({
            service: "api",
            write: (line) => logs.push(line),
          }),
        },
      );
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      const canaries = [],
        requests = [];
      async function send(route, { method = "POST", body, headers = {} } = {}) {
        const response = await globalThis.fetch(base + route, {
          method,
          headers: {
            ...(method === "GET"
              ? {}
              : { origin, "content-type": "application/json" }),
            ...headers,
          },
          ...(body === undefined
            ? {}
            : { body: typeof body === "string" ? body : JSON.stringify(body) }),
          signal: globalThis.AbortSignal.timeout(10000),
        });
        const json = await response.json();
        requests.push({ status: response.status, code: json.code });
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store",
        );
        assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
        assert.equal(response.headers.get("referrer-policy"), "no-referrer");
        assert.equal(response.headers.get("set-cookie"), null);
        return { response, json };
      }
      await verify({
        send,
        canaries,
        base,
        origin,
        credentials: composition.orderAccessRoute.credentials,
      });
      assert.ok(
        canaries.every((token) => logs.every((line) => !line.includes(token))),
      );
      console.log(
        JSON.stringify({
          status: "PASS",
          actualPostgres: true,
          actualHttp: true,
          fixtureOrders: 0,
          requests,
        }),
      );
    } finally {
      await app?.close();
      await composition?.orderAccessRuntime.stop();
      kms.close();
    }
  });
}

test("actual empty PostgreSQL access HTTP fails closed on unknown credentials and malformed payloads", async () => {
  await withIngress(async ({ send, canaries }) => {
    const token = randomBytes(32).toString("base64url");
    canaries.push(token);
    assert.equal(
      (await send(`/api/v1/orders/${randomUUID()}`, { method: "GET" })).response
        .status,
      401,
    );
    assert.equal(
      (
        await send(`/api/v1/checkout/sessions/${randomUUID()}/order-access`, {
          body: { schemaVersion: 1 },
        })
      ).response.status,
      401,
    );
    assert.equal(
      (
        await send("/api/v1/order-access/exchange", {
          body: { schemaVersion: 1, token },
        })
      ).response.status,
      401,
    );
    assert.equal(
      (
        await send("/api/v1/order-access/exchange", {
          body: { schemaVersion: 1, token: "x" },
        })
      ).response.status,
      400,
    );
    assert.equal(
      (await send("/api/v1/order-access/exchange", { body: "[" })).response
        .status,
      400,
    );
    assert.equal(
      (
        await send("/api/v1/order-access/exchange", {
          body: JSON.stringify({ schemaVersion: 1, token: "x".repeat(2000) }),
        })
      ).response.status,
      413,
    );
    assert.equal(
      (
        await send("/api/v1/order-access/exchange", {
          body: { schemaVersion: 1, token },
          headers: { origin: "https://untrusted.example.test" },
        })
      ).response.status,
      403,
    );
  });
});

test("actual access limiter persists failed exchange attempts and rejects spoofed proxy identity", async () => {
  await withIngress(async ({ send, canaries }) => {
    for (let index = 0; index < 3; index++) {
      const token = randomBytes(32).toString("base64url");
      canaries.push(token);
      const result = await send("/api/v1/order-access/exchange", {
        body: { schemaVersion: 1, token },
        headers: { "x-forwarded-for": `192.0.2.${index + 1}` },
      });
      assert.equal(result.response.status, index < 2 ? 401 : 429);
      if (index === 2)
        assert.ok(Number(result.response.headers.get("retry-after")) > 0);
    }
  }, 2);
});

test("actual access HTTP sees valid framing and rejects repeated Cookie, Origin, and independent CSRF headers", async () => {
  await withIngress(async ({ base, origin, credentials, canaries }) => {
    const session = await credentials.issueSession();
    canaries.push(session.token, session.csrfToken);
    const body = JSON.stringify({
      schemaVersion: 1,
      publicOrderId: randomUUID(),
    });
    const headers = [
      "Origin",
      origin,
      "Content-Type",
      "application/json",
      "Cookie",
      `__Host-fan-order=${session.token}`,
      "X-CSRF-Token",
      session.csrfToken,
    ];
    for (const [extra, expected] of [
      [["Cookie", `__Host-fan-order=${session.token}`], 401],
      [["Origin", origin], 403],
      [["X-CSRF-Token", session.csrfToken], 403],
    ]) {
      const response = await requestRawOrderAccess(
        base,
        "/api/v1/order-access/revoke",
        { headers: [...headers, ...extra], body },
      );
      assert.equal(response.status, expected);
      assert.equal(JSON.parse(response.body).code, "ACCESS_DENIED");
      assert.equal(response.headers["cache-control"], "private, no-store");
      assert.equal(response.headers["referrer-policy"], "no-referrer");
      assert.equal(response.headers["set-cookie"], undefined);
      assert.ok(canaries.every((value) => !response.body.includes(value)));
    }
  });
});

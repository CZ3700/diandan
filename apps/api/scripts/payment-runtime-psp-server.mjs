import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { createPaymentTestPspStore } from "./payment-runtime-psp-store.mjs";

const privateHeaders = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
};
function equal(left, right) {
  return (
    typeof left === "string" &&
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}
async function bodyOf(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error("Bounded TEST PSP body");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
const escape = (value) =>
  String(value).replace(
    /[&<>"']/gu,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

/** Actual hosted TEST HTTPS service. Fault controls are IPC/harness-only, never public routes. */
export async function createPaymentTestPspServer(options) {
  let store, origin, fault;
  const observations = [];
  const secret = Buffer.from(options.authorizationToken, "base64url");
  if (secret.length !== 32)
    throw new TypeError("Invalid TEST PSP authorization");
  const formToken = (path) =>
    createHmac("sha256", secret)
      .update(`hosted-form:${path}`)
      .digest("base64url");
  const server = createServer(
    {
      cert: await readFile(options.certificatePath),
      key: await readFile(options.privateKeyPath),
      minVersion: "TLSv1.2",
    },
    async (request, response) => {
      try {
        if (
          !store ||
          request.headers.host !== new globalThis.URL(origin).host
        ) {
          response.writeHead(503, privateHeaders).end();
          return;
        }
        const url = new globalThis.URL(request.url, origin);
        if (url.origin !== origin || url.search) {
          response.writeHead(400, privateHeaders).end();
          return;
        }
        if (request.method === "POST" && url.pathname === "/v1/commands") {
          if (
            !equal(
              request.headers.authorization,
              `Bearer ${options.authorizationToken}`,
            ) ||
            request.headers.cookie ||
            request.headers["content-type"] !== "application/json"
          ) {
            request.resume();
            response.writeHead(401, privateHeaders).end();
            return;
          }
          const command = JSON.parse(await bodyOf(request));
          const armed = fault?.operation === command.operation ? fault : null;
          if (armed) fault = undefined;
          if (armed?.mode === "BEFORE") {
            response.destroy();
            observations.push({
              operation: command.operation,
              fault: "BEFORE",
              accepted: false,
            });
            return;
          }
          const result = await store.execute(command);
          const accepted = result.outcome === "SUCCESS";
          observations.push({
            operation: command.operation,
            fault: armed?.mode ?? null,
            accepted,
          });
          if (armed?.mode === "AFTER" && accepted) {
            response.destroy();
            return;
          }
          if (armed?.mode === "MALFORMED" && accepted) {
            response
              .writeHead(200, {
                ...privateHeaders,
                "content-type": "application/json",
              })
              .end('{"invalid":true}');
            return;
          }
          response
            .writeHead(200, {
              ...privateHeaders,
              "content-type": "application/json",
            })
            .end(JSON.stringify(result));
          return;
        }
        const hosted = /^\/hosted\/([a-f\d-]{36})\/([A-Za-z0-9_-]{43})$/iu.exec(
          url.pathname,
        );
        if (!hosted || !["GET", "POST"].includes(request.method)) {
          request.resume();
          response.writeHead(404, privateHeaders).end();
          return;
        }
        if (request.headers.cookie || request.headers.authorization)
          observations.push({
            operation: "HOSTED",
            unexpectedCredentials: true,
          });
        const value = await store.readHosted(hosted[1], hosted[2]);
        if (request.method === "POST") {
          const body = new globalThis.URLSearchParams(await bodyOf(request));
          if (
            request.headers.origin !== origin ||
            !equal(body.get("csrf"), formToken(url.pathname)) ||
            [...body.keys()].some(
              (key) => !["csrf", "outcome"].includes(key),
            ) ||
            body.getAll("csrf").length !== 1 ||
            body.getAll("outcome").length !== 1
          ) {
            response.writeHead(403, privateHeaders).end();
            return;
          }
          await store.settleHosted(hosted[1], hosted[2], body.get("outcome"));
          response
            .writeHead(303, {
              ...privateHeaders,
              location:
                body.get("outcome") === "CANCELED"
                  ? value.cancelUrl
                  : value.returnUrl,
            })
            .end();
          return;
        }
        observations.push({
          operation: "HOSTED",
          unexpectedCredentials: false,
        });
        const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TEST payment</title><body><main><h1>TEST payment — no real charge</h1><p>This is an isolated payment simulator. Do not enter card or wallet information.</p><p data-test-psp-amount>${escape(value.currency)} ${escape(value.amountMinor)} minor units</p><p data-test-psp-status>${escape(value.status)}</p><form method="post"><input type="hidden" name="csrf" value="${escape(formToken(url.pathname))}"><button name="outcome" value="SUCCEEDED" data-test-psp-capture>Simulate completed payment</button><button name="outcome" value="FAILED" data-test-psp-fail>Simulate declined payment</button><button name="outcome" value="CANCELED" data-test-psp-cancel>Cancel test payment</button><button name="outcome" value="EXPIRED" data-test-psp-expire>Simulate expired payment</button></form></main></body></html>`;
        response
          .writeHead(200, {
            ...privateHeaders,
            "content-type": "text/html; charset=utf-8",
            "referrer-policy": "strict-origin",
            "content-security-policy": `default-src 'none'; form-action 'self' ${new globalThis.URL(options.returnOrigin).origin}; base-uri 'none'; frame-ancestors 'none'`,
          })
          .end(page);
      } catch {
        if (!response.destroyed) response.writeHead(400, privateHeaders).end();
      }
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  origin = `https://payments.example.invalid:${server.address().port}`;
  try {
    store = await createPaymentTestPspStore({ ...options, secret, origin });
  } catch (error) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    secret.fill(0);
    throw error;
  }
  let closing;
  return {
    origin,
    binding: { ...options.binding, allowedActionOrigins: [origin] },
    counts: () => store.counts(),
    observations: () => observations.map((entry) => ({ ...entry })),
    hostedAction: (attemptId) => store.readHostedAction(attemptId),
    async webhook(value) {
      if (
        !value ||
        Object.keys(value).sort().join(",") !==
          "attemptId,verificationSecret" ||
        typeof value.verificationSecret !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/u.test(value.verificationSecret)
      )
        throw new TypeError("Invalid owned TEST webhook request");
      const verificationSecret = Buffer.from(
        value.verificationSecret,
        "base64url",
      );
      try {
        if (
          verificationSecret.length !== 32 ||
          verificationSecret.toString("base64url") !== value.verificationSecret
        )
          throw new TypeError("Invalid TEST webhook key");
        const rawBody = JSON.stringify(
          await store.readWebhook(value.attemptId),
        );
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac("sha256", verificationSecret)
          .update(timestamp)
          .update(".")
          .update(rawBody)
          .digest("hex");
        return {
          rawBody,
          headers: {
            "x-fan-support-timestamp": timestamp,
            "x-fan-support-signature": `v1=${signature}`,
          },
        };
      } finally {
        verificationSecret.fill(0);
      }
    },
    arm(value) {
      if (
        fault ||
        !["BEFORE", "AFTER", "MALFORMED"].includes(value.mode) ||
        ![
          "GET_CAPABILITIES",
          "CREATE_PAYMENT",
          "RECONCILE_PAYMENT",
          "GET_PAYMENT",
        ].includes(value.operation)
      )
        throw new TypeError("Invalid TEST PSP fault");
      fault = { ...value };
    },
    close: () =>
      (closing ??= (async () => {
        server.closeAllConnections();
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await store.close();
        secret.fill(0);
      })()),
  };
}

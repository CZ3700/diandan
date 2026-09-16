import { createHash } from "node:crypto";
import { beforeAll, afterAll, expect, test } from "vitest";
import {
  notificationEmailDispatchSchema,
  notificationGatewayProfileSchema,
} from "@fan-support/contracts";
import { createNotificationGatewayTransport } from "./gateway.js";
import { tlsHarness } from "./harness.tls.js";

let server: Awaited<ReturnType<typeof tlsHarness>>;
let mode: "NORMAL" | "DROP" | "SLOW" | "REDIRECT" | "OVERSIZE" = "NORMAL";
let sideEffects = 0;
const receipts = new Map<string, { body: string; receipt: unknown }>();
beforeAll(async () => {
  server = await tlsHarness((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const input = JSON.parse(body);
      const key = String(request.headers["idempotency-key"]);
      if (
        request.method !== "POST" ||
        request.url !== "/v1/notification-commands" ||
        request.headers.authorization !== "Bearer test-only-tls-authentication"
      ) {
        response.writeHead(403);
        response.end();
        return;
      }
      if (mode === "REDIRECT") {
        response.writeHead(307, {
          location: "https://unrelated.invalid/collect",
        });
        response.end();
        return;
      }
      if (mode === "SLOW") {
        response.writeHead(200, { "content-type": "application/json" });
        response.write("{");
        return;
      }
      if (mode === "OVERSIZE") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("x".repeat(65537));
        return;
      }
      let entry = receipts.get(key);
      if (entry && entry.body !== body) {
        response.writeHead(409);
        response.end();
        return;
      }
      if (!entry) {
        sideEffects++;
        entry = {
          body,
          receipt: {
            schemaVersion: 1,
            protocol: "fan-support-mail-v1",
            profileHash: input.profileHash,
            notificationId: input.email.notification.id,
            idempotencyKey: key,
            requestHash: createHash("sha256").update(body).digest("hex"),
            result: {
              schemaVersion: 1,
              operation: "SEND_NOTIFICATION",
              outcome: "SUCCESS",
              value: {
                status: "ACCEPTED",
                providerReference: `local-mail/${sideEffects}`,
                acceptedAt: new Date().toISOString(),
              },
            },
          },
        };
        receipts.set(key, entry);
      }
      if (mode === "DROP") {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(entry.receipt));
    });
  });
});
afterAll(async () => server.close());
function client(timeoutMs = 1000, trust = true) {
  return createNotificationGatewayTransport({
    profile: notificationGatewayProfileSchema.parse({
      schemaVersion: 1,
      protocol: "fan-support-mail-v1",
      environment: "TEST",
      apiOrigin: server.origin,
      fromEmail: "orders@example.test",
      fromName: "Studio",
      replyToEmail: "support@example.test",
      timeoutMs,
      idempotencyRetentionSeconds: 3600,
    }),
    resolveCredential: async () => "test-only-tls-authentication",
    fetcher: server.fetcher(trust),
  }).transport;
}
function email(suffix: string) {
  const id = `12345678-1234-4234-8234-1234567890${suffix}`;
  return notificationEmailDispatchSchema.parse({
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    channel: "EMAIL",
    dispatchNotAfter: new Date(Date.now() + 60000).toISOString(),
    recipient: "test-only@example.test",
    notification: {
      schemaVersion: 1,
      id,
      orderId: id,
      customerContactId: id,
      eventType: "PAYMENT_CONFIRMED",
      locale: {
        schemaVersion: 1,
        requestedLocale: "en",
        resolvedLocale: "en",
        fallbackUsed: false,
        templateKey: "order.payment.confirmed",
        templateVersion: "v1.1",
        contentRevisionIds: [],
      },
      idempotencyKey: `notification:${id}`,
      correlationId: id,
    },
    content: {
      subject: "Order",
      preheader: "Update",
      text: "Hello",
      html: "<p>Hello</p>",
    },
  });
}
test("actual TLS lost response after acceptance recovers identical receipt from a fresh client without duplicate dispatch", async () => {
  mode = "DROP";
  const before = sideEffects;
  const command = email("01");
  expect(await client().sendEmail(command)).toMatchObject({
    outcome: "FAILURE",
    error: { code: "TIMEOUT_OUTCOME_UNKNOWN" },
  });
  mode = "NORMAL";
  expect(await client().sendEmail(command)).toMatchObject({
    outcome: "SUCCESS",
    value: { status: "ACCEPTED" },
  });
  expect(sideEffects - before).toBe(1);
  const repeated = await Promise.all(
    Array.from({ length: 8 }, () => client().sendEmail(command)),
  );
  expect(repeated.every((r) => r.outcome === "SUCCESS")).toBe(true);
  expect(sideEffects - before).toBe(1);
});
test("actual TLS rejects an untrusted TEST certificate before recipient dispatch", async () => {
  const before = sideEffects;
  mode = "NORMAL";
  expect(await client(1000, false).sendEmail(email("02"))).toMatchObject({
    outcome: "FAILURE",
    error: { code: "TIMEOUT_OUTCOME_UNKNOWN" },
  });
  expect(sideEffects).toBe(before);
});
test.each(["REDIRECT", "SLOW", "OVERSIZE"] as const)(
  "bounds %s without following another origin or hanging",
  async (next) => {
    mode = next;
    const before = sideEffects;
    const start = performance.now();
    expect(await client(150).sendEmail(email("03"))).toMatchObject({
      outcome: "FAILURE",
      error: { code: "TIMEOUT_OUTCOME_UNKNOWN" },
    });
    expect(performance.now() - start).toBeLessThan(1200);
    expect(sideEffects).toBe(before);
  },
);

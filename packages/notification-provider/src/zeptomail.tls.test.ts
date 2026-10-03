import { afterAll, beforeAll, expect, test } from "vitest";
import { notificationEmailDispatchSchema } from "@fan-support/contracts";
import * as adapter from "./index.js";
import { tlsHarness } from "./harness.tls.js";

let server: Awaited<ReturnType<typeof tlsHarness>>;
let mode = "NORMAL";
let requests = 0;
let submitted: unknown;
beforeAll(async () => {
  server = await tlsHarness((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests++;
      submitted = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        request.method !== "POST" ||
        request.url !== "/v1.1/email" ||
        request.headers.authorization !==
          "Zoho-enczapikey synthetic-tls-token-123456"
      ) {
        response.writeHead(401);
        response.end();
        return;
      }
      if (mode === "DROP") {
        request.socket.destroy();
        return;
      }
      if (mode === "REDIRECT") {
        response.writeHead(307, { location: "/must-not-follow" });
        response.end();
        return;
      }
      response.setHeader("content-type", "application/json");
      if (mode === "SLOW") {
        response.writeHead(200);
        response.write("{");
        return;
      }
      if (mode === "PARTIAL") {
        response.writeHead(200);
        response.write('{"data":');
        setImmediate(() => request.socket.destroy());
        return;
      }
      if (mode === "OVERSIZE") {
        response.writeHead(200);
        response.end("x".repeat(65537));
        return;
      }
      if (mode === "INVALID_UTF8") {
        response.writeHead(200);
        response.end(Buffer.from([0xc3, 0x28]));
        return;
      }
      if (mode === "MALFORMED") {
        response.writeHead(200);
        response.end('{"data":');
        return;
      }
      if (mode === "AUTH") {
        response.writeHead(401);
        response.end('{"message":"synthetic-private-details"}');
        return;
      }
      if (mode === "REJECT") {
        response.writeHead(400);
        response.end(
          '{"data":{"error_code":"TM_3201","message":"synthetic-private-details"},"message":"error"}',
        );
        return;
      }
      if (mode === "RATE") {
        response.writeHead(429, { "retry-after": "2" });
        response.end("{}");
        return;
      }
      if (mode === "SERVER") {
        response.writeHead(503);
        response.end("{}");
        return;
      }
      response.writeHead(200);
      response.end(
        JSON.stringify({
          data: [{ code: "EM_104", message: "OK" }],
          message: "OK",
          request_id: "tls-request-123",
        }),
      );
    });
  });
});
afterAll(async () => server?.close());

function email() {
  const id = "12345678-1234-4234-8234-123456789012";
  return notificationEmailDispatchSchema.parse({
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    channel: "EMAIL",
    dispatchNotAfter: new Date(Date.now() + 60000).toISOString(),
    recipient: "synthetic-fan@example.test",
    notification: {
      schemaVersion: 1,
      id,
      orderId: id,
      customerContactId: id,
      eventType: "PAYMENT_CONFIRMED",
      locale: {
        schemaVersion: 1,
        requestedLocale: "th",
        resolvedLocale: "th",
        fallbackUsed: false,
        templateKey: "order.payment.confirmed",
        templateVersion: "v1.1",
        contentRevisionIds: [],
      },
      idempotencyKey: `notification:${id}`,
      correlationId: id,
    },
    content: {
      subject: "คำสั่งซื้อ",
      preheader: "อัปเดต",
      text: "synthetic-test-token",
      html: "<p>synthetic-test-token</p>",
    },
  });
}
function client(trust = true) {
  const factory = (
    adapter as unknown as {
      createZeptoMailSubmission?: (options: unknown) => {
        submitter: { sendEmail(input: unknown): Promise<unknown> };
      };
    }
  ).createZeptoMailSubmission;
  expect(factory).toBeDefined();
  return factory!({
    profile: {
      schemaVersion: 1,
      protocol: "zeptomail-v1",
      environment: "TEST",
      apiOrigin: server.origin,
      fromEmail: "orders@example.test",
      fromName: "Studio",
      replyToEmail: "support@example.test",
      timeoutMs: 200,
      idempotencyRetentionSeconds: 3600,
    },
    resolveCredential: async () => "synthetic-tls-token-123456",
    fetcher: server.fetcher(trust),
  }).submitter;
}

test("real strict TLS reaches the native protocol without internal order or customer metadata", async () => {
  mode = "NORMAL";
  const before = requests;
  expect(await client().sendEmail(email())).toMatchObject({
    outcome: "SUCCESS",
    value: {
      status: "ACCEPTED",
      providerReference: "zeptomail/tls-request-123",
    },
  });
  expect(requests - before).toBe(1);
  expect(submitted).toMatchObject({
    to: [{ email_address: { address: "synthetic-fan@example.test" } }],
    track_opens: false,
    track_clicks: false,
  });
  expect(JSON.stringify(submitted)).not.toMatch(
    /customerContactId|correlationId|idempotencyKey|dispatchNotAfter|transportKey|orderId/u,
  );
});
test.each([
  ["AUTH", "AUTHENTICATION_FAILED"],
  ["REJECT", "TEMPLATE_CONTENT_INVALID"],
  ["RATE", "RATE_LIMITED"],
  ["SERVER", "TIMEOUT_OUTCOME_UNKNOWN"],
  ["DROP", "TIMEOUT_OUTCOME_UNKNOWN"],
  ["PARTIAL", "TIMEOUT_OUTCOME_UNKNOWN"],
  ["SLOW", "TIMEOUT_OUTCOME_UNKNOWN"],
  ["REDIRECT", "TIMEOUT_OUTCOME_UNKNOWN"],
  ["OVERSIZE", "MALFORMED_PROVIDER_RESPONSE"],
  ["INVALID_UTF8", "MALFORMED_PROVIDER_RESPONSE"],
  ["MALFORMED", "MALFORMED_PROVIDER_RESPONSE"],
])(
  "real TLS %s remains bounded, never retries and emits only safe status",
  async (next, code) => {
    mode = next;
    const before = requests;
    const start = performance.now();
    const result = await client().sendEmail(email());
    expect(result).toMatchObject({ outcome: "FAILURE", error: { code } });
    expect(requests - before).toBe(1);
    expect(performance.now() - start).toBeLessThan(1500);
    expect(JSON.stringify(result)).not.toMatch(
      /synthetic-private|synthetic-test-token|synthetic-fan|synthetic-tls-token/u,
    );
  },
);
test("untrusted TLS cannot send the recipient or mail body", async () => {
  mode = "NORMAL";
  const before = requests;
  expect(await client(false).sendEmail(email())).toMatchObject({
    outcome: "FAILURE",
    error: { code: "TIMEOUT_OUTCOME_UNKNOWN" },
  });
  expect(requests).toBe(before);
});

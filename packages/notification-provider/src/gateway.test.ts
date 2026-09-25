import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { notificationEmailDispatchSchema } from "@fan-support/contracts";
import * as adapter from "./index.js";
const id = "12345678-1234-4234-8234-123456789012";
const profile = {
  schemaVersion: 1,
  protocol: "fan-support-mail-v1",
  environment: "TEST",
  apiOrigin: "https://mail.example.test",
  fromEmail: "orders@example.test",
  fromName: "Studio",
  replyToEmail: "support@example.test",
  timeoutMs: 1000,
  idempotencyRetentionSeconds: 3600,
};
const email = notificationEmailDispatchSchema.parse({
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  channel: "EMAIL",
  dispatchNotAfter: "2026-09-17T00:00:00Z",
  recipient: "fan@example.test",
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
    subject: "Order",
    preheader: "Update",
    text: "Hello",
    html: "<p>Hello</p>",
  },
});
function factory() {
  const candidate = (
    adapter as unknown as {
      createNotificationGatewayTransport?: (options: unknown) => {
        transportKey: string;
        transport: { sendEmail(input: unknown): Promise<unknown> };
      };
    }
  ).createNotificationGatewayTransport;
  expect(candidate).toBeDefined();
  return candidate!;
}
function receipt(init: RequestInit | undefined) {
  const body = String(init?.body);
  const input = JSON.parse(body);
  return {
    schemaVersion: 1,
    protocol: "fan-support-mail-v1",
    profileHash: input.profileHash,
    notificationId: id,
    idempotencyKey: email.notification.idempotencyKey,
    requestHash: createHash("sha256").update(body).digest("hex"),
    result: {
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
      outcome: "SUCCESS",
      value: {
        status: "ACCEPTED",
        providerReference: "capture/one",
        acceptedAt: "2026-09-16T00:00:00Z",
      },
    },
  };
}
test("freezes profile identity and sends exact same idempotent protocol bytes", async () => {
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) =>
    Response.json(receipt(init)),
  );
  const instance = factory()({
    profile,
    resolveCredential: async () => "test-only-authentication-value",
    fetcher,
  });
  const first = await instance.transport.sendEmail(email),
    second = await instance.transport.sendEmail(email);
  expect(first).toEqual(second);
  expect(first).toMatchObject({
    outcome: "SUCCESS",
    value: { status: "ACCEPTED" },
  });
  expect(fetcher.mock.calls[0]![1]?.body).toEqual(
    fetcher.mock.calls[1]![1]?.body,
  );
  expect(fetcher.mock.calls[0]![1]?.headers).toEqual(
    fetcher.mock.calls[1]![1]?.headers,
  );
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    headers: { "idempotency-key": email.notification.idempotencyKey },
  });
  expect(instance.transportKey).toMatch(/^[a-f0-9]{64}$/u);
});
test.each(["notificationId", "requestHash", "profileHash"])(
  "rejects mismatched %s without accepting an unrelated receipt",
  async (field) => {
    const fetcher = async (_input: unknown, init?: RequestInit) =>
      Response.json({
        ...receipt(init),
        [field]:
          field === "notificationId"
            ? "12345678-1234-4234-8234-123456789099"
            : "f".repeat(64),
      });
    const instance = factory()({
      profile,
      resolveCredential: async () => "test-only-authentication-value",
      fetcher,
    });
    expect(await instance.transport.sendEmail(email)).toMatchObject({
      outcome: "FAILURE",
      error: {
        code: "MALFORMED_PROVIDER_RESPONSE",
        recovery: "RETRY_SAME_COMMAND",
      },
    });
  },
);
test("bounds credential resolution as well as response reading by one deadline", async () => {
  const instance = factory()({
    profile: { ...profile, timeoutMs: 100 },
    resolveCredential: () => new Promise(() => {}),
    fetcher: vi.fn(),
  });
  const start = performance.now();
  expect(await instance.transport.sendEmail(email)).toMatchObject({
    outcome: "FAILURE",
    error: { code: "TEMPORARY_UNAVAILABLE" },
  });
  expect(performance.now() - start).toBeLessThan(1000);
});
test("unknown transport failures expose no raw provider exception", async () => {
  const instance = factory()({
    profile,
    resolveCredential: async () => "test-only-authentication-value",
    fetcher: async () => {
      throw new Error("PRIVATE_ADDRESS_TOKEN");
    },
  });
  const result = await instance.transport.sendEmail(email);
  expect(result).toMatchObject({
    outcome: "FAILURE",
    error: { code: "TIMEOUT_OUTCOME_UNKNOWN" },
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_ADDRESS_TOKEN");
});

test.each(["2026-09-17T00:00:00Z", "2026-09-17T00:00:00.001Z"])(
  "rejects an acceptance at or after the frozen dispatch cutoff: %s",
  async (acceptedAt) => {
    const fetcher = async (_input: unknown, init?: RequestInit) => {
      const value = receipt(init);
      return Response.json({
        ...value,
        result: {
          ...value.result,
          value: { ...value.result.value, acceptedAt },
        },
      });
    };
    const instance = factory()({
      profile,
      resolveCredential: async () => "test-only-authentication-value",
      fetcher,
    });
    expect(await instance.transport.sendEmail(email)).toMatchObject({
      outcome: "FAILURE",
      error: {
        code: "MALFORMED_PROVIDER_RESPONSE",
        recovery: "RETRY_SAME_COMMAND",
      },
    });
  },
);

test("keeps the absolute cutoff in request bytes and allows a replay receipt accepted before cutoff", async () => {
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) =>
    Response.json(receipt(init)),
  );
  const instance = factory()({
    profile,
    resolveCredential: async () => "test-only-authentication-value",
    fetcher,
  });
  const result = await instance.transport.sendEmail(email);
  expect(result).toMatchObject({ outcome: "SUCCESS" });
  expect(
    JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).email.dispatchNotAfter,
  ).toBe(email.dispatchNotAfter);
});

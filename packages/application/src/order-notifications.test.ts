import { createHmac } from "node:crypto";
import { expect, test, vi } from "vitest";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type {
  NotificationRepository,
  NotificationTransactionManager,
} from "@fan-support/persistence-port";
import {
  notificationPortResponseSchema,
  notificationRuntimeConfigurationSchema,
  notificationDeliveryPlanSchema,
  notificationAttachLinkResultSchema,
  notificationRecipientResultSchema,
  notificationCommandSchema,
  type NotificationEmailDispatch,
  type ComputeBlindIndexCommand,
  type OrderNotificationRenderCommand,
} from "@fan-support/contracts";
import * as application from "./index.js";

const id = "12345678-1234-4234-8234-123456789012";
const other = "12345678-1234-4234-8234-123456789013";
const configuration = notificationRuntimeConfigurationSchema.parse({
  schemaVersion: 1,
  siteName: "Studio",
  publicStorefrontOrigin: "https://store.example.test",
  transportKey: "a".repeat(64),
  linkPepperVersion: "test-v1",
  linkTtlSeconds: 3600,
  idempotencyRetentionSeconds: 3600,
  leaseSeconds: 30,
  retryDelaySeconds: 1,
  maxAttempts: 6,
});
const selection = {
  schemaVersion: 1 as const,
  eventType: "PAYMENT_CONFIRMED" as const,
  requestedLocale: "th" as const,
  resolvedLocale: "th" as const,
  fallbackUsed: false,
  templateKey: "order.payment.confirmed" as const,
  templateVersion: `v1.${"b".repeat(64)}`,
};
const plan = notificationDeliveryPlanSchema.parse({
  schemaVersion: 1,
  notification: {
    schemaVersion: 1,
    id,
    orderId: id,
    customerContactId: other,
    eventType: "PAYMENT_CONFIRMED",
    locale: {
      schemaVersion: 1,
      requestedLocale: "th",
      resolvedLocale: "th",
      fallbackUsed: false,
      templateKey: selection.templateKey,
      templateVersion: selection.templateVersion,
      contentRevisionIds: [],
    },
    idempotencyKey: `notification:${id}`,
    correlationId: id,
  },
  baseVariables: {
    schemaVersion: 1,
    siteName: "Studio",
    publicOrderId: id,
    orderedAt: "2026-09-16T00:00:00Z",
    currency: "USD",
    totalMinor: 100,
    items: [
      {
        idolName: "Past Artist",
        idolLocale: "ja",
        giftName: "Past Gift",
        giftLocale: "vi",
        variantName: null,
        variantLocale: null,
        quantity: 1,
        lineTotalMinor: 100,
      },
    ],
  },
  publicStorefrontOrigin: configuration.publicStorefrontOrigin,
  transportKey: configuration.transportKey,
  linkNonce: "c".repeat(64),
  linkPepperVersion: "test-v1",
  linkTtlSeconds: 3600,
  dedupeUntil: "2026-09-17T00:00:00Z",
  leaseToken: other,
  attemptNumber: 1,
});
function fixture() {
  const trace: string[] = [];
  const repo: NotificationRepository = {
    source: vi.fn<NotificationRepository["source"]>(async () => ({
      schemaVersion: 1,
      decision: "READY",
      eventType: "PAYMENT_CONFIRMED",
      requestedLocale: "th",
    })),
    request: vi.fn<NotificationRepository["request"]>(async () => ({
      schemaVersion: 1,
      decision: "CREATED",
      notificationId: id,
      fallbackUsed: false,
    })),
    listPending: vi.fn<NotificationRepository["listPending"]>(async () => ({
      schemaVersion: 1,
      notificationIds: [id],
    })),
    claim: vi.fn<NotificationRepository["claim"]>(async () => ({
      schemaVersion: 1,
      decision: "READY",
      plan,
    })),
    attachLink: vi.fn<NotificationRepository["attachLink"]>(async () => {
      trace.push("attach");
      return notificationAttachLinkResultSchema.parse({
        schemaVersion: 1,
        publicOrderId: id,
        expiresAt: "2026-09-17T00:00:00Z",
      });
    }),
    recipient: vi.fn<NotificationRepository["recipient"]>(async () => {
      trace.push("audit");
      return notificationRecipientResultSchema.parse({
        schemaVersion: 1,
        customerContactId: other,
        ciphertext: `enc:v1:${"a".repeat(43)}`,
        encryptedDataKey: `enc:v1:${"b".repeat(43)}`,
        keyVersion: "test-v1",
        algorithm: "AES_256_GCM",
      });
    }),
    confirmSend: vi.fn<NotificationRepository["confirmSend"]>(async () => {
      trace.push("confirm");
      return { schemaVersion: 1, decision: "READY" };
    }),
    finish: vi.fn<NotificationRepository["finish"]>(async () => {
      trace.push("finish");
      return { schemaVersion: 1, decision: "SENT" };
    }),
  };
  const transactions: NotificationTransactionManager = {
    runInNotificationTransaction: async (work) => work(repo),
  };
  const keys = {
    computeBlindIndex: vi.fn(async (command: ComputeBlindIndexCommand) => ({
      schemaVersion: 1,
      operation: "COMPUTE_BLIND_INDEX",
      outcome: "SUCCESS",
      value: {
        digestBase64: createHmac("sha256", "test-only-key")
          .update(command.valueBase64)
          .digest("base64url"),
        keyVersion: command.keyVersion!,
        algorithm: "HMAC_SHA_256",
      },
    })),
    decryptEnvelope: vi.fn(async () => {
      trace.push("decrypt");
      return {
        schemaVersion: 1,
        operation: "DECRYPT_ENVELOPE",
        outcome: "SUCCESS",
        value: {
          plaintextBase64: Buffer.from("private@example.test").toString(
            "base64url",
          ),
        },
      };
    }),
  } as unknown as KeyManagementPort;
  const sendEmail = vi.fn(async (_command: NotificationEmailDispatch) => {
    void _command;
    trace.push("send");
    return {
      schemaVersion: 1 as const,
      operation: "SEND_NOTIFICATION" as const,
      outcome: "SUCCESS" as const,
      value: {
        status: "ACCEPTED" as const,
        providerReference: "capture/one",
        acceptedAt: "2026-09-16T00:00:00Z",
      },
    };
  });
  const templates = {
    select: vi.fn(() => selection),
    render: vi.fn((command: OrderNotificationRenderCommand) => ({
      subject: "Order",
      preheader: "Update",
      html: `<a href="${command.variables.orderUrl}">View</a>`,
      text: command.variables.orderUrl,
    })),
  };
  const factory = (
    application as unknown as {
      createOrderNotificationUseCases?: (dependencies: unknown) => {
        deliver(id: string): Promise<unknown>;
        request(id: string): Promise<unknown>;
        runPending(limit: number): Promise<unknown>;
      };
    }
  ).createOrderNotificationUseCases;
  expect(factory).toBeDefined();
  const useCases = factory!({
    transactions,
    keyManagement: keys,
    templates,
    transportForKey: (key: string) =>
      key === configuration.transportKey ? { sendEmail } : undefined,
    configuration,
    createId: () => other,
    createNonce: () => "d".repeat(64),
  });
  return { repo, keys, templates, sendEmail, useCases, trace };
}
test("authorizes contact before decrypting, sends historical content, and persists only digest material", async () => {
  const f = fixture();
  await f.useCases.deliver(id);
  expect(f.trace).toEqual([
    "audit",
    "decrypt",
    "attach",
    "confirm",
    "send",
    "finish",
  ]);
  const sent = f.sendEmail.mock.calls[0]![0];
  expect(sent.recipient).toBe("private@example.test");
  expect(sent.notification.locale.requestedLocale).toBe("th");
  expect(
    f.templates.render.mock.calls[0]![0].variables.items[0]!.giftName,
  ).toBe("Past Gift");
  const token = new URL(sent.content.text).hash.slice(7).split("&")[0]!;
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  const persisted = JSON.stringify([
    vi.mocked(f.repo.attachLink).mock.calls,
    vi.mocked(f.repo.confirmSend).mock.calls,
    vi.mocked(f.repo.finish).mock.calls,
  ]);
  expect(persisted).not.toContain(token);
  expect(persisted).not.toContain("private@example.test");
});
test("same frozen plan reproduces identical provider bytes and key after worker restart", async () => {
  const a = fixture(),
    b = fixture();
  await a.useCases.deliver(id);
  await b.useCases.deliver(id);
  expect(a.sendEmail.mock.calls[0]![0]).toEqual(b.sendEmail.mock.calls[0]![0]);
});
test("invalid templates preserve the prior usable order link and do not decrypt the contact", async () => {
  const f = fixture();
  f.templates.render.mockImplementation(() => {
    throw new Error("template unavailable");
  });
  await f.useCases.deliver(id);
  expect(f.repo.attachLink).not.toHaveBeenCalled();
  expect(f.repo.recipient).not.toHaveBeenCalled();
  expect(f.keys.decryptEnvelope).not.toHaveBeenCalled();
  expect(vi.mocked(f.repo.finish).mock.calls[0]![0].result).toMatchObject({
    outcome: "FAILURE",
    error: { code: "TEMPLATE_CONTENT_INVALID" },
  });
});
test("lost lease at final confirmation prevents the external side effect", async () => {
  const f = fixture();
  vi.mocked(f.repo.confirmSend).mockResolvedValue({
    schemaVersion: 1,
    decision: "SKIP",
  });
  await f.useCases.deliver(id);
  expect(f.sendEmail).not.toHaveBeenCalled();
});
test("malformed claimed identity never decrypts or sends", async () => {
  const f = fixture();
  vi.mocked(f.repo.claim).mockResolvedValue({
    schemaVersion: 1,
    decision: "READY",
    plan: {
      ...plan,
      notification: notificationCommandSchema.parse({
        ...plan.notification,
        id: other,
      }),
    },
  });
  await expect(f.useCases.deliver(id)).rejects.toThrow("Notification");
  expect(f.keys.decryptEnvelope).not.toHaveBeenCalled();
  expect(f.sendEmail).not.toHaveBeenCalled();
});
test("transport exception is recorded as unknown without leaking its message", async () => {
  const f = fixture();
  f.sendEmail.mockRejectedValue(
    new Error("private@example.test SECRET_PAYLOAD"),
  );
  await f.useCases.deliver(id);
  const result = vi.mocked(f.repo.finish).mock.calls[0]![0].result;
  expect(notificationPortResponseSchema.safeParse(result).success).toBe(true);
  expect(result).toMatchObject({
    outcome: "FAILURE",
    error: { code: "TIMEOUT_OUTCOME_UNKNOWN", recovery: "RETRY_SAME_COMMAND" },
  });
  expect(JSON.stringify(result)).not.toContain("SECRET");
});

test.each(["claim", "confirmSend"] as const)(
  "%s terminal failure is counted and alerted without a second finish",
  async (boundary) => {
    const f = fixture();
    vi.mocked(f.repo[boundary]).mockResolvedValue({
      schemaVersion: 1,
      decision: "FAILED",
    });
    await expect(f.useCases.runPending(10)).resolves.toMatchObject({
      failed: 1,
      skipped: 0,
    });
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.repo.finish).not.toHaveBeenCalled();
  },
);

test("mail links target the existing privacy-protected storefront entry route", async () => {
  const f = fixture();
  await f.useCases.deliver(id);
  expect(new URL(f.sendEmail.mock.calls[0]![0].content.text).pathname).toBe(
    "/th/order-access",
  );
});

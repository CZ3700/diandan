import { expect, test, vi } from "vitest";
import type * as Application from "@fan-support/application";
import { notificationEmailDispatchSchema } from "@fan-support/contracts";
import {
  createOrderNotificationUseCases,
  createAdminOrderResendUseCases,
} from "@fan-support/application";
import {
  createTestWorkerNotifications,
  prepareOptionalWorkerNotifications,
} from "./notification-composition.js";
import { workerNotificationConfigurationSchema } from "./notification-config.js";

vi.mock("@fan-support/application", async (original) => ({
  ...(await original<typeof Application>()),
  createOrderNotificationUseCases: vi.fn(() => ({
    runPending: async () => ({ scanned: 0 }),
  })),
  createAdminOrderResendUseCases: vi.fn(() => ({
    runPending: async () => ({ scanned: 0 }),
  })),
}));
const id = "12345678-1234-4234-8234-123456789012";
const key = "a".repeat(64);
const profile = {
  schemaVersion: 1,
  protocol: "zeptomail-v1",
  environment: "TEST",
  apiOrigin: "https://mail.example.test",
  fromEmail: "orders@example.test",
  fromName: "Studio",
  replyToEmail: "support@example.test",
  timeoutMs: 1000,
  idempotencyRetentionSeconds: 3600,
};
const configuration = {
  schemaVersion: 1,
  siteName: "Studio",
  publicStorefrontOrigin: "https://store.example.test",
  activeProfile: "native",
  profiles: [
    { name: "native", credentialEnvironmentVariable: "MAIL_TOKEN", profile },
  ],
  linkPepperVersion: "test-v1",
  acceptedPepperVersions: ["test-v1"],
  linkTtlSeconds: 3600,
  leaseSeconds: 30,
  retryDelaySeconds: 1,
  maxAttempts: 6,
  incidentFallbackLocales: [],
};
const accepted = {
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  outcome: "SUCCESS",
  value: {
    status: "ACCEPTED",
    providerReference: "provider-request-1",
    acceptedAt: "2026-09-29T00:00:00Z",
  },
} as const;
const email = notificationEmailDispatchSchema.parse({
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  channel: "EMAIL",
  dispatchNotAfter: "2030-01-01T00:00:00Z",
  recipient: "fan@example.test",
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
    text: "Order update",
    html: "<p>Order update</p>",
  },
});
function options() {
  const claim = vi.fn(async () => ({ schemaVersion: 1, decision: "SEND" }));
  const finish = vi.fn(async () => ({ schemaVersion: 1, decision: "STORED" }));
  const sendEmail = vi.fn(async () => accepted);
  const submissionFactory = vi.fn(() => ({
    transportKey: key,
    submitter: { sendEmail },
  }));
  const journal = {
    runInNotificationSubmissionTransaction: async (
      work: (repo: unknown) => Promise<unknown>,
    ) => work({ claim, finish }),
  };
  return {
    claim,
    finish,
    sendEmail,
    submissionFactory,
    input: {
      environment: "TEST",
      configuration,
      credentials: { MAIL_TOKEN: "test-credential-long-enough" },
      transactions: {},
      resendTransactions: {},
      keyManagement: {},
      submissionFactory,
      submissionTransactions: journal,
    },
  };
}
function create(input: unknown) {
  return createTestWorkerNotifications(
    input as Parameters<typeof createTestWorkerNotifications>[0],
  );
}
test("accepts the explicit native profile while retaining strict gateway config", () => {
  expect(
    workerNotificationConfigurationSchema.safeParse(configuration).success,
  ).toBe(true);
  expect(
    workerNotificationConfigurationSchema.safeParse({
      ...configuration,
      profiles: [
        {
          ...configuration.profiles[0],
          profile: { ...profile, allowUnsafeRetry: true },
        },
      ],
    }).success,
  ).toBe(false);
});
test("native mail refuses to start without a committed submission journal", () => {
  const f = options();
  expect(() =>
    create({ ...f.input, submissionTransactions: undefined }),
  ).toThrow("Invalid durable notification transport configuration");
  expect(f.sendEmail).not.toHaveBeenCalled();
});
test("worker gives both notification use cases a durable wrapper instead of the raw submitter", async () => {
  const f = options();
  vi.mocked(createOrderNotificationUseCases).mockClear();
  vi.mocked(createAdminOrderResendUseCases).mockClear();
  create(f.input);
  const dependencies = vi.mocked(createOrderNotificationUseCases).mock
    .calls[0]![0];
  const transport = dependencies.transportForKey(key)!;
  const manual = vi.mocked(createAdminOrderResendUseCases).mock.calls[0]![0];
  expect(manual.transportForKey(key)).toBe(transport);
  expect(transport).not.toBe(
    f.submissionFactory.mock.results[0]!.value.submitter,
  );
  expect(await transport.sendEmail(email)).toEqual(accepted);
  expect(f.claim).toHaveBeenCalledOnce();
  expect(f.finish).toHaveBeenCalledOnce();
  expect(f.sendEmail).toHaveBeenCalledOnce();
  f.claim.mockResolvedValue({ schemaVersion: 1, decision: "UNKNOWN" });
  await transport.sendEmail(email);
  expect(f.sendEmail).toHaveBeenCalledOnce();
});
test("TEST cannot select LIVE native mail even with an injected factory", () => {
  const f = options();
  expect(() =>
    create({
      ...f.input,
      configuration: {
        ...configuration,
        profiles: [
          {
            ...configuration.profiles[0],
            profile: { ...profile, environment: "LIVE" },
          },
        ],
      },
    }),
  ).toThrow("Invalid TEST notification configuration");
  expect(f.submissionFactory).not.toHaveBeenCalled();
});
test("native presence does not bypass missing production access configuration", () => {
  expect(() =>
    prepareOptionalWorkerNotifications({
      FAN_SUPPORT_NOTIFICATION_CONFIG_JSON: JSON.stringify(configuration),
    }),
  ).toThrow("Invalid notification worker configuration");
});

import { workerNotificationConfigurationSchema } from "./notification-config.js";
import { expect, test, vi } from "vitest";
import * as module from "./notification-composition.js";
import type {
  NotificationRepository,
  NotificationTransactionManager,
} from "@fan-support/persistence-port";

test("notification composition stays disabled without explicit approved configuration", () => {
  expect(module.createOptionalWorkerNotifications).toBeTypeOf("function");
  expect(
    module.createOptionalWorkerNotifications({}, {} as never),
  ).toBeUndefined();
});
test("malformed notification configuration fails closed without logging its contents", () => {
  const secret = "PRIVATE_CONFIGURATION_CANARY";
  expect(() =>
    module.createOptionalWorkerNotifications(
      { FAN_SUPPORT_NOTIFICATION_CONFIG_JSON: secret },
      {} as never,
    ),
  ).toThrow("Invalid notification worker configuration");
});
test("a TEST-only composition refuses a LIVE gateway even when draft templates were injected", () => {
  expect(module.createTestWorkerNotifications).toBeTypeOf("function");
  const transportFactory = vi.fn();
  expect(() =>
    module.createTestWorkerNotifications({
      environment: "TEST",
      configuration: testConfiguration("LIVE"),
      credentials: { TEST_MAIL_KEY: "test-key" },
      transactions: {} as never,
      keyManagement: {} as never,
      transportFactory,
    }),
  ).toThrow("Invalid TEST notification configuration");
  expect(transportFactory).not.toHaveBeenCalled();
});

test.each([undefined, "short", "invalid\ncredential-long-enough"])(
  "rejects unusable configured credentials before a profile can rotate an order link",
  (credential) => {
    const configuration = testConfiguration();
    configuration.profiles[0]!.credentialEnvironmentVariable =
      "MAIL_GATEWAY_KEY";
    const transportFactory = vi.fn(() => ({
      transportKey: "a".repeat(64),
      transport: {
        sendEmail: async () => {
          throw new Error("unexpected transport call");
        },
      },
    }));
    expect(() =>
      module.createTestWorkerNotifications({
        environment: "TEST",
        configuration,
        credentials: { MAIL_GATEWAY_KEY: credential },
        transactions: {} as never,
        keyManagement: {} as never,
        transportFactory,
      }),
    ).toThrow("Invalid notification worker configuration");
    expect(transportFactory).not.toHaveBeenCalled();
  },
);

function testConfiguration(environment: "TEST" | "LIVE" = "TEST") {
  return workerNotificationConfigurationSchema.parse({
    schemaVersion: 1,
    siteName: "Studio",
    publicStorefrontOrigin: "https://store.example.test",
    activeProfile: "mail",
    profiles: [
      {
        name: "mail",
        credentialEnvironmentVariable: "TEST_MAIL_KEY",
        profile: {
          schemaVersion: 1,
          protocol: "fan-support-mail-v1",
          environment,
          apiOrigin: "https://mail.example.test",
          fromEmail: "orders@example.test",
          fromName: "Studio",
          replyToEmail: "support@example.test",
          timeoutMs: 1000,
          idempotencyRetentionSeconds: 60,
        },
      },
    ],
    linkPepperVersion: "test-v1",
    acceptedPepperVersions: ["test-v1"],
    linkTtlSeconds: 3600,
    leaseSeconds: 30,
    retryDelaySeconds: 1,
    maxAttempts: 6,
    incidentFallbackLocales: [],
  });
}

test("freezes validated credentials for active and retained profiles", async () => {
  const credentials = {
    MAIL_GATEWAY_KEY: "test-credential-with-enough-length",
  };
  const configuration = testConfiguration();
  configuration.profiles[0]!.credentialEnvironmentVariable = "MAIL_GATEWAY_KEY";
  const resolvers: Array<() => Promise<string>> = [];
  const transportFactory = vi.fn(
    (options: { resolveCredential(): Promise<string> }) => {
      resolvers.push(options.resolveCredential);
      return {
        transportKey: "a".repeat(64),
        transport: {
          sendEmail: async () => {
            throw new Error("unexpected transport call");
          },
        },
      };
    },
  );
  module.createTestWorkerNotifications({
    environment: "TEST",
    configuration,
    credentials,
    transactions: {} as never,
    keyManagement: {} as never,
    transportFactory,
  });
  credentials.MAIL_GATEWAY_KEY = "replaced-with-another-credential";
  expect(await resolvers[0]!()).toBe("test-credential-with-enough-length");
  const retained = {
    ...configuration.profiles[0]!,
    name: "retained",
    credentialEnvironmentVariable: "MISSING_RETAINED_KEY",
  };
  configuration.profiles.push(retained);
  transportFactory.mockClear();
  expect(() =>
    module.createTestWorkerNotifications({
      environment: "TEST",
      configuration,
      credentials,
      transactions: {} as never,
      keyManagement: {} as never,
      transportFactory,
    }),
  ).toThrow("Invalid notification worker configuration");
  expect(transportFactory).not.toHaveBeenCalled();
});

test("maintenance consumes both automatic notifications and the durable operator resend outbox", async () => {
  const automatic = vi.fn(async () => ({
    schemaVersion: 1 as const,
    notificationIds: [],
  }));
  const manual = vi.fn(async () => ({
    schemaVersion: 1 as const,
    notificationIds: [],
  }));
  const transactions = (
    listPending: typeof automatic,
  ): NotificationTransactionManager => ({
    runInNotificationTransaction: (work) =>
      work({ listPending } as unknown as NotificationRepository),
  });
  const app = module.createTestWorkerNotifications({
    environment: "TEST",
    configuration: testConfiguration(),
    credentials: { TEST_MAIL_KEY: "test-credential-long-enough" },
    transactions: transactions(automatic),
    resendTransactions: transactions(manual),
    keyManagement: {} as never,
    transportFactory: () => ({
      transportKey: "a".repeat(64),
      transport: {
        sendEmail: async () => {
          throw new Error("must not send");
        },
      },
    }),
  });
  expect(await app.runPending(10)).toEqual({
    schemaVersion: 1,
    scanned: 0,
    sent: 0,
    scheduled: 0,
    failed: 0,
    skipped: 0,
  });
  expect(automatic).toHaveBeenCalledOnce();
  expect(manual).toHaveBeenCalledOnce();
});

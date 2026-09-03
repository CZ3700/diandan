import { describe, expect, test } from "vitest";

import {
  notificationPortCommandSchema,
  notificationPortResponseSchema,
  type SendNotificationCommand,
} from "@fan-support/notification-port";

import * as notificationProvider from "./index.js";

const testOnlyOptions = Object.freeze({ environment: "TEST" as const });
const fixtureCommand = parsedCommand({
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  notification: {
    schemaVersion: 1,
    id: "10000000-0000-4000-8000-000000000007",
    orderId: "10000000-0000-4000-8000-000000000002",
    customerContactId: "10000000-0000-4000-8000-000000000008",
    eventType: "PAYMENT_CONFIRMED",
    locale: {
      schemaVersion: 1,
      requestedLocale: "en",
      resolvedLocale: "en",
      fallbackUsed: false,
      templateKey: "order.payment.confirmed",
      templateVersion: "fixture-v1",
      contentRevisionIds: [],
    },
    idempotencyKey: "notification-fixture-0001",
    correlationId: "10000000-0000-4000-8000-000000000009",
  },
  channel: "EMAIL",
  content: {
    subject: "Your gift order is confirmed",
    text: "Your gift order is confirmed.",
    html: "<p>Your gift order is confirmed.</p>",
  },
});
const reviewedAcceptedFixture = Object.freeze({
  status: "ACCEPTED" as const,
  providerReference: "fake-notification/10000000-0000-4000-8000-000000000007",
  acceptedAt: "2026-09-03T00:00:00.000Z",
});

function parsedCommand(value: unknown): SendNotificationCommand {
  return notificationPortCommandSchema.parse(value) as SendNotificationCommand;
}

describe("test-only deterministic notification provider", () => {
  test("exposes the workspace boundary and explicit fake factories", () => {
    expect(notificationProvider.workspacePackageName).toBe(
      "@fan-support/notification-provider",
    );
    expect(notificationProvider.createFakeNotificationProvider).toBeTypeOf(
      "function",
    );
    expect(
      notificationProvider.createFakeNotificationProviderHarness,
    ).toBeTypeOf("function");
  });

  test("requires an explicit TEST environment and rejects deployment environments", () => {
    expect(() =>
      notificationProvider.createFakeNotificationProvider(undefined as never),
    ).toThrow(/test-only notification provider/u);
    for (const environment of ["PREVIEW", "STAGING", "PRODUCTION"]) {
      expect(() =>
        notificationProvider.createFakeNotificationProvider({
          environment,
        } as never),
      ).toThrow(/test-only notification provider/u);
    }
  });

  test("matches the reviewed accepted-email fixture", async () => {
    const response = await notificationProvider
      .createFakeNotificationProvider(testOnlyOptions)
      .sendNotification(fixtureCommand);

    expect(notificationPortResponseSchema.safeParse(response).success).toBe(
      true,
    );
    expect(response).toMatchObject({
      outcome: "SUCCESS",
      value: reviewedAcceptedFixture,
    });
  });

  test("maps configurable ACCEPTED and REJECTED outcomes to port responses", async () => {
    const command = fixtureCommand;
    const sent = await notificationProvider
      .createFakeNotificationProvider({
        environment: "TEST",
        outcome: "ACCEPTED",
        now: "2027-01-02T03:04:05.000Z",
      })
      .sendNotification(command);
    const rejected = await notificationProvider
      .createFakeNotificationProvider({
        environment: "TEST",
        outcome: "REJECTED",
      })
      .sendNotification(command);

    expect(sent).toMatchObject({
      outcome: "SUCCESS",
      value: {
        status: "ACCEPTED",
        providerReference: `fake-notification/${command.notification.id}`,
        acceptedAt: "2027-01-02T03:04:05.000Z",
      },
    });
    expect(rejected).toEqual({
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
      outcome: "SUCCESS",
      value: { status: "REJECTED" },
    });
  });

  test("maps UNKNOWN to a replayable outcome without claiming delivery", async () => {
    const harness = notificationProvider.createFakeNotificationProviderHarness({
      environment: "TEST",
      outcome: "UNKNOWN",
    });
    const command = fixtureCommand;

    const first = await harness.provider.sendNotification(command);
    const replay = await harness.provider.sendNotification(command);

    expect(first).toEqual({
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TIMEOUT_OUTCOME_UNKNOWN",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
      },
    });
    expect(replay).toEqual(first);
    expect(harness.deliveries()).toEqual([
      {
        schemaVersion: 1,
        notificationId: command.notification.id,
        idempotencyKey: command.notification.idempotencyKey,
        status: "UNKNOWN",
      },
    ]);
  });

  test("replays an identical command and records one side effect under concurrency", async () => {
    const harness = notificationProvider.createFakeNotificationProviderHarness({
      environment: "TEST",
    });
    const command = fixtureCommand;

    const [first, replay] = await Promise.all([
      harness.provider.sendNotification(command),
      harness.provider.sendNotification(command),
    ]);

    expect(replay).toEqual(first);
    expect(harness.deliveries()).toHaveLength(1);
  });

  test("keeps the replay snapshot isolated from caller mutation", async () => {
    const provider =
      notificationProvider.createFakeNotificationProvider(testOnlyOptions);
    const command = fixtureCommand;
    const first = await provider.sendNotification(command);

    if (first.outcome !== "SUCCESS" || first.value.status !== "ACCEPTED") {
      throw new Error("fixture notification must be accepted");
    }
    first.value.acceptedAt = "2099-01-01T00:00:00.000Z";
    const replay = await provider.sendNotification(command);

    expect(replay).toMatchObject({
      outcome: "SUCCESS",
      value: { acceptedAt: "2026-09-03T00:00:00.000Z" },
    });
  });

  test("rejects idempotency-key drift without a second side effect", async () => {
    const harness = notificationProvider.createFakeNotificationProviderHarness({
      environment: "TEST",
    });
    const command = fixtureCommand;
    const changed = parsedCommand({
      ...command,
      content: { ...command.content, subject: "Changed subject" },
    });

    await harness.provider.sendNotification(command);
    const conflict = await harness.provider.sendNotification(changed);

    expect(conflict).toMatchObject({
      outcome: "FAILURE",
      error: { code: "IDEMPOTENCY_CONFLICT", recovery: "NONE" },
    });
    expect(harness.deliveries()).toHaveLength(1);
  });

  test("normalizes invalid commands and does not record a side effect", async () => {
    const harness = notificationProvider.createFakeNotificationProviderHarness({
      environment: "TEST",
    });

    const response = await harness.provider.sendNotification({
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
    } as SendNotificationCommand);

    expect(response).toMatchObject({
      outcome: "FAILURE",
      error: { code: "INVALID_COMMAND", recovery: "NONE" },
    });
    expect(harness.deliveries()).toEqual([]);
  });

  test("exposes only frozen privacy-minimized delivery metadata", async () => {
    const harness = notificationProvider.createFakeNotificationProviderHarness({
      environment: "TEST",
    });
    await harness.provider.sendNotification(fixtureCommand);

    const deliveries = harness.deliveries();
    const serialized = JSON.stringify(deliveries);

    expect(Object.isFrozen(deliveries)).toBe(true);
    expect(Object.isFrozen(deliveries[0])).toBe(true);
    expect(serialized).not.toMatch(
      /subject|preheader|text|html|customerContact|correlation|email|confirmed|<p>/iu,
    );
  });

  test("snapshots configuration when the harness is created", async () => {
    const mutableOptions: {
      environment: "TEST";
      outcome: "ACCEPTED" | "REJECTED";
    } = { environment: "TEST", outcome: "REJECTED" };
    const provider =
      notificationProvider.createFakeNotificationProvider(mutableOptions);
    mutableOptions.outcome = "ACCEPTED";

    await expect(
      provider.sendNotification(fixtureCommand),
    ).resolves.toMatchObject({
      outcome: "SUCCESS",
      value: { status: "REJECTED" },
    });
  });
});

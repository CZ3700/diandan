import {
  notificationPortCommandSchema,
  notificationPortResponseSchema,
  type NotificationProvider,
  type SendNotificationCommand,
  type SendNotificationResponse,
} from "@fan-support/notification-port";

const DEFAULT_NOW = "2026-09-03T00:00:00.000Z";

export type FakeNotificationOutcome = "ACCEPTED" | "REJECTED" | "UNKNOWN";

export type FakeNotificationProviderOptions = Readonly<{
  /** Explicit safety marker: this adapter must never be composed for a deployment. */
  environment: "TEST";
  now?: string;
  outcome?: FakeNotificationOutcome;
}>;

export type FakeNotificationDelivery = Readonly<{
  schemaVersion: 1;
  notificationId: SendNotificationCommand["notification"]["id"];
  idempotencyKey: SendNotificationCommand["notification"]["idempotencyKey"];
  status: FakeNotificationOutcome;
}>;

export type FakeNotificationProviderHarness = Readonly<{
  provider: NotificationProvider;
  deliveries(): readonly FakeNotificationDelivery[];
}>;

type NormalizedOptions = Readonly<{
  now: string;
  outcome: FakeNotificationOutcome;
}>;

type StoredAttempt = Readonly<{
  fingerprint: string;
  serializedResponse: string;
}>;

function parseResponse(value: unknown): SendNotificationResponse {
  return notificationPortResponseSchema.parse(value);
}

function failure(
  code: "INVALID_COMMAND" | "IDEMPOTENCY_CONFLICT",
): SendNotificationResponse {
  return parseResponse({
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    outcome: "FAILURE",
    error: { schemaVersion: 1, code, recovery: "NONE" },
  });
}

function normalizeOptions(
  options: FakeNotificationProviderOptions,
): NormalizedOptions {
  if (
    options === null ||
    typeof options !== "object" ||
    options.environment !== "TEST"
  ) {
    throw new TypeError(
      "test-only notification provider requires environment: TEST and must not be used in preview, staging, or production",
    );
  }
  const outcome = options.outcome ?? "ACCEPTED";
  const now = options.now ?? DEFAULT_NOW;
  if (!(["ACCEPTED", "REJECTED", "UNKNOWN"] as const).includes(outcome)) {
    throw new TypeError("test-only notification provider outcome is invalid");
  }
  const timestampProbe = notificationPortResponseSchema.safeParse({
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    outcome: "SUCCESS",
    value: {
      status: "ACCEPTED",
      providerReference: "fake-notification/configuration-probe",
      acceptedAt: now,
    },
  });
  if (!timestampProbe.success) {
    throw new TypeError("test-only notification provider now is invalid");
  }
  return Object.freeze({ now, outcome });
}

function commandFingerprint(command: SendNotificationCommand): string {
  return JSON.stringify(command);
}

function responseFor(
  command: SendNotificationCommand,
  options: NormalizedOptions,
): SendNotificationResponse {
  if (options.outcome === "ACCEPTED") {
    return parseResponse({
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
      outcome: "SUCCESS",
      value: {
        status: "ACCEPTED",
        providerReference: `fake-notification/${command.notification.id}`,
        acceptedAt: options.now,
      },
    });
  }
  if (options.outcome === "REJECTED") {
    return parseResponse({
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
      outcome: "SUCCESS",
      value: { status: "REJECTED" },
    });
  }
  return parseResponse({
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
}

function replay(stored: StoredAttempt): SendNotificationResponse {
  return parseResponse(JSON.parse(stored.serializedResponse) as unknown);
}

/**
 * Creates an in-memory notification fake for deterministic tests only.
 *
 * The explicit TEST marker is mandatory. Do not compose this adapter in preview,
 * staging, or production; it has no external email transport or credentials.
 */
export function createFakeNotificationProviderHarness(
  options: FakeNotificationProviderOptions,
): FakeNotificationProviderHarness {
  const normalized = normalizeOptions(options);
  const deliveryRecords: FakeNotificationDelivery[] = [];
  const attempts = new Map<string, StoredAttempt>();

  const provider: NotificationProvider = Object.freeze({
    async sendNotification(
      command: SendNotificationCommand,
    ): Promise<SendNotificationResponse> {
      const parsed = notificationPortCommandSchema.safeParse(command);
      if (!parsed.success) {
        return failure("INVALID_COMMAND");
      }

      const idempotencyKey = parsed.data.notification.idempotencyKey;
      const fingerprint = commandFingerprint(parsed.data);
      const existing = attempts.get(idempotencyKey);
      if (existing !== undefined) {
        return existing.fingerprint === fingerprint
          ? replay(existing)
          : failure("IDEMPOTENCY_CONFLICT");
      }

      const response = responseFor(parsed.data, normalized);
      const stored = Object.freeze({
        fingerprint,
        serializedResponse: JSON.stringify(response),
      });
      attempts.set(idempotencyKey, stored);
      deliveryRecords.push(
        Object.freeze({
          schemaVersion: 1,
          notificationId: parsed.data.notification.id,
          idempotencyKey,
          status: normalized.outcome,
        }),
      );
      return replay(stored);
    },
  });

  return Object.freeze({
    provider,
    deliveries: () =>
      Object.freeze(
        deliveryRecords.map((delivery) => Object.freeze({ ...delivery })),
      ),
  });
}

/** Test-only shorthand for the provider exposed by the deterministic harness. */
export function createFakeNotificationProvider(
  options: FakeNotificationProviderOptions,
): NotificationProvider {
  return createFakeNotificationProviderHarness(options).provider;
}

export const workspacePackageName =
  "@fan-support/notification-provider" as const;

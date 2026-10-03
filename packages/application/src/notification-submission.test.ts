import { expect, test, vi } from "vitest";
import { notificationEmailDispatchSchema } from "@fan-support/contracts";
import type { NotificationEmailTransport } from "@fan-support/notification-port";
import * as application from "./index.js";

const id = "12345678-1234-4234-8234-123456789012";
const transportKey = "a".repeat(64);
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
    text: "Private link #token=CANARY_LINK",
    html: "<p>Private link #token=CANARY_LINK</p>",
  },
});
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
function factory() {
  const candidate = Reflect.get(
    application,
    "createDurableNotificationTransport",
  );
  expect(candidate).toBeTypeOf("function");
  return candidate as (options: unknown) => NotificationEmailTransport;
}
function setup() {
  const events: string[] = [];
  const claim = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({
    schemaVersion: 1,
    decision: "SEND",
  }));
  const finish = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({
    schemaVersion: 1,
    decision: "STORED",
  }));
  const transactions = {
    runInNotificationSubmissionTransaction: async (
      work: (repository: {
        claim: typeof claim;
        finish: typeof finish;
      }) => Promise<unknown>,
    ) => {
      events.push("begin");
      const result = await work({ claim, finish });
      events.push("commit");
      return result;
    },
  };
  const sendEmail = vi.fn<(input: unknown) => Promise<unknown>>(async () => {
    events.push("submit");
    return accepted;
  });
  const options = {
    transportKey,
    transactions,
    submitter: { sendEmail },
    createId: () => id,
  };
  return { events, claim, finish, sendEmail, options };
}

test("commits the one-time claim before submission and persists acceptance before returning", async () => {
  const f = setup();
  expect(await factory()(f.options).sendEmail(email)).toEqual(accepted);
  expect(f.events).toEqual(["begin", "commit", "submit", "begin", "commit"]);
  expect(f.claim).toHaveBeenCalledOnce();
  expect(f.finish).toHaveBeenCalledOnce();
  expect(f.claim.mock.calls[0]![0]).toMatchObject({
    schemaVersion: 1,
    transportKey,
    notificationId: id,
    idempotencyKey: email.notification.idempotencyKey,
    dispatchNotAfter: email.dispatchNotAfter,
    claimToken: id,
    requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
  });
  expect(f.sendEmail).toHaveBeenCalledWith(email);
  const stored = JSON.stringify([f.claim.mock.calls, f.finish.mock.calls]);
  expect(stored).not.toContain("fan@example.test");
  expect(stored).not.toContain("CANARY_LINK");
});

test("reconstructed transport replays the durable receipt without calling the provider", async () => {
  const f = setup();
  f.claim.mockResolvedValue({
    schemaVersion: 1,
    decision: "REPLAY",
    result: accepted,
  });
  expect(await factory()(f.options).sendEmail(email)).toEqual(accepted);
  expect(await factory()(f.options).sendEmail(email)).toEqual(accepted);
  expect(f.sendEmail).not.toHaveBeenCalled();
  expect(f.finish).not.toHaveBeenCalled();
});

test.each(["UNKNOWN", "CONFLICT", "EXPIRED"])(
  "journal %s never causes a new provider submission",
  async (decision) => {
    const f = setup();
    f.claim.mockResolvedValue({ schemaVersion: 1, decision });
    const result = await factory()(f.options).sendEmail(email);
    expect(result.outcome).toBe("FAILURE");
    if (result.outcome === "FAILURE")
      expect(result.error.code).toBe(
        decision === "UNKNOWN"
          ? "TIMEOUT_OUTCOME_UNKNOWN"
          : decision === "CONFLICT"
            ? "IDEMPOTENCY_CONFLICT"
            : "CONFIGURATION_ERROR",
      );
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.finish).not.toHaveBeenCalled();
  },
);

test.each([
  "TIMEOUT_OUTCOME_UNKNOWN",
  "MALFORMED_PROVIDER_RESPONSE",
  "UNEXPECTED_ADAPTER_FAILURE",
])("%s leaves the durable claim unresolved for safe recovery", async (code) => {
  const f = setup();
  const failure = {
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 1000,
    },
  };
  f.sendEmail.mockResolvedValue(failure);
  expect(await factory()(f.options).sendEmail(email)).toEqual(failure);
  expect(f.finish).not.toHaveBeenCalled();
  f.claim.mockResolvedValue({ schemaVersion: 1, decision: "UNKNOWN" });
  await factory()(f.options).sendEmail(email);
  expect(f.sendEmail).toHaveBeenCalledOnce();
});

test("provider exception and malformed response cannot become terminal rejection", async () => {
  for (const mode of ["throw", "malformed"]) {
    const f = setup();
    if (mode === "throw")
      f.sendEmail.mockRejectedValue(new Error("SECRET_PROVIDER_DETAIL"));
    else
      f.sendEmail.mockResolvedValue({ unexpected: "SECRET_PROVIDER_DETAIL" });
    const result = await factory()(f.options).sendEmail(email);
    expect(result.outcome).toBe("FAILURE");
    expect(JSON.stringify(result)).not.toContain("SECRET_PROVIDER_DETAIL");
    expect(f.finish).not.toHaveBeenCalled();
  }
});

test("unknown database commit result never permits a submission or exposes raw errors", async () => {
  const f = setup();
  f.options.transactions.runInNotificationSubmissionTransaction = async () => {
    throw new Error("SECRET_DATABASE_DETAIL");
  };
  const result = await factory()(f.options).sendEmail(email);
  expect(result.outcome).toBe("FAILURE");
  expect(f.sendEmail).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("SECRET_DATABASE_DETAIL");
});

test("lost acceptance persistence returns unknown and never submits twice", async () => {
  const f = setup();
  f.finish.mockRejectedValue(new Error("SECRET_DATABASE_DETAIL"));
  const result = await factory()(f.options).sendEmail(email);
  expect(result).toMatchObject({
    outcome: "FAILURE",
    error: { code: "TIMEOUT_OUTCOME_UNKNOWN" },
  });
  f.claim.mockResolvedValue({ schemaVersion: 1, decision: "UNKNOWN" });
  await factory()(f.options).sendEmail(email);
  expect(f.sendEmail).toHaveBeenCalledOnce();
});

test("invalid command and malformed journal decisions fail before network access", async () => {
  const f = setup();
  expect(
    await factory()(f.options).sendEmail({ ...email, recipient: "invalid" }),
  ).toMatchObject({ outcome: "FAILURE", error: { code: "INVALID_COMMAND" } });
  expect(f.claim).not.toHaveBeenCalled();
  f.claim.mockResolvedValue({
    schemaVersion: 1,
    decision: "SEND",
    extra: "invalid",
  });
  expect(await factory()(f.options).sendEmail(email)).toMatchObject({
    outcome: "FAILURE",
  });
  expect(f.sendEmail).not.toHaveBeenCalled();
});

test("known rate limiting is persisted and replayed without resubmitting", async () => {
  const f = setup();
  const limited = {
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code: "RATE_LIMITED",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 1000,
    },
  };
  f.sendEmail.mockResolvedValue(limited);
  expect(await factory()(f.options).sendEmail(email)).toEqual(limited);
  expect(f.finish).toHaveBeenCalledOnce();
  f.claim.mockResolvedValue({
    schemaVersion: 1,
    decision: "REPLAY",
    result: limited,
  });
  expect(await factory()(f.options).sendEmail(email)).toEqual(limited);
  expect(f.sendEmail).toHaveBeenCalledOnce();
});

import { expect, test } from "vitest";

import {
  paymentPortCommandSchema,
  type CancelPaymentCommand,
  type CreatePaymentCommand,
  type RefundPaymentCommand,
} from "@fan-support/payment-port";
import {
  deterministicPortFixtures,
  loadReviewedProviderFixtureBundle,
  runLegacyWebhookParserConformance,
  runPaymentProviderConformance,
} from "@fan-support/testing";

import * as paymentFake from "./index.js";

function parsedCommand<Command>(value: unknown): Command {
  return paymentPortCommandSchema.parse(value) as Command;
}

test("creates a deterministic payment provider", async () => {
  const factory = (paymentFake as Record<string, unknown>)[
    "createFakePaymentProvider"
  ];
  expect(factory).toBeTypeOf("function");
});

test("passes the shared provider conformance suite", async () => {
  const provider = paymentFake.createFakePaymentProvider();

  const report = await runPaymentProviderConformance(provider);

  expect(report.passed).toBe(true);
  expect(report.cases).toHaveLength(15);

  const legacyReport = await runLegacyWebhookParserConformance(provider);
  expect(legacyReport.passed).toBe(true);
  expect(legacyReport.cases).toHaveLength(1);
});

test("matches the reviewed payment provider fixture", async () => {
  const bundle = await loadReviewedProviderFixtureBundle();
  const fixture = bundle.fixtures["payment-fake.v1.json"];
  const command = deterministicPortFixtures.payment.createPayment;

  expect(fixture.request).toEqual({
    paymentMethod: command.paymentMethod,
    amountMinor: command.amountMinor,
    currency: command.currency,
    requestedLocale: command.requestedLocale,
  });
  await expect(
    paymentFake.createFakePaymentProvider().createPayment(command),
  ).resolves.toMatchObject({
    outcome: "SUCCESS",
    value: fixture.expected,
  });
});

test("refuses every LIVE payment command", async () => {
  const provider = paymentFake.createFakePaymentProvider();
  const liveCreate = parsedCommand<CreatePaymentCommand>({
    ...deterministicPortFixtures.payment.createPayment,
    environment: "LIVE",
  });

  await expect(provider.createPayment(liveCreate)).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
  });
  await expect(
    provider.reconcilePayment({
      ...deterministicPortFixtures.payment.reconcilePayment,
      environment: "LIVE",
    }),
  ).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
  });
});

test("replays an identical create command and rejects a changed fingerprint", async () => {
  const provider = paymentFake.createFakePaymentProvider();
  const command = deterministicPortFixtures.payment.createPayment;

  const first = await provider.createPayment(command);
  const replay = await provider.createPayment(command);
  const conflict = await provider.createPayment(
    parsedCommand<CreatePaymentCommand>({
      ...command,
      amountMinor: command.amountMinor + 1,
    }),
  );

  expect(replay).toEqual(first);
  expect(conflict).toMatchObject({
    outcome: "FAILURE",
    error: { code: "IDEMPOTENCY_CONFLICT" },
  });
});

test("replays an identical cancellation and rejects any second fingerprint", async () => {
  const provider = paymentFake.createFakePaymentProvider();
  await provider.createPayment(deterministicPortFixtures.payment.createPayment);
  const command = deterministicPortFixtures.payment.cancelPayment;

  const first = await provider.cancelPayment(command);
  const replay = await provider.cancelPayment(command);
  const sameKeyConflict = await provider.cancelPayment(
    parsedCommand<CancelPaymentCommand>({
      ...command,
      reasonCode: "DUPLICATE_ORDER",
    }),
  );
  const newKeyConflict = await provider.cancelPayment(
    parsedCommand<CancelPaymentCommand>({
      ...command,
      idempotencyKey: "10000000-0000-4000-8000-000000000010",
      reasonCode: "DUPLICATE_ORDER",
    }),
  );

  expect(replay).toEqual(first);
  for (const conflict of [sameKeyConflict, newKeyConflict]) {
    expect(conflict).toMatchObject({
      outcome: "FAILURE",
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  }
});

test("replays an identical refund and rejects a changed provider-key fingerprint", async () => {
  const provider = paymentFake.createFakePaymentProvider({
    reconcilePaymentStatus: "SUCCEEDED",
  });
  await provider.createPayment(deterministicPortFixtures.payment.createPayment);
  await provider.reconcilePayment(
    deterministicPortFixtures.payment.reconcilePayment,
  );
  const command = deterministicPortFixtures.payment.refundPayment;

  const first = await provider.refundPayment(command);
  const replay = await provider.refundPayment(command);
  const conflict = await provider.refundPayment(
    parsedCommand<RefundPaymentCommand>({
      ...command,
      amountMinor: command.amountMinor - 1,
    }),
  );

  expect(replay).toEqual(first);
  expect(conflict).toMatchObject({
    outcome: "FAILURE",
    error: { code: "IDEMPOTENCY_CONFLICT" },
  });
});

test("never refunds an uncaptured or canceled payment", async () => {
  const provider = paymentFake.createFakePaymentProvider();
  await provider.createPayment(deterministicPortFixtures.payment.createPayment);
  await provider.cancelPayment(deterministicPortFixtures.payment.cancelPayment);

  const result = await provider.refundPayment(
    deterministicPortFixtures.payment.refundPayment,
  );
  const reconciled = await provider.reconcilePayment(
    deterministicPortFixtures.payment.reconcilePayment,
  );

  expect(result).toMatchObject({
    outcome: "FAILURE",
    error: { code: "PROVIDER_DECLINED", recovery: "NONE" },
  });
  expect(reconciled).toMatchObject({
    outcome: "SUCCESS",
    value: { event: { status: "CANCELED" } },
  });
});

test("reconciles an accepted create whose response outcome was unknown without an external reference", async () => {
  const provider = paymentFake.createFakePaymentProvider({
    createPaymentOutcome: "TIMEOUT_AFTER_ACCEPT",
    reconcilePaymentStatus: "SUCCEEDED",
  });

  const created = await provider.createPayment(
    deterministicPortFixtures.payment.createPayment,
  );
  const reconciled = await provider.reconcilePayment(
    deterministicPortFixtures.payment.reconcilePayment,
  );

  expect(created).toMatchObject({
    outcome: "FAILURE",
    error: {
      code: "TIMEOUT_OUTCOME_UNKNOWN",
      recovery: "RECONCILE_REQUIRED",
    },
  });
  expect(reconciled).toMatchObject({
    outcome: "SUCCESS",
    value: {
      event: {
        association: {
          paymentAttemptId:
            deterministicPortFixtures.payment.createPayment.attemptId,
          externalReference: `fake-payment/${deterministicPortFixtures.payment.createPayment.attemptId}`,
        },
        status: "SUCCEEDED",
      },
    },
  });
});

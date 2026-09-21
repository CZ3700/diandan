import { Buffer } from "node:buffer";
import { afterEach, expect, test } from "vitest";
import {
  PAYMENT_PROVIDER_OPERATIONS,
  paymentPortCommandSchema,
  paymentPortResponseSchema,
  type CreatePaymentCommand,
  type PaymentPortCommand,
  type PaymentPortResponse,
  type RefundPaymentCommand,
} from "@fan-support/payment-port";
import {
  deterministicPortFixtures,
  runPaymentProviderConformance,
} from "@fan-support/testing";
import { createGatewayPaymentProvider } from "./client.js";
import { connection, credentials, observedAt } from "./harness.gateway.js";
import { tlsHarness } from "./harness.tls.js";

type Command = Extract<
  PaymentPortCommand,
  { operation: (typeof PAYMENT_PROVIDER_OPERATIONS)[number] }
>;
const isProviderCommand = (command: PaymentPortCommand): command is Command =>
  PAYMENT_PROVIDER_OPERATIONS.some(
    (operation) => operation === command.operation,
  );
type Payment = {
  command: CreatePaymentCommand;
  status: "PROCESSING" | "CANCELED" | "SUCCEEDED";
  refundedMinor: number;
};
type Fault =
  | "NONE"
  | "WRONG_ASSOCIATION"
  | "REPLAY_DRIFT"
  | "IGNORE_REFUND_CONFLICT"
  | "IGNORE_REFUND_CAPACITY"
  | "REUSE_RECONCILE_EVENT";

const reference = (attemptId: string) => `gateway-conformance/${attemptId}`;
// Keep the shared scenarios and IDs; adapt only provider-specific binding data.
const fixtures = Object.fromEntries(
  Object.entries(deterministicPortFixtures.payment).map(([name, command]) => [
    name,
    paymentPortCommandSchema.parse({
      ...command,
      providerAccountId: connection.binding.providerAccountId,
      ...(command.operation === "CREATE_PAYMENT"
        ? {
            paymentMethod: connection.instruments[0]!.paymentMethod,
            returnUrl: `${connection.returnOrigin}/payment/return`,
            cancelUrl: `${connection.returnOrigin}/payment/cancel`,
          }
        : {}),
      ...("externalReference" in command
        ? {
            externalReference: reference(
              "paymentAttemptId" in command
                ? command.paymentAttemptId
                : command.attemptId,
            ),
          }
        : {}),
    }),
  ]),
) as typeof deterministicPortFixtures.payment;

function successful(command: Command, value: unknown): PaymentPortResponse {
  return paymentPortResponseSchema.parse({
    schemaVersion: 1,
    operation: command.operation,
    outcome: "SUCCESS",
    value,
  });
}

function declined(
  command: Command,
  code:
    | "PAYMENT_NOT_FOUND"
    | "REFUND_NOT_FOUND"
    | "PROVIDER_DECLINED"
    | "IDEMPOTENCY_CONFLICT",
): PaymentPortResponse {
  return paymentPortResponseSchema.parse({
    schemaVersion: 1,
    operation: command.operation,
    outcome: "FAILURE",
    error: { schemaVersion: 1, code, recovery: "NONE" },
  });
}

/** TEST upstream state, not a PaymentProvider or a delegate to payment-fake. */
function createUpstream(fault: Fault) {
  const payments = new Map<string, Payment>();
  const refunds = new Map<
    string,
    { command: RefundPaymentCommand; response: PaymentPortResponse }
  >();

  function handle(command: Command): PaymentPortResponse {
    if (command.operation === "GET_CAPABILITIES") {
      return successful(command, {
        capabilities: [
          {
            schemaVersion: 1,
            id: "71000000-0000-4000-8000-000000000009",
            paymentMethod: connection.instruments[0]!.paymentMethod,
            displayName: "TEST conformance cards",
            market: command.market,
            country: command.country,
            currency: command.currency,
            minimumAmountMinor: 1,
            maximumAmountMinor: 100000,
            actionTypes: ["REDIRECT"],
            available: true,
          },
        ],
      });
    }
    if (command.operation === "CREATE_PAYMENT") {
      const existing = payments.get(command.attemptId);
      if (
        existing &&
        JSON.stringify(existing.command) !== JSON.stringify(command)
      )
        return declined(command, "IDEMPOTENCY_CONFLICT");
      if (!existing)
        payments.set(command.attemptId, {
          command,
          status: "PROCESSING",
          refundedMinor: 0,
        });
      return successful(command, {
        providerAccountId: command.providerAccountId,
        environment: command.environment,
        attemptId:
          fault === "WRONG_ASSOCIATION"
            ? "71000000-0000-4000-8000-000000000099"
            : command.attemptId,
        orderId: command.orderId,
        amountMinor: command.amountMinor,
        currency: command.currency,
        externalReference: reference(command.attemptId),
        status: "PROCESSING",
        providerLocale: command.requestedLocale,
        fallbackUsed: false,
        observedAt,
      });
    }
    const attemptId =
      "paymentAttemptId" in command
        ? command.paymentAttemptId
        : command.attemptId;
    const payment = payments.get(attemptId);
    if (!payment) return declined(command, "PAYMENT_NOT_FOUND");
    if (
      "externalReference" in command &&
      command.externalReference !== reference(attemptId)
    )
      return declined(command, "PAYMENT_NOT_FOUND");
    switch (command.operation) {
      case "GET_PAYMENT":
      case "CANCEL_PAYMENT": {
        if (command.operation === "CANCEL_PAYMENT") payment.status = "CANCELED";
        return successful(command, {
          providerAccountId: command.providerAccountId,
          environment: command.environment,
          attemptId,
          externalReference: reference(attemptId),
          status: payment.status,
          providerLocale: payment.command.requestedLocale,
          fallbackUsed: false,
          observedAt,
        });
      }
      case "REFUND_PAYMENT": {
        const previous = refunds.get(command.idempotencyKey);
        if (previous) {
          if (
            fault !== "IGNORE_REFUND_CONFLICT" &&
            JSON.stringify(previous.command) !== JSON.stringify(command)
          )
            return declined(command, "IDEMPOTENCY_CONFLICT");
          const replay = structuredClone(previous.response);
          if (
            fault === "REPLAY_DRIFT" &&
            replay.outcome === "SUCCESS" &&
            replay.operation === "REFUND_PAYMENT"
          )
            replay.value.observedAt = "2026-09-09T00:00:01.000Z";
          return replay;
        }
        if (
          payment.status !== "SUCCEEDED" ||
          (fault !== "IGNORE_REFUND_CAPACITY" &&
            payment.refundedMinor + command.amountMinor >
              payment.command.amountMinor)
        )
          return declined(command, "PROVIDER_DECLINED");
        const response = successful(command, {
          providerAccountId: command.providerAccountId,
          environment: command.environment,
          refundId: command.refundId,
          paymentAttemptId: attemptId,
          status: "PROCESSING",
          refundReference: command.refundReference,
          amountMinor: command.amountMinor,
          currency: command.currency,
          observedAt,
        });
        refunds.set(command.idempotencyKey, { command, response });
        payment.refundedMinor += command.amountMinor;
        return response;
      }
      case "RECONCILE_PAYMENT":
      case "RECONCILE_REFUND": {
        const refund = command.operation === "RECONCILE_REFUND";
        if (refund && !refunds.has(command.idempotencyKey))
          return declined(command, "REFUND_NOT_FOUND");
        // Simulate a provider-confirmed capture; cancellation remains terminal.
        if (!refund && payment.status === "PROCESSING")
          payment.status = "SUCCEEDED";
        const status = refund ? "SUCCEEDED" : payment.status;
        return successful(command, {
          ...(refund
            ? {
                refundId: command.refundId,
                idempotencyKey: command.idempotencyKey,
              }
            : {}),
          event: {
            schemaVersion: 1,
            providerAccountId: command.providerAccountId,
            environment: command.environment,
            providerEventId: `conformance:${command.operation}:${attemptId}:${fault === "REUSE_RECONCILE_EVENT" ? "fixed" : command.auditLogId}`,
            evidence: {
              kind: "AUTHENTICATED_RECONCILE",
              auditLogId: command.auditLogId,
            },
            occurredAt: observedAt,
            association: {
              status: "MATCHED",
              paymentAttemptId: attemptId,
              externalReference: reference(attemptId),
            },
            eventType: refund ? "REFUND_STATUS" : "PAYMENT_STATUS",
            ...(refund ? { refundReference: command.refundReference } : {}),
            status,
            amountMinor: command.amountMinor,
            currency: command.currency,
            ...(status === "SUCCEEDED"
              ? {
                  transaction: {
                    type: refund ? "REFUND" : "CAPTURE",
                    providerReference: refund
                      ? `refund/${command.refundId}`
                      : `capture/${attemptId}`,
                  },
                }
              : {}),
          },
        });
      }
    }
  }
  return { handle, payments, refunds };
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function runGatewayConformance(fault: Fault = "NONE") {
  const upstream = createUpstream(fault);
  const received: Array<{
    command: Command;
    method: string | undefined;
    path: string | undefined;
    authorized: boolean;
    idempotencyKey: string | string[] | undefined;
    instrument: unknown;
    instruments: unknown;
    merchantAccount: unknown;
    protocol: unknown;
  }> = [];
  const errors: unknown[] = [];
  const tls = await tlsHarness((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      try {
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          command: unknown;
          merchantAccount: unknown;
          protocol: unknown;
          instrument?: unknown;
          instruments?: unknown;
        };
        const command = paymentPortCommandSchema.parse(input.command);
        if (!isProviderCommand(command))
          throw new Error("Unsupported gateway operation");
        received.push({
          command,
          method: request.method,
          path: request.url,
          authorized:
            request.headers.authorization === "Bearer test-runtime-bearer",
          idempotencyKey: request.headers["idempotency-key"],
          instrument: input.instrument,
          instruments: input.instruments,
          merchantAccount: input.merchantAccount,
          protocol: input.protocol,
        });
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(upstream.handle(command)));
      } catch (error) {
        errors.push(error);
        response.writeHead(500).end();
      }
    });
  });
  cleanups.push(tls.close);
  const provider = createGatewayPaymentProvider({
    connection: {
      ...connection,
      apiOrigin: tls.origin as typeof connection.apiOrigin,
      timeoutMs: 1000,
    },
    credentials,
    fetcher: tls.fetcher(),
  });
  const report = await runPaymentProviderConformance(provider, fixtures);
  expect(errors).toEqual([]);
  return { report, received, upstream };
}

test("gateway passes the shared 15-case suite through CA-verified TLS and all seven operations", async () => {
  const { report, received, upstream } = await runGatewayConformance();
  expect(report.cases.filter((entry) => !entry.passed)).toEqual([]);
  expect(report).toMatchObject({ suite: "payment-provider-v1", passed: true });
  expect(report.cases).toHaveLength(15);
  expect(received).toHaveLength(15);
  expect(new Set(received.map(({ command }) => command.operation))).toEqual(
    new Set(PAYMENT_PROVIDER_OPERATIONS),
  );
  for (const entry of received) {
    expect(entry).toMatchObject({
      method: "POST",
      path: "/v1/payment-commands",
      authorized: true,
      protocol: connection.protocol,
      merchantAccount: connection.merchantAccount,
    });
    const { command } = entry;
    expect(entry.idempotencyKey).toBe(
      command.operation === "CREATE_PAYMENT"
        ? command.providerIdempotencyKey
        : command.operation === "REFUND_PAYMENT" ||
            command.operation === "CANCEL_PAYMENT"
          ? command.idempotencyKey
          : undefined,
    );
    if (command.operation === "CREATE_PAYMENT")
      expect(entry.instrument).toEqual(connection.instruments[0]);
    if (command.operation === "GET_CAPABILITIES")
      expect(entry.instruments).toEqual(connection.instruments);
  }
  expect(upstream.payments.get(fixtures.createPayment.attemptId)?.status).toBe(
    "CANCELED",
  );
  expect(upstream.refunds.size).toBe(1);
  expect(
    upstream.payments.get(fixtures.capturedCreatePayment.attemptId)
      ?.refundedMinor,
  ).toBe(fixtures.capturedRefundPayment.amountMinor);
});

test.each([
  ["WRONG_ASSOCIATION", "create-payment"],
  ["REPLAY_DRIFT", "replay-refund-exactly-once"],
  ["IGNORE_REFUND_CONFLICT", "reject-refund-idempotency-drift"],
  ["IGNORE_REFUND_CAPACITY", "reject-refund-over-capture"],
  ["REUSE_RECONCILE_EVENT", "authenticate-captured-payment-with-new-audit"],
] as const)(
  "shared suite rejects gateway upstream fault %s at %s",
  async (fault, caseName) => {
    const { report, received } = await runGatewayConformance(fault);
    expect(received).toHaveLength(15);
    expect(report.passed).toBe(false);
    expect(report.cases.find((entry) => entry.caseName === caseName)).toEqual({
      schemaVersion: 1,
      caseName,
      passed: false,
      failureCode: "SEMANTIC_MISMATCH",
    });
  },
);

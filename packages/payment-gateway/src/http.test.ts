import { Buffer } from "node:buffer";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  paymentPortCommandSchema,
  paymentPortResponseSchema,
  type PaymentPortCommand,
} from "@fan-support/contracts";
import type {
  PAYMENT_PROVIDER_OPERATIONS,
  PaymentProvider,
} from "@fan-support/payment-port";
import { tlsHarness } from "./harness.tls.js";
import { createGatewayPaymentProvider } from "./client.js";
import {
  connection,
  create,
  createResponse,
  get,
  credentials,
  capabilities,
  capability,
  observedAt,
} from "./harness.gateway.js";
type Command = Extract<
  PaymentPortCommand,
  { operation: (typeof PAYMENT_PROVIDER_OPERATIONS)[number] }
>;
const refundId = "71000000-0000-4000-8000-000000000007",
  auditLogId = "71000000-0000-4000-8000-000000000008";
const refund = {
  schemaVersion: 1,
  operation: "REFUND_PAYMENT",
  providerAccountId: create.providerAccountId,
  environment: "TEST",
  paymentAttemptId: create.attemptId,
  externalReference: get.externalReference,
  refundId,
  refundReference: "merchant-refund/test",
  idempotencyKey: refundId,
  amountMinor: 100,
  currency: "USD",
};
const commands = [
  capabilities,
  create,
  get,
  {
    ...get,
    operation: "CANCEL_PAYMENT",
    idempotencyKey: create.providerIdempotencyKey,
    reasonCode: "CUSTOMER_CANCELED",
  },
  refund,
  {
    schemaVersion: 1,
    operation: "RECONCILE_PAYMENT",
    providerAccountId: create.providerAccountId,
    environment: "TEST",
    attemptId: create.attemptId,
    merchantReference: create.merchantReference,
    providerIdempotencyKey: create.providerIdempotencyKey,
    amountMinor: create.amountMinor,
    currency: create.currency,
    auditLogId,
  },
  { ...refund, operation: "RECONCILE_REFUND", auditLogId },
].map((input) => paymentPortCommandSchema.parse(input) as Command);
function responseFor(command: Command) {
  const base = {
    schemaVersion: 1,
    operation: command.operation,
    outcome: "SUCCESS",
  };
  switch (command.operation) {
    case "GET_CAPABILITIES":
      return { ...base, value: { capabilities: [capability] } };
    case "CREATE_PAYMENT":
      return createResponse;
    case "GET_PAYMENT":
    case "CANCEL_PAYMENT":
      return {
        ...base,
        value: {
          providerAccountId: command.providerAccountId,
          environment: command.environment,
          attemptId: command.attemptId,
          externalReference: command.externalReference,
          status:
            command.operation === "GET_PAYMENT" ? "PROCESSING" : "CANCELED",
          providerLocale: "en",
          fallbackUsed: false,
          observedAt,
        },
      };
    case "REFUND_PAYMENT":
      return {
        ...base,
        value: {
          providerAccountId: command.providerAccountId,
          environment: command.environment,
          refundId: command.refundId,
          paymentAttemptId: command.paymentAttemptId,
          status: "PROCESSING",
          refundReference: command.refundReference,
          amountMinor: command.amountMinor,
          currency: command.currency,
          observedAt,
        },
      };
    case "RECONCILE_PAYMENT":
    case "RECONCILE_REFUND":
      return {
        ...base,
        value: {
          ...(command.operation === "RECONCILE_REFUND"
            ? {
                refundId: command.refundId,
                idempotencyKey: command.idempotencyKey,
              }
            : {}),
          event: {
            schemaVersion: 1,
            providerAccountId: command.providerAccountId,
            environment: command.environment,
            providerEventId: `evt_test_${command.operation}`,
            evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId },
            occurredAt: observedAt,
            association: {
              status: "MATCHED",
              paymentAttemptId: create.attemptId,
              externalReference: get.externalReference,
            },
            eventType:
              command.operation === "RECONCILE_PAYMENT"
                ? "PAYMENT_STATUS"
                : "REFUND_STATUS",
            ...(command.operation === "RECONCILE_REFUND"
              ? { refundReference: command.refundReference }
              : {}),
            status: "SUCCEEDED",
            amountMinor: command.amountMinor,
            currency: command.currency,
            transaction: {
              type:
                command.operation === "RECONCILE_PAYMENT"
                  ? "CAPTURE"
                  : "REFUND",
              providerReference: "txn/test",
            },
          },
        },
      };
  }
}
async function invoke(provider: PaymentProvider, command: Command) {
  switch (command.operation) {
    case "GET_CAPABILITIES":
      return provider.getCapabilities(command);
    case "CREATE_PAYMENT":
      return provider.createPayment(command);
    case "GET_PAYMENT":
      return provider.getPayment(command);
    case "CANCEL_PAYMENT":
      return provider.cancelPayment(command);
    case "REFUND_PAYMENT":
      return provider.refundPayment(command);
    case "RECONCILE_PAYMENT":
      return provider.reconcilePayment(command);
    case "RECONCILE_REFUND":
      return provider.reconcileRefund(command);
  }
}
let mode: "SUCCESS" | "DROP" | "OVERSIZE" | "REDIRECT" | "STALL" | "MISMATCH" =
  "SUCCESS";
let tls: Awaited<ReturnType<typeof tlsHarness>>, provider: PaymentProvider;
const received: {
  body: unknown;
  path: string | undefined;
  authorization: boolean;
  cookieAbsent: boolean;
  key: string | undefined;
}[] = [];
beforeAll(async () => {
  tls = await tlsHarness((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        command: Command;
      };
      received.push({
        body,
        path: request.url,
        authorization:
          request.headers.authorization === "Bearer test-runtime-bearer",
        cookieAbsent: request.headers.cookie === undefined,
        key: request.headers["idempotency-key"] as string | undefined,
      });
      if (mode === "DROP") {
        request.socket.destroy();
        return;
      }
      if (mode === "REDIRECT") {
        response.writeHead(302, { location: `${tls.origin}/other` }).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      if (mode === "STALL") {
        response.flushHeaders();
        return;
      }
      if (mode === "OVERSIZE") {
        response.end("x".repeat(1048577));
        return;
      }
      const output = responseFor(body.command);
      response.end(
        JSON.stringify(
          mode === "MISMATCH"
            ? { ...output, operation: "CREATE_PAYMENT" }
            : output,
        ),
      );
    });
  });
  provider = createGatewayPaymentProvider({
    connection: {
      ...connection,
      apiOrigin: tls.origin as typeof connection.apiOrigin,
      timeoutMs: 500,
    },
    credentials,
    fetcher: tls.fetcher(),
  });
});
afterAll(async () => {
  await tls?.close();
});
test("actual CA-verified TLS round-trips all seven command/response contracts and headers", async () => {
  mode = "SUCCESS";
  for (const command of commands) {
    expect(await invoke(provider, command)).toEqual(
      paymentPortResponseSchema.parse(responseFor(command)),
    );
    const actual = received.at(-1)!;
    expect(actual).toMatchObject({
      path: "/v1/payment-commands",
      authorization: true,
      cookieAbsent: true,
      body: {
        schemaVersion: 1,
        protocol: "fan-support-gateway-v1",
        merchantAccount: connection.merchantAccount,
        command,
        ...(command.operation === "CREATE_PAYMENT"
          ? { instrument: connection.instruments[0] }
          : command.operation === "GET_CAPABILITIES"
            ? { instruments: connection.instruments }
            : {}),
      },
    });
    expect(actual.key).toBe(
      command.operation === "CREATE_PAYMENT"
        ? command.providerIdempotencyKey
        : command.operation === "CANCEL_PAYMENT" ||
            command.operation === "REFUND_PAYMENT"
          ? command.idempotencyKey
          : undefined,
    );
  }
});
test("actual dropped sockets produce uncertainty only for mutations and never retry", async () => {
  mode = "DROP";
  for (const command of commands) {
    const before = received.length;
    expect(await invoke(provider, command)).toMatchObject({
      outcome: "FAILURE",
      error: {
        recovery: [
          "CREATE_PAYMENT",
          "CANCEL_PAYMENT",
          "REFUND_PAYMENT",
        ].includes(command.operation)
          ? "RECONCILE_REQUIRED"
          : "NONE",
      },
    });
    expect(received.length).toBe(before + 1);
  }
});
test("real oversized, redirect and stalled-body responses are bounded and do not retry", async () => {
  for (const next of ["OVERSIZE", "REDIRECT", "STALL"] as const) {
    mode = next;
    const before = received.length;
    expect(await provider.createPayment(create)).toMatchObject({
      outcome: "FAILURE",
      error: { recovery: "RECONCILE_REQUIRED" },
    });
    expect(received.length).toBe(before + 1);
  }
});
test("real TLS rejects an untrusted CA and a wrong configured server name before any HTTP dispatch", async () => {
  const before = received.length;
  for (const [apiOrigin, fetcher] of [
    [tls.origin, tls.fetcher(false)],
    [
      tls.origin.replace("gateway.example.invalid", "other.example.invalid"),
      tls.fetcher(),
    ],
  ] as const) {
    const invalidTrust = createGatewayPaymentProvider({
      connection: {
        ...connection,
        apiOrigin: apiOrigin as typeof connection.apiOrigin,
        timeoutMs: 500,
      },
      credentials,
      fetcher,
    });
    expect(await invalidTrust.createPayment(create)).toMatchObject({
      outcome: "FAILURE",
      error: { recovery: "RECONCILE_REQUIRED" },
    });
  }
  expect(received.length).toBe(before);
});

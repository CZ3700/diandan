import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { expect, test } from "vitest";

import {
  accountId,
  airwallexRefundId,
  connection,
  credentialResolver,
  intent,
  intentReference,
  refund,
  rotatedWebhookSecret,
  webhookSecret,
} from "./test-support/fake-airwallex.js";
import { createAirwallexWebhookVerifier } from "./webhook.js";

const endpointId = "70000000-0000-4000-8000-000000000007";
const keyHash = "b".repeat(64);
const configuration = {
  schemaVersion: 1,
  binding: (connection as { binding: unknown }).binding,
  endpointId,
  verificationKeyReferenceHash: keyHash,
  secretRef: "secret-ref:v1:env:PAYMENT_SECRET_AIRWALLEX_WEBHOOK",
  toleranceSeconds: 300,
  maxBodyBytes: 65_536,
} as never;
const signedAt = 1_790_000_000_123;
const eventId = "evt_100_2026092600000123_8321220011893766";

function event(name: string, object: unknown, overrides = {}) {
  return {
    id: eventId,
    name,
    account_id: "acct_fixture",
    data: { object },
    created_at: "2026-09-26T00:00:05+0000",
    version: "2026-08-21",
    ...overrides,
  };
}

function signed(
  body: unknown,
  options: Readonly<{
    timestamp?: string;
    secrets?: readonly string[];
    raw?: Buffer;
    headers?: Readonly<Record<string, string>>;
  }> = {},
) {
  const timestamp = options.timestamp ?? String(signedAt);
  const raw = Buffer.from(JSON.stringify(body));
  const [secret] = options.secrets ?? [webhookSecret];
  return {
    schemaVersion: 1,
    operation: "VERIFY_PAYMENT_WEBHOOK",
    endpointId,
    providerAccountId: accountId,
    environment: "TEST",
    verificationKeyReferenceHash: keyHash,
    rawBodyBase64: (options.raw ?? raw).toString("base64url"),
    headers: options.headers ?? {
      "x-timestamp": timestamp,
      "x-signature": createHmac("sha256", secret!)
        .update(`${timestamp}`)
        .update(raw)
        .digest("hex"),
    },
    receivedAt: new Date(signedAt + 2_000).toISOString(),
  };
}

function verifier(secrets: readonly string[] = [webhookSecret]) {
  return createAirwallexWebhookVerifier({
    configuration,
    connection,
    credentials: credentialResolver({
      API_AUTH: ["unusedClient:unusedApiKey000000"],
      WEBHOOK_VERIFY: secrets,
    }),
  });
}

const paid = intent({ status: "SUCCEEDED", client_secret: null });

test("a correctly signed succeeded intent becomes a capture candidate bound to the endpoint", async () => {
  expect(
    await verifier().verifyPaymentWebhook(
      signed(event("payment_intent.succeeded", paid)) as never,
    ),
  ).toEqual({
    schemaVersion: 1,
    operation: "VERIFY_PAYMENT_WEBHOOK",
    outcome: "SUCCESS",
    value: {
      endpointId,
      providerAccountId: accountId,
      environment: "TEST",
      verificationKeyReferenceHash: keyHash,
      signatureTimestamp: new Date(signedAt).toISOString(),
      candidate: {
        schemaVersion: 1,
        providerEventId: eventId.replaceAll("_", "."),
        occurredAt: "2026-09-26T00:00:05.000Z",
        eventType: "PAYMENT_STATUS",
        externalReference: intentReference,
        transaction: { type: "CAPTURE", providerReference: intentReference },
        status: "SUCCEEDED",
        amountMinor: 2500,
        currency: "USD",
      },
    },
  });
});

test("intent events report the snapshot's status and ignore intents the platform did not create", async () => {
  for (const [name, status, expected] of [
    ["payment_intent.cancelled", "CANCELLED", "CANCELED"],
    ["payment_intent.pending", "PENDING", "PROCESSING"],
    ["payment_intent.pending_review", "PENDING_REVIEW", "PROCESSING"],
    // A delayed pending event whose snapshot already succeeded reports the newer fact.
    ["payment_intent.pending", "SUCCEEDED", "SUCCEEDED"],
  ] as const)
    expect(
      await verifier().verifyPaymentWebhook(
        signed(event(name, intent({ status }))) as never,
      ),
    ).toMatchObject({
      outcome: "SUCCESS",
      value: { candidate: { status: expected } },
    });
  for (const [object, code] of [
    [intent({ status: "REQUIRES_PAYMENT_METHOD" }), "UNSUPPORTED_EVENT"],
    [intent({ status: "SUCCEEDED", metadata: {} }), "UNSUPPORTED_EVENT"],
    [
      intent({
        status: "SUCCEEDED",
        merchant_order_id: "90000000-0000-4000-8000-000000000009",
      }),
      "MALFORMED_PROVIDER_RESPONSE",
    ],
    [intent({ status: "REQUIRES_CAPTURE" }), "MALFORMED_PROVIDER_RESPONSE"],
    [
      intent({ status: "SUCCEEDED", amount: 25.001 }),
      "MALFORMED_PROVIDER_RESPONSE",
    ],
  ] as const)
    expect(
      await verifier().verifyPaymentWebhook(
        signed(event("payment_intent.succeeded", object)) as never,
      ),
    ).toMatchObject({ outcome: "FAILURE", error: { code } });
});

test("rotation accepts any configured secret, while tampering, stale timestamps and bad headers fail", async () => {
  const body = event("payment_intent.succeeded", paid);
  const rotating = verifier([rotatedWebhookSecret, webhookSecret]);
  for (const secrets of [[webhookSecret], [rotatedWebhookSecret]])
    expect(
      await rotating.verifyPaymentWebhook(signed(body, { secrets }) as never),
    ).toMatchObject({ outcome: "SUCCESS" });
  const valid = signed(body);
  const cases: [unknown, string][] = [
    [signed(body, { secrets: [rotatedWebhookSecret] }), "INVALID_SIGNATURE"],
    [
      signed(body, {
        raw: Buffer.from(JSON.stringify({ ...body, name: "refund.failed" })),
      }),
      "INVALID_SIGNATURE",
    ],
    [
      { ...valid, headers: { "x-signature": valid.headers["x-signature"] } },
      "INVALID_SIGNATURE",
    ],
    [
      { ...valid, headers: { ...valid.headers, "x-signature": "zz" } },
      "INVALID_SIGNATURE",
    ],
    [
      { ...valid, headers: { ...valid.headers, "x-timestamp": "0123" } },
      "INVALID_SIGNATURE",
    ],
    [
      signed(body, { timestamp: String(signedAt - 301_000) }),
      "EVENT_OUTSIDE_TOLERANCE",
    ],
    // A seconds-resolution timestamp reads as 1970 in milliseconds.
    [
      signed(body, { timestamp: String(Math.floor(signedAt / 1000)) }),
      "EVENT_OUTSIDE_TOLERANCE",
    ],
  ];
  for (const [command, code] of cases)
    expect(
      await verifier().verifyPaymentWebhook(command as never),
    ).toMatchObject({ outcome: "FAILURE", error: { code } });
});

test("endpoint, environment, size and account boundaries are enforced", async () => {
  const body = event("payment_intent.succeeded", paid);
  for (const change of [
    { endpointId: "70000000-0000-4000-8000-000000000008" },
    { environment: "LIVE" },
    { verificationKeyReferenceHash: "c".repeat(64) },
  ])
    expect(
      await verifier().verifyPaymentWebhook({
        ...signed(body),
        ...change,
      } as never),
    ).toMatchObject({ error: { code: "CONFIGURATION_ERROR" } });
  const small = createAirwallexWebhookVerifier({
    configuration: {
      ...(configuration as object),
      maxBodyBytes: 1024,
    } as never,
    connection,
    credentials: credentialResolver(),
  });
  expect(
    await small.verifyPaymentWebhook(
      signed(
        event("payment_intent.succeeded", { ...paid, pad: "x".repeat(2048) }),
      ) as never,
    ),
  ).toMatchObject({ error: { code: "INVALID_COMMAND" } });
  expect(() =>
    createAirwallexWebhookVerifier({
      configuration: {
        ...(configuration as object),
        binding: {
          ...(connection as { binding: object }).binding,
          providerAccountId: "10000000-0000-4000-8000-000000000009",
        },
      } as never,
      connection,
      credentials: credentialResolver(),
    }),
  ).toThrow(TypeError);
});

test("platform refunds map through their metadata; refunds made in the web app are unsupported", async () => {
  for (const [name, status, expected] of [
    ["refund.received", "RECEIVED", "PROCESSING"],
    ["refund.accepted", "ACCEPTED", "SUCCEEDED"],
    ["refund.settled", "SETTLED", "SUCCEEDED"],
    ["refund.failed", "FAILED", "FAILED"],
  ] as const) {
    const response = await verifier().verifyPaymentWebhook(
      signed(event(name, refund({ status }))) as never,
    );
    expect(response).toMatchObject({
      outcome: "SUCCESS",
      value: {
        candidate: {
          eventType: "REFUND_STATUS",
          externalReference: intentReference,
          refundReference: "refund-ref-1",
          status: expected,
          amountMinor: 1000,
          currency: "USD",
        },
      },
    });
    expect(
      (response as { value: { candidate: { transaction?: unknown } } }).value
        .candidate.transaction,
    ).toEqual(
      expected === "SUCCEEDED"
        ? {
            type: "REFUND",
            providerReference: airwallexRefundId.replaceAll("_", "."),
          }
        : undefined,
    );
  }
  expect(
    await verifier().verifyPaymentWebhook(
      signed(event("refund.accepted", refund({ metadata: null }))) as never,
    ),
  ).toMatchObject({ error: { code: "UNSUPPORTED_EVENT" } });
});

test("disputes carry their intent, and only chargebacks against payments move payment state", async () => {
  const dispute = (overrides = {}) => ({
    id: "dst_ch4cfk4lsdEmmgNc3gzyXz7g27n",
    payment_intent_id: "int_hkpdskz7vg1xc7uscdj",
    payment_attempt_id: "att_hkpdskz7vg1xc7uscdj",
    amount: 25,
    currency: "USD",
    stage: "CHARGEBACK",
    status: "REQUIRES_RESPONSE",
    transaction_type: "PAYMENT",
    ...overrides,
  });
  for (const [status, expected, chargeback] of [
    ["REQUIRES_RESPONSE", "OPEN", true],
    ["EXPIRED", "OPEN", true],
    ["WON", "WON", false],
    ["REVERSED", "WON", false],
    ["ACCEPTED", "LOST", true],
    ["LOST", "LOST", true],
  ] as const) {
    const response = await verifier().verifyPaymentWebhook(
      signed(
        event(`payment_dispute.${status.toLowerCase()}`, dispute({ status })),
      ) as never,
    );
    expect(response).toMatchObject({
      outcome: "SUCCESS",
      value: {
        candidate: {
          eventType: "DISPUTE_STATUS",
          externalReference: intentReference,
          disputeReference: "dst.ch4cfk4lsdEmmgNc3gzyXz7g27n",
          status: expected,
          amountMinor: 2500,
        },
      },
    });
    expect(
      "transaction" in
        (response as { value: { candidate: object } }).value.candidate,
    ).toBe(chargeback);
  }
  for (const [object, code] of [
    [dispute({ transaction_type: "REFUND" }), "UNSUPPORTED_EVENT"],
    [dispute({ payment_intent_id: null }), "UNSUPPORTED_EVENT"],
    [dispute({ currency: "KRW", amount: 25_000 }), "UNSUPPORTED_EVENT"],
    [dispute({ amount: 25.005 }), "MALFORMED_PROVIDER_RESPONSE"],
    [dispute({ status: "UNDER_REVIEW" }), "MALFORMED_PROVIDER_RESPONSE"],
  ] as const)
    expect(
      await verifier().verifyPaymentWebhook(
        signed(event("payment_dispute.requires_response", object)) as never,
      ),
    ).toMatchObject({ error: { code } });
});

test("unsubscribed events, unreadable bodies and unavailable secrets fail safely", async () => {
  expect(
    await verifier().verifyPaymentWebhook(
      signed(event("customer.created", { id: "cus_1" })) as never,
    ),
  ).toMatchObject({ error: { code: "UNSUPPORTED_EVENT" } });
  expect(
    await verifier().verifyPaymentWebhook(
      signed(
        event("payment_intent.succeeded", paid, { created_at: "yesterday" }),
      ) as never,
    ),
  ).toMatchObject({ error: { code: "MALFORMED_PROVIDER_RESPONSE" } });
  const garbage = Buffer.from("{not json");
  const timestamp = String(signedAt);
  expect(
    await verifier().verifyPaymentWebhook({
      ...signed({}),
      rawBodyBase64: garbage.toString("base64url"),
      headers: {
        "x-timestamp": timestamp,
        "x-signature": createHmac("sha256", webhookSecret)
          .update(timestamp)
          .update(garbage)
          .digest("hex"),
      },
    } as never),
  ).toMatchObject({ error: { code: "MALFORMED_PROVIDER_RESPONSE" } });
  const unavailable = createAirwallexWebhookVerifier({
    configuration,
    connection,
    credentials: { resolve: async () => Promise.reject(new Error("down")) },
  });
  expect(
    await unavailable.verifyPaymentWebhook(
      signed(event("payment_intent.succeeded", paid)) as never,
    ),
  ).toMatchObject({
    error: { code: "TEMPORARY_UNAVAILABLE", recovery: "RETRY_SAME_COMMAND" },
  });
});

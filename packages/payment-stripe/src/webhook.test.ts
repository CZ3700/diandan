import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { expect, test } from "vitest";

import {
  accountId,
  connection,
  credentialResolver,
  error,
  fakeStripe,
  intentId,
  list,
  ok,
  refund,
  rotatedWebhookSecret,
  session,
  sessionReference,
  webhookSecret,
  apiKey,
} from "./test-support/fake-stripe.js";
import { StripeTransportError } from "./transport.js";
import { createStripeWebhookVerifier } from "./webhook.js";

const endpointId = "70000000-0000-4000-8000-000000000007";
const keyHash = "a".repeat(64);
const configuration = {
  schemaVersion: 1,
  binding: (connection as { binding: unknown }).binding,
  endpointId,
  verificationKeyReferenceHash: keyHash,
  secretRef: "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_WEBHOOK",
  toleranceSeconds: 300,
  maxBodyBytes: 65_536,
} as never;
const signedAt = 1_790_000_000;

function event(type: string, object: unknown, overrides = {}) {
  return {
    id: "evt_1Fixture",
    object: "event",
    type,
    created: signedAt - 5,
    livemode: false,
    data: { object },
    ...overrides,
  };
}

function signed(
  body: unknown,
  options: Readonly<{
    timestamp?: number;
    secrets?: readonly string[];
    header?: (signatures: readonly string[], timestamp: number) => string;
    raw?: Buffer;
  }> = {},
) {
  const timestamp = options.timestamp ?? signedAt;
  const raw = Buffer.from(JSON.stringify(body));
  const signatures = (options.secrets ?? [webhookSecret]).map(
    (secret) =>
      `v1=${createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest("hex")}`,
  );
  return {
    schemaVersion: 1,
    operation: "VERIFY_PAYMENT_WEBHOOK",
    endpointId,
    providerAccountId: accountId,
    environment: "TEST",
    verificationKeyReferenceHash: keyHash,
    rawBodyBase64: (options.raw ?? raw).toString("base64url"),
    headers: {
      "stripe-signature": options.header
        ? options.header(signatures, timestamp)
        : [`t=${timestamp}`, ...signatures].join(","),
    },
    receivedAt: new Date((signedAt + 2) * 1000).toISOString(),
  };
}

function verifier(
  routes: Parameters<typeof fakeStripe>[0] = {},
  secrets: readonly string[] = [webhookSecret],
) {
  const stripe = fakeStripe(routes);
  return {
    stripe,
    verifier: createStripeWebhookVerifier({
      configuration,
      connection,
      credentials: credentialResolver({
        API_AUTH: [apiKey],
        WEBHOOK_VERIFY: secrets,
      }),
      transport: stripe.transport,
    }),
  };
}

const paidSession = session({
  status: "complete",
  payment_status: "paid",
  url: null,
  payment_intent: intentId,
});

test("a correctly signed completed session becomes a capture candidate bound to the endpoint", async () => {
  const { verifier: stripe } = verifier();
  expect(
    await stripe.verifyPaymentWebhook(
      signed(event("checkout.session.completed", paidSession)) as never,
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
      signatureTimestamp: new Date(signedAt * 1000).toISOString(),
      candidate: {
        schemaVersion: 1,
        providerEventId: "evt.1Fixture",
        occurredAt: new Date((signedAt - 5) * 1000).toISOString(),
        eventType: "PAYMENT_STATUS",
        externalReference: sessionReference,
        transaction: { type: "CAPTURE", providerReference: "pi.3MtwBw" },
        status: "SUCCEEDED",
        amountMinor: 2500,
        currency: "USD",
      },
    },
  });
});

test("each Checkout lifecycle event maps to one normalized payment status", async () => {
  const { verifier: stripe } = verifier();
  for (const [type, object, status] of [
    [
      "checkout.session.completed",
      session({ status: "complete", url: null }),
      "PROCESSING",
    ],
    ["checkout.session.async_payment_succeeded", paidSession, "SUCCEEDED"],
    [
      "checkout.session.async_payment_failed",
      session({ status: "complete", url: null }),
      "FAILED",
    ],
    [
      "checkout.session.expired",
      session({ status: "expired", url: null }),
      "EXPIRED",
    ],
  ] as const)
    expect(
      await stripe.verifyPaymentWebhook(signed(event(type, object)) as never),
    ).toMatchObject({ outcome: "SUCCESS", value: { candidate: { status } } });
});

test("rotation accepts any configured secret, while v0 downgrades, tampering and replays fail", async () => {
  const rotating = verifier({}, [rotatedWebhookSecret, webhookSecret]);
  const body = event("checkout.session.completed", paidSession);
  for (const secrets of [
    [webhookSecret],
    [rotatedWebhookSecret, webhookSecret],
  ])
    expect(
      await rotating.verifier.verifyPaymentWebhook(
        signed(body, { secrets }) as never,
      ),
    ).toMatchObject({ outcome: "SUCCESS" });
  const { verifier: stripe } = verifier();
  const cases: [ReturnType<typeof signed>, string][] = [
    [
      signed(body, {
        header: (s, t) => `t=${t},${s[0]!.replace("v1=", "v0=")}`,
      }),
      "INVALID_SIGNATURE",
    ],
    [
      signed(body, { header: (s, t) => `t=${t},t=${t},${s[0]}` }),
      "INVALID_SIGNATURE",
    ],
    [signed(body, { header: () => "garbage" }), "INVALID_SIGNATURE"],
    [signed(body, { secrets: [rotatedWebhookSecret] }), "INVALID_SIGNATURE"],
    [
      signed(body, {
        raw: Buffer.from(JSON.stringify({ ...body, livemode: true })),
      }),
      "INVALID_SIGNATURE",
    ],
    [signed(body, { timestamp: signedAt - 600 }), "EVENT_OUTSIDE_TOLERANCE"],
  ];
  for (const [command, code] of cases)
    expect(await stripe.verifyPaymentWebhook(command as never)).toMatchObject({
      outcome: "FAILURE",
      error: { code },
    });
});

test("endpoint, environment and size boundaries are enforced", async () => {
  const { verifier: stripe } = verifier();
  const body = event("checkout.session.completed", paidSession);
  expect(
    await stripe.verifyPaymentWebhook({
      ...signed(body),
      endpointId: "70000000-0000-4000-8000-000000000008",
    } as never),
  ).toMatchObject({ error: { code: "CONFIGURATION_ERROR" } });
  expect(
    await stripe.verifyPaymentWebhook(
      signed(
        event("checkout.session.completed", paidSession, { livemode: true }),
      ) as never,
    ),
  ).toMatchObject({ error: { code: "CONFIGURATION_ERROR" } });
  const small = createStripeWebhookVerifier({
    configuration: {
      ...(configuration as object),
      maxBodyBytes: 1024,
    } as never,
    connection,
    credentials: credentialResolver(),
    transport: fakeStripe({}).transport,
  });
  expect(
    await small.verifyPaymentWebhook(
      signed(
        event("checkout.session.completed", {
          ...paidSession,
          pad: "x".repeat(2048),
        }),
      ) as never,
    ),
  ).toMatchObject({ error: { code: "INVALID_COMMAND" } });
  expect(() =>
    createStripeWebhookVerifier({
      configuration: {
        ...(configuration as object),
        binding: {
          ...(connection as { binding: object }).binding,
          providerAccountId: "10000000-0000-4000-8000-000000000009",
        },
      } as never,
      connection,
      credentials: credentialResolver(),
      transport: fakeStripe({}).transport,
    }),
  ).toThrow(TypeError);
});

test("platform refunds map through their metadata; refunds made in the Stripe dashboard are unsupported", async () => {
  const { verifier: stripe } = verifier();
  expect(
    await stripe.verifyPaymentWebhook(
      signed(event("refund.updated", refund())) as never,
    ),
  ).toMatchObject({
    outcome: "SUCCESS",
    value: {
      candidate: {
        eventType: "REFUND_STATUS",
        externalReference: sessionReference,
        refundReference: "refund-ref-1",
        status: "SUCCEEDED",
        transaction: { type: "REFUND", providerReference: "re.1Fixture" },
        amountMinor: 1000,
        currency: "USD",
      },
    },
  });
  expect(
    await stripe.verifyPaymentWebhook(
      signed(event("refund.failed", refund({ status: "failed" }))) as never,
    ),
  ).toMatchObject({ value: { candidate: { status: "FAILED" } } });
  expect(
    await stripe.verifyPaymentWebhook(
      signed(event("refund.created", refund({ metadata: {} }))) as never,
    ),
  ).toMatchObject({ error: { code: "UNSUPPORTED_EVENT" } });
});

test("disputes resolve their Checkout session after the signature is proven", async () => {
  const dispute = {
    id: "dp_1Fixture",
    object: "dispute",
    amount: 2500,
    currency: "usd",
    status: "needs_response",
    payment_intent: intentId,
    created: signedAt - 5,
  };
  const body = event("charge.dispute.created", dispute);
  const found = verifier({
    "GET /v1/checkout/sessions": () => ok(list([paidSession])),
  });
  expect(
    await found.verifier.verifyPaymentWebhook(signed(body) as never),
  ).toMatchObject({
    outcome: "SUCCESS",
    value: {
      candidate: {
        eventType: "DISPUTE_STATUS",
        externalReference: sessionReference,
        disputeReference: "dp.1Fixture",
        status: "OPEN",
        transaction: { type: "CHARGEBACK", providerReference: "dp.1Fixture" },
      },
    },
  });
  expect(found.stripe.calls[0]?.parameters).toEqual([
    ["payment_intent", intentId],
    ["limit", "1"],
  ]);
  const foreign = verifier({ "GET /v1/checkout/sessions": () => ok(list([])) });
  expect(
    await foreign.verifier.verifyPaymentWebhook(signed(body) as never),
  ).toMatchObject({
    error: { code: "UNSUPPORTED_EVENT" },
  });
  for (const handler of [
    () => error(500, "api_error"),
    () => {
      throw new StripeTransportError();
    },
  ]) {
    const unavailable = verifier({ "GET /v1/checkout/sessions": handler });
    expect(
      await unavailable.verifier.verifyPaymentWebhook(signed(body) as never),
    ).toMatchObject({
      error: { code: "TEMPORARY_UNAVAILABLE", recovery: "RETRY_SAME_COMMAND" },
    });
  }
});

test("events outside the subscribed set are acknowledged as unsupported", async () => {
  const { verifier: stripe } = verifier();
  expect(
    await stripe.verifyPaymentWebhook(
      signed(event("customer.created", { id: "cus_1" })) as never,
    ),
  ).toMatchObject({ error: { code: "UNSUPPORTED_EVENT" } });
});

import { paymentConnectorSnapshotSchema } from "@fan-support/contracts";
import { expect, test, vi } from "vitest";

import { createAirwallexAdapter } from "./factory.js";
import {
  accountId,
  attemptId,
  connection,
  credentialResolver,
  intent,
  intentReference,
} from "./test-support/fake-airwallex.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("the deployed descriptor promises durable, lookup-backed idempotency for hosted card payments", () => {
  const { connector } = createAirwallexAdapter({
    credentials: credentialResolver(),
  });
  expect(connector.descriptor).toEqual({
    schemaVersion: 1,
    adapterKey: "airwallex",
    adapterVersion: "1.0.0",
    protocol: "airwallex-hpp-v1",
    supportedOperations: [
      "GET_CAPABILITIES",
      "CREATE_PAYMENT",
      "GET_PAYMENT",
      "CANCEL_PAYMENT",
      "REFUND_PAYMENT",
      "RECONCILE_PAYMENT",
      "RECONCILE_REFUND",
    ],
    supportedInstrumentKinds: ["CARD"],
    idempotency: {
      retention: "DURABLE",
      minimumRetentionSeconds: 0,
      referenceLookup: true,
    },
  });
  expect(
    paymentConnectorSnapshotSchema.safeParse({
      schemaVersion: 1,
      revision: 1,
      connections: [connection],
    }).success,
  ).toBe(true);
});

test("connections must match the environment's API, hosted page and supported languages", () => {
  const { connector } = createAirwallexAdapter({
    credentials: credentialResolver(),
  });
  const base = connection as {
    binding: { allowedActionOrigins: string[]; localeMapping: object };
  };
  for (const change of [
    { apiOrigin: "https://api.airwallex.com" },
    { protocol: "airwallex-dropin-v1" },
    { adapterVersion: "2.0.0" },
    {
      binding: {
        ...base.binding,
        allowedActionOrigins: ["https://checkout.airwallex.com"],
      },
    },
    { binding: { ...base.binding, providerCode: "stripe" } },
    {
      binding: {
        ...base.binding,
        localeMapping: {
          ...base.binding.localeMapping,
          th: { providerLocale: "th", fallbackUsed: false },
        },
      },
    },
  ])
    expect(() => connector.create({ ...base, ...change } as never)).toThrow(
      TypeError,
    );
  expect(connector.create(connection).configuration).toMatchObject({
    providerAccountId: accountId,
    providerCode: "airwallex",
  });
});

test("republished providers for one account share its access token", async () => {
  const fetcher = vi.fn(async (url: URL) =>
    url.pathname === "/api/v1/authentication/login"
      ? json({
          token: "shared-access-token-0001",
          expires_at: "2999-01-01T00:00:00+0000",
        })
      : json(intent()),
  );
  const { connector } = createAirwallexAdapter({
    credentials: credentialResolver(),
    fetch: fetcher as never,
  });
  const lookup = {
    schemaVersion: 1,
    operation: "GET_PAYMENT",
    providerAccountId: accountId,
    environment: "TEST",
    attemptId,
    externalReference: intentReference,
  } as const;
  for (const provider of [
    connector.create(connection).provider,
    connector.create(connection).provider,
  ])
    expect(await provider.getPayment(lookup as never)).toMatchObject({
      outcome: "SUCCESS",
    });
  expect(
    fetcher.mock.calls.filter(
      ([url]) => url.pathname === "/api/v1/authentication/login",
    ),
  ).toHaveLength(1);
});

import { describe, expect, it } from "vitest";
import { supportedLocaleSchema } from "./locale.js";
import {
  deployedPaymentAdapterSchema,
  paymentAccountConnectionSchema,
  paymentConnectorSnapshotSchema,
} from "./payment-connector.js";

const connection = () => ({
  schemaVersion: 1,
  binding: {
    schemaVersion: 1,
    providerAccountId: "71000000-0000-4000-8000-000000000001",
    providerCode: "normalized-gateway",
    environment: "TEST",
    localeMapping: Object.fromEntries(
      supportedLocaleSchema.options.map((locale) => [
        locale,
        { providerLocale: locale, fallbackUsed: false },
      ]),
    ),
    allowedActionOrigins: ["https://checkout.example.test"],
  },
  adapterVersion: "1.0.0",
  protocol: "fan-support-gateway-v1",
  apiOrigin: "https://gateway.example.test",
  returnOrigin: "https://shop.example.test",
  merchantAccount: "merchant-test",
  credentialRef: "secret-ref:v1:payment:test/api",
  timeoutMs: 5000,
  instruments: [
    {
      kind: "CARD",
      paymentMethod: "card",
      brands: ["VISA", "MASTERCARD"],
      authentication: "PSP_MANAGED_3DS",
      capture: "AUTOMATIC",
    },
  ],
});
describe("payment connector configuration", () => {
  it("keeps a serializable versioned hosted card binding", () => {
    expect(paymentAccountConnectionSchema.parse(connection())).toEqual(
      connection(),
    );
  });
  it.each([
    { apiOrigin: "http://gateway.example.test" },
    { apiOrigin: "https://gateway.example.test/execute" },
    { apiOrigin: "https://user:password@gateway.example.test" },
    { apiKey: "raw-secret" },
    { script: "return fetch(userUrl)" },
    { credentialRef: "raw-secret" },
    { timeoutMs: 0 },
    { instruments: [] },
    {
      instruments: [
        {
          kind: "CARD",
          paymentMethod: "card",
          brands: ["VISA"],
          authentication: "NONE",
          capture: "AUTOMATIC",
        },
      ],
    },
  ])("rejects unsafe or incomplete connection %j", (patch) => {
    expect(
      paymentAccountConnectionSchema.safeParse({ ...connection(), ...patch })
        .success,
    ).toBe(false);
  });
  it("rejects duplicate accounts even with different UUID casing", () => {
    const first = connection();
    first.binding.providerAccountId = "aaaaaaaa-0000-4000-8000-000000000001";
    const second = structuredClone(first);
    second.binding.providerAccountId =
      first.binding.providerAccountId.toUpperCase();
    expect(
      paymentConnectorSnapshotSchema.safeParse({
        schemaVersion: 1,
        revision: 1,
        connections: [first, second],
      }).success,
    ).toBe(false);
  });
  it("allows an unconfigured deployment with no advertised accounts", () => {
    expect(
      paymentConnectorSnapshotSchema.parse({
        schemaVersion: 1,
        revision: 1,
        connections: [],
      }),
    ).toEqual({ schemaVersion: 1, revision: 1, connections: [] });
  });
  it.each([
    { retention: "DURABLE", minimumRetentionSeconds: 0, referenceLookup: true },
    {
      retention: "BOUNDED",
      minimumRetentionSeconds: 86400,
      referenceLookup: true,
    },
    {
      retention: "UNSUPPORTED",
      minimumRetentionSeconds: 0,
      referenceLookup: false,
    },
  ])(
    "distinguishes externally limited deduplication from a durable guarantee %j",
    (idempotency) => {
      const descriptor = {
        schemaVersion: 1,
        adapterKey: "example",
        adapterVersion: "1.0.0",
        protocol: "example-v1",
        supportedOperations: ["CREATE_PAYMENT"],
        supportedInstrumentKinds: ["CARD"],
        idempotency,
      };
      expect(deployedPaymentAdapterSchema.safeParse(descriptor).success).toBe(
        true,
      );
      expect(
        deployedPaymentAdapterSchema.safeParse({
          ...descriptor,
          idempotency: {
            ...idempotency,
            minimumRetentionSeconds:
              idempotency.minimumRetentionSeconds === 0 ? 1 : 0,
          },
        }).success,
      ).toBe(false);
    },
  );
});

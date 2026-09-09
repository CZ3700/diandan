import { expect, test, vi } from "vitest";
import { createNormalizedGatewayFactory } from "./factory.js";
import { createPaymentConnectorRegistry } from "./registry.js";
import { connection } from "./harness.gateway.js";

test("a statically deployed factory assembles a hosted card provider without reading secrets or issuing requests", () => {
  const resolve = vi.fn();
  const factory = createNormalizedGatewayFactory({ resolve });
  expect(factory.descriptor).toMatchObject({
    adapterKey: "normalized-gateway",
    adapterVersion: "1.0.0",
    protocol: "fan-support-gateway-v1",
    supportedInstrumentKinds: ["CARD", "LOCAL_PAYMENT"],
    idempotency: { retention: "DURABLE", referenceLookup: true },
  });
  const registry = createPaymentConnectorRegistry([factory]);
  expect(registry.directory.getRegistrations()).toEqual([]);
  registry.applyPublishedSnapshot({
    schemaVersion: 1,
    revision: 1,
    connections: [connection],
  });
  expect(registry.directory.getRegistrations()[0]?.configuration).toEqual(
    connection.binding,
  );
  expect(
    typeof registry.directory.getRegistrations()[0]?.provider.refundPayment,
  ).toBe("function");
  expect(resolve).not.toHaveBeenCalled();
});

test("the normalized factory rejects stablecoin without an authenticated settlement mapper", () => {
  const registry = createPaymentConnectorRegistry([
    createNormalizedGatewayFactory({ resolve: vi.fn() }),
  ]);
  expect(() =>
    registry.applyPublishedSnapshot({
      schemaVersion: 1,
      revision: 1,
      connections: [
        {
          ...connection,
          instruments: [
            {
              kind: "STABLECOIN",
              paymentMethod: "usdt",
              asset: "USDT",
              network: "test-chain",
              tokenReference: "test-token",
              decimals: 6,
              minimumConfirmations: 12,
              exceptionPolicy: "MANUAL_REVIEW",
            },
          ],
        },
      ],
    }),
  ).toThrow();
  expect(registry.revision).toBe(0);
});

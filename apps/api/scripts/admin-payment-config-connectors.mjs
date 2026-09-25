import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { request } from "node:https";
import {
  createNormalizedGatewayFactory,
  createGatewayPaymentProvider,
} from "@fan-support/payment-gateway";
import { createPersistentTestPaymentProvider } from "@fan-support/payment-fake/persistent-http";
/** Exact TEST SAN and real CA verification, without global TLS changes. */
export async function createConfigurationTestTlsFetch(caPath) {
  const ca = await readFile(caPath);
  return async (input, options = {}) => {
    const url = new globalThis.URL(input);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "payments.example.invalid" ||
      url.username ||
      url.password
    )
      throw new TypeError("Unapproved configuration TEST PSP origin");
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: Number(url.port),
          servername: url.hostname,
          ca,
          rejectUnauthorized: true,
          path: url.pathname + url.search,
          method: options.method ?? "GET",
          headers: {
            ...Object.fromEntries(new globalThis.Headers(options.headers)),
            host: url.host,
          },
          signal: options.signal,
        },
        (response) => {
          const chunks = [];
          let size = 0;
          response.on("data", (chunk) => {
            size += chunk.length;
            if (size > 1048576)
              response.destroy(new Error("TEST PSP response bound"));
            else chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () =>
            resolve(
              new globalThis.Response(Buffer.concat(chunks), {
                status: response.statusCode,
                headers: response.headers,
              }),
            ),
          );
        },
      );
      req.on("error", reject);
      if (options.body !== undefined) req.write(options.body);
      req.end();
    });
  };
}
export function createConfigurationTestFactories({
  legacy,
  normalized,
  fetcher,
}) {
  const credentials = {
    resolve: async (input) => ({
      ...input,
      version: "owned-test-v1",
      values: [normalized.authorizationToken],
    }),
  };
  const factory = createNormalizedGatewayFactory(credentials);
  return [
    {
      descriptor: {
        ...factory.descriptor,
        adapterKey: legacy.binding.providerCode,
        protocol: "persistent-test-v1",
      },
      create: (connection) => ({
        configuration: connection.binding,
        provider: createPersistentTestPaymentProvider({
          binding: connection.binding,
          endpointOrigin: legacy.endpointOrigin,
          returnOrigin: legacy.returnOrigin,
          authorizationToken: legacy.authorizationToken,
          fetcher,
        }),
      }),
    },
    {
      ...factory,
      create: (connection) => ({
        configuration: connection.binding,
        provider: createGatewayPaymentProvider({
          connection,
          credentials,
          fetcher,
        }),
      }),
    },
  ];
}
export const testHealthPolicy = (binding, version = 1) => ({
  schemaVersion: 1,
  providerAccountId: binding.providerAccountId,
  environment: "TEST",
  version,
  failureThreshold: 3,
  failureWindowMs: 60000,
  openDurationMs: 30000,
  probeLeaseMs: 5000,
  probeRetryMs: 1000,
});
export function testPaymentConnection(deployment, normalized = false) {
  return {
    schemaVersion: 1,
    binding: deployment.binding,
    adapterVersion: "1.0.0",
    protocol: normalized ? "fan-support-gateway-v1" : "persistent-test-v1",
    apiOrigin: deployment.endpointOrigin,
    returnOrigin: deployment.returnOrigin,
    merchantAccount: normalized
      ? deployment.merchantAccount
      : "legacy-test-merchant",
    credentialRef: `secret-ref:v1:test:configuration/${deployment.binding.providerAccountId}`,
    timeoutMs: 5000,
    instruments: [
      {
        kind: "CARD",
        paymentMethod: "fake_card",
        brands: ["VISA", "MASTERCARD"],
        authentication: "PSP_MANAGED_3DS",
        capture: "AUTOMATIC",
      },
    ],
  };
}

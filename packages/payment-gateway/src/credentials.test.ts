import { Buffer } from "node:buffer";
import { expect, test, vi } from "vitest";
import {
  resolveGatewayCredentials,
  type GatewayCredentialRequest,
} from "./credentials.js";
const request: GatewayCredentialRequest = {
  schemaVersion: 1,
  secretRef: "secret-ref:v1:payment:test/api",
  providerAccountId: "10000000-0000-4000-8000-000000000001",
  environment: "TEST",
  purpose: "API_AUTH",
};
const reply = (values = ["opaque-bearer-token"]) => ({
  ...request,
  version: "key-v1",
  values,
});
test("resolves every use and validates the full credential identity", async () => {
  const resolve = vi
    .fn()
    .mockResolvedValueOnce(reply())
    .mockResolvedValueOnce(reply(["rotated-token"]));
  expect(await resolveGatewayCredentials({ resolve }, request)).toEqual([
    "opaque-bearer-token",
  ]);
  expect(await resolveGatewayCredentials({ resolve }, request)).toEqual([
    "rotated-token",
  ]);
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(resolve).toHaveBeenCalledWith(request);
});
test("rejects mismatched receipts, malformed bearer values and resolver errors without leaking values", async () => {
  for (const value of [
    { ...reply(), providerAccountId: "10000000-0000-4000-8000-000000000002" },
    { ...reply(), environment: "LIVE" },
    { ...reply(), purpose: "WEBHOOK_VERIFY" },
    { ...reply(), secretRef: "secret-ref:v1:payment:other" },
    { ...reply(), schemaVersion: 2 },
    { ...reply(), version: "" },
    { ...reply(), private: "PRIVATE_CANARY" },
    reply([]),
    reply(["one", "two"]),
    reply(["PRIVATE_CANARY\r\ninjected: true"]),
  ])
    await expect(
      resolveGatewayCredentials({ resolve: async () => value }, request),
    ).rejects.toThrow(/^Gateway credentials unavailable$/u);
  await expect(
    resolveGatewayCredentials(
      {
        resolve: async () => {
          throw new Error("PRIVATE_CANARY");
        },
      },
      request,
    ),
  ).rejects.toThrow(/^Gateway credentials unavailable$/u);
});
test("accepts bounded Standard Webhooks rotating keysets and rejects invalid keys", async () => {
  const webhook = { ...request, purpose: "WEBHOOK_VERIFY" } as const;
  const keys = [24, 32, 64].map(
    (size) => `whsec_${Buffer.alloc(size, size).toString("base64")}`,
  );
  expect(
    await resolveGatewayCredentials(
      {
        resolve: async () => ({
          ...webhook,
          version: "rotation-v2",
          values: keys,
        }),
      },
      webhook,
    ),
  ).toEqual(keys);
  for (const values of [
    [],
    [...keys, keys[0]],
    ["whsec_%%%"],
    ["whsec_YQ=="],
    [keys[0], keys[0]],
  ]) {
    await expect(
      resolveGatewayCredentials(
        { resolve: async () => ({ ...webhook, version: "v1", values }) },
        webhook,
      ),
    ).rejects.toThrow(/^Gateway credentials unavailable$/u);
  }
});

import { expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  paymentConfigurationPublishedProjectionSchema,
  paymentAccountConnectionSchema,
  paymentHealthPolicySchema,
} from "@fan-support/contracts";
import { createNormalizedGatewayFactory } from "@fan-support/payment-gateway";
const module = await import("./payment-configuration-runtime.js").catch(
  () => undefined,
);
const id = (digit: number) =>
  `71000000-0000-4000-8000-${String(digit).padStart(12, "0")}`;
const connection = (digit: number) =>
  paymentAccountConnectionSchema.parse({
    schemaVersion: 1,
    binding: {
      schemaVersion: 1,
      providerAccountId: id(digit),
      providerCode: "normalized-gateway",
      environment: "TEST",
      localeMapping: Object.fromEntries(
        SUPPORTED_LOCALES.map((locale) => [
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
    merchantAccount: `merchant-${digit}`,
    credentialRef: `secret-ref:v1:payment:test/${digit}`,
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
const policy = (digit: number, version = 1) =>
  paymentHealthPolicySchema.parse({
    schemaVersion: 1,
    providerAccountId: id(digit),
    environment: "TEST",
    version,
    failureThreshold: 3,
    failureWindowMs: 60000,
    openDurationMs: 30000,
    probeLeaseMs: 30000,
    probeRetryMs: 10000,
  });
const projection = (generation: number, accounts = [1, 2]) =>
  paymentConfigurationPublishedProjectionSchema.parse({
    schemaVersion: 1,
    generation,
    publicationId: id(10 + generation),
    revisionId: id(20 + generation),
    accounts: accounts.map((digit) => ({
      providerAccountId: id(digit),
      environment: "TEST",
      adapterKey: "normalized-gateway",
    })),
    policies: accounts.map((digit) => policy(digit, generation + 1)),
  });
function setup() {
  const read = vi.fn(async (): Promise<unknown> => null);
  expect(module?.createPaymentConfigurationRuntime).toBeTypeOf("function");
  const runtime = module!.createPaymentConfigurationRuntime({
    connections: [connection(1), connection(2)],
    factories: [
      createNormalizedGatewayFactory({
        resolve: async () => {
          throw new Error("No business I/O expected");
        },
      }),
    ],
    initialProviderAccountIds: [id(1)],
    initialPolicies: [policy(1)],
    readPublished: read,
  });
  return { runtime, read };
}
test("legacy initialization stays available until a complete published PG projection reaches the real gateway registry", async () => {
  const { runtime, read } = setup();
  expect(runtime.providerDirectory.getRegistrations()).toHaveLength(1);
  await runtime.refresh();
  expect(runtime.generation).toBe(0);
  read.mockResolvedValue(projection(1));
  await runtime.refresh();
  expect(runtime.generation).toBe(1);
  expect(runtime.providerDirectory.getRegistrations()).toHaveLength(2);
  expect(runtime.readPolicies().map((value) => value.version)).toEqual([2, 2]);
  expect(runtime.deployedAccounts).toHaveLength(2);
  expect(JSON.stringify(runtime.deployedAccounts)).not.toContain("merchant-");
  expect(JSON.stringify(runtime.deployedAccounts)).not.toContain("secret-ref");
});
test("failed, regressed or incomplete projections cannot discard old payment identities or partially replace policies", async () => {
  const { runtime, read } = setup();
  read.mockResolvedValue(projection(2));
  await runtime.refresh();
  const before = runtime.readPolicies();
  for (const invalid of [
    projection(1),
    projection(3, [2]),
    { ...projection(3), policies: [policy(1, 4)] },
    {
      ...projection(3),
      accounts: [
        { ...projection(3).accounts[0], adapterKey: "missing-gateway" },
      ],
    },
    { ...projection(2), revisionId: id(90) },
  ]) {
    read.mockResolvedValue(invalid);
    await expect(runtime.refresh()).rejects.toThrow();
    expect(runtime.generation).toBe(2);
    expect(runtime.readPolicies()).toEqual(before);
    expect(runtime.providerDirectory.getRegistrations()).toHaveLength(2);
  }
  read.mockRejectedValue(new Error("Database unavailable"));
  await expect(runtime.refresh()).rejects.toThrow();
  expect(runtime.generation).toBe(2);
});
test("concurrent refreshes read one PG snapshot and publish only once", async () => {
  const { runtime, read } = setup();
  let resolve!: (value: unknown) => void;
  read.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = runtime.refresh(),
    second = runtime.refresh();
  resolve(projection(1));
  await Promise.all([first, second]);
  expect(read).toHaveBeenCalledOnce();
  expect(runtime.generation).toBe(1);
});
test("first managed publication adds a new account while retaining legacy identity and its original health policy", async () => {
  const { runtime, read } = setup();
  const original =
    runtime.providerDirectory.getRegistrations()[0]!.configuration;
  read.mockResolvedValue(projection(5, [2]));
  await runtime.refresh();
  expect(
    runtime.providerDirectory
      .getRegistrations()
      .map((entry) => entry.configuration),
  ).toContainEqual(original);
  expect(runtime.readPolicies()).toContainEqual(policy(1));
  expect(runtime.readPolicies()).toContainEqual(policy(2, 6));
  expect(runtime.generation).toBe(5);
});

import { describe, expect, it, vi } from "vitest";
import {
  deployedPaymentAdapterSchema,
  paymentAccountConnectionSchema,
  SUPPORTED_LOCALES,
  type PaymentAccountConnection,
} from "@fan-support/contracts";
import type { PaymentProvider } from "@fan-support/payment-port";

const connection = (digit = 1) =>
  paymentAccountConnectionSchema.parse({
    schemaVersion: 1,
    binding: {
      schemaVersion: 1,
      providerAccountId: `71000000-0000-4000-8000-${String(digit).padStart(12, "0")}`,
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
const descriptor = () =>
  deployedPaymentAdapterSchema.parse({
    schemaVersion: 1,
    adapterKey: "normalized-gateway",
    adapterVersion: "1.0.0",
    protocol: "fan-support-gateway-v1",
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
const snapshot = (
  revision: number,
  connections: PaymentAccountConnection[],
) => ({ schemaVersion: 1, revision, connections });
function factory() {
  const invoke = vi.fn(async () => {
    throw new Error("No business operation expected");
  });
  const provider: PaymentProvider = {
    getCapabilities: invoke,
    createPayment: invoke,
    getPayment: invoke,
    cancelPayment: invoke,
    refundPayment: invoke,
    reconcilePayment: invoke,
    reconcileRefund: invoke,
  };
  return {
    descriptor: descriptor(),
    create: vi.fn((value: PaymentAccountConnection) => ({
      configuration: value.binding,
      provider,
    })),
    provider,
    invoke,
  };
}
async function registry(factories: ReturnType<typeof factory>[]) {
  const module = await import("./registry.js").catch(() => null);
  expect(module?.createPaymentConnectorRegistry).toBeTypeOf("function");
  return module!.createPaymentConnectorRegistry(factories);
}

describe("deployed payment connector registry", () => {
  it("starts empty and only assembles explicit published accounts", async () => {
    const f = factory(),
      r = await registry([f]);
    expect(r.revision).toBe(0);
    expect(r.directory.getRegistrations()).toEqual([]);
    r.applyPublishedSnapshot(snapshot(1, []));
    expect(r.revision).toBe(1);
    expect(f.create).not.toHaveBeenCalled();
    r.applyPublishedSnapshot(snapshot(2, [connection()]));
    expect(r.directory.getRegistrations()).toHaveLength(1);
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("retains old adapters and accepts identical revision replay without rebuilding", async () => {
    const f = factory(),
      r = await registry([f]),
      first = connection(),
      second = connection(2);
    r.applyPublishedSnapshot(snapshot(1, [first]));
    const old = r.directory.getRegistrations()[0];
    r.applyPublishedSnapshot(snapshot(1, [structuredClone(first)]));
    r.applyPublishedSnapshot(snapshot(2, [second, first]));
    r.applyPublishedSnapshot(snapshot(2, [first, second]));
    expect(r.directory.getRegistrations()).toContain(old);
    expect(f.create).toHaveBeenCalledTimes(2);
    expect(r.revision).toBe(2);
  });

  it("rejects revision conflicts, rollback, and historical account deletion atomically", async () => {
    const f = factory(),
      r = await registry([f]);
    r.applyPublishedSnapshot(snapshot(2, [connection()]));
    for (const invalid of [
      snapshot(2, [connection(), connection(2)]),
      snapshot(1, [connection()]),
      snapshot(3, []),
    ]) {
      expect(() => r.applyPublishedSnapshot(invalid)).toThrow();
      expect(r.revision).toBe(2);
      expect(r.directory.getRegistrations()).toHaveLength(1);
    }
    expect(f.create).toHaveBeenCalledOnce();
  });

  it.each([
    "merchantAccount",
    "protocol",
    "apiOrigin",
    "returnOrigin",
    "credentialRef",
    "adapterVersion",
    "timeoutMs",
    "instruments",
    "binding",
  ] as const)("rejects in-place changes to %s", async (field) => {
    const f = factory(),
      r = await registry([f]),
      before = connection(),
      changed = connection();
    const replacements = {
      merchantAccount: "changed",
      protocol: "other",
      apiOrigin: "https://other.example.test",
      returnOrigin: "https://other.example.test",
      credentialRef: "secret-ref:v1:payment:other",
      adapterVersion: "2.0.0",
      timeoutMs: 6000,
      instruments: [{ kind: "LOCAL_PAYMENT", paymentMethod: "local" }],
      binding: {
        ...changed.binding,
        allowedActionOrigins: ["https://other.example.test"],
      },
    };
    r.applyPublishedSnapshot(snapshot(1, [before]));
    expect(() =>
      r.applyPublishedSnapshot(
        snapshot(2, [
          {
            ...changed,
            [field]: replacements[field],
          } as PaymentAccountConnection,
        ]),
      ),
    ).toThrow();
    expect(r.revision).toBe(1);
    expect(f.create).toHaveBeenCalledOnce();
  });

  it.each(["adapter", "protocol", "version", "instrument"])(
    "rejects unsupported deployed %s before constructing any account",
    async (mismatch) => {
      const f = factory(),
        r = await registry([f]),
        bad = connection(2);
      if (mismatch === "adapter") bad.binding.providerCode = "missing";
      if (mismatch === "protocol") bad.protocol = "missing";
      if (mismatch === "version") bad.adapterVersion = "2.0.0";
      if (mismatch === "instrument")
        bad.instruments = [
          {
            kind: "LOCAL_PAYMENT",
            paymentMethod: bad.instruments[0]!.paymentMethod,
          },
        ];
      expect(() =>
        r.applyPublishedSnapshot(snapshot(1, [connection(), bad])),
      ).toThrow();
      expect(f.create).not.toHaveBeenCalled();
      expect(r.revision).toBe(0);
    },
  );

  it("does not partially publish when a factory fails and can retry the same revision", async () => {
    const f = factory(),
      r = await registry([f]),
      normal = f.create.getMockImplementation()!;
    f.create.mockImplementationOnce(normal).mockImplementationOnce(() => {
      throw new Error("Factory unavailable");
    });
    expect(() =>
      r.applyPublishedSnapshot(snapshot(1, [connection(), connection(2)])),
    ).toThrow();
    expect(r.directory.getRegistrations()).toEqual([]);
    expect(r.revision).toBe(0);
    r.applyPublishedSnapshot(snapshot(1, [connection(), connection(2)]));
    expect(r.revision).toBe(1);
    expect(r.directory.getRegistrations()).toHaveLength(2);
  });

  it("rejects factory bindings which differ from the published account", async () => {
    const f = factory(),
      r = await registry([f]);
    f.create.mockImplementation(() => ({
      configuration: connection(2).binding,
      provider: f.provider,
    }));
    expect(() =>
      r.applyPublishedSnapshot(snapshot(1, [connection()])),
    ).toThrow();
    expect(r.directory.getRegistrations()).toEqual([]);
  });

  it("freezes copies of descriptors, bindings, connection inputs, and callable methods", async () => {
    const f = factory(),
      original = f.create.getMockImplementation()!,
      r = await registry([f]),
      input = connection();
    f.descriptor.protocol = "caller-change";
    f.create.mockImplementationOnce((value) => {
      expect(Object.isFrozen(value)).toBe(true);
      expect(Object.isFrozen(value.binding.localeMapping)).toBe(true);
      return original(value);
    });
    r.applyPublishedSnapshot(snapshot(1, [input]));
    input.binding.allowedActionOrigins.length = 0;
    f.provider.createPayment = vi.fn(async () => {
      throw new Error("Caller replacement");
    });
    const list = r.directory.getRegistrations();
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list[0])).toBe(true);
    expect(Object.isFrozen(list[0]!.configuration.allowedActionOrigins)).toBe(
      true,
    );
    expect(list[0]!.configuration.allowedActionOrigins).toEqual([
      "https://checkout.example.test",
    ]);
    expect(Object.isFrozen(f.provider)).toBe(false);
    await expect(list[0]!.provider.createPayment({} as never)).rejects.toThrow(
      "No business operation expected",
    );
    expect(f.invoke).toHaveBeenCalledOnce();
    expect(f.provider.createPayment).not.toHaveBeenCalled();
  });

  it("rejects duplicate deployed factory identities", async () => {
    const f = factory();
    await expect(registry([f, f])).rejects.toThrow();
  });

  it.each([
    {
      retention: "BOUNDED",
      minimumRetentionSeconds: 3600,
      referenceLookup: true,
    },
    {
      retention: "UNSUPPORTED",
      minimumRetentionSeconds: 0,
      referenceLookup: true,
    },
    {
      retention: "DURABLE",
      minimumRetentionSeconds: 0,
      referenceLookup: false,
    },
  ])(
    "refuses a create connection without durable same-key recovery %j",
    async (idempotency) => {
      const f = factory();
      f.descriptor = deployedPaymentAdapterSchema.parse({
        ...f.descriptor,
        idempotency,
      });
      const r = await registry([f]);
      expect(() =>
        r.applyPublishedSnapshot(snapshot(1, [connection()])),
      ).toThrow();
      expect(f.create).not.toHaveBeenCalled();
      expect(r.revision).toBe(0);
    },
  );

  it("can rebuild a fresh process from the complete latest snapshot", async () => {
    const f = factory(),
      r = await registry([f]);
    r.applyPublishedSnapshot(snapshot(7, [connection(2), connection()]));
    expect(r.revision).toBe(7);
    expect(r.directory.getRegistrations()).toHaveLength(2);
    expect(f.create).toHaveBeenCalledTimes(2);
  });

  it("rejects a factory with a missing provider operation without publishing", async () => {
    const f = factory(),
      r = await registry([f]);
    f.create.mockImplementation((value) => ({
      configuration: value.binding,
      provider: { ...f.provider, getPayment: undefined } as never,
    }));
    expect(() => r.applyPublishedSnapshot(snapshot(1, [connection()]))).toThrow(
      TypeError,
    );
    expect(r.revision).toBe(0);
    expect(r.directory.getRegistrations()).toEqual([]);
  });

  it("preserves the original receiver for stateful adapter methods", async () => {
    const f = factory();
    f.provider.getPayment = vi.fn(async function (this: PaymentProvider) {
      expect(this).toBe(f.provider);
      throw new Error("Receiver captured");
    });
    const r = await registry([f]);
    r.applyPublishedSnapshot(snapshot(1, [connection()]));
    await expect(
      r.directory.getRegistrations()[0]!.provider.getPayment({} as never),
    ).rejects.toThrow("Receiver captured");
    expect(f.provider.getPayment).toHaveBeenCalledOnce();
  });

  it.each([
    "GET_CAPABILITIES",
    "CREATE_PAYMENT",
    "GET_PAYMENT",
    "RECONCILE_PAYMENT",
  ] as const)(
    "rejects a connector which does not support required %s",
    async (operation) => {
      const f = factory();
      f.descriptor.supportedOperations =
        f.descriptor.supportedOperations.filter((value) => value !== operation);
      const r = await registry([f]);
      expect(() =>
        r.applyPublishedSnapshot(snapshot(1, [connection()])),
      ).toThrow(TypeError);
      expect(f.create).not.toHaveBeenCalled();
      expect(r.directory.getRegistrations()).toEqual([]);
    },
  );
});

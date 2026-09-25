import { describe, expect, it, vi } from "vitest";
import type { PaymentRuntimeProviderRegistration } from "@fan-support/payment-port";
import { paymentRuntimeOriginSchema } from "@fan-support/contracts";
import { paymentHarness } from "./payment-runtime.harness.js";
import { createPaymentRuntimeUseCases } from "./payment-runtime.js";

async function directoryHarness() {
  const h = await paymentHarness();
  let registrations: readonly PaymentRuntimeProviderRegistration[] = [];
  const providerDirectory = { getRegistrations: () => registrations };
  const app = createPaymentRuntimeUseCases({
    ...h.dependencies,
    providers: [],
    providerDirectory,
  });
  return {
    ...h,
    app,
    setRegistrations: (value: typeof registrations) => {
      registrations = value;
    },
  };
}

describe("live deployed payment provider directory", () => {
  it("finds a newly registered account in an already constructed use case", async () => {
    const h = await directoryHarness();
    expect(await h.app.create(h.create, h.context)).toMatchObject({
      outcome: "FAILURE",
      code: "CAPABILITY_UNAVAILABLE",
    });
    expect(h.provider.createPayment).not.toHaveBeenCalled();
    h.setRegistrations(h.dependencies.providers);
    expect(await h.app.create(h.create, h.freshContext())).toMatchObject({
      outcome: "SUCCESS",
      action: "CREATED",
      attempt: { status: "REQUIRES_ACTION" },
    });
    expect(h.provider.createPayment).toHaveBeenCalledOnce();
  });

  it("validates duplicate directory bindings before any provider invocation", async () => {
    const h = await paymentHarness();
    const registration = h.dependencies.providers[0]!;
    expect(() =>
      createPaymentRuntimeUseCases({
        ...h.dependencies,
        providers: [],
        providerDirectory: {
          getRegistrations: () => [registration, registration],
        },
      }),
    ).toThrow(TypeError);
    expect(h.provider.createPayment).not.toHaveBeenCalled();
  });

  it("validates later malformed directory snapshots without dispatching", async () => {
    const h = await directoryHarness();
    const registration = h.dependencies.providers[0]!;
    h.setRegistrations([registration, registration]);
    expect(await h.app.create(h.create, h.context)).toMatchObject({
      outcome: "FAILURE",
      code: "TEMPORARY_UNAVAILABLE",
    });
    expect(h.provider.createPayment).not.toHaveBeenCalled();
  });

  it("does not permit a directory to rewrite a previously seen binding", async () => {
    const h = await directoryHarness();
    h.setRegistrations(h.dependencies.providers);
    expect(await h.app.create(h.create, h.context)).toMatchObject({
      outcome: "SUCCESS",
    });
    h.setRegistrations([
      {
        ...h.dependencies.providers[0]!,
        configuration: {
          ...h.dependencies.providers[0]!.configuration,
          allowedActionOrigins: [
            paymentRuntimeOriginSchema.parse("https://changed.example.test"),
          ],
        },
      },
    ]);
    const attempt = h.state().current.currentAttempt!;
    expect(
      await h.app.recover(h.recover(attempt.id), h.freshContext()),
    ).toMatchObject({ outcome: "FAILURE", code: "TEMPORARY_UNAVAILABLE" });
    expect(h.provider.reconcilePayment).not.toHaveBeenCalled();
  });

  it("copies static bindings and callable methods without freezing provider state", async () => {
    const h = await paymentHarness();
    const originalCreate = h.provider.createPayment;
    const app = createPaymentRuntimeUseCases(h.dependencies);
    h.dependencies.providers[0]!.configuration.allowedActionOrigins.push(
      paymentRuntimeOriginSchema.parse("https://unexpected.example.test"),
    );
    h.provider.createPayment = vi.fn(async () => {
      throw new Error("Replaced caller-owned method");
    });
    expect(await app.create(h.create, h.context)).toMatchObject({
      outcome: "SUCCESS",
      attempt: { status: "REQUIRES_ACTION" },
    });
    expect(originalCreate).toHaveBeenCalledOnce();
    expect(h.provider.createPayment).not.toHaveBeenCalled();
  });

  it("rejects removal of a previously seen account instead of changing recovery routing", async () => {
    const h = await directoryHarness();
    h.setRegistrations(h.dependencies.providers);
    expect(await h.app.create(h.create, h.context)).toMatchObject({
      outcome: "SUCCESS",
    });
    h.setRegistrations([]);
    const attempt = h.state().current.currentAttempt!;
    expect(
      await h.app.recover(h.recover(attempt.id), h.freshContext()),
    ).toMatchObject({ outcome: "FAILURE", code: "TEMPORARY_UNAVAILABLE" });
    expect(h.provider.reconcilePayment).not.toHaveBeenCalled();
  });

  it("checks duplicates across static and dynamic registration entry points", async () => {
    const h = await paymentHarness();
    expect(() =>
      createPaymentRuntimeUseCases({
        ...h.dependencies,
        providerDirectory: { getRegistrations: () => h.dependencies.providers },
      }),
    ).toThrow(TypeError);
    expect(h.provider.createPayment).not.toHaveBeenCalled();
  });

  it("rejects missing methods from an otherwise valid binding", async () => {
    const h = await paymentHarness();
    const entry = h.dependencies.providers[0]!;
    expect(() =>
      createPaymentRuntimeUseCases({
        ...h.dependencies,
        providers: [
          {
            ...entry,
            provider: {
              ...entry.provider,
              reconcilePayment: undefined,
            } as never,
          },
        ],
      }),
    ).toThrow(TypeError);
  });
});

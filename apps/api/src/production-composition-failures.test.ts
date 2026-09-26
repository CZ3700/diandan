import { expect, test, vi } from "vitest";

import { createProductionAdminComposition } from "./production-admin-composition.js";
import { createProductionPaymentComposition } from "./production-payment-composition.js";
import { resolveApiProductionConfig } from "./production-config.js";
import { completeProductionEnvironment } from "./test-support/production-environment.js";

const config = resolveApiProductionConfig(completeProductionEnvironment);

function leaseFactory() {
  const closes = vi.fn(async () => undefined);
  const lease = vi.fn(
    () =>
      new Proxy(
        { close: closes },
        {
          get: (target, property) =>
            property === "close"
              ? target.close
              : new Proxy({}, { get: () => vi.fn() }),
        },
      ) as never,
  );
  return { lease, closes };
}

test("administration refuses to start without key management or media clients", () => {
  const { lease } = leaseFactory();
  expect(() =>
    createProductionAdminComposition({
      config: config.admin!,
      resources: {
        persistence: lease,
        paymentConfigurationPersistence: lease,
        keys: undefined,
        media: undefined,
      },
      payment: {
        deployedAccounts: [],
        providerDirectory: { getRegistrations: () => [] },
      },
    }),
  ).toThrow("Administration requires key management and media");
  expect(lease).not.toHaveBeenCalled();
});

test("a failed administration construction returns every hold it borrowed", () => {
  const { lease, closes } = leaseFactory();
  expect(() =>
    createProductionAdminComposition({
      config: { ...config.admin!, tokenPepper: "not-a-pepper" },
      resources: {
        persistence: lease,
        paymentConfigurationPersistence: lease,
        keys: {
          keyManagement: {} as never,
          activePepperVersion: "blind-v1",
          pepperVersions: ["blind-v1"],
        },
        media: {
          storage: {
            createUploadGrant: vi.fn(),
            createDownloadGrant: vi.fn(),
          } as never,
          inspector: { inspect: vi.fn() },
        },
      },
      payment: {
        deployedAccounts: [],
        providerDirectory: { getRegistrations: () => [] },
      },
    }),
  ).toThrow("Administration construction failed");
  expect(lease).toHaveBeenCalledTimes(3);
  expect(closes).toHaveBeenCalledTimes(3);
});

test("without runtime configuration the payment projection still publishes, but checkout payment stays absent", async () => {
  const { lease, closes } = leaseFactory();
  const composition = createProductionPaymentComposition({
    config: { ...config.payment, runtime: undefined },
    factories: [],
    resources: {
      persistence: lease,
      paymentConfigurationPersistence: lease,
      keys: undefined,
      media: undefined,
      lifecycle: { start: vi.fn(), stop: vi.fn() },
    },
    publicMediaBaseUrl: config.storage.publicMediaOrigin,
  });
  expect(composition.payment).toBeUndefined();
  expect(composition.projection.deployedAccounts).toEqual([]);
  expect(composition.projection.providerDirectory.getRegistrations()).toEqual(
    [],
  );
  await composition.paymentConfigurationRuntime.stop();
  expect(closes).toHaveBeenCalledTimes(1);
});

test("a payment runtime without key management is refused and its projection hold is returned", () => {
  const { lease, closes } = leaseFactory();
  expect(() =>
    createProductionPaymentComposition({
      config: config.payment,
      factories: [],
      resources: {
        persistence: lease,
        paymentConfigurationPersistence: lease,
        keys: undefined,
        media: undefined,
        lifecycle: { start: vi.fn(), stop: vi.fn() },
      },
      publicMediaBaseUrl: config.storage.publicMediaOrigin,
    }),
  ).toThrow("Payment requires key management");
  expect(closes).toHaveBeenCalledTimes(1);
});

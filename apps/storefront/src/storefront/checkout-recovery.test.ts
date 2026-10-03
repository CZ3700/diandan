import { expect, it, vi } from "vitest";
import { paymentRuntimeAttemptViewSchema } from "@fan-support/contracts";
import {
  checkoutFixture,
  currentFixture,
} from "../test-support/checkout-fixtures";
import { createCheckoutController } from "./checkout-controller";

const expired = paymentRuntimeAttemptViewSchema.parse({
  ...currentFixture.attempt,
  status: "REQUIRES_ACTION",
  actionExpired: true,
  recovery: "RECONCILE_REQUIRED",
});
const terminal = paymentRuntimeAttemptViewSchema.parse({
  ...currentFixture.attempt,
  status: "EXPIRED",
  recovery: "NONE",
  canRetry: true,
});
const capabilities = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  action: "CAPABILITIES",
  capabilities: {
    schemaVersion: 1,
    checkoutSessionId: checkoutFixture.id,
    presentationLocale: "ja",
    market: checkoutFixture.market,
    currency: checkoutFixture.currency,
    amountMinor: checkoutFixture.amount.totalAmountMinor,
    countries: ["US"],
    country: "US",
    countrySelectionRequired: false,
    capabilities: [],
  },
};

it.each(["return", "refresh", "recover"] as const)(
  "loads current payment choices after a trusted terminal result on %s without creating another attempt",
  async (entry) => {
    const request = vi.fn();
    if (entry === "return") {
      request
        .mockResolvedValueOnce({
          schemaVersion: 1,
          outcome: "SUCCESS",
          action: "READ",
          checkout: checkoutFixture,
        })
        .mockResolvedValueOnce({
          schemaVersion: 1,
          outcome: "SUCCESS",
          action: "READ",
          attempt: terminal,
        });
    } else {
      request
        .mockResolvedValueOnce({ ...currentFixture, attempt: expired })
        .mockResolvedValueOnce({
          schemaVersion: 1,
          outcome: "SUCCESS",
          action: entry === "recover" ? "RECOVERED" : "READ",
          attempt: terminal,
        });
    }
    request.mockResolvedValueOnce(capabilities);
    const controller = createCheckoutController("ja", {
      request,
      dispose: vi.fn(),
    });
    if (entry === "return")
      await controller.initialize({
        session: checkoutFixture.id,
        attempt: terminal.id,
      });
    else {
      await controller.initialize();
      if (entry === "refresh") await controller.refresh();
      else await controller.retry();
    }
    expect(request.mock.calls.map(([call]) => call.kind)).toEqual(
      entry === "return"
        ? ["session", "attempt", "capabilities"]
        : [
            "current",
            entry === "refresh" ? "attempt" : "recover",
            "capabilities",
          ],
    );
    expect(controller.snapshot().capabilities).toEqual(
      capabilities.capabilities,
    );
    expect(controller.snapshot().checkout?.presentationLocale).toBe("en");
  },
);

it("recovers only the existing expired authorization, then rechecks it before an explicit continue", async () => {
  const ready = paymentRuntimeAttemptViewSchema.parse({
    ...expired,
    version: expired.version + 1,
    recovery: "NONE",
    actionExpired: false,
    action: {
      schemaVersion: 1,
      type: "REDIRECT",
      url: "https://payments.example/continue-same-payment",
    },
    actionExpiresAt: "2099-01-01T00:00:00Z",
  });
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ...currentFixture, attempt: expired })
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "RECOVERED",
      attempt: ready,
    })
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "READ",
      attempt: ready,
    });
  const controller = createCheckoutController("ja", {
    request,
    dispose: vi.fn(),
  });
  await controller.initialize();
  await controller.retry();
  expect(request.mock.calls.map(([call]) => call.kind)).toEqual([
    "current",
    "recover",
  ]);
  expect(request.mock.calls[1]?.[0]).toMatchObject({
    method: "POST",
    sessionId: checkoutFixture.id,
    attemptId: expired.id,
  });
  expect(await controller.continuePayment()).toEqual({
    type: "REDIRECT",
    url: "https://payments.example/continue-same-payment",
  });
  expect(request.mock.calls.map(([call]) => call.kind)).toEqual([
    "current",
    "recover",
    "attempt",
  ]);
});

it("replays a lost recovery response with the same request and key, with no new checkout or payment", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ...currentFixture, attempt: expired })
    .mockResolvedValueOnce({ outcome: "UNKNOWN" })
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "RECOVERED",
      attempt: currentFixture.attempt,
    });
  const controller = createCheckoutController("en", {
    request,
    dispose: vi.fn(),
  });
  await controller.initialize();
  await controller.retry();
  expect(controller.snapshot().uncertain).toBe(true);
  expect(await controller.continuePayment()).toBeNull();
  await controller.retry();
  expect(request.mock.calls.map(([call]) => call.kind)).toEqual([
    "current",
    "recover",
    "recover",
  ]);
  expect(request.mock.calls[1]?.[0]).toEqual(request.mock.calls[2]?.[0]);
  expect(controller.snapshot().capabilities).toBeNull();
});

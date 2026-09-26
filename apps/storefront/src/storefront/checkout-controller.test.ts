import { expect, it, vi } from "vitest";
import {
  currentFixture,
  reviewFixture,
  checkoutFixture,
} from "../test-support/checkout-fixtures";
import type { CheckoutReply } from "./checkout-transport";
const load = () => import("./checkout-controller").catch(() => null);
it("shows an empty checkout only after a missing Cookie is confirmed by the read-only cart endpoint", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_ACCESS",
    })
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CART_NOT_FOUND",
    });
  const controller = loaded.createCheckoutController("en", {
    request,
    dispose: vi.fn(),
  });
  await controller.initialize();
  expect(request.mock.calls.map(([call]) => [call.kind, call.method])).toEqual([
    ["current", "GET"],
    ["cart", "GET"],
  ]);
  expect(controller.snapshot()).toMatchObject({
    initialized: true,
    busy: false,
    error: null,
    cart: null,
    checkout: null,
    preflight: null,
    attempt: null,
    uncertain: false,
  });
});
it.each(["INVALID_ACCESS", "CART_EXPIRED", "TEMPORARY_UNAVAILABLE"])(
  "keeps an authentication error when the cart probe does not confirm absence: %s",
  async (code) => {
    const loaded = await load();
    if (!loaded) throw new Error("Missing controller");
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "INVALID_ACCESS",
      })
      .mockResolvedValueOnce({ schemaVersion: 1, outcome: "FAILURE", code });
    const controller = loaded.createCheckoutController("en", {
      request,
      dispose: vi.fn(),
    });
    await controller.initialize();
    expect(
      request.mock.calls.map(([call]) => [call.kind, call.method]),
    ).toEqual([
      ["current", "GET"],
      ["cart", "GET"],
    ]);
    expect(controller.snapshot().error).toBe("INVALID_ACCESS");
  },
);
it("does not probe or turn an unavailable current checkout into an empty cart", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const request = vi.fn().mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "TEMPORARY_UNAVAILABLE",
  });
  const controller = loaded.createCheckoutController("en", {
    request,
    dispose: vi.fn(),
  });
  await controller.initialize();
  expect(request.mock.calls.map(([call]) => call.kind)).toEqual(["current"]);
  expect(controller.snapshot().error).toBe("TEMPORARY_UNAVAILABLE");
});
it("a successful cart probe cannot bypass rejected checkout access", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_ACCESS",
    })
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "READ",
      cart: {
        schemaVersion: 1,
        kind: "CART_RUNTIME",
        version: 1,
        status: "ACTIVE",
        presentationLocale: "en",
        market: "TEST",
        currency: "USD",
        expiresAt: "2099-01-01T00:00:00Z",
        items: [],
      },
    });
  const controller = loaded.createCheckoutController("en", {
    request,
    dispose: vi.fn(),
  });
  await controller.initialize();
  expect(request.mock.calls.map(([call]) => [call.kind, call.method])).toEqual([
    ["current", "GET"],
    ["cart", "GET"],
  ]);
  expect(controller.snapshot()).toMatchObject({
    error: "INVALID_ACCESS",
    checkout: null,
    preflight: null,
  });
});
it("a late missing-cart probe cannot reactivate a disposed checkout", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  let resolve!: (value: CheckoutReply) => void;
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_ACCESS",
    })
    .mockImplementationOnce(
      () =>
        new Promise<CheckoutReply>((done) => {
          resolve = done;
        }),
    );
  const controller = loaded.createCheckoutController("en", {
    request,
    dispose: vi.fn(),
  });
  const initialize = controller.initialize();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  controller.dispose();
  resolve({ schemaVersion: 1, outcome: "FAILURE", code: "CART_NOT_FOUND" });
  await initialize;
  expect(controller.snapshot()).toMatchObject({
    initialized: false,
    busy: false,
    error: null,
    checkout: null,
  });
});
it("recovers an existing uncertain attempt without revalidating, creating or changing its locale", async () => {
  const loaded = await load();
  expect(loaded?.createCheckoutController).toBeTypeOf("function");
  if (!loaded) return;
  const request = vi.fn().mockResolvedValue(currentFixture);
  const controller = loaded.createCheckoutController("ja", {
    request,
    dispose: vi.fn(),
  });
  await controller.initialize();
  expect(request.mock.calls.map(([call]) => call.kind)).toEqual(["current"]);
  expect(controller.snapshot()).toMatchObject({
    checkout: { presentationLocale: "en" },
    attempt: { canRetry: false, recovery: "RECONCILE_REQUIRED" },
  });
});
it("freezes private create body and key after UNKNOWN, blocks duplicate dispatch and wipes on dispose", async () => {
  const loaded = await load();
  expect(loaded?.createCheckoutController).toBeTypeOf("function");
  if (!loaded) return;
  let resolve!: (data: unknown) => void;
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "VALIDATED",
      replayed: false,
      preflight: reviewFixture,
    })
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "CREATED",
      checkout: checkoutFixture,
    });
  const controller = loaded.createCheckoutController("en", {
    request,
    dispose: vi.fn(),
  });
  await controller.validate(2);
  const first = controller.confirm("private@example.test");
  await controller.confirm("different@example.test");
  expect(request).toHaveBeenCalledTimes(2);
  resolve({ outcome: "UNKNOWN" });
  await first;
  expect(controller.snapshot().uncertain).toBe(true);
  expect(JSON.stringify(controller.snapshot())).not.toContain(
    "private@example.test",
  );
  await controller.retry();
  expect(request.mock.calls[1]?.[0]).toEqual(request.mock.calls[2]?.[0]);
  controller.dispose();
  expect(controller.snapshot().checkout).toBeNull();
});
it("never applies a late response after leaving the page", async () => {
  const loaded = await load();
  expect(loaded?.createCheckoutController).toBeTypeOf("function");
  if (!loaded) return;
  let resolve!: (data: CheckoutReply) => void;
  const controller = loaded.createCheckoutController("en", {
    request: vi.fn(
      () =>
        new Promise<CheckoutReply>((r) => {
          resolve = r;
        }),
    ),
    dispose: vi.fn(),
  });
  const running = controller.initialize();
  controller.dispose();
  resolve(currentFixture);
  await running;
  expect(controller.snapshot().checkout).toBeNull();
});
it("does not let an old poll or retry reactivate a disposed page", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const request = vi.fn().mockResolvedValue(currentFixture);
  const controller = loaded.createCheckoutController("en", {
    request,
    dispose: vi.fn(),
  });
  controller.dispose();
  await controller.refresh();
  await controller.retry();
  expect(request).not.toHaveBeenCalled();
});
it("keeps the return locator when retrying a failed status read", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const request = vi
    .fn()
    .mockResolvedValueOnce({ outcome: "UNKNOWN" })
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
      attempt: currentFixture.attempt,
    });
  const controller = loaded.createCheckoutController("ja", {
    request,
    dispose: vi.fn(),
  });
  await controller.initialize({
    session: checkoutFixture.id,
    attempt: currentFixture.attempt.id,
  });
  await controller.retry();
  expect(request.mock.calls.map(([call]) => call.kind)).toEqual([
    "session",
    "session",
    "attempt",
  ]);
});
it("rechecks a hosted action on explicit continue and refuses one that expired meanwhile", async () => {
  const loaded = await load();
  expect(loaded?.createCheckoutController).toBeTypeOf("function");
  if (!loaded) return;
  const ready = {
    ...currentFixture.attempt,
    status: "REQUIRES_ACTION",
    recovery: "NONE",
    action: {
      schemaVersion: 1,
      type: "REDIRECT",
      url: "https://payments.example/continue",
    },
    actionExpiresAt: "2026-09-10T00:00:00Z",
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ...currentFixture, attempt: ready })
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "READ",
      attempt: {
        ...currentFixture.attempt,
        status: "REQUIRES_ACTION",
        recovery: "NONE",
        actionExpired: true,
      },
    });
  const controller = loaded.createCheckoutController("en", {
    request,
    dispose: vi.fn(),
  });
  await controller.initialize();
  expect(controller.continuePayment).toBeTypeOf("function");
  expect(await controller.continuePayment()).toBeNull();
  expect(request.mock.calls.map(([call]) => call.kind)).toEqual([
    "current",
    "attempt",
  ]);
});
it("continues a fresh redirect or a component this release can launch, and nothing else", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const ready = (action: object) => ({
    ...currentFixture.attempt,
    status: "REQUIRES_ACTION",
    recovery: "NONE",
    action,
    actionExpiresAt: "2026-09-10T00:00:00Z",
  });
  const component = (componentKey: string) => ({
    schemaVersion: 1,
    type: "PROVIDER_COMPONENT",
    componentKey,
    clientToken: "A".repeat(40),
  });
  const redirect = {
    schemaVersion: 1,
    type: "REDIRECT",
    url: "https://payments.example/continue",
  };
  for (const [action, expected] of [
    [redirect, { type: "REDIRECT", url: redirect.url }],
    [
      component("airwallex-hpp"),
      { type: "PROVIDER_COMPONENT", action: component("airwallex-hpp") },
    ],
    [component("paypal-buttons"), null],
  ] as const) {
    const attempt = ready(action);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...currentFixture, attempt })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "READ",
        attempt,
      });
    const controller = loaded.createCheckoutController("en", {
      request,
      dispose: vi.fn(),
    });
    await controller.initialize();
    expect(await controller.continuePayment()).toEqual(expected);
  }
});
it("invalidates old capabilities after a configuration conflict instead of offering the stale choice again", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const capability = {
    schemaVersion: 1,
    id: checkoutFixture.id,
    paymentMethod: "card",
    displayName: "Test",
    customerHint: "Test",
    environment: "TEST",
    configVersion: 1,
    ruleVersion: 1,
    supportedActionTypes: ["REDIRECT"],
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ...currentFixture, attempt: null })
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "CAPABILITIES",
      capabilities: {
        schemaVersion: 1,
        checkoutSessionId: checkoutFixture.id,
        presentationLocale: "en",
        market: "TEST",
        currency: "USD",
        amountMinor: 1500,
        countries: ["US"],
        country: "US",
        capabilities: [capability],
      },
    })
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "STALE_CONFIGURATION",
    });
  const controller = loaded.createCheckoutController("en", {
    request,
    dispose: vi.fn(),
  });
  await controller.initialize();
  await controller.start(controller.snapshot().capabilities!.capabilities[0]!);
  expect(controller.snapshot().capabilities).toBeNull();
  expect(controller.snapshot().error).toBe("STALE_CONFIGURATION");
});
it("keeps the country control mounted while new methods are loading", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const capabilities = {
    schemaVersion: 1,
    checkoutSessionId: checkoutFixture.id,
    presentationLocale: "en",
    market: "TEST",
    currency: "USD",
    amountMinor: 1500,
    countries: ["US"],
    country: null,
    capabilities: [],
  };
  let resolve!: (value: unknown) => void;
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ...currentFixture, attempt: null })
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "CAPABILITIES",
      capabilities,
    })
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  const controller = loaded.createCheckoutController("en", {
    request,
    dispose: vi.fn(),
  });
  await controller.initialize();
  const reading = controller.capabilities("US");
  expect(controller.snapshot()).toMatchObject({
    busy: true,
    capabilities: { country: "US", countries: ["US"], capabilities: [] },
  });
  resolve({
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "CAPABILITIES",
    capabilities: { ...capabilities, country: "US" },
  });
  await reading;
});

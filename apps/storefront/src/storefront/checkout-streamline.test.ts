import { expect, it, vi } from "vitest";
import {
  paymentRuntimeAttemptViewSchema,
  paymentRuntimeCapabilitiesViewSchema,
  paymentRuntimeCapabilityViewSchema,
  type PaymentRuntimeAttemptView,
} from "@fan-support/contracts";
import {
  attemptFixture,
  checkoutFixture,
  currentFixture,
  reviewFixture,
} from "../test-support/checkout-fixtures";
import { createCheckoutController } from "./checkout-controller";
import type { CheckoutCall, CheckoutReply } from "./checkout-transport";

const method = paymentRuntimeCapabilityViewSchema.parse({
  schemaVersion: 1,
  id: checkoutFixture.id,
  paymentMethod: "card",
  displayName: "Test card",
  customerHint: "Test funds only",
  environment: "TEST",
  configVersion: 1,
  ruleVersion: 1,
  supportedActionTypes: ["REDIRECT"],
});
const caps = paymentRuntimeCapabilitiesViewSchema.parse({
  schemaVersion: 1,
  checkoutSessionId: checkoutFixture.id,
  presentationLocale: "en",
  market: checkoutFixture.market,
  currency: checkoutFixture.currency,
  amountMinor: checkoutFixture.amount.totalAmountMinor,
  country: "US",
  countries: ["US"],
  countrySelectionRequired: false,
  capabilities: [method],
});
const expected = {
  type: "REDIRECT",
  url: "https://payments.example/continue",
} as const;
const ready = paymentRuntimeAttemptViewSchema.parse({
  ...attemptFixture,
  status: "REQUIRES_ACTION",
  recovery: "NONE",
  action: {
    schemaVersion: 1,
    ...expected,
  },
  actionExpiresAt: "2099-01-01T00:00:00Z",
});
const success = (
  action: "READ" | "CREATED",
  attempt = ready,
): CheckoutReply => ({
  schemaVersion: 1,
  outcome: "SUCCESS",
  action,
  attempt,
});

function fixture(
  capabilities = caps,
  existing: PaymentRuntimeAttemptView | null = null,
) {
  const request = vi.fn(async (call: CheckoutCall): Promise<CheckoutReply> => {
    switch (call.kind) {
      case "validate":
        return {
          schemaVersion: 1,
          outcome: "SUCCESS",
          action: "VALIDATED",
          replayed: false,
          preflight: reviewFixture,
        };
      case "create":
        return {
          schemaVersion: 1,
          outcome: "SUCCESS",
          action: "CREATED",
          checkout: checkoutFixture,
        };
      case "current":
        return { ...currentFixture, attempt: existing };
      case "capabilities":
        return {
          schemaVersion: 1,
          outcome: "SUCCESS",
          action: "CAPABILITIES",
          capabilities,
        };
      case "attempt-create":
        return success("CREATED");
      case "attempt":
        return success("READ");
      default:
        throw new Error(`Unexpected ${call.kind}`);
    }
  });
  const controller = createCheckoutController("en", {
    request,
    dispose: vi.fn(),
  });
  const calls = () => request.mock.calls.map(([call]) => call.kind);
  return { controller, request, calls };
}

it("one explicit confirmation creates the checkout, selects the sole method and rechecks its action", async () => {
  const { controller, request, calls } = fixture();
  await controller.validate(2);
  expect(await controller.confirmAndPay("fan@example.test")).toEqual(expected);
  expect(calls()).toEqual([
    "validate",
    "create",
    "capabilities",
    "attempt-create",
    "attempt",
  ]);
  expect(JSON.parse(request.mock.calls[1]![0].body!).policyAcceptances).toEqual(
    [
      {
        policyKey: "terms",
        policyRevisionId: checkoutFixture.id,
        policyTranslationRevisionId: checkoutFixture.id,
        accepted: true,
      },
    ],
  );
  expect(JSON.stringify(controller.snapshot())).not.toContain(
    "fan@example.test",
  );
});

it.each(
  [
    { ...caps, capabilities: [method, { ...method, id: attemptFixture.id }] },
    { ...caps, countries: ["US", "TH"], countrySelectionRequired: true },
    { ...caps, country: null, countries: [], capabilities: [] },
    { ...caps, capabilities: [] },
    {
      ...caps,
      capabilities: [{ ...method, supportedActionTypes: ["QR_CODE"] }],
    },
    { ...caps, amountMinor: caps.amountMinor + 1 },
    { ...caps, currency: "EUR" },
    { ...caps, market: "OTHER" },
  ].map((value) => paymentRuntimeCapabilitiesViewSchema.parse(value)),
)(
  "leaves choices or a capability mismatch on screen without starting a payment (%#)",
  async (capabilities) => {
    const { controller, calls } = fixture(capabilities);
    await controller.validate(2);
    expect(await controller.confirmAndPay("fan@example.test")).toBeNull();
    expect(calls()).toEqual(["validate", "create", "capabilities"]);
  },
);

it("selecting a method starts only that method and immediately obtains its continuation", async () => {
  const selected = paymentRuntimeCapabilityViewSchema.parse({
    ...method,
    id: attemptFixture.id,
  });
  const { controller, request, calls } = fixture({
    ...caps,
    capabilities: [method, selected],
  });
  await controller.initialize();
  expect(calls()).toEqual(["current", "capabilities"]);
  expect(await controller.startAndPay(selected)).toEqual(expected);
  expect(calls()).toEqual([
    "current",
    "capabilities",
    "attempt-create",
    "attempt",
  ]);
  expect(JSON.parse(request.mock.calls[2]![0].body!).capabilityId).toBe(
    selected.id,
  );
});

it.each([ready, attemptFixture])(
  "never launches or replaces an existing non-retryable attempt (%#)",
  async (existing) => {
    const { controller, calls } = fixture(caps, existing);
    await controller.initialize();
    expect(await controller.startAndPay(method)).toBeNull();
    expect(await controller.confirmAndPay("fan@example.test")).toBeNull();
    expect(calls()).toEqual(["current"]);
  },
);

it("a lost attempt response stops the chain and preserves its exact command for an explicit retry", async () => {
  const { controller, request, calls } = fixture();
  await controller.initialize();
  request.mockResolvedValueOnce({ outcome: "UNKNOWN" });
  expect(await controller.startAndPay(method)).toBeNull();
  expect(controller.snapshot().uncertain).toBe(true);
  expect(await controller.startAndPay(method)).toBeNull();
  request.mockResolvedValueOnce(success("CREATED"));
  await controller.retry();
  expect(calls()).toEqual([
    "current",
    "capabilities",
    "attempt-create",
    "attempt-create",
  ]);
  expect(request.mock.calls[2]![0]).toEqual(request.mock.calls[3]![0]);
  expect(await controller.continuePayment()).toEqual(expected);
});

it("a lost checkout response does not let its recovery automatically create a payment", async () => {
  const { controller, request, calls } = fixture();
  await controller.validate(2);
  request.mockResolvedValueOnce({ outcome: "UNKNOWN" });
  expect(await controller.confirmAndPay("fan@example.test")).toBeNull();
  await controller.retry();
  expect(calls()).toEqual(["validate", "create", "create", "capabilities"]);
  expect(request.mock.calls[1]![0]).toEqual(request.mock.calls[2]![0]);
  expect(controller.snapshot().attempt).toBeNull();
});

it("a failed start cannot continue an earlier retryable attempt", async () => {
  const { controller, request, calls } = fixture(caps, {
    ...attemptFixture,
    status: "FAILED",
    recovery: "NONE",
    canRetry: true,
  });
  await controller.initialize();
  request.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "STALE_CONFIGURATION",
  });
  expect(await controller.startAndPay(method)).toBeNull();
  expect(calls()).toEqual(["current", "capabilities", "attempt-create"]);
  expect(controller.snapshot().capabilities).toBeNull();
});

it("does not continue an action that expires during the final read", async () => {
  const { controller, request, calls } = fixture();
  await controller.initialize();
  request.mockResolvedValueOnce(success("CREATED")).mockResolvedValueOnce(
    success(
      "READ",
      paymentRuntimeAttemptViewSchema.parse({
        ...attemptFixture,
        status: "REQUIRES_ACTION",
        actionExpired: true,
      }),
    ),
  );
  expect(await controller.startAndPay(method)).toBeNull();
  expect(calls()).toEqual([
    "current",
    "capabilities",
    "attempt-create",
    "attempt",
  ]);
});

it("blocks reentrant commands across the whole payment chain and discards a late response after disposal", async () => {
  const { controller, request, calls } = fixture();
  await controller.validate(2);
  let resolve!: (reply: CheckoutReply) => void;
  request
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "CREATED",
      checkout: checkoutFixture,
    })
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  const payment = controller.confirmAndPay("fan@example.test");
  await vi.waitFor(() =>
    expect(calls()).toEqual(["validate", "create", "capabilities"]),
  );
  expect(await controller.confirmAndPay("other@example.test")).toBeNull();
  expect(await controller.startAndPay(method)).toBeNull();
  await controller.retry();
  controller.dispose();
  resolve({
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "CAPABILITIES",
    capabilities: caps,
  });
  expect(await payment).toBeNull();
  expect(calls()).toEqual(["validate", "create", "capabilities"]);
  expect(controller.snapshot().checkout).toBeNull();
});

it("keeps the explicit chain exclusive between completed requests, when the network busy flag is clear", async () => {
  const { controller, calls } = fixture();
  await controller.validate(2);
  let reentered = false;
  const unsubscribe = controller.subscribe(() => {
    const state = controller.snapshot();
    if (!reentered && !state.busy && state.capabilities) {
      reentered = true;
      void controller.start(method);
      void controller.initialize();
      void controller.refresh();
      void controller.retry();
      void controller.continuePayment();
    }
  });
  expect(await controller.confirmAndPay("fan@example.test")).toEqual(expected);
  unsubscribe();
  expect(reentered).toBe(true);
  expect(calls()).toEqual([
    "validate",
    "create",
    "capabilities",
    "attempt-create",
    "attempt",
  ]);
});

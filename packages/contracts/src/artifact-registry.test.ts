import { expect, test } from "vitest";

const domainRuleRootNames = [
  "SelectPaymentRouteInput",
  "PaymentRouteDecision",
  "DecideIdempotencyInput",
  "IdempotencyDecision",
  "LineAmountCalculationInput",
  "LineAmountCalculationDecision",
  "OrderAmountCalculationInput",
  "OrderAmountCalculationDecision",
  "PriceSelectionInput",
  "PriceSelectionDecision",
  "GiftEligibilityInput",
  "GiftEligibilityDecision",
  "InventoryReservationCreationInput",
  "InventoryReservationCreationDecision",
  "InventoryReservationTransitionInput",
  "InventoryReservationTransitionDecision",
  "RefundCapacityInput",
  "RefundCapacityDecision",
  "PaymentAttemptTransitionCommand",
  "PaymentAttemptTransitionDecision",
  "OrderLifecycleTransitionCommand",
  "OrderLifecycleTransitionDecision",
  "OrderPaymentTransitionCommand",
  "OrderPaymentTransitionDecision",
  "RefundTransitionCommand",
  "RefundTransitionDecision",
  "DisputeTransitionCommand",
  "DisputeTransitionDecision",
  "FulfillmentTransitionCommand",
  "FulfillmentTransitionDecision",
  "LatePaymentSuccessCommand",
  "LatePaymentSuccessDecision",
] as const;

test("registers every public domain-rule boundary as an internal artifact root", async () => {
  const { contractArtifactRegistry } = await import("./artifact-registry.js");
  const registrationsByName = new Map(
    contractArtifactRegistry.map((registration) => [
      registration.name,
      registration,
    ]),
  );

  for (const name of domainRuleRootNames) {
    expect(registrationsByName.get(name), `${name} must be registered`).toEqual(
      expect.objectContaining({
        audience: "internal",
        versionedRoot: true,
      }),
    );
  }
});

test("registers reliable-event wire roots as internal versioned contracts", async () => {
  const { contractArtifactRegistry } = await import("./artifact-registry.js");
  const registrationsByName = new Map(
    contractArtifactRegistry.map((registration) => [
      registration.name,
      registration,
    ]),
  );

  for (const name of [
    "VerifiedWebhookEventCandidate",
    "PaymentWebhookVerificationCommand",
    "PaymentWebhookVerificationResponse",
    "PaymentWebhookVerificationError",
    "QueuePropagationCarrier",
    "WebhookInboxJob",
    "OutboxDispatchJob",
    "ReliableEventJob",
  ]) {
    expect(registrationsByName.get(name), `${name} must be registered`).toEqual(
      expect.objectContaining({
        audience: "internal",
        versionedRoot: true,
      }),
    );
  }
});

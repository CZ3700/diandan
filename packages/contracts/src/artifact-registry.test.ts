import { expect, test } from "vitest";

test("registers content draft boundaries as internal versioned contracts", async () => {
  const { contractArtifactRegistry } = await import("./artifact-registry.js");
  for (const name of [
    "IdolAliasSet",
    "CreateIdolAliasDraftCommand",
    "CreateGiftDetailDraftCommand",
    "ContentDraftReadCommand",
    "ContentDraftFailure",
    "IdolAliasDraftResponse",
    "GiftDetailDraftResponse",
    "ContentDraftResponse",
  ]) {
    expect(
      contractArtifactRegistry.find((entry) => entry.name === name),
      name,
    ).toMatchObject({ audience: "internal", versionedRoot: true });
  }
});

test("registers discovery, framing and localized detail boundaries without pretending HTTP operations exist", async () => {
  const { contractArtifactRegistry } = await import("./artifact-registry.js");
  const roots = new Map(
    contractArtifactRegistry.map((root) => [root.name, root]),
  );
  for (const name of [
    "DiscoveryCacheInput",
    "DiscoveryCacheKey",
    "IdolDiscoveryQuery",
    "GiftDiscoveryQuery",
    "CatalogPageInfo",
    "IdolDiscoveryPlan",
    "GiftDiscoveryPlan",
    "ChangeGiftDiscoveryQuery",
    "CatalogPageRequest",
    "MediaFramingRequest",
    "MediaFramingPlan",
    "MediaFramingResult",
    "GiftDetailDocument",
    "GiftDetailTranslation",
    "GiftDetailValidationInput",
    "GiftDetailValidationReport",
  ])
    expect(roots.get(name), name).toMatchObject({ versionedRoot: true });
});

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
    "PaymentWebhookEndpointPreflightCommand",
    "PaymentWebhookEndpointPreflightResult",
    "QueuePropagationCarrier",
    "WebhookInboxJob",
    "OutboxDispatchJob",
    "ReliableEventJob",
    "ReceivePaymentWebhookCommand",
    "ReceivePaymentWebhookResponse",
    "ReceivePaymentWebhookError",
    "ReliableEventDeliveryContext",
    "PaymentWebhookEndpointDescriptor",
    "EncryptedWebhookPayload",
    "ReliableEventPersistenceCommand",
    "ReliableEventPersistenceResponse",
  ]) {
    expect(registrationsByName.get(name), `${name} must be registered`).toEqual(
      expect.objectContaining({
        audience: "internal",
        versionedRoot: true,
      }),
    );
  }
});

test("registers only the safe webhook receipt as a public HTTP contract", async () => {
  const { contractArtifactRegistry } = await import("./artifact-registry.js");
  const registrationsByName = new Map(
    contractArtifactRegistry.map((registration) => [
      registration.name,
      registration,
    ]),
  );

  expect(registrationsByName.get("PaymentWebhookAcceptedResponse")).toEqual(
    expect.objectContaining({
      audience: "public-http",
      versionedRoot: true,
    }),
  );
  for (const internalName of [
    "ReceivePaymentWebhookCommand",
    "ReceivePaymentWebhookResponse",
    "PaymentWebhookVerificationCommand",
  ]) {
    expect(registrationsByName.get(internalName)?.audience).toBe("internal");
  }
});

test("keeps media processing contracts internal and versioned", async () => {
  const { contractArtifactRegistry } = await import("./artifact-registry.js");
  for (const name of [
    "MediaImageProcessingCommand",
    "MediaImageProcessingSuccess",
    "MediaImageProcessingResult",
    "MediaProcessingEnqueueCommand",
    "MediaProcessingReadCommand",
    "MediaProcessingClaimCommand",
    "MediaProcessingClaim",
    "MediaProcessingSnapshot",
    "MediaProcessingRepositoryFailure",
    "MediaProcessingSnapshotResponse",
    "MediaProcessingClaimResponse",
    "MediaProcessingCompleteCommand",
    "MediaProcessingFailCommand",
    "MediaProcessingRunResult",
  ]) {
    expect(
      contractArtifactRegistry.find((root) => root.name === name),
      name,
    ).toMatchObject({ audience: "internal", versionedRoot: true });
  }
});

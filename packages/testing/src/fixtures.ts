import {
  cachePurgePortCommandSchema,
  identityPortCommandSchema,
  keyManagementPortCommandSchema,
  mediaPortCommandSchema,
  notificationPortCommandSchema,
  paymentPortCommandSchema,
  persistencePortCommandSchema,
  type AppendOutboxEventCommand,
  type ApplyInventoryReservationCreationCommand,
  type ApplyInventoryReservationTransitionCommand,
  type BeginIdempotencyCommand,
  type CancelPaymentCommand,
  type CompleteIdempotencyCommand,
  type ComputeBlindIndexCommand,
  type CreateAuthorizationRequestCommand,
  type CreateMediaDownloadGrantCommand,
  type CreateMediaUploadGrantCommand,
  type CreatePaymentCommand,
  type DecryptEnvelopeCommand,
  type DeleteMediaObjectCommand,
  type EncryptEnvelopeCommand,
  type EncryptEnvelopeFieldsCommand,
  type ExchangeAuthorizationCodeCommand,
  type GetCachePurgeStatusCommand,
  type GetPaymentCapabilitiesCommand,
  type GetPaymentCommand,
  type InspectMediaObjectCommand,
  type LoadInventoryForUpdateCommand,
  type ReconcilePaymentCommand,
  type ReconcileRefundCommand,
  type RefundPaymentCommand,
  type ResolvePublicMediaUrlCommand,
  type SendNotificationCommand,
  type SubmitCachePurgeCommand,
  type VerifyAndParseWebhookCommand,
} from "@fan-support/contracts";
import {
  planInventoryReservationCreation,
  planInventoryReservationTransition,
} from "@fan-support/domain";

export const DETERMINISTIC_NOW = "2026-09-03T00:00:00.000Z" as const;

const ids = Object.freeze({
  attempt: "10000000-0000-4000-8000-000000000001",
  order: "10000000-0000-4000-8000-000000000002",
  provider: "10000000-0000-4000-8000-000000000003",
  refund: "10000000-0000-4000-8000-000000000004",
  refundOverCapacity: "10000000-0000-4000-8000-000000000014",
  capturedAttempt: "10000000-0000-4000-8000-000000000015",
  capturedOrder: "10000000-0000-4000-8000-000000000016",
  capturedRefund: "10000000-0000-4000-8000-000000000017",
  capturedRefundOverCapacity: "10000000-0000-4000-8000-000000000018",
  capturedAudit: "10000000-0000-4000-8000-000000000019",
  capturedAuditSecond: "10000000-0000-4000-8000-00000000001a",
  webhook: "10000000-0000-4000-8000-000000000005",
  audit: "10000000-0000-4000-8000-000000000006",
  notification: "10000000-0000-4000-8000-000000000007",
  contact: "10000000-0000-4000-8000-000000000008",
  correlation: "10000000-0000-4000-8000-000000000009",
  item: "10000000-0000-4000-8000-00000000000a",
  location: "10000000-0000-4000-8000-00000000000b",
  variant: "10000000-0000-4000-8000-00000000000c",
  reservation: "10000000-0000-4000-8000-00000000000d",
  quote: "10000000-0000-4000-8000-00000000000e",
  cartItem: "10000000-0000-4000-8000-00000000000f",
  ledgerCreate: "20000000-0000-4000-8000-000000000001",
  ledgerTransition: "20000000-0000-4000-8000-000000000002",
  event: "20000000-0000-4000-8000-000000000003",
  request: "20000000-0000-4000-8000-000000000004",
});

function parsed<Output>(
  schema: Readonly<{ parse(value: unknown): unknown }>,
  value: unknown,
): Output {
  return schema.parse(value) as Output;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen);
  }
  return Object.freeze(value);
}

const payment = Object.freeze({
  getCapabilities: parsed<GetPaymentCapabilitiesCommand>(
    paymentPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "GET_CAPABILITIES",
      providerAccountId: ids.provider,
      environment: "TEST",
      market: "AMERICAS",
      country: "US",
      currency: "USD",
      amountMinor: 2_500,
      requestedLocale: "en",
      supportedActionTypes: ["REDIRECT"],
    },
  ),
  createPayment: parsed<CreatePaymentCommand>(paymentPortCommandSchema, {
    schemaVersion: 1,
    operation: "CREATE_PAYMENT",
    providerAccountId: ids.provider,
    environment: "TEST",
    attemptId: ids.attempt,
    orderId: ids.order,
    paymentMethod: "fake_card",
    amountMinor: 2_500,
    currency: "USD",
    requestedLocale: "en",
    merchantReference: ids.attempt,
    providerIdempotencyKey: ids.attempt,
    returnUrl: "https://store.example.invalid/payment/return",
    cancelUrl: "https://store.example.invalid/payment/cancel",
  }),
  verifyAndParseWebhook: parsed<VerifyAndParseWebhookCommand>(
    paymentPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "VERIFY_AND_PARSE_WEBHOOK",
      providerAccountId: ids.provider,
      environment: "TEST",
      webhookInboxId: ids.webhook,
      rawBodyBase64: "e30",
      headers: { "x-fake-signature": "fixture-signature" },
      receivedAt: DETERMINISTIC_NOW,
    },
  ),
  getPayment: parsed<GetPaymentCommand>(paymentPortCommandSchema, {
    schemaVersion: 1,
    operation: "GET_PAYMENT",
    providerAccountId: ids.provider,
    environment: "TEST",
    attemptId: ids.attempt,
    externalReference: `fake-payment/${ids.attempt}`,
  }),
  cancelPayment: parsed<CancelPaymentCommand>(paymentPortCommandSchema, {
    schemaVersion: 1,
    operation: "CANCEL_PAYMENT",
    providerAccountId: ids.provider,
    environment: "TEST",
    attemptId: ids.attempt,
    externalReference: `fake-payment/${ids.attempt}`,
    idempotencyKey: ids.attempt,
    reasonCode: "CUSTOMER_CANCELED",
  }),
  refundPayment: parsed<RefundPaymentCommand>(paymentPortCommandSchema, {
    schemaVersion: 1,
    operation: "REFUND_PAYMENT",
    providerAccountId: ids.provider,
    environment: "TEST",
    refundId: ids.refund,
    paymentAttemptId: ids.attempt,
    externalReference: `fake-payment/${ids.attempt}`,
    refundReference: `merchant-refund/${ids.refund}`,
    amountMinor: 2_500,
    currency: "USD",
    idempotencyKey: ids.refund,
  }),
  refundPaymentConflict: parsed<RefundPaymentCommand>(
    paymentPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "REFUND_PAYMENT",
      providerAccountId: ids.provider,
      environment: "TEST",
      refundId: ids.refund,
      paymentAttemptId: ids.attempt,
      externalReference: `fake-payment/${ids.attempt}`,
      refundReference: `merchant-refund/${ids.refund}`,
      amountMinor: 2_499,
      currency: "USD",
      idempotencyKey: ids.refund,
    },
  ),
  refundPaymentOverCapacity: parsed<RefundPaymentCommand>(
    paymentPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "REFUND_PAYMENT",
      providerAccountId: ids.provider,
      environment: "TEST",
      refundId: ids.refundOverCapacity,
      paymentAttemptId: ids.attempt,
      externalReference: `fake-payment/${ids.attempt}`,
      refundReference: `merchant-refund/${ids.refundOverCapacity}`,
      amountMinor: 1,
      currency: "USD",
      idempotencyKey: ids.refundOverCapacity,
    },
  ),
  reconcilePayment: parsed<ReconcilePaymentCommand>(paymentPortCommandSchema, {
    schemaVersion: 1,
    operation: "RECONCILE_PAYMENT",
    providerAccountId: ids.provider,
    environment: "TEST",
    attemptId: ids.attempt,
    merchantReference: ids.attempt,
    providerIdempotencyKey: ids.attempt,
    amountMinor: 2_500,
    currency: "USD",
    auditLogId: ids.audit,
  }),
  reconcileRefund: parsed<ReconcileRefundCommand>(paymentPortCommandSchema, {
    schemaVersion: 1,
    operation: "RECONCILE_REFUND",
    providerAccountId: ids.provider,
    environment: "TEST",
    refundId: ids.refund,
    paymentAttemptId: ids.attempt,
    externalReference: `fake-payment/${ids.attempt}`,
    refundReference: `merchant-refund/${ids.refund}`,
    amountMinor: 2_500,
    currency: "USD",
    idempotencyKey: ids.refund,
    auditLogId: ids.audit,
  }),
  capturedCreatePayment: parsed<CreatePaymentCommand>(
    paymentPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "CREATE_PAYMENT",
      providerAccountId: ids.provider,
      environment: "TEST",
      attemptId: ids.capturedAttempt,
      orderId: ids.capturedOrder,
      paymentMethod: "fake_card",
      amountMinor: 2_500,
      currency: "USD",
      requestedLocale: "en",
      merchantReference: ids.capturedAttempt,
      providerIdempotencyKey: ids.capturedAttempt,
      returnUrl: "https://store.example.invalid/payment/return",
      cancelUrl: "https://store.example.invalid/payment/cancel",
    },
  ),
  capturedReconcilePayment: parsed<ReconcilePaymentCommand>(
    paymentPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "RECONCILE_PAYMENT",
      providerAccountId: ids.provider,
      environment: "TEST",
      attemptId: ids.capturedAttempt,
      merchantReference: ids.capturedAttempt,
      providerIdempotencyKey: ids.capturedAttempt,
      amountMinor: 2_500,
      currency: "USD",
      auditLogId: ids.capturedAudit,
    },
  ),
  capturedReconcilePaymentAgain: parsed<ReconcilePaymentCommand>(
    paymentPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "RECONCILE_PAYMENT",
      providerAccountId: ids.provider,
      environment: "TEST",
      attemptId: ids.capturedAttempt,
      merchantReference: ids.capturedAttempt,
      providerIdempotencyKey: ids.capturedAttempt,
      amountMinor: 2_500,
      currency: "USD",
      auditLogId: ids.capturedAuditSecond,
    },
  ),
  capturedRefundPayment: parsed<RefundPaymentCommand>(
    paymentPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "REFUND_PAYMENT",
      providerAccountId: ids.provider,
      environment: "TEST",
      refundId: ids.capturedRefund,
      paymentAttemptId: ids.capturedAttempt,
      externalReference: `fake-payment/${ids.capturedAttempt}`,
      refundReference: `merchant-refund/${ids.capturedRefund}`,
      amountMinor: 2_500,
      currency: "USD",
      idempotencyKey: ids.capturedRefund,
    },
  ),
  capturedRefundPaymentConflict: parsed<RefundPaymentCommand>(
    paymentPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "REFUND_PAYMENT",
      providerAccountId: ids.provider,
      environment: "TEST",
      refundId: ids.capturedRefund,
      paymentAttemptId: ids.capturedAttempt,
      externalReference: `fake-payment/${ids.capturedAttempt}`,
      refundReference: `merchant-refund/${ids.capturedRefund}`,
      amountMinor: 2_499,
      currency: "USD",
      idempotencyKey: ids.capturedRefund,
    },
  ),
  capturedRefundPaymentOverCapacity: parsed<RefundPaymentCommand>(
    paymentPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "REFUND_PAYMENT",
      providerAccountId: ids.provider,
      environment: "TEST",
      refundId: ids.capturedRefundOverCapacity,
      paymentAttemptId: ids.capturedAttempt,
      externalReference: `fake-payment/${ids.capturedAttempt}`,
      refundReference: `merchant-refund/${ids.capturedRefundOverCapacity}`,
      amountMinor: 1,
      currency: "USD",
      idempotencyKey: ids.capturedRefundOverCapacity,
    },
  ),
  capturedReconcileRefund: parsed<ReconcileRefundCommand>(
    paymentPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "RECONCILE_REFUND",
      providerAccountId: ids.provider,
      environment: "TEST",
      refundId: ids.capturedRefund,
      paymentAttemptId: ids.capturedAttempt,
      externalReference: `fake-payment/${ids.capturedAttempt}`,
      refundReference: `merchant-refund/${ids.capturedRefund}`,
      amountMinor: 2_500,
      currency: "USD",
      idempotencyKey: ids.capturedRefund,
      auditLogId: ids.capturedAudit,
    },
  ),
});

const mediaBase = {
  schemaVersion: 1,
  storageClass: "SOURCE",
  objectKey: "fixtures/media/source-image.jpg",
} as const;
const media = Object.freeze({
  createUploadGrant: parsed<CreateMediaUploadGrantCommand>(
    mediaPortCommandSchema,
    {
      ...mediaBase,
      operation: "CREATE_UPLOAD_GRANT",
      checksumSha256: "a".repeat(64),
      byteSize: 1_024,
      mimeType: "image/jpeg",
      expiresAt: "2026-09-03T00:15:00.000Z",
    },
  ),
  inspectObject: parsed<InspectMediaObjectCommand>(mediaPortCommandSchema, {
    ...mediaBase,
    operation: "INSPECT_OBJECT",
  }),
  createDownloadGrant: parsed<CreateMediaDownloadGrantCommand>(
    mediaPortCommandSchema,
    {
      ...mediaBase,
      operation: "CREATE_DOWNLOAD_GRANT",
      expiresAt: "2026-09-03T00:15:00.000Z",
    },
  ),
  deleteObject: parsed<DeleteMediaObjectCommand>(mediaPortCommandSchema, {
    ...mediaBase,
    operation: "DELETE_OBJECT",
    expectedChecksumSha256: "a".repeat(64),
    expectedRevisionToken: "68b329da9893e34099c7d8ad5cb9c940",
  }),
  resolvePublicUrl: parsed<ResolvePublicMediaUrlCommand>(
    mediaPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "RESOLVE_PUBLIC_URL",
      storageClass: "DERIVATIVE",
      objectKey: "fixtures/media/public-image.webp",
    },
  ),
});

const baseIdentityState = "fixture-state-000000000000000000000000000000";
const baseIdentityNonce = "fixture-nonce-000000000000000000000000000000";
const baseIdentityCodeChallenge = "DwBzhbb51LfusnSGBa_hqYSgo7-j8BTQnip4TOnlzRo";
const baseIdentityCodeVerifier = "A".repeat(43);

export function deterministicIdentityAuthorizationCode(state: string): string {
  return state === baseIdentityState ? "fixture-code" : `fixture-code/${state}`;
}

function identityAuthorizationTransaction(label: string) {
  const state = `fixture-${label}-state`.padEnd(43, "0");
  const nonce = `fixture-${label}-nonce`.padEnd(43, "0");
  const createAuthorizationRequest = parsed<CreateAuthorizationRequestCommand>(
    identityPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "CREATE_AUTHORIZATION_REQUEST",
      issuer: "https://identity.example.invalid",
      clientId: "fan-support-admin",
      redirectUri: "https://admin.example.invalid/oidc/callback",
      state,
      nonce,
      codeChallenge: baseIdentityCodeChallenge,
      requestedAt: DETERMINISTIC_NOW,
    },
  );
  const exchangeAuthorizationCode = parsed<ExchangeAuthorizationCodeCommand>(
    identityPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "EXCHANGE_AUTHORIZATION_CODE",
      issuer: createAuthorizationRequest.issuer,
      clientId: createAuthorizationRequest.clientId,
      redirectUri: createAuthorizationRequest.redirectUri,
      code: deterministicIdentityAuthorizationCode(state),
      state,
      expectedState: state,
      nonce,
      codeVerifier: baseIdentityCodeVerifier,
      receivedAt: DETERMINISTIC_NOW,
    },
  );
  return Object.freeze({
    createAuthorizationRequest,
    exchangeAuthorizationCode,
  });
}

const identityCreateAuthorizationRequest =
  parsed<CreateAuthorizationRequestCommand>(identityPortCommandSchema, {
    schemaVersion: 1,
    operation: "CREATE_AUTHORIZATION_REQUEST",
    issuer: "https://identity.example.invalid",
    clientId: "fan-support-admin",
    redirectUri: "https://admin.example.invalid/oidc/callback",
    state: baseIdentityState,
    nonce: baseIdentityNonce,
    codeChallenge: baseIdentityCodeChallenge,
    requestedAt: DETERMINISTIC_NOW,
  });
const identityExchangeAuthorizationCode =
  parsed<ExchangeAuthorizationCodeCommand>(identityPortCommandSchema, {
    schemaVersion: 1,
    operation: "EXCHANGE_AUTHORIZATION_CODE",
    issuer: identityCreateAuthorizationRequest.issuer,
    clientId: identityCreateAuthorizationRequest.clientId,
    redirectUri: identityCreateAuthorizationRequest.redirectUri,
    code: deterministicIdentityAuthorizationCode(baseIdentityState),
    state: baseIdentityState,
    expectedState: baseIdentityState,
    nonce: baseIdentityNonce,
    codeVerifier: baseIdentityCodeVerifier,
    receivedAt: DETERMINISTIC_NOW,
  });

const identity = Object.freeze({
  authorizationEndpoint: "https://identity.example.invalid/authorize",
  createAuthorizationRequest: identityCreateAuthorizationRequest,
  exchangeAuthorizationCode: identityExchangeAuthorizationCode,
  authorizationTransactions: Object.freeze({
    stateMismatch: identityAuthorizationTransaction("state-mismatch"),
    nonceMismatch: identityAuthorizationTransaction("nonce-mismatch"),
    invalidCode: identityAuthorizationTransaction("invalid-code"),
    invalidPkceVerifier: identityAuthorizationTransaction("invalid-pkce"),
    issuerMismatch: identityAuthorizationTransaction("issuer-mismatch"),
    clientIdMismatch: identityAuthorizationTransaction("client-mismatch"),
    redirectUriMismatch: identityAuthorizationTransaction("redirect-mismatch"),
    expiredCode: identityAuthorizationTransaction("expired-code"),
  }),
});

const notification = Object.freeze({
  sendNotification: parsed<SendNotificationCommand>(
    notificationPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
      notification: {
        schemaVersion: 1,
        id: ids.notification,
        orderId: ids.order,
        customerContactId: ids.contact,
        eventType: "PAYMENT_CONFIRMED",
        locale: {
          schemaVersion: 1,
          requestedLocale: "en",
          resolvedLocale: "en",
          fallbackUsed: false,
          templateKey: "order.payment.confirmed",
          templateVersion: "fixture-v1",
          contentRevisionIds: [],
        },
        idempotencyKey: "notification-fixture-0001",
        correlationId: ids.correlation,
      },
      channel: "EMAIL",
      content: {
        subject: "Your gift order is confirmed",
        text: "Your gift order is confirmed.",
        html: "<p>Your gift order is confirmed.</p>",
      },
    },
  ),
});

const cachePurge = Object.freeze({
  submitPurge: parsed<SubmitCachePurgeCommand>(cachePurgePortCommandSchema, {
    schemaVersion: 1,
    operation: "SUBMIT_PURGE",
    idempotencyKey: "cache-purge-fixture-0001",
    paths: ["/en/idols/fixture"],
  }),
  getPurgeStatus: parsed<GetCachePurgeStatusCommand>(
    cachePurgePortCommandSchema,
    {
      schemaVersion: 1,
      operation: "GET_PURGE_STATUS",
      purgeReference: "fixture-purge/0001",
    },
  ),
});

const keyManagement = Object.freeze({
  encryptEnvelope: parsed<EncryptEnvelopeCommand>(
    keyManagementPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      purpose: "SUPPORT_INTENT_MESSAGE",
      subjectId: ids.cartItem,
      plaintextBase64: "ZmljdHVyZQ",
    },
  ),
  encryptEnvelopeFields: parsed<EncryptEnvelopeFieldsCommand>(
    keyManagementPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE_FIELDS",
      subjectId: ids.cartItem,
      fields: [
        {
          purpose: "SUPPORT_INTENT_MESSAGE",
          plaintextBase64: "Zml4dHVyZS1tZXNzYWdl",
        },
        {
          purpose: "SUPPORT_INTENT_DISPLAY_NAME",
          plaintextBase64: "Zml4dHVyZS1uaWNrbmFtZQ",
        },
      ],
    },
  ),
  decryptEnvelope: parsed<DecryptEnvelopeCommand>(
    keyManagementPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      purpose: "SUPPORT_INTENT_MESSAGE",
      subjectId: ids.cartItem,
      ciphertext: `enc:v1:${"A".repeat(32)}`,
      encryptedDataKey: `enc:v1:${"B".repeat(32)}`,
      keyVersion: "fixture-envelope-v1",
      algorithm: "AES_256_GCM",
    },
  ),
  computeBlindIndex: parsed<ComputeBlindIndexCommand>(
    keyManagementPortCommandSchema,
    {
      schemaVersion: 1,
      operation: "COMPUTE_BLIND_INDEX",
      purpose: "CART_ACCESS_TOKEN",
      valueBase64: "ZmljdHVyZQ",
      keyVersion: "blind-index-2026-09",
    },
  ),
});

const inventoryItem = {
  schemaVersion: 1,
  id: ids.item,
  giftVariantId: ids.variant,
  sku: "FIXTURE-GIFT-01",
  policy: "TRACKED",
  status: "ACTIVE",
} as const;
const inventoryLocation = {
  schemaVersion: 1,
  id: ids.location,
  code: "PRIMARY",
  status: "ACTIVE",
} as const;
const balance = {
  schemaVersion: 1,
  inventoryItemId: ids.item,
  inventoryLocationId: ids.location,
  onHand: 10,
  reserved: 0,
  version: 1,
} as const;
const reservation = {
  schemaVersion: 1,
  id: ids.reservation,
  checkoutQuoteId: ids.quote,
  cartItemId: ids.cartItem,
  giftVariantId: ids.variant,
  inventoryLocationId: ids.location,
  quantity: 2,
  status: "ACTIVE",
  expiresAt: "2026-09-03T01:00:00.000Z",
  version: 1,
} as const;
const creationDecision = planInventoryReservationCreation({
  schemaVersion: 1,
  inventoryItem,
  inventoryLocation,
  balance,
  reservation,
  existingReservation: null,
  evaluatedAt: DETERMINISTIC_NOW,
});
if (creationDecision.kind !== "APPLY") {
  throw new Error("deterministic creation fixture must be applicable");
}
const transitionDecision = planInventoryReservationTransition({
  schemaVersion: 1,
  inventoryItem,
  balance: creationDecision.nextBalance,
  reservation: creationDecision.nextReservation,
  targetStatus: "COMMITTED",
  evaluatedAt: "2026-09-03T00:30:00.000Z",
});
if (transitionDecision.kind !== "APPLY") {
  throw new Error("deterministic transition fixture must be applicable");
}
const persistence = Object.freeze({
  beginIdempotency: parsed<BeginIdempotencyCommand>(
    persistencePortCommandSchema,
    {
      schemaVersion: 1,
      operation: "BEGIN_IDEMPOTENCY",
      actor: `actor-ref:v1:guest:${"a".repeat(64)}`,
      idempotencyOperation: "checkout.create",
      idempotencyKey: "checkout-fixture-0001",
      canonicalRequestHash: "b".repeat(64),
      expiresAt: "2026-09-03T01:00:00.000Z",
    },
  ),
  completeIdempotency: parsed<CompleteIdempotencyCommand>(
    persistencePortCommandSchema,
    {
      schemaVersion: 1,
      operation: "COMPLETE_IDEMPOTENCY",
      actor: `actor-ref:v1:guest:${"a".repeat(64)}`,
      idempotencyOperation: "checkout.create",
      idempotencyKey: "checkout-fixture-0001",
      canonicalRequestHash: "b".repeat(64),
      status: "SUCCEEDED",
      safeResultReference: `result-ref:v1:${ids.order}`,
    },
  ),
  appendOutboxEvent: parsed<AppendOutboxEventCommand>(
    persistencePortCommandSchema,
    {
      schemaVersion: 1,
      operation: "APPEND_OUTBOX_EVENT",
      event: {
        schemaVersion: 1,
        eventId: ids.event,
        occurredAt: DETERMINISTIC_NOW,
        correlationId: ids.correlation,
        requestId: ids.request,
        eventType: "CART_ITEM_ADDED",
        aggregateId: ids.quote,
        payload: { cartId: ids.quote, cartItemId: ids.cartItem },
      },
      aggregateVersion: 1,
      primarySubjectId: ids.quote,
      idempotencyKey: "outbox-fixture-0001",
      availableAt: DETERMINISTIC_NOW,
    },
  ),
  loadInventoryForUpdate: parsed<LoadInventoryForUpdateCommand>(
    persistencePortCommandSchema,
    {
      schemaVersion: 1,
      operation: "LOAD_INVENTORY_FOR_UPDATE",
      targets: [
        { inventoryItemId: ids.item, inventoryLocationId: ids.location },
      ],
    },
  ),
  applyReservationCreation: parsed<ApplyInventoryReservationCreationCommand>(
    persistencePortCommandSchema,
    {
      schemaVersion: 1,
      operation: "APPLY_INVENTORY_RESERVATION_CREATION",
      decision: creationDecision,
      ledgerEntry: {
        schemaVersion: 1,
        id: ids.ledgerCreate,
        inventoryItemId: ids.item,
        inventoryLocationId: ids.location,
        ...creationDecision.ledgerDelta,
        reasonCode: creationDecision.reasonCode,
        idempotencyKey: "inventory-create-0001",
        actor: { kind: "SYSTEM", taskName: "fixture" },
        occurredAt: DETERMINISTIC_NOW,
      },
    },
  ),
  applyReservationTransition:
    parsed<ApplyInventoryReservationTransitionCommand>(
      persistencePortCommandSchema,
      {
        schemaVersion: 1,
        operation: "APPLY_INVENTORY_RESERVATION_TRANSITION",
        decision: transitionDecision,
        ledgerEntry: {
          schemaVersion: 1,
          id: ids.ledgerTransition,
          inventoryItemId: ids.item,
          inventoryLocationId: ids.location,
          ...transitionDecision.ledgerDelta,
          reasonCode: transitionDecision.reasonCode,
          idempotencyKey: "inventory-transition-0001",
          actor: { kind: "SYSTEM", taskName: "fixture" },
          occurredAt: "2026-09-03T00:30:00.000Z",
        },
      },
    ),
  inventorySnapshot: Object.freeze({
    inventoryItem,
    inventoryLocation,
    balance,
    reservation,
  }),
});

export const deterministicPortFixtures = deepFreeze({
  ids,
  payment,
  media,
  identity,
  notification,
  cachePurge,
  keyManagement,
  persistence,
});

export type DeterministicPortFixtures = typeof deterministicPortFixtures;

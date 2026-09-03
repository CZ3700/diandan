import { isProxy } from "node:util/types";

import {
  cachePurgePortCommandSchema,
  cachePurgePortResponseSchema,
  type CachePurgePort,
  type GetCachePurgeStatusCommand,
} from "@fan-support/cache-purge-port";
import {
  identityPortCommandSchema,
  identityPortResponseSchema,
  type ExchangeAuthorizationCodeCommand,
  type IdentityProvider,
} from "@fan-support/identity-port";
import {
  keyManagementPortCommandSchema,
  keyManagementPortResponseSchema,
  type DecryptEnvelopeCommand,
  type KeyManagementPort,
} from "@fan-support/key-management-port";
import {
  mediaPortCommandSchema,
  mediaPortResponseSchema,
  type MediaStoragePort,
} from "@fan-support/media-port";
import {
  notificationPortResponseSchema,
  type NotificationProvider,
} from "@fan-support/notification-port";
import {
  paymentPortResponseSchema,
  paymentPortResponseMatchesCommand,
  type PaymentProvider,
} from "@fan-support/payment-port";
import {
  persistencePortCommandSchema,
  persistencePortResponseSchema,
  type JsonValue,
  type TransactionManager,
  type TransactionRepositories,
} from "@fan-support/persistence-port";

import {
  deterministicPortFixtures,
  type DeterministicPortFixtures,
} from "./fixtures.js";

type SchemaLike = Readonly<{
  safeParse(value: unknown): Readonly<{ success: boolean }>;
}>;

export type ConformanceFailureCode =
  | "ADAPTER_THROW"
  | "COMMAND_MUTATED"
  | "INVALID_RESPONSE"
  | "NON_SERIALIZABLE_COMMAND"
  | "NON_SERIALIZABLE_RESPONSE"
  | "OPERATION_MISMATCH"
  | "SEMANTIC_MISMATCH";

export type ConformanceCaseResult = Readonly<{
  schemaVersion: 1;
  caseName: string;
  passed: boolean;
  failureCode?: ConformanceFailureCode;
}>;

export type ConformanceReport = Readonly<{
  schemaVersion: 1;
  suite: string;
  passed: boolean;
  cases: readonly ConformanceCaseResult[];
}>;

type ConformanceCase = Readonly<{
  name: string;
  command: Readonly<{ operation: string }>;
  responseSchema: SchemaLike;
  acceptsResponse?(response: unknown): boolean;
  captureResponseSnapshot?(response: JsonValue): void;
  invoke(): Promise<unknown>;
}>;

function readCanonicalArrayElements(
  value: readonly unknown[],
): readonly unknown[] | undefined {
  try {
    if (isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return undefined;
    }

    const descriptors = Object.getOwnPropertyDescriptors(
      value,
    ) as unknown as Readonly<Record<string, PropertyDescriptor | undefined>>;
    const lengthDescriptor = descriptors["length"];
    if (
      lengthDescriptor === undefined ||
      lengthDescriptor.enumerable !== false ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      return undefined;
    }

    const length = lengthDescriptor.value as number;
    if (Reflect.ownKeys(descriptors).length !== length + 1) {
      return undefined;
    }

    const elements: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      ) {
        return undefined;
      }
      elements.push(descriptor.value);
    }
    return elements;
  } catch {
    return undefined;
  }
}

const invalidJsonSnapshot = Symbol("invalid-json-snapshot");

function snapshotJsonDataUnchecked(
  value: unknown,
  ancestors: ReadonlySet<object>,
): JsonValue | typeof invalidJsonSnapshot {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? Object.is(value, -0)
        ? 0
        : value
      : invalidJsonSnapshot;
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    return invalidJsonSnapshot;
  }
  if (isProxy(value)) {
    return invalidJsonSnapshot;
  }

  if (Array.isArray(value)) {
    const elements = readCanonicalArrayElements(value);
    if (elements === undefined) {
      return invalidJsonSnapshot;
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    const snapshot: JsonValue[] = [];
    for (const entry of elements) {
      const entrySnapshot = snapshotJsonDataUnchecked(entry, nextAncestors);
      if (entrySnapshot === invalidJsonSnapshot) {
        return invalidJsonSnapshot;
      }
      snapshot.push(entrySnapshot);
    }
    return Object.freeze(snapshot);
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidJsonSnapshot;
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(
    value,
  ) as unknown as Readonly<Record<PropertyKey, PropertyDescriptor | undefined>>;
  const snapshot: Record<string, JsonValue> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === "symbol") {
      return invalidJsonSnapshot;
    }
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      return invalidJsonSnapshot;
    }
    const fieldSnapshot = snapshotJsonDataUnchecked(
      descriptor.value,
      nextAncestors,
    );
    if (fieldSnapshot === invalidJsonSnapshot) {
      return invalidJsonSnapshot;
    }
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: fieldSnapshot,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

function snapshotJsonData(value: unknown): JsonValue | undefined {
  try {
    const snapshot = snapshotJsonDataUnchecked(value, new Set<object>());
    return snapshot === invalidJsonSnapshot ? undefined : snapshot;
  } catch {
    return undefined;
  }
}

function outcome(response: unknown): string | undefined {
  return typeof response === "object" &&
    response !== null &&
    "outcome" in response &&
    typeof response.outcome === "string"
    ? response.outcome
    : undefined;
}

function failureCode(response: unknown): string | undefined {
  if (
    typeof response !== "object" ||
    response === null ||
    !("error" in response) ||
    typeof response.error !== "object" ||
    response.error === null ||
    !("code" in response.error) ||
    typeof response.error.code !== "string"
  ) {
    return undefined;
  }
  return response.error.code;
}

function succeeds(response: unknown): boolean {
  return outcome(response) === "SUCCESS";
}

function failsWith(response: unknown, code: string): boolean {
  return outcome(response) === "FAILURE" && failureCode(response) === code;
}

function responseValue(response: unknown): Record<string, unknown> | undefined {
  if (
    typeof response !== "object" ||
    response === null ||
    !("value" in response) ||
    typeof response.value !== "object" ||
    response.value === null ||
    Array.isArray(response.value)
  ) {
    return undefined;
  }
  return response.value as Record<string, unknown>;
}

function providerEvent(response: unknown): Record<string, unknown> | undefined {
  const value = responseValue(response);
  const event = value?.["event"];
  return typeof event === "object" && event !== null && !Array.isArray(event)
    ? (event as Record<string, unknown>)
    : undefined;
}

function mediaResponseMatchesCommand(
  command: unknown,
  response: unknown,
): boolean {
  const parsedCommand = mediaPortCommandSchema.safeParse(command);
  const parsedResponse = mediaPortResponseSchema.safeParse(response);
  if (
    !parsedCommand.success ||
    !parsedResponse.success ||
    parsedResponse.data.outcome !== "SUCCESS" ||
    parsedCommand.data.operation !== parsedResponse.data.operation
  ) {
    return false;
  }
  const value = parsedResponse.data.value;
  switch (parsedCommand.data.operation) {
    case "CREATE_UPLOAD_GRANT":
      return (
        "storageClass" in value &&
        "objectKey" in value &&
        "checksumSha256" in value &&
        "byteSize" in value &&
        "mimeType" in value &&
        "expiresAt" in value &&
        "method" in value &&
        value.storageClass === parsedCommand.data.storageClass &&
        value.objectKey === parsedCommand.data.objectKey &&
        value.checksumSha256 === parsedCommand.data.checksumSha256 &&
        value.byteSize === parsedCommand.data.byteSize &&
        value.mimeType === parsedCommand.data.mimeType &&
        value.expiresAt === parsedCommand.data.expiresAt &&
        value.method === "PUT"
      );
    case "CREATE_DOWNLOAD_GRANT":
      return (
        "storageClass" in value &&
        "objectKey" in value &&
        "expiresAt" in value &&
        "method" in value &&
        value.storageClass === parsedCommand.data.storageClass &&
        value.objectKey === parsedCommand.data.objectKey &&
        value.expiresAt === parsedCommand.data.expiresAt &&
        value.method === "GET"
      );
    case "INSPECT_OBJECT":
      return (
        "storageClass" in value &&
        "objectKey" in value &&
        value.storageClass === parsedCommand.data.storageClass &&
        value.objectKey === parsedCommand.data.objectKey
      );
    case "DELETE_OBJECT":
      return (
        "storageClass" in value &&
        "objectKey" in value &&
        "checksumSha256" in value &&
        "revisionToken" in value &&
        value.storageClass === parsedCommand.data.storageClass &&
        value.objectKey === parsedCommand.data.objectKey &&
        value.checksumSha256 === parsedCommand.data.expectedChecksumSha256 &&
        value.revisionToken === parsedCommand.data.expectedRevisionToken &&
        value.versionId === parsedCommand.data.expectedVersionId
      );
    case "RESOLVE_PUBLIC_URL":
      return (
        "storageClass" in value &&
        "objectKey" in value &&
        value.storageClass === parsedCommand.data.storageClass &&
        value.objectKey === parsedCommand.data.objectKey
      );
    default:
      return false;
  }
}

function identityResponseMatchesCommand(
  command: unknown,
  response: unknown,
  authorizationEndpoint?: string,
): boolean {
  const parsedCommand = identityPortCommandSchema.safeParse(command);
  const parsedResponse = identityPortResponseSchema.safeParse(response);
  if (
    !parsedCommand.success ||
    !parsedResponse.success ||
    parsedResponse.data.outcome !== "SUCCESS" ||
    parsedCommand.data.operation !== parsedResponse.data.operation
  ) {
    return false;
  }
  if (parsedCommand.data.operation === "EXCHANGE_AUTHORIZATION_CODE") {
    return (
      parsedResponse.data.operation === "EXCHANGE_AUTHORIZATION_CODE" &&
      parsedResponse.data.value.principal.issuer === parsedCommand.data.issuer
    );
  }
  if (parsedResponse.data.operation !== "CREATE_AUTHORIZATION_REQUEST") {
    return false;
  }
  const value = parsedResponse.data.value;
  if (
    value.state !== parsedCommand.data.state ||
    Date.parse(value.expiresAt) <= Date.parse(parsedCommand.data.requestedAt)
  ) {
    return false;
  }
  try {
    const authorizationUrl = new URL(value.authorizationUrl);
    const parameters = authorizationUrl.searchParams;
    if (authorizationEndpoint !== undefined) {
      const expectedEndpoint = new URL(authorizationEndpoint);
      if (
        authorizationUrl.origin !== expectedEndpoint.origin ||
        authorizationUrl.pathname !== expectedEndpoint.pathname ||
        expectedEndpoint.search !== "" ||
        expectedEndpoint.hash !== ""
      ) {
        return false;
      }
    }
    const hasSingleValue = (name: string, expected: string): boolean => {
      const values = parameters.getAll(name);
      return values.length === 1 && values[0] === expected;
    };
    return (
      hasSingleValue("response_type", "code") &&
      hasSingleValue("client_id", parsedCommand.data.clientId) &&
      hasSingleValue("redirect_uri", parsedCommand.data.redirectUri) &&
      hasSingleValue("state", parsedCommand.data.state) &&
      hasSingleValue("nonce", parsedCommand.data.nonce) &&
      hasSingleValue("code_challenge", parsedCommand.data.codeChallenge) &&
      hasSingleValue("code_challenge_method", "S256") &&
      parameters.getAll("scope").length === 1 &&
      (parameters.get("scope") ?? "").split(/\s+/u).includes("openid")
    );
  } catch {
    return false;
  }
}

function serializeJsonData(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const elements = readCanonicalArrayElements(value);
    if (elements === undefined) {
      throw new TypeError(
        "validated JSON data unexpectedly has an invalid array",
      );
    }
    let serialized = "[";
    for (let index = 0; index < elements.length; index += 1) {
      serialized += `${index === 0 ? "" : ","}${serializeJsonData(elements[index] as JsonValue)}`;
    }
    return `${serialized}]`;
  }
  const fields = Object.entries(Object.getOwnPropertyDescriptors(value)).map(
    ([key, descriptor]) => {
      if (!("value" in descriptor)) {
        throw new TypeError("validated JSON data unexpectedly has an accessor");
      }
      return `${JSON.stringify(key)}:${serializeJsonData(descriptor.value as JsonValue)}`;
    },
  );
  return `{${fields.join(",")}}`;
}

function serialize(value: unknown): string | undefined {
  const snapshot = snapshotJsonData(value);
  return snapshot === undefined ? undefined : serializeJsonData(snapshot);
}

async function runCase(
  testCase: ConformanceCase,
): Promise<ConformanceCaseResult> {
  const commandSnapshot = snapshotJsonData(testCase.command);
  if (commandSnapshot === undefined) {
    return {
      schemaVersion: 1,
      caseName: testCase.name,
      passed: false,
      failureCode: "NON_SERIALIZABLE_COMMAND",
    };
  }
  const before = serializeJsonData(commandSnapshot);

  let rawResponse: unknown;
  try {
    rawResponse = await testCase.invoke();
  } catch {
    return {
      schemaVersion: 1,
      caseName: testCase.name,
      passed: false,
      failureCode: "ADAPTER_THROW",
    };
  }
  const response = snapshotJsonData(rawResponse);
  const commandAfterInvoke = snapshotJsonData(testCase.command);

  if (
    commandAfterInvoke === undefined ||
    serializeJsonData(commandAfterInvoke) !== before
  ) {
    return {
      schemaVersion: 1,
      caseName: testCase.name,
      passed: false,
      failureCode: "COMMAND_MUTATED",
    };
  }
  if (response === undefined) {
    return {
      schemaVersion: 1,
      caseName: testCase.name,
      passed: false,
      failureCode: "NON_SERIALIZABLE_RESPONSE",
    };
  }
  if (!testCase.responseSchema.safeParse(response).success) {
    return {
      schemaVersion: 1,
      caseName: testCase.name,
      passed: false,
      failureCode: "INVALID_RESPONSE",
    };
  }
  const operation =
    typeof response === "object" &&
    response !== null &&
    "operation" in response &&
    typeof response["operation"] === "string"
      ? response["operation"]
      : undefined;
  const commandOperation =
    typeof commandSnapshot === "object" &&
    commandSnapshot !== null &&
    !Array.isArray(commandSnapshot) &&
    "operation" in commandSnapshot &&
    typeof commandSnapshot["operation"] === "string"
      ? commandSnapshot["operation"]
      : undefined;
  if (operation !== commandOperation) {
    return {
      schemaVersion: 1,
      caseName: testCase.name,
      passed: false,
      failureCode: "OPERATION_MISMATCH",
    };
  }
  if (testCase.acceptsResponse?.(response) === false) {
    return {
      schemaVersion: 1,
      caseName: testCase.name,
      passed: false,
      failureCode: "SEMANTIC_MISMATCH",
    };
  }
  testCase.captureResponseSnapshot?.(response);
  return { schemaVersion: 1, caseName: testCase.name, passed: true };
}

async function runSuite(
  suite: string,
  cases: readonly ConformanceCase[],
): Promise<ConformanceReport> {
  const results: ConformanceCaseResult[] = [];
  for (const testCase of cases) {
    results.push(await runCase(testCase));
  }
  return {
    schemaVersion: 1,
    suite,
    passed: results.every((result) => result.passed),
    cases: results,
  };
}

export function runPaymentProviderConformance(
  provider: PaymentProvider,
  fixtures: DeterministicPortFixtures["payment"] = deterministicPortFixtures.payment,
): Promise<ConformanceReport> {
  let firstCapturedRefundResponse: unknown;
  let firstCapturedReconcileEventId: unknown;
  return runSuite("payment-provider-v1", [
    {
      name: "get-capabilities",
      command: fixtures.getCapabilities,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        paymentPortResponseMatchesCommand(fixtures.getCapabilities, response),
      invoke: () => provider.getCapabilities(fixtures.getCapabilities),
    },
    {
      name: "create-payment",
      command: fixtures.createPayment,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        paymentPortResponseMatchesCommand(fixtures.createPayment, response),
      invoke: () => provider.createPayment(fixtures.createPayment),
    },
    {
      name: "verify-and-parse-webhook",
      command: fixtures.verifyAndParseWebhook,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        paymentPortResponseMatchesCommand(
          fixtures.verifyAndParseWebhook,
          response,
        ) &&
        (succeeds(response) || failsWith(response, "UNSUPPORTED_EVENT")),
      invoke: () =>
        provider.verifyAndParseWebhook(fixtures.verifyAndParseWebhook),
    },
    {
      name: "get-payment",
      command: fixtures.getPayment,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        paymentPortResponseMatchesCommand(fixtures.getPayment, response),
      invoke: () => provider.getPayment(fixtures.getPayment),
    },
    {
      name: "cancel-payment",
      command: fixtures.cancelPayment,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        paymentPortResponseMatchesCommand(fixtures.cancelPayment, response),
      invoke: () => provider.cancelPayment(fixtures.cancelPayment),
    },
    {
      name: "refund-payment",
      command: fixtures.refundPayment,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        paymentPortResponseMatchesCommand(fixtures.refundPayment, response) &&
        failsWith(response, "PROVIDER_DECLINED"),
      invoke: () => provider.refundPayment(fixtures.refundPayment),
    },
    {
      name: "reconcile-payment",
      command: fixtures.reconcilePayment,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        paymentPortResponseMatchesCommand(fixtures.reconcilePayment, response),
      invoke: () => provider.reconcilePayment(fixtures.reconcilePayment),
    },
    {
      name: "reconcile-refund",
      command: fixtures.reconcileRefund,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        paymentPortResponseMatchesCommand(fixtures.reconcileRefund, response) &&
        failsWith(response, "REFUND_NOT_FOUND"),
      invoke: () => provider.reconcileRefund(fixtures.reconcileRefund),
    },
    {
      name: "create-captured-payment-scenario",
      command: fixtures.capturedCreatePayment,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        paymentPortResponseMatchesCommand(
          fixtures.capturedCreatePayment,
          response,
        ),
      invoke: () => provider.createPayment(fixtures.capturedCreatePayment),
    },
    {
      name: "authenticate-captured-payment-scenario",
      command: fixtures.capturedReconcilePayment,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        paymentPortResponseMatchesCommand(
          fixtures.capturedReconcilePayment,
          response,
        ) &&
        typeof response === "object" &&
        response !== null &&
        "value" in response &&
        typeof response.value === "object" &&
        response.value !== null &&
        "event" in response.value &&
        typeof response.value.event === "object" &&
        response.value.event !== null &&
        "status" in response.value.event &&
        response.value.event.status === "SUCCEEDED",
      captureResponseSnapshot: (response) => {
        firstCapturedReconcileEventId =
          providerEvent(response)?.["providerEventId"];
      },
      invoke: () =>
        provider.reconcilePayment(fixtures.capturedReconcilePayment),
    },
    {
      name: "authenticate-captured-payment-with-new-audit",
      command: fixtures.capturedReconcilePaymentAgain,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        paymentPortResponseMatchesCommand(
          fixtures.capturedReconcilePaymentAgain,
          response,
        ) &&
        typeof firstCapturedReconcileEventId === "string" &&
        providerEvent(response)?.["providerEventId"] !==
          firstCapturedReconcileEventId,
      invoke: () =>
        provider.reconcilePayment(fixtures.capturedReconcilePaymentAgain),
    },
    {
      name: "refund-after-authenticated-reconcile",
      command: fixtures.capturedRefundPayment,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        paymentPortResponseMatchesCommand(
          fixtures.capturedRefundPayment,
          response,
        ),
      captureResponseSnapshot: (response) => {
        firstCapturedRefundResponse = response;
      },
      invoke: () => provider.refundPayment(fixtures.capturedRefundPayment),
    },
    {
      name: "replay-refund-exactly-once",
      command: fixtures.capturedRefundPayment,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        firstCapturedRefundResponse !== undefined &&
        serialize(response) === serialize(firstCapturedRefundResponse),
      invoke: () => provider.refundPayment(fixtures.capturedRefundPayment),
    },
    {
      name: "reject-refund-idempotency-drift",
      command: fixtures.capturedRefundPaymentConflict,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        failsWith(response, "IDEMPOTENCY_CONFLICT"),
      invoke: () =>
        provider.refundPayment(fixtures.capturedRefundPaymentConflict),
    },
    {
      name: "reject-refund-over-capture",
      command: fixtures.capturedRefundPaymentOverCapacity,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) => failsWith(response, "PROVIDER_DECLINED"),
      invoke: () =>
        provider.refundPayment(fixtures.capturedRefundPaymentOverCapacity),
    },
    {
      name: "reconcile-existing-refund",
      command: fixtures.capturedReconcileRefund,
      responseSchema: paymentPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        paymentPortResponseMatchesCommand(
          fixtures.capturedReconcileRefund,
          response,
        ),
      invoke: () => provider.reconcileRefund(fixtures.capturedReconcileRefund),
    },
  ]);
}

export function runMediaStorageConformance(
  port: MediaStoragePort,
  fixtures: DeterministicPortFixtures["media"] = deterministicPortFixtures.media,
): Promise<ConformanceReport> {
  return runSuite("media-storage-v1", [
    {
      name: "create-upload-grant",
      command: fixtures.createUploadGrant,
      responseSchema: mediaPortResponseSchema,
      acceptsResponse: (response) =>
        mediaResponseMatchesCommand(fixtures.createUploadGrant, response),
      invoke: () => port.createUploadGrant(fixtures.createUploadGrant),
    },
    {
      name: "inspect-object",
      command: fixtures.inspectObject,
      responseSchema: mediaPortResponseSchema,
      acceptsResponse: (response) =>
        mediaResponseMatchesCommand(fixtures.inspectObject, response),
      invoke: () => port.inspectObject(fixtures.inspectObject),
    },
    {
      name: "create-download-grant",
      command: fixtures.createDownloadGrant,
      responseSchema: mediaPortResponseSchema,
      acceptsResponse: (response) =>
        mediaResponseMatchesCommand(fixtures.createDownloadGrant, response),
      invoke: () => port.createDownloadGrant(fixtures.createDownloadGrant),
    },
    {
      name: "delete-object",
      command: fixtures.deleteObject,
      responseSchema: mediaPortResponseSchema,
      acceptsResponse: (response) =>
        mediaResponseMatchesCommand(fixtures.deleteObject, response),
      invoke: () => port.deleteObject(fixtures.deleteObject),
    },
    {
      name: "resolve-public-url",
      command: fixtures.resolvePublicUrl,
      responseSchema: mediaPortResponseSchema,
      acceptsResponse: (response) =>
        mediaResponseMatchesCommand(fixtures.resolvePublicUrl, response),
      invoke: () => port.resolvePublicUrl(fixtures.resolvePublicUrl),
    },
  ]);
}

export function runIdentityProviderConformance(
  provider: IdentityProvider,
  fixtures: DeterministicPortFixtures["identity"] = deterministicPortFixtures.identity,
): Promise<ConformanceReport> {
  const transactions = fixtures.authorizationTransactions;
  const changeLastCharacter = (value: string): string =>
    `${value.slice(0, -1)}${value.endsWith("x") ? "y" : "x"}`;
  const changeOpaqueValue = (value: string): string =>
    value.length < 1_024 ? `${value}~mismatch` : changeLastCharacter(value);
  const changeHttpsUrl = (value: string): string => {
    const url = new URL(value);
    url.hostname =
      url.hostname === "identity-mismatch.example.invalid"
        ? "identity-other.example.invalid"
        : "identity-mismatch.example.invalid";
    return url.toString();
  };
  const prepareAndExchange = async (
    transaction: (typeof transactions)[keyof typeof transactions],
    command: ExchangeAuthorizationCodeCommand,
  ): Promise<unknown> => {
    const rawAuthorization = await provider.createAuthorizationRequest(
      transaction.createAuthorizationRequest,
    );
    const authorization = snapshotJsonData(rawAuthorization);
    if (authorization === undefined) {
      return rawAuthorization;
    }
    if (
      !identityResponseMatchesCommand(
        transaction.createAuthorizationRequest,
        authorization,
        fixtures.authorizationEndpoint,
      )
    ) {
      return authorization;
    }
    return provider.exchangeAuthorizationCode(command);
  };
  const wrongState = identityPortCommandSchema.parse({
    ...transactions.stateMismatch.exchangeAuthorizationCode,
    expectedState: changeLastCharacter(
      transactions.stateMismatch.exchangeAuthorizationCode.expectedState,
    ),
  }) as ExchangeAuthorizationCodeCommand;
  const wrongNonce = identityPortCommandSchema.parse({
    ...transactions.nonceMismatch.exchangeAuthorizationCode,
    nonce: changeLastCharacter(
      transactions.nonceMismatch.exchangeAuthorizationCode.nonce,
    ),
  }) as ExchangeAuthorizationCodeCommand;
  const wrongCode = identityPortCommandSchema.parse({
    ...transactions.invalidCode.exchangeAuthorizationCode,
    code: changeOpaqueValue(
      transactions.invalidCode.exchangeAuthorizationCode.code,
    ),
  }) as ExchangeAuthorizationCodeCommand;
  const wrongVerifier = identityPortCommandSchema.parse({
    ...transactions.invalidPkceVerifier.exchangeAuthorizationCode,
    codeVerifier: changeLastCharacter(
      transactions.invalidPkceVerifier.exchangeAuthorizationCode.codeVerifier,
    ),
  }) as ExchangeAuthorizationCodeCommand;
  const wrongIssuer = identityPortCommandSchema.parse({
    ...transactions.issuerMismatch.exchangeAuthorizationCode,
    issuer: changeHttpsUrl(
      transactions.issuerMismatch.exchangeAuthorizationCode.issuer,
    ),
  }) as ExchangeAuthorizationCodeCommand;
  const wrongClientId = identityPortCommandSchema.parse({
    ...transactions.clientIdMismatch.exchangeAuthorizationCode,
    clientId: changeOpaqueValue(
      transactions.clientIdMismatch.exchangeAuthorizationCode.clientId,
    ),
  }) as ExchangeAuthorizationCodeCommand;
  const wrongRedirectUri = identityPortCommandSchema.parse({
    ...transactions.redirectUriMismatch.exchangeAuthorizationCode,
    redirectUri: changeHttpsUrl(
      transactions.redirectUriMismatch.exchangeAuthorizationCode.redirectUri,
    ),
  }) as ExchangeAuthorizationCodeCommand;
  const expiredCode = identityPortCommandSchema.parse({
    ...transactions.expiredCode.exchangeAuthorizationCode,
    receivedAt: "9999-12-31T23:59:59.999Z",
  }) as ExchangeAuthorizationCodeCommand;
  return runSuite("identity-provider-v1", [
    {
      name: "create-authorization-request",
      command: fixtures.createAuthorizationRequest,
      responseSchema: identityPortResponseSchema,
      acceptsResponse: (response) =>
        identityResponseMatchesCommand(
          fixtures.createAuthorizationRequest,
          response,
          fixtures.authorizationEndpoint,
        ),
      invoke: () =>
        provider.createAuthorizationRequest(
          fixtures.createAuthorizationRequest,
        ),
    },
    {
      name: "reject-state-mismatch",
      command: wrongState,
      responseSchema: identityPortResponseSchema,
      acceptsResponse: (response) => failsWith(response, "STATE_MISMATCH"),
      invoke: () => prepareAndExchange(transactions.stateMismatch, wrongState),
    },
    {
      name: "reject-nonce-mismatch",
      command: wrongNonce,
      responseSchema: identityPortResponseSchema,
      acceptsResponse: (response) => failsWith(response, "NONCE_MISMATCH"),
      invoke: () => prepareAndExchange(transactions.nonceMismatch, wrongNonce),
    },
    {
      name: "reject-invalid-authorization-code",
      command: wrongCode,
      responseSchema: identityPortResponseSchema,
      acceptsResponse: (response) =>
        failsWith(response, "INVALID_AUTHORIZATION_CODE"),
      invoke: () => prepareAndExchange(transactions.invalidCode, wrongCode),
    },
    {
      name: "reject-invalid-pkce-verifier",
      command: wrongVerifier,
      responseSchema: identityPortResponseSchema,
      acceptsResponse: (response) =>
        failsWith(response, "INVALID_AUTHORIZATION_CODE"),
      invoke: () =>
        prepareAndExchange(transactions.invalidPkceVerifier, wrongVerifier),
    },
    {
      name: "reject-issuer-mismatch",
      command: wrongIssuer,
      responseSchema: identityPortResponseSchema,
      acceptsResponse: (response) =>
        failsWith(response, "INVALID_AUTHORIZATION_CODE"),
      invoke: () =>
        prepareAndExchange(transactions.issuerMismatch, wrongIssuer),
    },
    {
      name: "reject-client-id-mismatch",
      command: wrongClientId,
      responseSchema: identityPortResponseSchema,
      acceptsResponse: (response) =>
        failsWith(response, "INVALID_AUTHORIZATION_CODE"),
      invoke: () =>
        prepareAndExchange(transactions.clientIdMismatch, wrongClientId),
    },
    {
      name: "reject-redirect-uri-mismatch",
      command: wrongRedirectUri,
      responseSchema: identityPortResponseSchema,
      acceptsResponse: (response) =>
        failsWith(response, "INVALID_AUTHORIZATION_CODE"),
      invoke: () =>
        prepareAndExchange(transactions.redirectUriMismatch, wrongRedirectUri),
    },
    {
      name: "reject-expired-authorization-code",
      command: expiredCode,
      responseSchema: identityPortResponseSchema,
      acceptsResponse: (response) =>
        failsWith(response, "INVALID_AUTHORIZATION_CODE"),
      invoke: () => prepareAndExchange(transactions.expiredCode, expiredCode),
    },
    {
      name: "exchange-authorization-code",
      command: fixtures.exchangeAuthorizationCode,
      responseSchema: identityPortResponseSchema,
      acceptsResponse: (response) =>
        identityResponseMatchesCommand(
          fixtures.exchangeAuthorizationCode,
          response,
        ),
      invoke: () =>
        provider.exchangeAuthorizationCode(fixtures.exchangeAuthorizationCode),
    },
    {
      name: "reject-authorization-code-replay",
      command: fixtures.exchangeAuthorizationCode,
      responseSchema: identityPortResponseSchema,
      acceptsResponse: (response) =>
        failsWith(response, "INVALID_AUTHORIZATION_CODE"),
      invoke: () =>
        provider.exchangeAuthorizationCode(fixtures.exchangeAuthorizationCode),
    },
  ]);
}

export function runNotificationProviderConformance(
  provider: NotificationProvider,
  fixtures: DeterministicPortFixtures["notification"] = deterministicPortFixtures.notification,
): Promise<ConformanceReport> {
  let firstResponse: unknown;
  const conflictCommand = {
    ...fixtures.sendNotification,
    content: {
      ...fixtures.sendNotification.content,
      subject: `${fixtures.sendNotification.content.subject} changed`,
    },
  };
  return runSuite("notification-provider-v1", [
    {
      name: "send-notification",
      command: fixtures.sendNotification,
      responseSchema: notificationPortResponseSchema,
      acceptsResponse: succeeds,
      captureResponseSnapshot: (response) => {
        firstResponse = response;
      },
      invoke: () => provider.sendNotification(fixtures.sendNotification),
    },
    {
      name: "replay-notification",
      command: fixtures.sendNotification,
      responseSchema: notificationPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) && serialize(response) === serialize(firstResponse),
      invoke: () => provider.sendNotification(fixtures.sendNotification),
    },
    {
      name: "reject-notification-idempotency-drift",
      command: conflictCommand,
      responseSchema: notificationPortResponseSchema,
      acceptsResponse: (response) =>
        failsWith(response, "IDEMPOTENCY_CONFLICT"),
      invoke: () => provider.sendNotification(conflictCommand),
    },
  ]);
}

export async function runCachePurgeConformance(
  port: CachePurgePort,
  fixtures: DeterministicPortFixtures["cachePurge"] = deterministicPortFixtures.cachePurge,
): Promise<ConformanceReport> {
  let firstSubmitResponse: unknown;
  let replaySubmitResponse: unknown;
  const conflictCommand = {
    ...fixtures.submitPurge,
    paths: [...fixtures.submitPurge.paths, "/en/idols/fixture-changed"],
  };
  const submitValue = () => responseValue(firstSubmitResponse);
  const replayMatchesSubmission = (response: unknown): boolean => {
    if (!succeeds(response)) {
      return false;
    }
    const first = submitValue();
    const replay = responseValue(response);
    if (
      typeof first?.["purgeReference"] !== "string" ||
      typeof first["submittedAt"] !== "string" ||
      replay?.["purgeReference"] !== first["purgeReference"] ||
      replay["submittedAt"] !== first["submittedAt"]
    ) {
      return false;
    }
    return (
      replay["status"] === first["status"] ||
      (first["status"] === "PENDING" && replay["status"] === "COMPLETED")
    );
  };
  const results: ConformanceCaseResult[] = [];
  results.push(
    await runCase({
      name: "submit-purge",
      command: fixtures.submitPurge,
      responseSchema: cachePurgePortResponseSchema,
      acceptsResponse: succeeds,
      captureResponseSnapshot: (response) => {
        firstSubmitResponse = response;
      },
      invoke: () => port.submitPurge(fixtures.submitPurge),
    }),
  );
  results.push(
    await runCase({
      name: "replay-purge-submission",
      command: fixtures.submitPurge,
      responseSchema: cachePurgePortResponseSchema,
      acceptsResponse: replayMatchesSubmission,
      captureResponseSnapshot: (response) => {
        replaySubmitResponse = response;
      },
      invoke: () => port.submitPurge(fixtures.submitPurge),
    }),
  );
  results.push(
    await runCase({
      name: "reject-purge-idempotency-drift",
      command: conflictCommand,
      responseSchema: cachePurgePortResponseSchema,
      acceptsResponse: (response) =>
        failsWith(response, "IDEMPOTENCY_CONFLICT"),
      invoke: () => port.submitPurge(conflictCommand),
    }),
  );
  const purgeReference = submitValue()?.["purgeReference"];
  const completedWasObserved = [
    responseValue(firstSubmitResponse)?.["status"],
    responseValue(replaySubmitResponse)?.["status"],
  ].includes("COMPLETED");
  const statusCommand = cachePurgePortCommandSchema.parse({
    schemaVersion: 1,
    operation: "GET_PURGE_STATUS",
    purgeReference:
      typeof purgeReference === "string"
        ? purgeReference
        : fixtures.getPurgeStatus.purgeReference,
  }) as GetCachePurgeStatusCommand;
  results.push(
    await runCase({
      name: "get-purge-status",
      command: statusCommand,
      responseSchema: cachePurgePortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        responseValue(response)?.["purgeReference"] ===
          statusCommand.purgeReference &&
        (!completedWasObserved ||
          responseValue(response)?.["status"] === "COMPLETED"),
      invoke: () => port.getPurgeStatus(statusCommand),
    }),
  );
  return {
    schemaVersion: 1,
    suite: "cache-purge-v1",
    passed: results.every((result) => result.passed),
    cases: results,
  };
}

export function runKeyManagementConformance(
  port: KeyManagementPort,
  fixtures: DeterministicPortFixtures["keyManagement"] = deterministicPortFixtures.keyManagement,
): Promise<ConformanceReport> {
  let encryptedResponse: unknown;
  let encryptedFieldsResponse: unknown;
  let firstBlindIndexResponse: unknown;
  const roundTripCommand = (subjectId: string): DecryptEnvelopeCommand => {
    const value = responseValue(encryptedResponse);
    return keyManagementPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      purpose: fixtures.encryptEnvelope.purpose,
      subjectId,
      ciphertext: value?.["ciphertext"],
      encryptedDataKey: value?.["encryptedDataKey"],
      keyVersion: value?.["keyVersion"],
      algorithm: value?.["algorithm"],
    }) as DecryptEnvelopeCommand;
  };
  const tamperedCiphertextCommand = (): DecryptEnvelopeCommand => {
    const command = roundTripCommand(fixtures.encryptEnvelope.subjectId);
    const replacement = command.ciphertext.endsWith("A") ? "B" : "A";
    return keyManagementPortCommandSchema.parse({
      ...command,
      ciphertext: `${command.ciphertext.slice(0, -1)}${replacement}`,
    }) as DecryptEnvelopeCommand;
  };
  const encryptedFieldCommand = (
    purpose: "SUPPORT_INTENT_MESSAGE" | "SUPPORT_INTENT_DISPLAY_NAME",
    ciphertextPurpose = purpose,
  ): DecryptEnvelopeCommand => {
    const value = responseValue(encryptedFieldsResponse);
    const rawFields = value?.["fields"];
    const fields = Array.isArray(rawFields)
      ? (readCanonicalArrayElements(rawFields) ?? [])
      : [];
    let field: unknown;
    for (const candidate of fields) {
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        "purpose" in candidate &&
        candidate.purpose === ciphertextPurpose
      ) {
        field = candidate;
        break;
      }
    }
    const ciphertext =
      typeof field === "object" && field !== null && "ciphertext" in field
        ? field.ciphertext
        : undefined;
    return keyManagementPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      purpose,
      subjectId: fixtures.encryptEnvelopeFields.subjectId,
      ciphertext,
      encryptedDataKey: value?.["encryptedDataKey"],
      keyVersion: value?.["keyVersion"],
      algorithm: value?.["algorithm"],
    }) as DecryptEnvelopeCommand;
  };
  const plaintextForPurpose = (
    purpose: "SUPPORT_INTENT_MESSAGE" | "SUPPORT_INTENT_DISPLAY_NAME",
  ): string | undefined => {
    const fields = readCanonicalArrayElements(
      fixtures.encryptEnvelopeFields.fields,
    );
    if (fields === undefined) {
      return undefined;
    }
    for (const field of fields) {
      if (
        typeof field === "object" &&
        field !== null &&
        "purpose" in field &&
        field.purpose === purpose &&
        "plaintextBase64" in field &&
        typeof field.plaintextBase64 === "string"
      ) {
        return field.plaintextBase64;
      }
    }
    return undefined;
  };
  const differentBlindIndexPurpose = keyManagementPortCommandSchema.parse({
    ...fixtures.computeBlindIndex,
    purpose:
      fixtures.computeBlindIndex.purpose === "CART_ACCESS_TOKEN"
        ? "ORDER_ACCESS_TOKEN"
        : "CART_ACCESS_TOKEN",
  }) as typeof fixtures.computeBlindIndex;
  const unknownBlindIndexVersion = keyManagementPortCommandSchema.parse({
    ...fixtures.computeBlindIndex,
    keyVersion: "blind-index-not-retained",
  }) as typeof fixtures.computeBlindIndex;
  return runSuite("key-management-v1", [
    {
      name: "encrypt-envelope",
      command: fixtures.encryptEnvelope,
      responseSchema: keyManagementPortResponseSchema,
      acceptsResponse: succeeds,
      captureResponseSnapshot: (response) => {
        encryptedResponse = response;
      },
      invoke: () => port.encryptEnvelope(fixtures.encryptEnvelope),
    },
    {
      name: "encrypt-envelope-fields",
      command: fixtures.encryptEnvelopeFields,
      responseSchema: keyManagementPortResponseSchema,
      acceptsResponse: succeeds,
      captureResponseSnapshot: (response) => {
        encryptedFieldsResponse = response;
      },
      invoke: () => port.encryptEnvelopeFields(fixtures.encryptEnvelopeFields),
    },
    {
      name: "decrypt-envelope-message-field-round-trip",
      command: fixtures.decryptEnvelope,
      responseSchema: keyManagementPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        responseValue(response)?.["plaintextBase64"] ===
          plaintextForPurpose("SUPPORT_INTENT_MESSAGE"),
      invoke: () =>
        port.decryptEnvelope(encryptedFieldCommand("SUPPORT_INTENT_MESSAGE")),
    },
    {
      name: "decrypt-envelope-display-name-field-round-trip",
      command: fixtures.decryptEnvelope,
      responseSchema: keyManagementPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        responseValue(response)?.["plaintextBase64"] ===
          plaintextForPurpose("SUPPORT_INTENT_DISPLAY_NAME"),
      invoke: () =>
        port.decryptEnvelope(
          encryptedFieldCommand("SUPPORT_INTENT_DISPLAY_NAME"),
        ),
    },
    {
      name: "reject-envelope-field-purpose-swap",
      command: fixtures.decryptEnvelope,
      responseSchema: keyManagementPortResponseSchema,
      acceptsResponse: (response) => failsWith(response, "DECRYPTION_FAILED"),
      invoke: () =>
        port.decryptEnvelope(
          encryptedFieldCommand(
            "SUPPORT_INTENT_DISPLAY_NAME",
            "SUPPORT_INTENT_MESSAGE",
          ),
        ),
    },
    {
      name: "decrypt-envelope-round-trip",
      command: fixtures.decryptEnvelope,
      responseSchema: keyManagementPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        responseValue(response)?.["plaintextBase64"] ===
          fixtures.encryptEnvelope.plaintextBase64,
      invoke: () =>
        port.decryptEnvelope(
          roundTripCommand(fixtures.encryptEnvelope.subjectId),
        ),
    },
    {
      name: "reject-envelope-aad-tamper",
      command: fixtures.decryptEnvelope,
      responseSchema: keyManagementPortResponseSchema,
      acceptsResponse: (response) =>
        failsWith(response, "DECRYPTION_FAILED") ||
        failsWith(response, "MAC_FAILED"),
      invoke: () =>
        port.decryptEnvelope(
          roundTripCommand("30000000-0000-4000-8000-000000000002"),
        ),
    },
    {
      name: "reject-ciphertext-tamper",
      command: fixtures.decryptEnvelope,
      responseSchema: keyManagementPortResponseSchema,
      acceptsResponse: (response) => failsWith(response, "DECRYPTION_FAILED"),
      invoke: () => port.decryptEnvelope(tamperedCiphertextCommand()),
    },
    {
      name: "compute-blind-index",
      command: fixtures.computeBlindIndex,
      responseSchema: keyManagementPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        responseValue(response)?.["keyVersion"] ===
          fixtures.computeBlindIndex.keyVersion,
      captureResponseSnapshot: (response) => {
        firstBlindIndexResponse = response;
      },
      invoke: () => port.computeBlindIndex(fixtures.computeBlindIndex),
    },
    {
      name: "replay-blind-index-deterministically",
      command: fixtures.computeBlindIndex,
      responseSchema: keyManagementPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        serialize(response) === serialize(firstBlindIndexResponse),
      invoke: () => port.computeBlindIndex(fixtures.computeBlindIndex),
    },
    {
      name: "domain-separate-blind-index-purpose",
      command: differentBlindIndexPurpose,
      responseSchema: keyManagementPortResponseSchema,
      acceptsResponse: (response) =>
        succeeds(response) &&
        responseValue(response)?.["digestBase64"] !==
          responseValue(firstBlindIndexResponse)?.["digestBase64"],
      invoke: () => port.computeBlindIndex(differentBlindIndexPurpose),
    },
    {
      name: "reject-unknown-blind-index-version",
      command: unknownBlindIndexVersion,
      responseSchema: keyManagementPortResponseSchema,
      acceptsResponse: (response) =>
        failsWith(response, "KEY_VERSION_NOT_FOUND"),
      invoke: () => port.computeBlindIndex(unknownBlindIndexVersion),
    },
  ]);
}

function invokeRepository(
  manager: TransactionManager,
  invoke: (repositories: TransactionRepositories) => Promise<unknown>,
): () => Promise<unknown> {
  return () =>
    manager.runInTransaction<JsonValue>(
      { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
      (repositories) => invoke(repositories) as Promise<JsonValue>,
    );
}

function sameCanonicalJsonData(left: JsonValue, right: JsonValue): boolean {
  if (left === null || right === null || typeof left !== typeof right) {
    return left === right;
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return left === right;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      const leftEntry = left[index];
      const rightEntry = right[index];
      if (
        leftEntry === undefined ||
        rightEntry === undefined ||
        !sameCanonicalJsonData(leftEntry, rightEntry)
      ) {
        return false;
      }
    }
    return true;
  }
  const leftRecord = left as Readonly<Record<string, JsonValue>>;
  const rightRecord = right as Readonly<Record<string, JsonValue>>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    const leftValue = key === undefined ? undefined : leftRecord[key];
    const rightValue = key === undefined ? undefined : rightRecord[key];
    if (
      key === undefined ||
      key !== rightKeys[index] ||
      leftValue === undefined ||
      rightValue === undefined ||
      !sameCanonicalJsonData(leftValue, rightValue)
    ) {
      return false;
    }
  }
  return true;
}

function sameJsonData(left: unknown, right: unknown): boolean {
  const leftSnapshot = snapshotJsonData(left);
  const rightSnapshot = snapshotJsonData(right);
  return (
    leftSnapshot !== undefined &&
    rightSnapshot !== undefined &&
    sameCanonicalJsonData(leftSnapshot, rightSnapshot)
  );
}

function persistenceResponseMatchesCommand(
  command: unknown,
  response: unknown,
  fixtures: DeterministicPortFixtures["persistence"],
): boolean {
  const parsedCommand = persistencePortCommandSchema.safeParse(command);
  const parsedResponse = persistencePortResponseSchema.safeParse(response);
  if (
    !parsedCommand.success ||
    !parsedResponse.success ||
    parsedResponse.data.outcome !== "SUCCESS" ||
    parsedCommand.data.operation !== parsedResponse.data.operation
  ) {
    return false;
  }
  const value = parsedResponse.data.value;
  switch (parsedCommand.data.operation) {
    case "BEGIN_IDEMPOTENCY":
      return "decision" in value && value.decision === "STARTED";
    case "COMPLETE_IDEMPOTENCY":
      return "completed" in value && value.completed === true;
    case "APPEND_OUTBOX_EVENT":
      return (
        "eventId" in value &&
        "appended" in value &&
        value.eventId === parsedCommand.data.event.eventId &&
        value.appended === true
      );
    case "LOAD_INVENTORY_FOR_UPDATE": {
      if (!("items" in value) || value.items.length !== 1) {
        return false;
      }
      const item = value.items[0];
      return (
        item !== undefined &&
        sameJsonData(
          item.inventoryItem,
          fixtures.inventorySnapshot.inventoryItem,
        ) &&
        sameJsonData(
          item.inventoryLocation,
          fixtures.inventorySnapshot.inventoryLocation,
        ) &&
        sameJsonData(item.balance, fixtures.inventorySnapshot.balance) &&
        item.reservation === null
      );
    }
    case "APPLY_INVENTORY_RESERVATION_CREATION":
    case "APPLY_INVENTORY_RESERVATION_TRANSITION":
      return (
        "balance" in value &&
        "reservation" in value &&
        "ledgerEntry" in value &&
        sameJsonData(value.balance, parsedCommand.data.decision.nextBalance) &&
        sameJsonData(
          value.reservation,
          parsedCommand.data.decision.nextReservation,
        ) &&
        sameJsonData(value.ledgerEntry, parsedCommand.data.ledgerEntry)
      );
    default:
      return false;
  }
}

export function runPersistenceConformance(
  manager: TransactionManager,
  fixtures: DeterministicPortFixtures["persistence"] = deterministicPortFixtures.persistence,
): Promise<ConformanceReport> {
  const cases: readonly ConformanceCase[] = [
    {
      name: "begin-idempotency",
      command: fixtures.beginIdempotency,
      responseSchema: persistencePortResponseSchema,
      acceptsResponse: (response) =>
        persistenceResponseMatchesCommand(
          fixtures.beginIdempotency,
          response,
          fixtures,
        ),
      invoke: invokeRepository(manager, (repositories) =>
        repositories.idempotency.begin(fixtures.beginIdempotency),
      ),
    },
    {
      name: "complete-idempotency",
      command: fixtures.completeIdempotency,
      responseSchema: persistencePortResponseSchema,
      acceptsResponse: (response) =>
        persistenceResponseMatchesCommand(
          fixtures.completeIdempotency,
          response,
          fixtures,
        ),
      invoke: invokeRepository(manager, (repositories) =>
        repositories.idempotency.complete(fixtures.completeIdempotency),
      ),
    },
    {
      name: "append-outbox-event",
      command: fixtures.appendOutboxEvent,
      responseSchema: persistencePortResponseSchema,
      acceptsResponse: (response) =>
        persistenceResponseMatchesCommand(
          fixtures.appendOutboxEvent,
          response,
          fixtures,
        ),
      invoke: invokeRepository(manager, (repositories) =>
        repositories.outbox.append(fixtures.appendOutboxEvent),
      ),
    },
    {
      name: "load-inventory-for-update",
      command: fixtures.loadInventoryForUpdate,
      responseSchema: persistencePortResponseSchema,
      acceptsResponse: (response) =>
        persistenceResponseMatchesCommand(
          fixtures.loadInventoryForUpdate,
          response,
          fixtures,
        ),
      invoke: invokeRepository(manager, (repositories) =>
        repositories.inventory.loadManyForUpdate(
          fixtures.loadInventoryForUpdate,
        ),
      ),
    },
    {
      name: "apply-reservation-creation",
      command: fixtures.applyReservationCreation,
      responseSchema: persistencePortResponseSchema,
      acceptsResponse: (response) =>
        persistenceResponseMatchesCommand(
          fixtures.applyReservationCreation,
          response,
          fixtures,
        ),
      invoke: invokeRepository(manager, (repositories) =>
        repositories.inventory.applyReservationCreation(
          fixtures.applyReservationCreation,
        ),
      ),
    },
    {
      name: "apply-reservation-transition",
      command: fixtures.applyReservationTransition,
      responseSchema: persistencePortResponseSchema,
      acceptsResponse: (response) =>
        persistenceResponseMatchesCommand(
          fixtures.applyReservationTransition,
          response,
          fixtures,
        ),
      invoke: invokeRepository(manager, (repositories) =>
        repositories.inventory.applyReservationTransition(
          fixtures.applyReservationTransition,
        ),
      ),
    },
  ];
  return runSuite("persistence-v1", cases);
}

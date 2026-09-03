import {
  CloudFrontClient,
  CreateInvalidationCommand,
  GetInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import {
  cachePurgePortCommandSchema,
  cachePurgePortResponseSchema,
  type CachePurgePort,
  type CachePurgePortError,
  type GetCachePurgeStatusResponse,
  type SubmitCachePurgeResponse,
} from "@fan-support/cache-purge-port";

type Operation = "SUBMIT_PURGE" | "GET_PURGE_STATUS";
type JsonRecord = Readonly<Record<string, unknown>>;
type ResponseByOperation = Readonly<{
  SUBMIT_PURGE: SubmitCachePurgeResponse;
  GET_PURGE_STATUS: GetCachePurgeStatusResponse;
}>;
type FailureFor<SelectedOperation extends Operation> = Extract<
  ResponseByOperation[SelectedOperation],
  { outcome: "FAILURE" }
>;
type SuccessFor<SelectedOperation extends Operation> = Extract<
  ResponseByOperation[SelectedOperation],
  { outcome: "SUCCESS" }
>;

export type CloudFrontCachePurgeAdapterConfig = Readonly<{
  schemaVersion: 1;
  region: string;
  distributionId: string;
}>;

export type CloudFrontCachePurgeDependencies = Readonly<{
  send: (command: unknown) => Promise<unknown>;
}>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeConfig(
  value: unknown,
): CloudFrontCachePurgeAdapterConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const expectedKeys = ["schemaVersion", "region", "distributionId"];
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some(
        (key) => typeof key !== "string" || !expectedKeys.includes(key),
      )
    ) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      expectedKeys.some((key) => {
        const descriptor = descriptors[key];
        return (
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable
        );
      })
    ) {
      return undefined;
    }
    const schemaVersion = descriptors["schemaVersion"]?.value;
    const region = descriptors["region"]?.value;
    const distributionId = descriptors["distributionId"]?.value;
    if (
      schemaVersion !== 1 ||
      typeof region !== "string" ||
      !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(region) ||
      typeof distributionId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/+=-]{0,127}$/u.test(distributionId)
    ) {
      return undefined;
    }
    return Object.freeze({ schemaVersion, region, distributionId });
  } catch {
    return undefined;
  }
}

function failure<SelectedOperation extends Operation>(
  operation: SelectedOperation,
  code: CachePurgePortError["code"],
): FailureFor<SelectedOperation> {
  const recovery = [
    "RATE_LIMITED",
    "TEMPORARY_UNAVAILABLE",
    "UNEXPECTED_ADAPTER_FAILURE",
  ].includes(code)
    ? "RETRY_SAME_COMMAND"
    : "NONE";
  return cachePurgePortResponseSchema.parse({
    schemaVersion: 1,
    operation,
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery,
      ...(recovery === "RETRY_SAME_COMMAND" ? { retryAfterMs: 1_000 } : {}),
    },
  }) as FailureFor<SelectedOperation>;
}

function success<SelectedOperation extends Operation>(
  operation: SelectedOperation,
  value: JsonRecord,
): SuccessFor<SelectedOperation> {
  return cachePurgePortResponseSchema.parse({
    schemaVersion: 1,
    operation,
    outcome: "SUCCESS",
    value,
  }) as SuccessFor<SelectedOperation>;
}

function normalizedFailure<SelectedOperation extends Operation>(
  operation: SelectedOperation,
  error: unknown,
): FailureFor<SelectedOperation> {
  const name = readProviderErrorName(error);
  if (name === "NoSuchInvalidation") {
    return failure(operation, "PURGE_NOT_FOUND");
  }
  if (name === "InvalidationBatchAlreadyExists") {
    return failure(operation, "IDEMPOTENCY_CONFLICT");
  }
  if (name === "NoSuchDistribution") {
    return failure(operation, "CONFIGURATION_ERROR");
  }
  if (name === "InvalidArgument") {
    return failure(operation, "CONFIGURATION_ERROR");
  }
  if (name === "CredentialsProviderError") {
    return failure(operation, "CONFIGURATION_ERROR");
  }
  if (
    [
      "AccessDenied",
      "AccessDeniedException",
      "ExpiredToken",
      "InvalidClientTokenId",
      "SignatureDoesNotMatch",
    ].includes(name)
  ) {
    return failure(operation, "ACCESS_DENIED");
  }
  if (
    [
      "Throttling",
      "ThrottlingException",
      "TooManyInvalidationsInProgress",
    ].includes(name)
  ) {
    return failure(operation, "RATE_LIMITED");
  }
  if (["ServiceUnavailable", "TimeoutError"].includes(name)) {
    return failure(operation, "TEMPORARY_UNAVAILABLE");
  }
  return failure(operation, "UNEXPECTED_ADAPTER_FAILURE");
}

function readProviderErrorName(error: unknown): string {
  if (
    error === null ||
    (typeof error !== "object" && typeof error !== "function")
  ) {
    return "";
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "name");
    return descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : "";
  } catch {
    return "";
  }
}

function readInvalidation(
  value: unknown,
):
  | Readonly<{ id: string; status: "PENDING" | "COMPLETED"; createdAt?: Date }>
  | undefined {
  if (!isRecord(value) || !isRecord(value["Invalidation"])) {
    return undefined;
  }
  const invalidation = value["Invalidation"];
  const id = invalidation["Id"];
  const status = invalidation["Status"];
  if (
    typeof id !== "string" ||
    (status !== "InProgress" && status !== "Completed")
  ) {
    return undefined;
  }
  const createdAt = invalidation["CreateTime"];
  return {
    id,
    status: status === "Completed" ? "COMPLETED" : "PENDING",
    ...(createdAt instanceof Date && !Number.isNaN(createdAt.getTime())
      ? { createdAt }
      : {}),
  };
}

function createConfiguredAdapter(
  config: CloudFrontCachePurgeAdapterConfig | undefined,
  dependencies: CloudFrontCachePurgeDependencies,
) {
  const send = dependencies.send;

  return {
    async submitPurge(input: unknown) {
      const parsed = cachePurgePortCommandSchema.safeParse(input);
      if (!parsed.success || parsed.data.operation !== "SUBMIT_PURGE") {
        return failure("SUBMIT_PURGE", "INVALID_COMMAND");
      }
      if (config === undefined) {
        return failure("SUBMIT_PURGE", "CONFIGURATION_ERROR");
      }
      const paths = [...new Set(parsed.data.paths)].sort();
      try {
        const raw = await send(
          new CreateInvalidationCommand({
            DistributionId: config.distributionId,
            InvalidationBatch: {
              CallerReference: parsed.data.idempotencyKey,
              Paths: { Items: paths, Quantity: paths.length },
            },
          }),
        );
        const invalidation = readInvalidation(raw);
        if (
          invalidation === undefined ||
          invalidation.createdAt === undefined
        ) {
          return failure("SUBMIT_PURGE", "UNEXPECTED_ADAPTER_FAILURE");
        }
        return success("SUBMIT_PURGE", {
          purgeReference: invalidation.id,
          status: invalidation.status,
          submittedAt: invalidation.createdAt.toISOString(),
        });
      } catch (error: unknown) {
        return normalizedFailure("SUBMIT_PURGE", error);
      }
    },

    async getPurgeStatus(input: unknown) {
      const parsed = cachePurgePortCommandSchema.safeParse(input);
      if (!parsed.success || parsed.data.operation !== "GET_PURGE_STATUS") {
        return failure("GET_PURGE_STATUS", "INVALID_COMMAND");
      }
      if (config === undefined) {
        return failure("GET_PURGE_STATUS", "CONFIGURATION_ERROR");
      }
      try {
        const raw = await send(
          new GetInvalidationCommand({
            DistributionId: config.distributionId,
            Id: parsed.data.purgeReference,
          }),
        );
        const invalidation = readInvalidation(raw);
        if (
          invalidation === undefined ||
          invalidation.id !== parsed.data.purgeReference
        ) {
          return failure("GET_PURGE_STATUS", "UNEXPECTED_ADAPTER_FAILURE");
        }
        return success("GET_PURGE_STATUS", {
          purgeReference: invalidation.id,
          status: invalidation.status,
        });
      } catch (error: unknown) {
        return normalizedFailure("GET_PURGE_STATUS", error);
      }
    },
  };
}

export function createCloudFrontCachePurgeAdapterForTesting(
  config: CloudFrontCachePurgeAdapterConfig,
  dependencies: CloudFrontCachePurgeDependencies,
) {
  return createConfiguredAdapter(normalizeConfig(config), dependencies);
}

export function createCloudFrontCachePurgeAdapter(
  config: CloudFrontCachePurgeAdapterConfig,
): CachePurgePort {
  const normalizedConfig = normalizeConfig(config);
  const client =
    normalizedConfig === undefined
      ? undefined
      : new CloudFrontClient({ region: normalizedConfig.region });
  return createConfiguredAdapter(normalizedConfig, {
    send: (command) => {
      if (client === undefined) {
        throw new Error("CloudFront adapter is not configured");
      }
      return client.send(command as never);
    },
  });
}

import { Buffer } from "node:buffer";

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  mediaPortCommandSchema,
  mediaPortResponseSchema,
  mediaMimeTypeSchema,
  type CreateMediaDownloadGrantResponse,
  type CreateMediaUploadGrantResponse,
  type DeleteMediaObjectResponse,
  type InspectMediaObjectResponse,
  type MediaPortError,
  type MediaStoragePort,
  type ResolvePublicMediaUrlResponse,
} from "@fan-support/media-port";

type StorageClass = "SOURCE" | "DERIVATIVE";
type Operation =
  | "CREATE_UPLOAD_GRANT"
  | "INSPECT_OBJECT"
  | "CREATE_DOWNLOAD_GRANT"
  | "DELETE_OBJECT"
  | "RESOLVE_PUBLIC_URL";

type ResponseByOperation = Readonly<{
  CREATE_UPLOAD_GRANT: CreateMediaUploadGrantResponse;
  INSPECT_OBJECT: InspectMediaObjectResponse;
  CREATE_DOWNLOAD_GRANT: CreateMediaDownloadGrantResponse;
  DELETE_OBJECT: DeleteMediaObjectResponse;
  RESOLVE_PUBLIC_URL: ResolvePublicMediaUrlResponse;
}>;
type FailureFor<SelectedOperation extends Operation> = Extract<
  ResponseByOperation[SelectedOperation],
  { outcome: "FAILURE" }
>;
type SuccessFor<SelectedOperation extends Operation> = Extract<
  ResponseByOperation[SelectedOperation],
  { outcome: "SUCCESS" }
>;

export type S3MediaStorageBoundaryConfig = Readonly<{
  schemaVersion: 1;
  sourceBucket: string;
  derivativeBucket: string;
  publicMediaOrigin: string;
  allowPreviewLoopbackPublicOrigin?: boolean;
  maxUploadBytes: number;
}>;

export type S3MediaStorageAdapterConfig = S3MediaStorageBoundaryConfig &
  Readonly<{
    region: string;
    authentication:
      | Readonly<{ mode: "ambient" }>
      | Readonly<{
          mode: "static";
          endpoint: string;
          presignEndpoint: string;
          accessKeyId: string;
          secretAccessKey: string;
          forcePathStyle: boolean;
        }>;
  }>;

export type S3MediaStorageAdapterDependencies = Readonly<{
  now: () => Date;
  send: (command: unknown) => Promise<unknown>;
  presign: (
    command: unknown,
    options: Readonly<{
      expiresIn: number;
      signableHeaders?: ReadonlySet<string>;
      unhoistableHeaders?: ReadonlySet<string>;
    }>,
  ) => Promise<string>;
}>;

type JsonRecord = Readonly<Record<string, unknown>>;
type OwnDataProperties = ReadonlyMap<string, unknown>;

type NormalizedBoundaryConfig = Readonly<{
  config: S3MediaStorageBoundaryConfig;
  publicOrigin: URL | undefined;
}>;

type NormalizedAdapterConfig = Readonly<{
  config: S3MediaStorageAdapterConfig;
  publicOrigin: URL | undefined;
}>;

const boundaryConfigRequiredKeys = [
  "schemaVersion",
  "sourceBucket",
  "derivativeBucket",
  "publicMediaOrigin",
  "maxUploadBytes",
] as const;
const boundaryConfigOptionalKeys = [
  "allowPreviewLoopbackPublicOrigin",
] as const;
const adapterConfigRequiredKeys = [
  ...boundaryConfigRequiredKeys,
  "region",
  "authentication",
] as const;
const dependencyKeys = ["now", "send", "presign"] as const;
const ambientAuthenticationKeys = ["mode"] as const;
const staticAuthenticationKeys = [
  "mode",
  "endpoint",
  "presignEndpoint",
  "accessKeyId",
  "secretAccessKey",
  "forcePathStyle",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwnEnumerableDataProperties(
  value: unknown,
): OwnDataProperties | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) {
      return undefined;
    }
    const properties = new Map<string, unknown>();
    for (const key of keys) {
      if (typeof key !== "string") {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      ) {
        return undefined;
      }
      properties.set(key, descriptor.value);
    }
    return properties;
  } catch {
    return undefined;
  }
}

function hasExactKeys(
  properties: OwnDataProperties,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  return (
    requiredKeys.every((key) => properties.has(key)) &&
    [...properties.keys()].every((key) => allowedKeys.has(key))
  );
}

function bucketFor(
  config: S3MediaStorageBoundaryConfig,
  storageClass: StorageClass,
): string {
  return storageClass === "SOURCE"
    ? config.sourceBucket
    : config.derivativeBucket;
}

function failure<SelectedOperation extends Operation>(
  operation: SelectedOperation,
  code: MediaPortError["code"],
): FailureFor<SelectedOperation> {
  const recovery = [
    "RATE_LIMITED",
    "TEMPORARY_UNAVAILABLE",
    "UNEXPECTED_ADAPTER_FAILURE",
  ].includes(code)
    ? "RETRY_SAME_COMMAND"
    : "NONE";
  return mediaPortResponseSchema.parse({
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
  return mediaPortResponseSchema.parse({
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
  if (["NoSuchKey", "NotFound", "NoSuchVersion"].includes(name)) {
    return failure(operation, "OBJECT_NOT_FOUND");
  }
  if (
    [
      "AuthorizationHeaderMalformed",
      "CredentialsProviderError",
      "InvalidBucketName",
      "InvalidRequest",
      "NoSuchBucket",
      "PermanentRedirect",
      "RequestExpired",
      "RequestTimeTooSkewed",
    ].includes(name)
  ) {
    return failure(operation, "CONFIGURATION_ERROR");
  }
  if (["PreconditionFailed", "ConditionalRequestConflict"].includes(name)) {
    return failure(operation, "PRECONDITION_FAILED");
  }
  if (
    [
      "AccessDenied",
      "ExpiredToken",
      "Forbidden",
      "InvalidAccessKeyId",
      "InvalidToken",
      "SignatureDoesNotMatch",
    ].includes(name)
  ) {
    return failure(operation, "ACCESS_DENIED");
  }
  if (["SlowDown", "Throttling", "ThrottlingException"].includes(name)) {
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

function expiresInSeconds(expiresAt: string, now: Date): number | undefined {
  const seconds = Math.floor((Date.parse(expiresAt) - now.getTime()) / 1_000);
  return Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= 900
    ? seconds
    : undefined;
}

function sha256HexToBase64(value: string): string {
  return Buffer.from(value, "hex").toString("base64");
}

function sha256Base64ToHex(value: string): string | undefined {
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.byteLength === 32 ? bytes.toString("hex") : undefined;
  } catch {
    return undefined;
  }
}

function revisionTokenFromEntityTag(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = /^"([A-Za-z0-9][A-Za-z0-9._:-]{0,255})"$/u.exec(value);
  return match?.[1];
}

function entityTagFromRevisionToken(value: string): string {
  return `"${value}"`;
}

function encodeObjectPath(objectKey: string): string {
  return objectKey.split("/").map(encodeURIComponent).join("/");
}

function isBucketName(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(value) &&
    !value.includes("..") &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)
  );
}

function isBlockedIpv4Address(octets: readonly number[]): boolean {
  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second !== undefined && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 31 && third === 196) ||
    (first === 192 && second === 52 && third === 193) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 175 && third === 48) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    (first !== undefined && first >= 224)
  );
}

function parseIpv4Address(hostname: string): readonly number[] | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) {
    return undefined;
  }
  const octets = hostname.split(".").map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255)
    ? octets
    : undefined;
}

function parseIpv6Address(hostname: string): readonly number[] | undefined {
  const address = hostname.startsWith("[")
    ? hostname.slice(1, hostname.endsWith("]") ? -1 : undefined)
    : hostname;
  const halves = address.split("::");
  if (halves.length > 2) {
    return undefined;
  }
  const left = halves[0] === "" ? [] : halves[0]!.split(":");
  const right =
    halves.length === 1 || halves[1] === "" ? [] : halves[1]!.split(":");
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return undefined;
  }
  const segments = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ];
  if (!segments.every((segment) => /^[0-9a-f]{1,4}$/u.test(segment))) {
    return undefined;
  }
  return segments.map((segment) => Number.parseInt(segment, 16));
}

function isBlockedIpLiteral(hostname: string): boolean {
  const ipv4 = parseIpv4Address(hostname);
  if (ipv4 !== undefined) {
    return isBlockedIpv4Address(ipv4);
  }
  const ipv6 = parseIpv6Address(hostname);
  if (ipv6 === undefined) {
    return false;
  }
  const [first] = ipv6;
  const isUnspecifiedOrLoopback =
    ipv6.slice(0, 7).every((segment) => segment === 0) &&
    (ipv6[7] === 0 || ipv6[7] === 1);
  const isUniqueLocal = first !== undefined && (first & 0xfe00) === 0xfc00;
  const isLinkLocal = first !== undefined && (first & 0xffc0) === 0xfe80;
  const isGlobalUnicast =
    first !== undefined && first >= 0x2000 && first <= 0x3fff;
  const isDocumentation = first === 0x2001 && ipv6[1] === 0x0db8;
  const isBenchmarking =
    first === 0x2001 && ipv6[1] === 0x0002 && ipv6[2] === 0;
  const isTeredo = first === 0x2001 && ipv6[1] === 0;
  const isDeprecatedSixToFour = first === 0x2002;
  const isIpv4Embedded =
    ipv6.slice(0, 5).every((segment) => segment === 0) &&
    (ipv6[5] === 0 || ipv6[5] === 0xffff);
  const embeddedIpv4 = isIpv4Embedded
    ? [
        (ipv6[6]! >> 8) & 0xff,
        ipv6[6]! & 0xff,
        (ipv6[7]! >> 8) & 0xff,
        ipv6[7]! & 0xff,
      ]
    : undefined;
  return (
    isUnspecifiedOrLoopback ||
    isUniqueLocal ||
    isLinkLocal ||
    !isGlobalUnicast ||
    isDocumentation ||
    isBenchmarking ||
    isTeredo ||
    isDeprecatedSixToFour ||
    (embeddedIpv4 !== undefined && isBlockedIpv4Address(embeddedIpv4))
  );
}

function isPublicMediaHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return (
    normalized !== "localhost" &&
    !normalized.endsWith(".localhost") &&
    !isBlockedIpLiteral(normalized)
  );
}

function validateBoundaryConfig(
  config: S3MediaStorageBoundaryConfig,
): URL | undefined {
  if (
    config.schemaVersion !== 1 ||
    typeof config.sourceBucket !== "string" ||
    typeof config.derivativeBucket !== "string" ||
    typeof config.publicMediaOrigin !== "string" ||
    typeof config.maxUploadBytes !== "number" ||
    (config.allowPreviewLoopbackPublicOrigin !== undefined &&
      typeof config.allowPreviewLoopbackPublicOrigin !== "boolean")
  ) {
    return undefined;
  }
  try {
    const origin = new URL(config.publicMediaOrigin);
    const allowsFixedLocalPreview =
      config.allowPreviewLoopbackPublicOrigin === true &&
      config.publicMediaOrigin === "https://localhost:7444";
    if (
      !isBucketName(config.sourceBucket) ||
      !isBucketName(config.derivativeBucket) ||
      config.sourceBucket === config.derivativeBucket ||
      !Number.isSafeInteger(config.maxUploadBytes) ||
      config.maxUploadBytes <= 0 ||
      origin.protocol !== "https:" ||
      origin.origin !== config.publicMediaOrigin ||
      origin.username !== "" ||
      origin.password !== "" ||
      origin.pathname !== "/" ||
      origin.search !== "" ||
      origin.hash !== "" ||
      config.publicMediaOrigin.includes("#") ||
      (!isPublicMediaHostname(origin.hostname) && !allowsFixedLocalPreview) ||
      (config.allowPreviewLoopbackPublicOrigin === true &&
        !allowsFixedLocalPreview)
    ) {
      return undefined;
    }
    return origin;
  } catch {
    return undefined;
  }
}

function isCredential(value: string, minimumLength: number): boolean {
  return (
    value.length >= minimumLength &&
    value.length <= 512 &&
    value.trim() === value &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
      );
    })
  );
}

function isHttpsObjectStorageEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    return (
      endpoint.origin === value &&
      endpoint.protocol === "https:" &&
      endpoint.username === "" &&
      endpoint.password === "" &&
      endpoint.pathname === "/" &&
      endpoint.search === "" &&
      endpoint.hash === ""
    );
  } catch {
    return false;
  }
}

function validateAdapterConfig(
  config: S3MediaStorageAdapterConfig,
): URL | undefined {
  const publicOrigin = validateBoundaryConfig(config);
  if (
    publicOrigin === undefined ||
    typeof config.region !== "string" ||
    config.region.length > 64 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(config.region)
  ) {
    return undefined;
  }
  const authentication: unknown = config.authentication;
  if (!isRecord(authentication)) {
    return undefined;
  }
  if (authentication["mode"] === "ambient") {
    return publicOrigin;
  }
  return authentication["mode"] === "static" &&
    typeof authentication["endpoint"] === "string" &&
    isHttpsObjectStorageEndpoint(authentication["endpoint"]) &&
    typeof authentication["presignEndpoint"] === "string" &&
    isHttpsObjectStorageEndpoint(authentication["presignEndpoint"]) &&
    typeof authentication["accessKeyId"] === "string" &&
    isCredential(authentication["accessKeyId"], 3) &&
    typeof authentication["secretAccessKey"] === "string" &&
    isCredential(authentication["secretAccessKey"], 8) &&
    typeof authentication["forcePathStyle"] === "boolean"
    ? publicOrigin
    : undefined;
}

function copyBoundaryConfig(
  properties: OwnDataProperties,
): S3MediaStorageBoundaryConfig {
  return Object.freeze({
    schemaVersion: properties.get("schemaVersion"),
    sourceBucket: properties.get("sourceBucket"),
    derivativeBucket: properties.get("derivativeBucket"),
    publicMediaOrigin: properties.get("publicMediaOrigin"),
    maxUploadBytes: properties.get("maxUploadBytes"),
    ...(properties.has("allowPreviewLoopbackPublicOrigin")
      ? {
          allowPreviewLoopbackPublicOrigin: properties.get(
            "allowPreviewLoopbackPublicOrigin",
          ),
        }
      : {}),
  }) as unknown as S3MediaStorageBoundaryConfig;
}

function normalizeBoundaryConfig(
  input: unknown,
): NormalizedBoundaryConfig | undefined {
  const properties = readOwnEnumerableDataProperties(input);
  if (
    properties === undefined ||
    !hasExactKeys(
      properties,
      boundaryConfigRequiredKeys,
      boundaryConfigOptionalKeys,
    )
  ) {
    return undefined;
  }
  const config = copyBoundaryConfig(properties);
  return Object.freeze({
    config,
    publicOrigin: validateBoundaryConfig(config),
  });
}

function normalizeAuthentication(
  input: unknown,
): S3MediaStorageAdapterConfig["authentication"] | undefined {
  const properties = readOwnEnumerableDataProperties(input);
  if (properties === undefined) {
    return undefined;
  }
  if (
    properties.get("mode") === "ambient" &&
    hasExactKeys(properties, ambientAuthenticationKeys)
  ) {
    return Object.freeze({ mode: "ambient" });
  }
  if (
    properties.get("mode") !== "static" ||
    !hasExactKeys(properties, staticAuthenticationKeys)
  ) {
    return undefined;
  }
  return Object.freeze({
    mode: "static",
    endpoint: properties.get("endpoint"),
    presignEndpoint: properties.get("presignEndpoint"),
    accessKeyId: properties.get("accessKeyId"),
    secretAccessKey: properties.get("secretAccessKey"),
    forcePathStyle: properties.get("forcePathStyle"),
  }) as unknown as S3MediaStorageAdapterConfig["authentication"];
}

function normalizeAdapterConfig(
  input: unknown,
): NormalizedAdapterConfig | undefined {
  const properties = readOwnEnumerableDataProperties(input);
  if (
    properties === undefined ||
    !hasExactKeys(
      properties,
      adapterConfigRequiredKeys,
      boundaryConfigOptionalKeys,
    )
  ) {
    return undefined;
  }
  const authentication = normalizeAuthentication(
    properties.get("authentication"),
  );
  if (authentication === undefined) {
    return undefined;
  }
  const config = Object.freeze({
    ...copyBoundaryConfig(properties),
    region: properties.get("region"),
    authentication,
  }) as unknown as S3MediaStorageAdapterConfig;
  return Object.freeze({
    config,
    publicOrigin: validateAdapterConfig(config),
  });
}

function normalizeDependencies(
  input: unknown,
): S3MediaStorageAdapterDependencies | undefined {
  const properties = readOwnEnumerableDataProperties(input);
  if (
    properties === undefined ||
    !hasExactKeys(properties, dependencyKeys) ||
    typeof properties.get("now") !== "function" ||
    typeof properties.get("send") !== "function" ||
    typeof properties.get("presign") !== "function"
  ) {
    return undefined;
  }
  return Object.freeze({
    now: properties.get("now"),
    send: properties.get("send"),
    presign: properties.get("presign"),
  }) as S3MediaStorageAdapterDependencies;
}

function createS3MediaStorageAdapterWithDependencies(
  config: S3MediaStorageBoundaryConfig | undefined,
  dependencies: S3MediaStorageAdapterDependencies | undefined,
  publicOrigin: URL | undefined,
) {
  const inspectObject = async (input: unknown, versionId?: string) => {
    const parsed = mediaPortCommandSchema.safeParse(input);
    if (!parsed.success || parsed.data.operation !== "INSPECT_OBJECT") {
      return failure("INSPECT_OBJECT", "INVALID_COMMAND");
    }
    if (
      config === undefined ||
      dependencies === undefined ||
      publicOrigin === undefined
    ) {
      return failure("INSPECT_OBJECT", "CONFIGURATION_ERROR");
    }
    try {
      const raw = await dependencies.send(
        new HeadObjectCommand({
          Bucket: bucketFor(config, parsed.data.storageClass),
          ChecksumMode: "ENABLED",
          Key: parsed.data.objectKey,
          ...(versionId === undefined ? {} : { VersionId: versionId }),
        }),
      );
      if (!isRecord(raw)) {
        return failure("INSPECT_OBJECT", "CONTENT_MISMATCH");
      }
      const checksum =
        typeof raw["ChecksumSHA256"] === "string"
          ? sha256Base64ToHex(raw["ChecksumSHA256"])
          : undefined;
      const byteSize = raw["ContentLength"];
      const mimeType = raw["ContentType"];
      const revisionToken = revisionTokenFromEntityTag(raw["ETag"]);
      if (
        checksum === undefined ||
        typeof byteSize !== "number" ||
        !Number.isSafeInteger(byteSize) ||
        byteSize <= 0 ||
        !mediaMimeTypeSchema.safeParse(mimeType).success ||
        revisionToken === undefined
      ) {
        return failure("INSPECT_OBJECT", "CONTENT_MISMATCH");
      }
      return success("INSPECT_OBJECT", {
        storageClass: parsed.data.storageClass,
        objectKey: parsed.data.objectKey,
        checksumSha256: checksum,
        byteSize,
        mimeType,
        revisionToken,
        ...(typeof raw["VersionId"] === "string"
          ? { versionId: raw["VersionId"] }
          : {}),
      });
    } catch (error: unknown) {
      return normalizedFailure("INSPECT_OBJECT", error);
    }
  };

  return {
    async createUploadGrant(input: unknown) {
      const parsed = mediaPortCommandSchema.safeParse(input);
      if (!parsed.success || parsed.data.operation !== "CREATE_UPLOAD_GRANT") {
        return failure("CREATE_UPLOAD_GRANT", "INVALID_COMMAND");
      }
      if (
        config === undefined ||
        dependencies === undefined ||
        publicOrigin === undefined
      ) {
        return failure("CREATE_UPLOAD_GRANT", "CONFIGURATION_ERROR");
      }
      const expiresIn = expiresInSeconds(
        parsed.data.expiresAt,
        dependencies.now(),
      );
      if (expiresIn === undefined) {
        return failure("CREATE_UPLOAD_GRANT", "INVALID_COMMAND");
      }
      if (parsed.data.byteSize > config.maxUploadBytes) {
        return failure("CREATE_UPLOAD_GRANT", "INVALID_COMMAND");
      }
      const checksum = sha256HexToBase64(parsed.data.checksumSha256);
      const command = new PutObjectCommand({
        Bucket: bucketFor(config, parsed.data.storageClass),
        Key: parsed.data.objectKey,
        ChecksumSHA256: checksum,
        ContentLength: parsed.data.byteSize,
        ContentType: parsed.data.mimeType,
        IfNoneMatch: "*",
      });
      try {
        const url = await dependencies.presign(command, {
          expiresIn,
          signableHeaders: new Set([
            "content-length",
            "content-type",
            "if-none-match",
          ]),
          unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
        });
        return success("CREATE_UPLOAD_GRANT", {
          storageClass: parsed.data.storageClass,
          objectKey: parsed.data.objectKey,
          checksumSha256: parsed.data.checksumSha256,
          byteSize: parsed.data.byteSize,
          mimeType: parsed.data.mimeType,
          method: "PUT",
          url,
          headers: {
            "content-type": parsed.data.mimeType,
            "if-none-match": "*",
            "x-amz-checksum-sha256": checksum,
          },
          expiresAt: parsed.data.expiresAt,
        });
      } catch (error: unknown) {
        return normalizedFailure("CREATE_UPLOAD_GRANT", error);
      }
    },

    inspectObject,

    async createDownloadGrant(input: unknown) {
      const parsed = mediaPortCommandSchema.safeParse(input);
      if (
        !parsed.success ||
        parsed.data.operation !== "CREATE_DOWNLOAD_GRANT"
      ) {
        return failure("CREATE_DOWNLOAD_GRANT", "INVALID_COMMAND");
      }
      if (
        config === undefined ||
        dependencies === undefined ||
        publicOrigin === undefined
      ) {
        return failure("CREATE_DOWNLOAD_GRANT", "CONFIGURATION_ERROR");
      }
      const expiresIn = expiresInSeconds(
        parsed.data.expiresAt,
        dependencies.now(),
      );
      if (expiresIn === undefined) {
        return failure("CREATE_DOWNLOAD_GRANT", "INVALID_COMMAND");
      }
      try {
        const url = await dependencies.presign(
          new GetObjectCommand({
            Bucket: bucketFor(config, parsed.data.storageClass),
            Key: parsed.data.objectKey,
          }),
          { expiresIn },
        );
        return success("CREATE_DOWNLOAD_GRANT", {
          storageClass: parsed.data.storageClass,
          objectKey: parsed.data.objectKey,
          method: "GET",
          url,
          headers: {},
          expiresAt: parsed.data.expiresAt,
        });
      } catch (error: unknown) {
        return normalizedFailure("CREATE_DOWNLOAD_GRANT", error);
      }
    },

    async deleteObject(input: unknown) {
      const parsed = mediaPortCommandSchema.safeParse(input);
      if (!parsed.success || parsed.data.operation !== "DELETE_OBJECT") {
        return failure("DELETE_OBJECT", "INVALID_COMMAND");
      }
      if (
        config === undefined ||
        dependencies === undefined ||
        publicOrigin === undefined
      ) {
        return failure("DELETE_OBJECT", "CONFIGURATION_ERROR");
      }
      const deletedValue = {
        storageClass: parsed.data.storageClass,
        objectKey: parsed.data.objectKey,
        checksumSha256: parsed.data.expectedChecksumSha256,
        revisionToken: parsed.data.expectedRevisionToken,
        ...(parsed.data.expectedVersionId === undefined
          ? {}
          : { versionId: parsed.data.expectedVersionId }),
        deleted: true,
      } as const;
      const inspected = await inspectObject(
        {
          schemaVersion: 1,
          operation: "INSPECT_OBJECT",
          storageClass: parsed.data.storageClass,
          objectKey: parsed.data.objectKey,
        },
        parsed.data.expectedVersionId,
      );
      if (inspected.outcome === "FAILURE") {
        if (inspected.error.code === "OBJECT_NOT_FOUND") {
          return success("DELETE_OBJECT", deletedValue);
        }
        return failure("DELETE_OBJECT", inspected.error.code);
      }
      if (
        inspected.value.checksumSha256 !== parsed.data.expectedChecksumSha256 ||
        inspected.value.revisionToken !== parsed.data.expectedRevisionToken ||
        (parsed.data.expectedVersionId !== undefined &&
          inspected.value.versionId !== parsed.data.expectedVersionId)
      ) {
        return failure("DELETE_OBJECT", "PRECONDITION_FAILED");
      }
      try {
        await dependencies.send(
          new DeleteObjectCommand({
            Bucket: bucketFor(config, parsed.data.storageClass),
            Key: parsed.data.objectKey,
            IfMatch: entityTagFromRevisionToken(
              parsed.data.expectedRevisionToken,
            ),
            ...(parsed.data.expectedVersionId === undefined
              ? {}
              : { VersionId: parsed.data.expectedVersionId }),
          }),
        );
        return success("DELETE_OBJECT", deletedValue);
      } catch (error: unknown) {
        const normalized = normalizedFailure("DELETE_OBJECT", error);
        return normalized.error.code === "OBJECT_NOT_FOUND"
          ? success("DELETE_OBJECT", deletedValue)
          : normalized;
      }
    },

    async resolvePublicUrl(input: unknown) {
      const parsed = mediaPortCommandSchema.safeParse(input);
      if (!parsed.success || parsed.data.operation !== "RESOLVE_PUBLIC_URL") {
        return failure("RESOLVE_PUBLIC_URL", "INVALID_COMMAND");
      }
      if (
        config === undefined ||
        dependencies === undefined ||
        publicOrigin === undefined
      ) {
        return failure("RESOLVE_PUBLIC_URL", "CONFIGURATION_ERROR");
      }
      const base = publicOrigin.href.endsWith("/")
        ? publicOrigin.href
        : `${publicOrigin.href}/`;
      return success("RESOLVE_PUBLIC_URL", {
        storageClass: parsed.data.storageClass,
        objectKey: parsed.data.objectKey,
        url: new URL(encodeObjectPath(parsed.data.objectKey), base).href,
      });
    },
  };
}

export function createS3MediaStorageAdapterForTesting(
  config: S3MediaStorageBoundaryConfig,
  dependencies: S3MediaStorageAdapterDependencies,
) {
  const normalizedConfig = normalizeBoundaryConfig(config);
  return createS3MediaStorageAdapterWithDependencies(
    normalizedConfig?.config,
    normalizeDependencies(dependencies),
    normalizedConfig?.publicOrigin,
  );
}

export function createS3MediaStorageAdapter(
  config: S3MediaStorageAdapterConfig,
): MediaStoragePort {
  const normalized = normalizeAdapterConfig(config);
  if (normalized?.publicOrigin === undefined) {
    return createS3MediaStorageAdapterWithDependencies(
      normalized?.config,
      undefined,
      normalized?.publicOrigin,
    );
  }
  const canonicalConfig = normalized.config;
  let serviceClient: S3Client;
  let presignClient: S3Client;
  if (canonicalConfig.authentication.mode === "static") {
    const commonConfig = {
      region: canonicalConfig.region,
      credentials: {
        accessKeyId: canonicalConfig.authentication.accessKeyId,
        secretAccessKey: canonicalConfig.authentication.secretAccessKey,
      },
      forcePathStyle: canonicalConfig.authentication.forcePathStyle,
    } as const;
    serviceClient = new S3Client({
      ...commonConfig,
      endpoint: canonicalConfig.authentication.endpoint,
    });
    presignClient = new S3Client({
      ...commonConfig,
      endpoint: canonicalConfig.authentication.presignEndpoint,
    });
  } else {
    serviceClient = new S3Client({ region: canonicalConfig.region });
    presignClient = serviceClient;
  }
  return createS3MediaStorageAdapterWithDependencies(
    canonicalConfig,
    Object.freeze({
      now: () => new Date(),
      send: (command) => serviceClient.send(command as never),
      presign: (command, options) =>
        getSignedUrl(presignClient, command as never, {
          expiresIn: options.expiresIn,
          ...(options.signableHeaders === undefined
            ? {}
            : { signableHeaders: new Set(options.signableHeaders) }),
          ...(options.unhoistableHeaders === undefined
            ? {}
            : { unhoistableHeaders: new Set(options.unhoistableHeaders) }),
        }),
    }),
    normalized.publicOrigin,
  );
}

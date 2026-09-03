import { Buffer } from "node:buffer";

import { describe, expect, test } from "vitest";

import {
  mediaPortCommandSchema,
  mediaPortResponseSchema,
} from "@fan-support/media-port";
import {
  deterministicPortFixtures,
  loadReviewedProviderFixtureBundle,
  runMediaStorageConformance,
} from "@fan-support/testing";

import {
  createS3MediaStorageAdapter,
  createS3MediaStorageAdapterForTesting,
  type S3MediaStorageAdapterDependencies,
} from "./adapter.js";

const now = new Date("2026-09-03T12:00:00.000Z");
const checksumHex = "a".repeat(64);
const checksumBase64 = Buffer.from(checksumHex, "hex").toString("base64");

type HostileProviderError = Readonly<{
  label: string;
  create: () => Readonly<{
    reason: unknown;
    verifyNoUnsafeRead: () => void;
  }>;
}>;

const hostileProviderErrors: readonly HostileProviderError[] = [
  {
    label: "an own enumerable name getter",
    create: () => {
      let nameReads = 0;
      const reason = {};
      Object.defineProperty(reason, "name", {
        enumerable: true,
        get() {
          nameReads += 1;
          return "NoSuchBucket";
        },
      });
      return {
        reason,
        verifyNoUnsafeRead: () => expect(nameReads).toBe(0),
      };
    },
  },
  {
    label: "an inherited name",
    create: () => ({
      reason: Object.create({ name: "NoSuchBucket" }),
      verifyNoUnsafeRead: () => undefined,
    }),
  },
  {
    label: "a revoked proxy",
    create: () => {
      const revocable = Proxy.revocable({ name: "NoSuchBucket" }, {});
      revocable.revoke();
      return {
        reason: revocable.proxy,
        verifyNoUnsafeRead: () => undefined,
      };
    },
  },
  {
    label: "a throwing getOwnPropertyDescriptor trap",
    create: () => {
      let descriptorReads = 0;
      const reason = new Proxy(
        { name: "NoSuchBucket" },
        {
          getOwnPropertyDescriptor() {
            descriptorReads += 1;
            throw new Error("RAW_DESCRIPTOR_TRAP_MUST_NOT_ESCAPE");
          },
        },
      );
      return {
        reason,
        verifyNoUnsafeRead: () => expect(descriptorReads).toBe(1),
      };
    },
  },
];

const providerFailureOperations = [
  "INSPECT_OBJECT",
  "CREATE_UPLOAD_GRANT",
  "CREATE_DOWNLOAD_GRANT",
  "DELETE_OBJECT",
] as const;

function createHarness(
  responses: readonly unknown[] = [],
  harnessNow = now,
): Readonly<{
  adapter: ReturnType<typeof createS3MediaStorageAdapterForTesting>;
  commands: unknown[];
  presignCalls: unknown[];
}> {
  const commands: unknown[] = [];
  const presignCalls: unknown[] = [];
  const pendingResponses = [...responses];
  const dependencies: S3MediaStorageAdapterDependencies = {
    now: () => harnessNow,
    send: async (command) => {
      commands.push(command);
      return pendingResponses.shift() ?? {};
    },
    presign: async (command, options) => {
      presignCalls.push({ command, options });
      return "https://uploads.example.invalid/signed";
    },
  };

  return {
    adapter: createS3MediaStorageAdapterForTesting(
      {
        schemaVersion: 1,
        sourceBucket: "private-source",
        derivativeBucket: "private-derivatives",
        publicMediaOrigin: "https://media.example.invalid",
        maxUploadBytes: 1_024,
      },
      dependencies,
    ),
    commands,
    presignCalls,
  };
}

describe("S3 media storage adapter", () => {
  test("passes the shared media-storage conformance suite", async () => {
    const metadata = {
      ChecksumSHA256: checksumBase64,
      ContentLength: 1_024,
      ContentType: "image/jpeg",
      ETag: '"68b329da9893e34099c7d8ad5cb9c940"',
    };
    const { adapter } = createHarness(
      [metadata, metadata, {}],
      new Date("2026-09-03T00:00:00.000Z"),
    );

    const report = await runMediaStorageConformance(
      adapter,
      deterministicPortFixtures.media,
    );

    expect(report.passed).toBe(true);
    expect(report.cases).toHaveLength(5);
  });

  test("matches the reviewed media provider fixture", async () => {
    const bundle = await loadReviewedProviderFixtureBundle();
    const fixture = bundle.fixtures["media-s3.v1.json"];
    const command = deterministicPortFixtures.media.inspectObject;
    const { adapter } = createHarness([
      {
        ChecksumSHA256: checksumBase64,
        ContentLength: 1_024,
        ContentType: "image/jpeg",
        ETag: '"68b329da9893e34099c7d8ad5cb9c940"',
      },
    ]);

    expect(fixture.request).toEqual({
      storageClass: command.storageClass,
      objectKey: command.objectKey,
    });
    await expect(adapter.inspectObject(command)).resolves.toEqual({
      schemaVersion: 1,
      operation: "INSPECT_OBJECT",
      outcome: "SUCCESS",
      value: {
        storageClass: command.storageClass,
        objectKey: command.objectKey,
        ...fixture.expected,
      },
    });
  });

  test("presigns a byte-size-, checksum-, and content-type-bound upload without exposing SDK output", async () => {
    const { adapter, presignCalls } = createHarness();

    const result = await adapter.createUploadGrant({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      storageClass: "SOURCE",
      objectKey: "source/asset-1/original.jpg",
      checksumSha256: checksumHex,
      byteSize: 12,
      mimeType: "image/jpeg",
      expiresAt: "2026-09-03T12:05:00.000Z",
    });

    expect(result).toEqual({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      outcome: "SUCCESS",
      value: {
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        checksumSha256: checksumHex,
        byteSize: 12,
        mimeType: "image/jpeg",
        method: "PUT",
        url: "https://uploads.example.invalid/signed",
        headers: {
          "content-type": "image/jpeg",
          "if-none-match": "*",
          "x-amz-checksum-sha256": checksumBase64,
        },
        expiresAt: "2026-09-03T12:05:00.000Z",
      },
    });
    expect(presignCalls).toHaveLength(1);
    const [presignCall] = presignCalls as readonly Readonly<{
      command: Readonly<{ input?: Readonly<Record<string, unknown>> }>;
      options: Readonly<{ signableHeaders?: ReadonlySet<string> }>;
    }>[];
    expect(presignCall?.command.input).toMatchObject({
      Bucket: "private-source",
      ChecksumSHA256: checksumBase64,
      ContentLength: 12,
      ContentType: "image/jpeg",
      IfNoneMatch: "*",
    });
    expect(presignCall?.options.signableHeaders).toContain("content-length");
    expect(JSON.stringify(presignCalls[0])).not.toContain("$metadata");
  });

  test("rejects a declared upload larger than the configured adapter limit before presigning", async () => {
    const presignCalls: unknown[] = [];
    const adapter = createS3MediaStorageAdapterForTesting(
      {
        schemaVersion: 1,
        sourceBucket: "private-source",
        derivativeBucket: "private-derivatives",
        publicMediaOrigin: "https://media.example.invalid",
        maxUploadBytes: 11,
      },
      {
        now: () => now,
        presign: async (command, options) => {
          presignCalls.push({ command, options });
          return "https://uploads.example.invalid/signed";
        },
        send: async () => ({}),
      },
    );

    await expect(
      adapter.createUploadGrant({
        schemaVersion: 1,
        operation: "CREATE_UPLOAD_GRANT",
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        checksumSha256: checksumHex,
        byteSize: 12,
        mimeType: "image/jpeg",
        expiresAt: "2026-09-03T12:05:00.000Z",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "INVALID_COMMAND",
        recovery: "NONE",
      },
    });
    expect(presignCalls).toHaveLength(0);
  });

  test("maps object metadata and strips the raw AWS response", async () => {
    const { adapter } = createHarness([
      {
        ChecksumSHA256: checksumBase64,
        ContentLength: 12,
        ContentType: "image/jpeg",
        ETag: '"68b329da9893e34099c7d8ad5cb9c940"',
        VersionId: "version-1",
        $metadata: { requestId: "must-not-escape" },
      },
    ]);

    await expect(
      adapter.inspectObject({
        schemaVersion: 1,
        operation: "INSPECT_OBJECT",
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "INSPECT_OBJECT",
      outcome: "SUCCESS",
      value: {
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        checksumSha256: checksumHex,
        byteSize: 12,
        mimeType: "image/jpeg",
        revisionToken: "68b329da9893e34099c7d8ad5cb9c940",
        versionId: "version-1",
      },
    });
  });

  test("classifies an unsupported stored content type as a deterministic mismatch", async () => {
    const { adapter } = createHarness([
      {
        ChecksumSHA256: checksumBase64,
        ContentLength: 12,
        ContentType: "text/html",
        ETag: '"68b329da9893e34099c7d8ad5cb9c940"',
      },
    ]);

    await expect(
      adapter.inspectObject({
        schemaVersion: 1,
        operation: "INSPECT_OBJECT",
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
      }),
    ).resolves.toMatchObject({
      operation: "INSPECT_OBJECT",
      outcome: "FAILURE",
      error: { code: "CONTENT_MISMATCH", recovery: "NONE" },
    });
  });

  test("fails closed on malformed commands and normalizes supplier failures", async () => {
    const malformed = createHarness().adapter;
    await expect(
      malformed.inspectObject({
        schemaVersion: 2,
        operation: "INSPECT_OBJECT",
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        providerResponse: "forbidden",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "INSPECT_OBJECT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "INVALID_COMMAND",
        recovery: "NONE",
      },
    });

    const canary = "RAW_S3_ERROR_MUST_NOT_ESCAPE";
    const adapter = createS3MediaStorageAdapterForTesting(
      {
        schemaVersion: 1,
        sourceBucket: "private-source",
        derivativeBucket: "private-derivatives",
        publicMediaOrigin: "https://media.example.invalid",
        maxUploadBytes: 1_024,
      },
      {
        now: () => now,
        presign: async () => {
          throw new Error(canary);
        },
        send: async () => {
          throw new Error(canary);
        },
      },
    );
    const failure = await adapter.inspectObject({
      schemaVersion: 1,
      operation: "INSPECT_OBJECT",
      storageClass: "SOURCE",
      objectKey: "source/asset-1/original.jpg",
    });
    expect(failure).toEqual({
      schemaVersion: 1,
      operation: "INSPECT_OBJECT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "UNEXPECTED_ADAPTER_FAILURE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
      },
    });
    expect(JSON.stringify(failure)).not.toContain(canary);
  });

  test.each(
    providerFailureOperations.flatMap((operation) =>
      hostileProviderErrors.map(
        ({ label, create }) => [operation, label, create] as const,
      ),
    ),
  )(
    "returns a stable %s failure when the provider rejects with %s",
    async (operation, _errorLabel, createError) => {
      const { reason, verifyNoUnsafeRead } = createError();
      let sendCalls = 0;
      const adapter = createS3MediaStorageAdapterForTesting(
        {
          schemaVersion: 1,
          sourceBucket: "private-source",
          derivativeBucket: "private-derivatives",
          publicMediaOrigin: "https://media.example.invalid",
          maxUploadBytes: 1_024,
        },
        {
          now: () => now,
          presign: async () => Promise.reject(reason),
          send: async () => {
            sendCalls += 1;
            if (operation === "DELETE_OBJECT" && sendCalls === 1) {
              return {
                ChecksumSHA256: checksumBase64,
                ContentLength: 12,
                ContentType: "image/jpeg",
                ETag: '"68b329da9893e34099c7d8ad5cb9c940"',
              };
            }
            return Promise.reject(reason);
          },
        },
      );
      const result = await (operation === "INSPECT_OBJECT"
        ? adapter.inspectObject({
            schemaVersion: 1,
            operation,
            storageClass: "SOURCE",
            objectKey: "source/asset-1/original.jpg",
          })
        : operation === "CREATE_UPLOAD_GRANT"
          ? adapter.createUploadGrant({
              schemaVersion: 1,
              operation,
              storageClass: "SOURCE",
              objectKey: "source/asset-1/original.jpg",
              checksumSha256: checksumHex,
              byteSize: 12,
              mimeType: "image/jpeg",
              expiresAt: "2026-09-03T12:05:00.000Z",
            })
          : operation === "CREATE_DOWNLOAD_GRANT"
            ? adapter.createDownloadGrant({
                schemaVersion: 1,
                operation,
                storageClass: "SOURCE",
                objectKey: "source/asset-1/original.jpg",
                expiresAt: "2026-09-03T12:05:00.000Z",
              })
            : adapter.deleteObject({
                schemaVersion: 1,
                operation,
                storageClass: "SOURCE",
                objectKey: "source/asset-1/original.jpg",
                expectedChecksumSha256: checksumHex,
                expectedRevisionToken: "68b329da9893e34099c7d8ad5cb9c940",
              }));

      expect(result).toEqual({
        schemaVersion: 1,
        operation,
        outcome: "FAILURE",
        error: {
          schemaVersion: 1,
          code: "UNEXPECTED_ADAPTER_FAILURE",
          recovery: "RETRY_SAME_COMMAND",
          retryAfterMs: 1_000,
        },
      });
      expect(mediaPortResponseSchema.safeParse(result).success).toBe(true);
      verifyNoUnsafeRead();
    },
  );

  test.each([
    ["NoSuchBucket", "CONFIGURATION_ERROR"],
    ["PermanentRedirect", "CONFIGURATION_ERROR"],
    ["AuthorizationHeaderMalformed", "CONFIGURATION_ERROR"],
    ["CredentialsProviderError", "CONFIGURATION_ERROR"],
    ["RequestTimeTooSkewed", "CONFIGURATION_ERROR"],
    ["RequestExpired", "CONFIGURATION_ERROR"],
    ["InvalidRequest", "CONFIGURATION_ERROR"],
    ["InvalidAccessKeyId", "ACCESS_DENIED"],
    ["SignatureDoesNotMatch", "ACCESS_DENIED"],
    ["ExpiredToken", "ACCESS_DENIED"],
    ["InvalidToken", "ACCESS_DENIED"],
  ] as const)(
    "normalizes deterministic S3 failure %s without retrying",
    async (supplierErrorName, expectedCode) => {
      const adapter = createS3MediaStorageAdapterForTesting(
        {
          schemaVersion: 1,
          sourceBucket: "private-source",
          derivativeBucket: "private-derivatives",
          publicMediaOrigin: "https://media.example.invalid",
          maxUploadBytes: 1_024,
        },
        {
          now: () => now,
          presign: async () => "https://uploads.example.invalid/signed",
          send: async () => {
            const error = new Error("supplier detail");
            error.name = supplierErrorName;
            throw error;
          },
        },
      );

      await expect(
        adapter.inspectObject({
          schemaVersion: 1,
          operation: "INSPECT_OBJECT",
          storageClass: "SOURCE",
          objectKey: "source/asset-1/original.jpg",
        }),
      ).resolves.toMatchObject({
        outcome: "FAILURE",
        error: { code: expectedCode, recovery: "NONE" },
      });
    },
  );

  test("only resolves derivative objects through the injected public origin", async () => {
    const { adapter } = createHarness();

    await expect(
      adapter.resolvePublicUrl({
        schemaVersion: 1,
        operation: "RESOLVE_PUBLIC_URL",
        storageClass: "DERIVATIVE",
        objectKey: "derivatives/asset-1/hero.webp",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "RESOLVE_PUBLIC_URL",
      outcome: "SUCCESS",
      value: {
        storageClass: "DERIVATIVE",
        objectKey: "derivatives/asset-1/hero.webp",
        url: "https://media.example.invalid/derivatives/asset-1/hero.webp",
      },
    });
  });

  test("presigns private downloads and deletes only the inspected object version", async () => {
    const { adapter, commands, presignCalls } = createHarness([
      {
        ChecksumSHA256: checksumBase64,
        ContentLength: 12,
        ContentType: "image/jpeg",
        ETag: '"68b329da9893e34099c7d8ad5cb9c940"',
        VersionId: "version-1",
      },
      {},
    ]);

    await expect(
      adapter.createDownloadGrant({
        schemaVersion: 1,
        operation: "CREATE_DOWNLOAD_GRANT",
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        expiresAt: "2026-09-03T12:05:00.000Z",
      }),
    ).resolves.toMatchObject({
      operation: "CREATE_DOWNLOAD_GRANT",
      outcome: "SUCCESS",
      value: { method: "GET", headers: {} },
    });
    expect(JSON.stringify(presignCalls[0])).toContain("private-source");

    const deleteObject = adapter.deleteObject;
    await expect(
      deleteObject({
        schemaVersion: 1,
        operation: "DELETE_OBJECT",
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        expectedChecksumSha256: checksumHex,
        expectedRevisionToken: "68b329da9893e34099c7d8ad5cb9c940",
        expectedVersionId: "version-1",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "DELETE_OBJECT",
      outcome: "SUCCESS",
      value: {
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        checksumSha256: checksumHex,
        revisionToken: "68b329da9893e34099c7d8ad5cb9c940",
        versionId: "version-1",
        deleted: true,
      },
    });
    expect(commands).toHaveLength(2);
    expect(JSON.stringify(commands[0])).toContain('"VersionId":"version-1"');
    expect(JSON.stringify(commands[1])).toContain('"VersionId":"version-1"');
    expect(JSON.stringify(commands[1])).toContain(
      '"IfMatch":"\\"68b329da9893e34099c7d8ad5cb9c940\\""',
    );
  });

  test("replays a versioned delete after an older version becomes current", async () => {
    const commands: unknown[] = [];
    let targetVersionDeleted = false;
    const adapter = createS3MediaStorageAdapterForTesting(
      {
        schemaVersion: 1,
        sourceBucket: "private-source",
        derivativeBucket: "private-derivatives",
        publicMediaOrigin: "https://media.example.invalid",
        maxUploadBytes: 1_024,
      },
      {
        now: () => now,
        presign: async () => "https://uploads.example.invalid/signed",
        send: async (command) => {
          commands.push(command);
          const input = (
            command as Readonly<{
              input?: Readonly<Record<string, unknown>>;
            }>
          ).input;
          if (input?.["ChecksumMode"] === "ENABLED") {
            if (!targetVersionDeleted) {
              return {
                ChecksumSHA256: checksumBase64,
                ContentLength: 12,
                ContentType: "image/jpeg",
                ETag: '"68b329da9893e34099c7d8ad5cb9c940"',
                VersionId: "version-2",
              };
            }
            if (input["VersionId"] === "version-2") {
              const error = new Error("target version is already absent");
              error.name = "NoSuchVersion";
              throw error;
            }
            return {
              ChecksumSHA256: Buffer.from("b".repeat(64), "hex").toString(
                "base64",
              ),
              ContentLength: 9,
              ContentType: "image/jpeg",
              ETag: '"11111111111111111111111111111111"',
              VersionId: "version-1",
            };
          }
          targetVersionDeleted = true;
          return {};
        },
      },
    );
    const command = {
      schemaVersion: 1,
      operation: "DELETE_OBJECT",
      storageClass: "SOURCE",
      objectKey: "source/asset-1/original.jpg",
      expectedChecksumSha256: checksumHex,
      expectedRevisionToken: "68b329da9893e34099c7d8ad5cb9c940",
      expectedVersionId: "version-2",
    } as const;

    await expect(adapter.deleteObject(command)).resolves.toMatchObject({
      outcome: "SUCCESS",
      value: { versionId: "version-2", deleted: true },
    });
    await expect(adapter.deleteObject(command)).resolves.toMatchObject({
      outcome: "SUCCESS",
      value: { versionId: "version-2", deleted: true },
    });
    expect(commands).toHaveLength(3);
  });

  test("does not delete when the current checksum no longer matches", async () => {
    const { adapter, commands } = createHarness([
      {
        ChecksumSHA256: checksumBase64,
        ContentLength: 12,
        ContentType: "image/jpeg",
        ETag: '"68b329da9893e34099c7d8ad5cb9c940"',
      },
    ]);

    await expect(
      adapter.deleteObject({
        schemaVersion: 1,
        operation: "DELETE_OBJECT",
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        expectedChecksumSha256: "b".repeat(64),
        expectedRevisionToken: "68b329da9893e34099c7d8ad5cb9c940",
      }),
    ).resolves.toMatchObject({
      operation: "DELETE_OBJECT",
      outcome: "FAILURE",
      error: { code: "PRECONDITION_FAILED", recovery: "NONE" },
    });
    expect(commands).toHaveLength(1);
  });

  test("treats an already-absent object as a successful delete replay", async () => {
    const commands: unknown[] = [];
    const adapter = createS3MediaStorageAdapterForTesting(
      {
        schemaVersion: 1,
        sourceBucket: "private-source",
        derivativeBucket: "private-derivatives",
        publicMediaOrigin: "https://media.example.invalid",
        maxUploadBytes: 1_024,
      },
      {
        now: () => now,
        presign: async () => "https://uploads.example.invalid/signed",
        send: async (command) => {
          commands.push(command);
          const error = new Error("supplier detail");
          error.name = "NoSuchKey";
          throw error;
        },
      },
    );

    await expect(
      adapter.deleteObject({
        schemaVersion: 1,
        operation: "DELETE_OBJECT",
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        expectedChecksumSha256: checksumHex,
        expectedRevisionToken: "68b329da9893e34099c7d8ad5cb9c940",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "DELETE_OBJECT",
      outcome: "SUCCESS",
      value: {
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        checksumSha256: checksumHex,
        revisionToken: "68b329da9893e34099c7d8ad5cb9c940",
        deleted: true,
      },
    });
    expect(commands).toHaveLength(1);
  });

  test("treats a concurrent delete after inspection as a successful replay", async () => {
    const commands: unknown[] = [];
    const adapter = createS3MediaStorageAdapterForTesting(
      {
        schemaVersion: 1,
        sourceBucket: "private-source",
        derivativeBucket: "private-derivatives",
        publicMediaOrigin: "https://media.example.invalid",
        maxUploadBytes: 1_024,
      },
      {
        now: () => now,
        presign: async () => "https://uploads.example.invalid/signed",
        send: async (command) => {
          commands.push(command);
          if (commands.length === 1) {
            return {
              ChecksumSHA256: checksumBase64,
              ContentLength: 12,
              ContentType: "image/jpeg",
              ETag: '"68b329da9893e34099c7d8ad5cb9c940"',
            };
          }
          const error = new Error("supplier detail");
          error.name = "NoSuchKey";
          throw error;
        },
      },
    );

    await expect(
      adapter.deleteObject({
        schemaVersion: 1,
        operation: "DELETE_OBJECT",
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        expectedChecksumSha256: checksumHex,
        expectedRevisionToken: "68b329da9893e34099c7d8ad5cb9c940",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "DELETE_OBJECT",
      outcome: "SUCCESS",
      value: {
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        checksumSha256: checksumHex,
        revisionToken: "68b329da9893e34099c7d8ad5cb9c940",
        deleted: true,
      },
    });
    expect(commands).toHaveLength(2);
  });

  test("fails closed before S3 when bucket configuration is not canonical or isolated", async () => {
    const commands: unknown[] = [];
    const adapter = createS3MediaStorageAdapterForTesting(
      {
        schemaVersion: 1,
        sourceBucket: " shared-media ",
        derivativeBucket: " shared-media ",
        publicMediaOrigin: "https://media.example.invalid",
        maxUploadBytes: 1_024,
      },
      {
        now: () => now,
        presign: async () => "https://uploads.example.invalid/signed",
        send: async (command) => {
          commands.push(command);
          return {};
        },
      },
    );

    await expect(
      adapter.inspectObject({
        schemaVersion: 1,
        operation: "INSPECT_OBJECT",
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "INSPECT_OBJECT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "CONFIGURATION_ERROR",
        recovery: "NONE",
      },
    });
    expect(commands).toHaveLength(0);
  });

  test("rejects a public media origin with a path prefix", async () => {
    const commands: unknown[] = [];
    const adapter = createS3MediaStorageAdapterForTesting(
      {
        schemaVersion: 1,
        sourceBucket: "private-source",
        derivativeBucket: "private-derivatives",
        publicMediaOrigin: "https://media.example.invalid/prefix",
        maxUploadBytes: 1_024,
      },
      {
        now: () => now,
        presign: async () => "https://uploads.example.invalid/signed",
        send: async (command) => {
          commands.push(command);
          return {};
        },
      },
    );

    await expect(
      adapter.resolvePublicUrl({
        schemaVersion: 1,
        operation: "RESOLVE_PUBLIC_URL",
        storageClass: "DERIVATIVE",
        objectKey: "derivatives/asset-1/hero.webp",
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
    expect(commands).toHaveLength(0);
  });

  test.each([
    "https://localhost",
    "https://localhost:7444",
    "https://media.localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.0.1",
    "https://169.254.1.1",
    "https://100.64.0.1",
    "https://198.18.0.1",
    "https://224.0.0.1",
    "https://[::1]",
    "https://[fc00::1]",
    "https://[fe80::1]",
    "https://[ff02::1]",
    "https://[2001:db8::1]",
  ] as const)(
    "rejects non-public media origin %s before resolving a URL",
    async (publicMediaOrigin) => {
      const commands: unknown[] = [];
      const adapter = createS3MediaStorageAdapterForTesting(
        {
          schemaVersion: 1,
          sourceBucket: "private-source",
          derivativeBucket: "private-derivatives",
          publicMediaOrigin,
          maxUploadBytes: 1_024,
        },
        {
          now: () => now,
          presign: async () => "https://uploads.example.invalid/signed",
          send: async (command) => {
            commands.push(command);
            return {};
          },
        },
      );

      await expect(
        adapter.resolvePublicUrl({
          schemaVersion: 1,
          operation: "RESOLVE_PUBLIC_URL",
          storageClass: "DERIVATIVE",
          objectKey: "derivatives/asset-1/hero.webp",
        }),
      ).resolves.toMatchObject({
        outcome: "FAILURE",
        error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
      });
      expect(commands).toHaveLength(0);
    },
  );

  test("allows the fixed preview origin only through an explicit adapter flag", async () => {
    const adapter = createS3MediaStorageAdapterForTesting(
      {
        schemaVersion: 1,
        sourceBucket: "private-source",
        derivativeBucket: "private-derivatives",
        publicMediaOrigin: "https://localhost:7444",
        allowPreviewLoopbackPublicOrigin: true,
        maxUploadBytes: 1_024,
      },
      {
        now: () => now,
        presign: async () => "https://uploads.example.invalid/signed",
        send: async () => ({}),
      },
    );

    await expect(
      adapter.resolvePublicUrl({
        schemaVersion: 1,
        operation: "RESOLVE_PUBLIC_URL",
        storageClass: "DERIVATIVE",
        objectKey: "derivatives/asset-1/hero.webp",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "RESOLVE_PUBLIC_URL",
      outcome: "SUCCESS",
      value: {
        storageClass: "DERIVATIVE",
        objectKey: "derivatives/asset-1/hero.webp",
        url: "https://localhost:7444/derivatives/asset-1/hero.webp",
      },
    });
  });

  test("fails closed on invalid production connection configuration", async () => {
    const adapter = createS3MediaStorageAdapter({
      schemaVersion: 1,
      sourceBucket: "private-source",
      derivativeBucket: "private-derivatives",
      publicMediaOrigin: "https://media.example.invalid",
      maxUploadBytes: 1_024,
      region: "",
      authentication: { mode: "ambient" },
    });
    const command = mediaPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      storageClass: "SOURCE",
      objectKey: "source/asset-1/original.jpg",
      checksumSha256: checksumHex,
      byteSize: 12,
      mimeType: "image/jpeg",
      expiresAt: "2026-09-03T12:05:00.000Z",
    });
    if (command.operation !== "CREATE_UPLOAD_GRANT") {
      throw new Error("fixture command mismatch");
    }

    await expect(adapter.createUploadGrant(command)).resolves.toMatchObject({
      operation: "CREATE_UPLOAD_GRANT",
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
  });

  test("rejects HTTP object-storage endpoints before creating an HTTPS grant", async () => {
    const adapter = createS3MediaStorageAdapter({
      schemaVersion: 1,
      sourceBucket: "private-source",
      derivativeBucket: "private-derivatives",
      publicMediaOrigin: "https://media.example.invalid",
      maxUploadBytes: 1_024,
      region: "us-east-1",
      authentication: {
        mode: "static",
        endpoint: "http://127.0.0.1:9000",
        presignEndpoint: "https://uploads.example.invalid",
        accessKeyId: "local-access-key",
        secretAccessKey: "local-secret-access-key",
        forcePathStyle: true,
      },
    });
    const command = mediaPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      storageClass: "SOURCE",
      objectKey: "source/asset-1/original.jpg",
      checksumSha256: checksumHex,
      byteSize: 12,
      mimeType: "image/jpeg",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (command.operation !== "CREATE_UPLOAD_GRANT") {
      throw new Error("fixture command mismatch");
    }

    await expect(adapter.createUploadGrant(command)).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
  });

  test("rejects an HTTP browser presign endpoint before creating a grant", async () => {
    const adapter = createS3MediaStorageAdapter({
      schemaVersion: 1,
      sourceBucket: "private-source",
      derivativeBucket: "private-derivatives",
      publicMediaOrigin: "https://media.example.invalid",
      maxUploadBytes: 1_024,
      region: "us-east-1",
      authentication: {
        mode: "static",
        endpoint: "https://service.example.invalid",
        presignEndpoint: "http://127.0.0.1:9000",
        accessKeyId: "local-access-key",
        secretAccessKey: "local-secret-access-key",
        forcePathStyle: true,
      },
    });
    const command = mediaPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      storageClass: "SOURCE",
      objectKey: "source/asset-1/original.jpg",
      checksumSha256: checksumHex,
      byteSize: 12,
      mimeType: "image/jpeg",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (command.operation !== "CREATE_UPLOAD_GRANT") {
      throw new Error("fixture command mismatch");
    }

    await expect(adapter.createUploadGrant(command)).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
  });

  test("signs browser grants with the public presign endpoint instead of the service endpoint", async () => {
    const adapter = createS3MediaStorageAdapter({
      schemaVersion: 1,
      sourceBucket: "private-source",
      derivativeBucket: "private-derivatives",
      publicMediaOrigin: "https://media.example.invalid",
      maxUploadBytes: 1_024,
      region: "us-east-1",
      authentication: {
        mode: "static",
        endpoint: "https://service.example.invalid",
        presignEndpoint: "https://uploads.example.invalid",
        accessKeyId: "local-access-key",
        secretAccessKey: "local-secret-access-key",
        forcePathStyle: true,
      },
    });
    const command = mediaPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      storageClass: "SOURCE",
      objectKey: "source/asset-1/original.jpg",
      checksumSha256: checksumHex,
      byteSize: 12,
      mimeType: "image/jpeg",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (command.operation !== "CREATE_UPLOAD_GRANT") {
      throw new Error("fixture command mismatch");
    }

    const result = await adapter.createUploadGrant(command);
    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") {
      throw new Error("expected a signed upload grant");
    }
    const signedUrl = new URL(result.value.url);
    expect(signedUrl.origin).toBe("https://uploads.example.invalid");
    expect(signedUrl.pathname).toBe(
      "/private-source/source/asset-1/original.jpg",
    );
    expect(signedUrl.searchParams.get("X-Amz-SignedHeaders")).toContain("host");
  });

  test("snapshots boundary configuration and dependency functions at construction", async () => {
    const buckets: string[] = [];
    const inspectedBuckets: string[] = [];
    let replacementCalls = 0;
    const config = {
      schemaVersion: 1 as const,
      sourceBucket: "private-source",
      derivativeBucket: "private-derivatives",
      publicMediaOrigin: "https://media.example.invalid",
      maxUploadBytes: 1_024,
    };
    const dependencies = {
      now: () => now,
      send: async (command: unknown) => {
        const input = (
          command as Readonly<{
            input?: Readonly<Record<string, unknown>>;
          }>
        ).input;
        if (typeof input?.["Bucket"] === "string") {
          inspectedBuckets.push(input["Bucket"]);
        }
        return {};
      },
      presign: async (command: unknown) => {
        const input = (
          command as Readonly<{
            input?: Readonly<Record<string, unknown>>;
          }>
        ).input;
        if (typeof input?.["Bucket"] === "string") {
          buckets.push(input["Bucket"]);
        }
        return "https://uploads.example.invalid/signed";
      },
    };
    const adapter = createS3MediaStorageAdapterForTesting(config, dependencies);

    config.sourceBucket = "mutated-source";
    config.derivativeBucket = "mutated-derivatives";
    config.maxUploadBytes = 1;
    dependencies.now = () => new Date("2026-09-03T14:00:00.000Z");
    dependencies.send = async () => {
      replacementCalls += 1;
      return {};
    };
    dependencies.presign = async () => {
      replacementCalls += 1;
      return "https://mutated.example.invalid/signed";
    };

    for (const storageClass of ["SOURCE", "DERIVATIVE"] as const) {
      await expect(
        adapter.createUploadGrant({
          schemaVersion: 1,
          operation: "CREATE_UPLOAD_GRANT",
          storageClass,
          objectKey:
            storageClass === "SOURCE"
              ? "source/asset-1/original.jpg"
              : "derivatives/asset-1/hero.webp",
          checksumSha256: checksumHex,
          byteSize: 12,
          mimeType: "image/jpeg",
          expiresAt: "2026-09-03T12:05:00.000Z",
        }),
      ).resolves.toMatchObject({ outcome: "SUCCESS" });
    }

    await expect(
      adapter.inspectObject({
        schemaVersion: 1,
        operation: "INSPECT_OBJECT",
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONTENT_MISMATCH", recovery: "NONE" },
    });

    expect(buckets).toEqual(["private-source", "private-derivatives"]);
    expect(inspectedBuckets).toEqual(["private-source"]);
    expect(replacementCalls).toBe(0);
  });

  test("rejects a root accessor without invoking it", async () => {
    let reads = 0;
    const config = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(config, {
      schemaVersion: {
        enumerable: true,
        get() {
          reads += 1;
          return 1;
        },
      },
      sourceBucket: { enumerable: true, value: "private-source" },
      derivativeBucket: {
        enumerable: true,
        value: "private-derivatives",
      },
      publicMediaOrigin: {
        enumerable: true,
        value: "https://media.example.invalid",
      },
      maxUploadBytes: { enumerable: true, value: 1_024 },
    });

    const adapter = createS3MediaStorageAdapterForTesting(config as never, {
      now: () => now,
      send: async () => ({}),
      presign: async () => "https://uploads.example.invalid/signed",
    });

    expect(reads).toBe(0);
    await expect(
      adapter.resolvePublicUrl({
        schemaVersion: 1,
        operation: "RESOLVE_PUBLIC_URL",
        storageClass: "DERIVATIVE",
        objectKey: "derivatives/asset-1/hero.webp",
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
    expect(reads).toBe(0);
  });

  test("rejects unknown, symbol, and inherited root configuration", async () => {
    const baseConfig = {
      schemaVersion: 1,
      sourceBucket: "private-source",
      derivativeBucket: "private-derivatives",
      publicMediaOrigin: "https://media.example.invalid",
      maxUploadBytes: 1_024,
    };
    const withSymbol = { ...baseConfig };
    Object.defineProperty(withSymbol, Symbol("unexpected"), {
      enumerable: true,
      value: true,
    });
    const withCustomPrototype = Object.assign(
      Object.create({ inherited: true }) as Record<string, unknown>,
      baseConfig,
    );

    for (const config of [
      { ...baseConfig, unexpected: true },
      withSymbol,
      withCustomPrototype,
    ]) {
      const adapter = createS3MediaStorageAdapterForTesting(config as never, {
        now: () => now,
        send: async () => ({}),
        presign: async () => "https://uploads.example.invalid/signed",
      });
      await expect(
        adapter.resolvePublicUrl({
          schemaVersion: 1,
          operation: "RESOLVE_PUBLIC_URL",
          storageClass: "DERIVATIVE",
          objectKey: "derivatives/asset-1/hero.webp",
        }),
      ).resolves.toMatchObject({
        outcome: "FAILURE",
        error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
      });
    }
  });

  test("accepts exact null-prototype configuration objects", async () => {
    const boundaryConfig = Object.assign(
      Object.create(null) as Record<string, unknown>,
      {
        schemaVersion: 1,
        sourceBucket: "private-source",
        derivativeBucket: "private-derivatives",
        publicMediaOrigin: "https://media.example.invalid",
        maxUploadBytes: 1_024,
      },
    );
    const testingAdapter = createS3MediaStorageAdapterForTesting(
      boundaryConfig as never,
      {
        now: () => now,
        send: async () => ({}),
        presign: async () => "https://uploads.example.invalid/signed",
      },
    );
    await expect(
      testingAdapter.resolvePublicUrl({
        schemaVersion: 1,
        operation: "RESOLVE_PUBLIC_URL",
        storageClass: "DERIVATIVE",
        objectKey: "derivatives/asset-1/hero.webp",
      }),
    ).resolves.toMatchObject({ outcome: "SUCCESS" });

    const authentication = Object.assign(
      Object.create(null) as Record<string, unknown>,
      { mode: "ambient" },
    );
    const productionConfig = Object.assign(
      Object.create(null) as Record<string, unknown>,
      boundaryConfig,
      { region: "us-east-1", authentication },
    );
    const productionAdapter = createS3MediaStorageAdapter(
      productionConfig as never,
    );
    const command = mediaPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "RESOLVE_PUBLIC_URL",
      storageClass: "DERIVATIVE",
      objectKey: "derivatives/asset-1/hero.webp",
    });
    if (command.operation !== "RESOLVE_PUBLIC_URL") {
      throw new Error("fixture command mismatch");
    }
    await expect(
      productionAdapter.resolvePublicUrl(command),
    ).resolves.toMatchObject({ outcome: "SUCCESS" });
  });

  test("rejects production authentication accessors without invoking them", async () => {
    let reads = 0;
    const authentication = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(authentication, "mode", {
      enumerable: true,
      get() {
        reads += 1;
        return "ambient";
      },
    });

    const adapter = createS3MediaStorageAdapter({
      schemaVersion: 1,
      sourceBucket: "private-source",
      derivativeBucket: "private-derivatives",
      publicMediaOrigin: "https://media.example.invalid",
      maxUploadBytes: 1_024,
      region: "us-east-1",
      authentication,
    } as never);

    expect(reads).toBe(0);
    const command = mediaPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "RESOLVE_PUBLIC_URL",
      storageClass: "DERIVATIVE",
      objectKey: "derivatives/asset-1/hero.webp",
    });
    if (command.operation !== "RESOLVE_PUBLIC_URL") {
      throw new Error("fixture command mismatch");
    }
    await expect(adapter.resolvePublicUrl(command)).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
    expect(reads).toBe(0);
  });

  test("requires exact plain production authentication configuration", async () => {
    const ambient = { mode: "ambient" as const };
    const withSymbol = { ...ambient };
    Object.defineProperty(withSymbol, Symbol("unexpected"), {
      enumerable: true,
      value: true,
    });
    const withCustomPrototype = Object.assign(
      Object.create({ inherited: true }) as Record<string, unknown>,
      ambient,
    );
    const command = mediaPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "RESOLVE_PUBLIC_URL",
      storageClass: "DERIVATIVE",
      objectKey: "derivatives/asset-1/hero.webp",
    });
    if (command.operation !== "RESOLVE_PUBLIC_URL") {
      throw new Error("fixture command mismatch");
    }

    for (const authentication of [
      { ...ambient, unexpected: true },
      {
        mode: "static",
        endpoint: "https://service.example.invalid",
        presignEndpoint: "https://uploads.example.invalid",
        accessKeyId: "local-access-key",
        secretAccessKey: "local-secret-access-key",
        forcePathStyle: true,
        unexpected: true,
      },
      withSymbol,
      withCustomPrototype,
    ]) {
      const adapter = createS3MediaStorageAdapter({
        schemaVersion: 1,
        sourceBucket: "private-source",
        derivativeBucket: "private-derivatives",
        publicMediaOrigin: "https://media.example.invalid",
        maxUploadBytes: 1_024,
        region: "us-east-1",
        authentication,
      } as never);
      await expect(adapter.resolvePublicUrl(command)).resolves.toMatchObject({
        outcome: "FAILURE",
        error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
      });
    }
  });

  test("snapshots nested static authentication before constructing SDK clients", async () => {
    const authentication = {
      mode: "static" as const,
      endpoint: "https://service.example.invalid",
      presignEndpoint: "https://uploads.example.invalid",
      accessKeyId: "local-access-key",
      secretAccessKey: "local-secret-access-key",
      forcePathStyle: true,
    };
    const adapter = createS3MediaStorageAdapter({
      schemaVersion: 1,
      sourceBucket: "private-source",
      derivativeBucket: "private-derivatives",
      publicMediaOrigin: "https://media.example.invalid",
      maxUploadBytes: 1_024,
      region: "us-east-1",
      authentication,
    });

    authentication.endpoint = "https://mutated-service.example.invalid";
    authentication.presignEndpoint = "https://mutated-upload.example.invalid";
    authentication.accessKeyId = "mutated-access-key";
    authentication.secretAccessKey = "mutated-secret-access-key";
    authentication.forcePathStyle = false;

    const command = mediaPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      storageClass: "SOURCE",
      objectKey: "source/asset-1/original.jpg",
      checksumSha256: checksumHex,
      byteSize: 12,
      mimeType: "image/jpeg",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (command.operation !== "CREATE_UPLOAD_GRANT") {
      throw new Error("fixture command mismatch");
    }
    const result = await adapter.createUploadGrant(command);
    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") {
      throw new Error("expected a signed upload grant");
    }
    const signedUrl = new URL(result.value.url);
    expect(signedUrl.origin).toBe("https://uploads.example.invalid");
    expect(signedUrl.searchParams.get("X-Amz-Credential")).toContain(
      "local-access-key/",
    );
  });

  test("fails closed without constructing S3 for structurally invalid runtime config", async () => {
    expect(() =>
      createS3MediaStorageAdapter({
        schemaVersion: 1,
        sourceBucket: "private-source",
        derivativeBucket: "private-derivatives",
        publicMediaOrigin: "https://media.example.invalid",
        maxUploadBytes: undefined,
        region: undefined,
        authentication: undefined,
      } as never),
    ).not.toThrow();

    const adapter = createS3MediaStorageAdapter({
      schemaVersion: 1,
      sourceBucket: "private-source",
      derivativeBucket: "private-derivatives",
      publicMediaOrigin: "https://media.example.invalid",
      maxUploadBytes: undefined,
      region: undefined,
      authentication: undefined,
    } as never);
    const command = mediaPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "INSPECT_OBJECT",
      storageClass: "SOURCE",
      objectKey: "source/asset-1/original.jpg",
    });
    if (command.operation !== "INSPECT_OBJECT") {
      throw new Error("fixture command mismatch");
    }
    await expect(adapter.inspectObject(command)).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
  });
});

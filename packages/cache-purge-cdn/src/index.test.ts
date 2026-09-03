import { describe, expect, test } from "vitest";

import { cachePurgePortResponseSchema } from "@fan-support/cache-purge-port";
import {
  deterministicPortFixtures,
  runCachePurgeConformance,
} from "@fan-support/testing";

import {
  createCloudFrontCachePurgeAdapterForTesting,
  type CloudFrontCachePurgeDependencies,
} from "./adapter.js";

const now = new Date("2026-09-03T12:00:00.000Z");

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
          return "NoSuchDistribution";
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
      reason: Object.create({ name: "NoSuchDistribution" }),
      verifyNoUnsafeRead: () => undefined,
    }),
  },
  {
    label: "a revoked proxy",
    create: () => {
      const revocable = Proxy.revocable({ name: "NoSuchDistribution" }, {});
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
        { name: "NoSuchDistribution" },
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

const providerFailureOperations = ["SUBMIT_PURGE", "GET_PURGE_STATUS"] as const;

function createHarness(responses: readonly unknown[] = []) {
  const commands: unknown[] = [];
  const pendingResponses = [...responses];
  const dependencies: CloudFrontCachePurgeDependencies = {
    send: async (command) => {
      commands.push(command);
      const response = pendingResponses.shift() ?? {};
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  };
  return {
    adapter: createCloudFrontCachePurgeAdapterForTesting(
      {
        schemaVersion: 1,
        region: "us-east-1",
        distributionId: "distribution-1",
      },
      dependencies,
    ),
    commands,
  };
}

describe("CloudFront cache purge adapter", () => {
  test("passes the shared cache-purge conformance suite", async () => {
    const conflict = new Error("provider detail");
    conflict.name = "InvalidationBatchAlreadyExists";
    const { adapter } = createHarness([
      {
        Invalidation: {
          Id: "fixture-purge/0001",
          Status: "InProgress",
          CreateTime: now,
        },
      },
      {
        Invalidation: {
          Id: "fixture-purge/0001",
          Status: "InProgress",
          CreateTime: now,
        },
      },
      conflict,
      {
        Invalidation: {
          Id: "fixture-purge/0001",
          Status: "Completed",
          CreateTime: now,
        },
      },
    ]);

    const report = await runCachePurgeConformance(
      adapter,
      deterministicPortFixtures.cachePurge,
    );

    expect(report.passed).toBe(true);
    expect(report.cases).toHaveLength(4);
  });

  test("fails closed when CloudFront returns a different invalidation ID", async () => {
    const { adapter } = createHarness([
      {
        Invalidation: {
          Id: "wrong-invalidation",
          Status: "Completed",
          CreateTime: now,
        },
      },
    ]);

    await expect(
      adapter.getPurgeStatus({
        schemaVersion: 1,
        operation: "GET_PURGE_STATUS",
        purgeReference: "requested-invalidation",
      }),
    ).resolves.toMatchObject({
      operation: "GET_PURGE_STATUS",
      outcome: "FAILURE",
    });
  });

  test("submits a canonical idempotent invalidation batch", async () => {
    const { adapter, commands } = createHarness([
      {
        Invalidation: {
          Id: "invalidation-1",
          Status: "InProgress",
          CreateTime: now,
        },
        $metadata: { requestId: "must-not-escape" },
      },
    ]);

    await expect(
      adapter.submitPurge({
        schemaVersion: 1,
        operation: "SUBMIT_PURGE",
        idempotencyKey: "cache-purge:fixture:0001",
        paths: ["/zh-CN/idols/*", "/en/idols/*"],
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "SUBMIT_PURGE",
      outcome: "SUCCESS",
      value: {
        purgeReference: "invalidation-1",
        status: "PENDING",
        submittedAt: "2026-09-03T12:00:00.000Z",
      },
    });
    expect(JSON.stringify(commands[0])).toContain("distribution-1");
    expect(JSON.stringify(commands[0])).toContain(
      '"Items":["/en/idols/*","/zh-CN/idols/*"]',
    );
    expect(JSON.stringify(commands[0])).toContain(
      '"CallerReference":"cache-purge:fixture:0001"',
    );
  });

  test("maps completion status without leaking request metadata", async () => {
    const createdAt = new Date("2026-09-03T11:59:00.000Z");
    const { adapter } = createHarness([
      {
        Invalidation: {
          Id: "invalidation-1",
          Status: "Completed",
          CreateTime: createdAt,
        },
        $metadata: { extendedRequestId: "forbidden" },
      },
    ]);

    const result = await adapter.getPurgeStatus({
      schemaVersion: 1,
      operation: "GET_PURGE_STATUS",
      purgeReference: "invalidation-1",
    });
    expect(result).toEqual({
      schemaVersion: 1,
      operation: "GET_PURGE_STATUS",
      outcome: "SUCCESS",
      value: {
        purgeReference: "invalidation-1",
        status: "COMPLETED",
      },
    });
    expect(JSON.stringify(result)).not.toContain("extendedRequestId");
  });

  test("rejects non-canonical input and returns only allowlisted failures", async () => {
    const { adapter } = createHarness();
    await expect(
      adapter.submitPurge({
        schemaVersion: 2,
        operation: "SUBMIT_PURGE",
        idempotencyKey: "cache-purge:fixture:0001",
        paths: ["https://attacker.invalid/"],
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "SUBMIT_PURGE",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "INVALID_COMMAND",
        recovery: "NONE",
      },
    });
  });

  test.each(["/en/*/idol", "/en/~asset", "/en/%7Easset", "/en/%GG"])(
    "rejects the unsupported CloudFront invalidation path %s before the supplier call",
    async (path) => {
      const commands: unknown[] = [];
      const adapter = createCloudFrontCachePurgeAdapterForTesting(
        {
          schemaVersion: 1,
          region: "us-east-1",
          distributionId: "distribution-1",
        },
        {
          send: async (command) => {
            commands.push(command);
            return {};
          },
        },
      );

      await expect(
        adapter.submitPurge({
          schemaVersion: 1,
          operation: "SUBMIT_PURGE",
          idempotencyKey: "cache-purge:fixture:invalid-path",
          paths: [path],
        }),
      ).resolves.toMatchObject({
        outcome: "FAILURE",
        error: { code: "INVALID_COMMAND", recovery: "NONE" },
      });
      expect(commands).toHaveLength(0);
    },
  );

  test("fails closed before the supplier call when the distribution reference is not canonical", async () => {
    const commands: unknown[] = [];
    const adapter = createCloudFrontCachePurgeAdapterForTesting(
      {
        schemaVersion: 1,
        region: "us-east-1",
        distributionId: " distribution-1 ",
      },
      {
        send: async (command) => {
          commands.push(command);
          return {};
        },
      },
    );

    await expect(
      adapter.getPurgeStatus({
        schemaVersion: 1,
        operation: "GET_PURGE_STATUS",
        purgeReference: "invalidation-1",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "GET_PURGE_STATUS",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "CONFIGURATION_ERROR",
        recovery: "NONE",
      },
    });
    expect(commands).toHaveLength(0);
  });

  test("normalizes throttling without leaking the supplier error", async () => {
    const canary = "RAW_CLOUDFRONT_ERROR_MUST_NOT_ESCAPE";
    const adapter = createCloudFrontCachePurgeAdapterForTesting(
      {
        schemaVersion: 1,
        region: "us-east-1",
        distributionId: "distribution-1",
      },
      {
        send: async () => {
          const error = new Error(canary);
          error.name = "TooManyInvalidationsInProgress";
          throw error;
        },
      },
    );

    const result = await adapter.submitPurge({
      schemaVersion: 1,
      operation: "SUBMIT_PURGE",
      idempotencyKey: "cache-purge:fixture:0001",
      paths: ["/en/idols/*"],
    });
    expect(result).toEqual({
      schemaVersion: 1,
      operation: "SUBMIT_PURGE",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "RATE_LIMITED",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
      },
    });
    expect(JSON.stringify(result)).not.toContain(canary);
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
      const adapter = createCloudFrontCachePurgeAdapterForTesting(
        {
          schemaVersion: 1,
          region: "us-east-1",
          distributionId: "distribution-1",
        },
        {
          send: async () => Promise.reject(reason),
        },
      );
      const result = await (operation === "SUBMIT_PURGE"
        ? adapter.submitPurge({
            schemaVersion: 1,
            operation,
            idempotencyKey: "cache-purge:fixture:hostile-provider-error",
            paths: ["/en/idols/*"],
          })
        : adapter.getPurgeStatus({
            schemaVersion: 1,
            operation,
            purgeReference: "invalidation-1",
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
      expect(cachePurgePortResponseSchema.safeParse(result).success).toBe(true);
      verifyNoUnsafeRead();
    },
  );

  test("treats a missing configured distribution as a non-retryable configuration failure", async () => {
    const adapter = createCloudFrontCachePurgeAdapterForTesting(
      {
        schemaVersion: 1,
        region: "us-east-1",
        distributionId: "distribution-1",
      },
      {
        send: async () => {
          const error = new Error("supplier detail");
          error.name = "NoSuchDistribution";
          throw error;
        },
      },
    );

    await expect(
      adapter.submitPurge({
        schemaVersion: 1,
        operation: "SUBMIT_PURGE",
        idempotencyKey: "cache-purge:fixture:0001",
        paths: ["/en/idols/*"],
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "SUBMIT_PURGE",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "CONFIGURATION_ERROR",
        recovery: "NONE",
      },
    });
  });

  test("treats CloudFront InvalidArgument as a non-retryable configuration failure", async () => {
    const adapter = createCloudFrontCachePurgeAdapterForTesting(
      {
        schemaVersion: 1,
        region: "us-east-1",
        distributionId: "distribution-1",
      },
      {
        send: async () => {
          const error = new Error("supplier detail");
          error.name = "InvalidArgument";
          throw error;
        },
      },
    );

    await expect(
      adapter.submitPurge({
        schemaVersion: 1,
        operation: "SUBMIT_PURGE",
        idempotencyKey: "cache-purge:fixture:0001",
        paths: ["/en/idols/*"],
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
  });

  test.each([
    ["CredentialsProviderError", "CONFIGURATION_ERROR"],
    ["ExpiredToken", "ACCESS_DENIED"],
    ["InvalidClientTokenId", "ACCESS_DENIED"],
    ["SignatureDoesNotMatch", "ACCESS_DENIED"],
  ] as const)(
    "normalizes deterministic CloudFront identity failure %s without retrying",
    async (supplierErrorName, expectedCode) => {
      const adapter = createCloudFrontCachePurgeAdapterForTesting(
        {
          schemaVersion: 1,
          region: "us-east-1",
          distributionId: "distribution-1",
        },
        {
          send: async () => {
            const error = new Error("supplier detail");
            error.name = supplierErrorName;
            throw error;
          },
        },
      );

      await expect(
        adapter.submitPurge({
          schemaVersion: 1,
          operation: "SUBMIT_PURGE",
          idempotencyKey: "cache-purge:fixture:0001",
          paths: ["/en/idols/*"],
        }),
      ).resolves.toMatchObject({
        outcome: "FAILURE",
        error: { code: expectedCode, recovery: "NONE" },
      });
    },
  );

  test("fails closed on structurally invalid CloudFront configuration", async () => {
    const commands: unknown[] = [];
    const adapter = createCloudFrontCachePurgeAdapterForTesting(
      {
        schemaVersion: 1,
        region: undefined,
        distributionId: undefined,
      } as never,
      {
        send: async (command) => {
          commands.push(command);
          return {};
        },
      },
    );

    await expect(
      adapter.getPurgeStatus({
        schemaVersion: 1,
        operation: "GET_PURGE_STATUS",
        purgeReference: "invalidation-1",
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
    expect(commands).toHaveLength(0);
  });

  test("uses an immutable distribution configuration snapshot", async () => {
    const mutableConfig: {
      schemaVersion: 1;
      region: string;
      distributionId: string;
    } = {
      schemaVersion: 1,
      region: "us-east-1",
      distributionId: "APPROVEDDIST",
    };
    const commands: unknown[] = [];
    const adapter = createCloudFrontCachePurgeAdapterForTesting(mutableConfig, {
      send: async (command) => {
        commands.push(command);
        return {
          Invalidation: {
            Id: "invalidation-1",
            Status: "InProgress",
            CreateTime: now,
          },
        };
      },
    });
    mutableConfig.distributionId = "SUBSTITUTEDDIST";

    await expect(
      adapter.submitPurge({
        schemaVersion: 1,
        operation: "SUBMIT_PURGE",
        idempotencyKey: "cache-purge:fixture:immutable-config",
        paths: ["/en/idols/*"],
      }),
    ).resolves.toMatchObject({ outcome: "SUCCESS" });
    expect(JSON.stringify(commands[0])).toContain("APPROVEDDIST");
    expect(JSON.stringify(commands[0])).not.toContain("SUBSTITUTEDDIST");
  });

  test("rejects accessor-backed configuration without reading or calling CloudFront", async () => {
    let distributionReads = 0;
    const config = {
      schemaVersion: 1,
      region: "us-east-1",
    } as Record<string, unknown>;
    Object.defineProperty(config, "distributionId", {
      enumerable: true,
      get() {
        distributionReads += 1;
        return distributionReads === 1 ? "APPROVEDDIST" : "SUBSTITUTEDDIST";
      },
    });
    const commands: unknown[] = [];
    const adapter = createCloudFrontCachePurgeAdapterForTesting(
      config as never,
      {
        send: async (command) => {
          commands.push(command);
          return {};
        },
      },
    );

    await expect(
      adapter.getPurgeStatus({
        schemaVersion: 1,
        operation: "GET_PURGE_STATUS",
        purgeReference: "invalidation-1",
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
    expect(distributionReads).toBe(0);
    expect(commands).toHaveLength(0);
  });

  test.each([
    [
      "an unknown key",
      {
        schemaVersion: 1,
        region: "us-east-1",
        distributionId: "APPROVEDDIST",
        unexpectedOption: true,
      },
    ],
    [
      "a custom prototype",
      Object.assign(Object.create({ inheritedOption: true }), {
        schemaVersion: 1,
        region: "us-east-1",
        distributionId: "APPROVEDDIST",
      }),
    ],
  ])("rejects configuration with %s", async (_caseName, config) => {
    const commands: unknown[] = [];
    const adapter = createCloudFrontCachePurgeAdapterForTesting(
      config as never,
      {
        send: async (command) => {
          commands.push(command);
          return {};
        },
      },
    );

    await expect(
      adapter.getPurgeStatus({
        schemaVersion: 1,
        operation: "GET_PURGE_STATUS",
        purgeReference: "invalidation-1",
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
    expect(commands).toHaveLength(0);
  });
});

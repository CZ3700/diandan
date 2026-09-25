/// <reference types="node" />
import { describe, expect, test, vi } from "vitest";
import {
  adminPrincipalSchema,
  adminResourceCommandSchema,
  mediaUploadTicketSchema,
  credentiallessHttpsUrlSchema,
  type AdminContentFailure,
  type AdminResourceCommand,
  type AdminResourcePermission,
  type MediaUploadTicket,
} from "@fan-support/contracts";
import type {
  ResourceManagementRepositories,
  ResourceManagementTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import type {
  MediaSourceInspectionPort,
  MediaStoragePort,
} from "@fan-support/media-port";
import { createResourceManagementUseCases } from "./resource-management.js";
import { digestAdminContentToken } from "./admin-content-tokens.js";
const id = (n: number) =>
  `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tokenPepper = "da".repeat(32);
const sessionToken = Buffer.alloc(32, 6).toString("base64url");
const csrfToken = Buffer.alloc(32, 7).toString("base64url");
const principal = adminPrincipalSchema.parse({
  schemaVersion: 1,
  actorId: id(1),
  sessionId: id(2),
  authorizedAt: "2026-09-06T10:00:00.818789Z",
  expiresAt: "2026-09-06T11:00:00.818789Z",
});
const failure = (code: AdminContentFailure["code"]): AdminContentFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const mutation = (resultId: string) => ({
  schemaVersion: 1 as const,
  outcome: "SUCCESS" as const,
  kind: "MUTATION" as const,
  resultId,
  replayed: false,
});
const beginUpload = adminResourceCommandSchema.parse({
  schemaVersion: 1,
  action: "BEGIN_UPLOAD",
  expectedVersion: 0,
  checksumSha256: "a".repeat(64),
  byteSize: 200,
  mimeType: "image/png",
  rightsReference: "rights:fixture",
  idempotencyKey: "resource-upload-001",
  reasonCode: "MEDIA_UPLOADED",
});
const completeUpload = adminResourceCommandSchema.parse({
  schemaVersion: 1,
  action: "COMPLETE_UPLOAD",
  uploadId: id(3),
  expectedVersion: 1,
  idempotencyKey: "resource-complete-001",
  reasonCode: "MEDIA_REGISTERED",
});
function ticket(): MediaUploadTicket {
  return mediaUploadTicketSchema.parse({
    schemaVersion: 1,
    uploadId: id(3),
    version: 1,
    actorId: principal.actorId,
    sessionId: principal.sessionId,
    source: {
      objectKey: "uploads/v1/fixture.png",
      checksumSha256: "a".repeat(64),
      byteSize: 200,
      mimeType: "image/png",
    },
    rightsReference: "rights:fixture",
    status: "PENDING",
    assetId: null,
    createdAt: principal.authorizedAt,
    expiresAt: "2026-09-06T10:15:00.818789Z",
  });
}
function request(command: unknown, requestId = id(50)) {
  return { schemaVersion: 1, requestId, sessionToken, csrfToken, command };
}
function harness() {
  const events: string[] = [];
  const state = {
    principal: structuredClone(principal),
    ticket: ticket(),
    depth: 0,
    authorized: true,
    mutations: 0,
    reservations: {} as Record<string, { hash: string; result: string }>,
  };
  const authorize = vi.fn<
    ResourceManagementRepositories["authorization"]["authorize"]
  >(async () => {
    events.push("authorize");
    return state.authorized
      ? { schemaVersion: 1, outcome: "SUCCESS", principal: state.principal }
      : failure("FORBIDDEN");
  });
  const resources: ResourceManagementRepositories["resources"] = {
    readPolicy: vi.fn<
      ResourceManagementRepositories["resources"]["readPolicy"]
    >(async (c) => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "POLICY",
      policy: {
        schemaVersion: 1,
        policyKey: c.policyKey,
        kind: "PRIVACY",
        createdAt: principal.authorizedAt,
      },
    })),
    registerPolicy: vi.fn<
      ResourceManagementRepositories["resources"]["registerPolicy"]
    >(async (c) => {
      state.mutations++;
      return mutation(c.receiptId);
    }),
    reserveUpload: vi.fn<
      ResourceManagementRepositories["resources"]["reserveUpload"]
    >(async (c) => {
      events.push("reserve");
      state.mutations++;
      state.ticket = mediaUploadTicketSchema.parse({
        ...ticket(),
        uploadId: c.uploadId,
        actorId: c.actorId,
        sessionId: c.sessionId,
        source: {
          objectKey: c.objectKey,
          checksumSha256: c.checksumSha256,
          mimeType: c.mimeType,
          byteSize: c.byteSize,
        },
        rightsReference: c.rightsReference,
        createdAt: c.createdAt,
        expiresAt: c.expiresAt,
      });
      return {
        schemaVersion: 1,
        outcome: "SUCCESS",
        value: structuredClone(state.ticket),
      };
    }),
    readUpload: vi.fn<
      ResourceManagementRepositories["resources"]["readUpload"]
    >(async () => {
      events.push("read-ticket");
      return {
        schemaVersion: 1,
        outcome: "SUCCESS",
        value: structuredClone(state.ticket),
      };
    }),
    registerUpload: vi.fn<
      ResourceManagementRepositories["resources"]["registerUpload"]
    >(async () => {
      events.push("register");
      state.mutations++;
      state.ticket = {
        ...state.ticket,
        version: 2,
        status: "REGISTERED",
        assetId: id(60),
      };
      return mutation(id(60));
    }),
    readMedia: vi.fn<ResourceManagementRepositories["resources"]["readMedia"]>(
      async (c) => ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MEDIA",
        media: {
          schemaVersion: 1,
          assetId: c.assetId,
          identityKind: "SOURCE",
          mimeType: "image/png",
          width: 30,
          height: 20,
          byteSize: 200,
          processingStatus: "PENDING",
          rightsStatus: "PENDING",
          rightsVersion: 0,
        },
      }),
    ),
    setRights: vi.fn<ResourceManagementRepositories["resources"]["setRights"]>(
      async (c) => {
        state.mutations++;
        return mutation(c.eventId);
      },
    ),
    enqueueMedia: vi.fn<
      ResourceManagementRepositories["resources"]["enqueueMedia"]
    >(async () => {
      state.mutations++;
      return mutation(id(70));
    }),
    readMediaJob: vi.fn<
      ResourceManagementRepositories["resources"]["readMediaJob"]
    >(async (c) => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MEDIA_JOB",
      job: {
        schemaVersion: 1,
        generation: 1,
        retryOfJobId: null,
        snapshot: {
          schemaVersion: 1,
          jobId: c.jobId,
          status: "FAILED",
          attemptCount: 6,
          outputAssetId: null,
          error: { code: "STORAGE_UNAVAILABLE", retryable: true },
          nextAttemptAt: null,
        },
      },
    })),
    retryMediaJob: vi.fn<
      ResourceManagementRepositories["resources"]["retryMediaJob"]
    >(async (c) => {
      state.mutations++;
      return mutation(c.newJobId);
    }),
  };
  const begin = vi.fn<ResourceManagementRepositories["idempotency"]["begin"]>(
    async (c) => {
      events.push("begin");
      const previous =
        state.reservations[`${c.idempotencyOperation}/${c.idempotencyKey}`];
      return {
        schemaVersion: 1,
        operation: "BEGIN_IDEMPOTENCY",
        outcome: "SUCCESS",
        value:
          previous === undefined
            ? { decision: "STARTED" }
            : previous.hash === c.canonicalRequestHash
              ? { decision: "REPLAY", safeResultReference: previous.result }
              : { decision: "CONFLICT" },
      };
    },
  );
  const complete = vi.fn<
    ResourceManagementRepositories["idempotency"]["complete"]
  >(async (c) => {
    events.push("complete");
    state.reservations[`${c.idempotencyOperation}/${c.idempotencyKey}`] = {
      hash: c.canonicalRequestHash,
      result: c.safeResultReference,
    };
    return {
      schemaVersion: 1,
      operation: "COMPLETE_IDEMPOTENCY",
      outcome: "SUCCESS",
      value: { completed: true },
    };
  });
  const repositories: ResourceManagementRepositories = {
    authorization: { authorize },
    resources,
    idempotency: { begin, complete },
  };
  const transactions: ResourceManagementTransactionManager = {
    async runInResourceManagementTransaction<Result extends JsonValue>(
      work: (r: ResourceManagementRepositories) => Promise<Result>,
    ): Promise<Result> {
      events.push("transaction");
      state.depth++;
      const before = structuredClone({
        ticket: state.ticket,
        mutations: state.mutations,
        reservations: state.reservations,
      });
      try {
        const result = await work(repositories);
        events.push("commit");
        return result;
      } catch (error) {
        Object.assign(state, before);
        events.push("rollback");
        throw error;
      } finally {
        state.depth--;
      }
    },
  };
  const createUploadGrant = vi.fn<MediaStoragePort["createUploadGrant"]>(
    async (c) => {
      events.push("sign");
      expect(state.depth).toBe(0);
      return {
        schemaVersion: 1,
        operation: "CREATE_UPLOAD_GRANT",
        outcome: "SUCCESS",
        value: {
          storageClass: c.storageClass,
          objectKey: c.objectKey,
          checksumSha256: c.checksumSha256,
          byteSize: c.byteSize,
          mimeType: c.mimeType,
          method: "PUT",
          expiresAt: c.expiresAt,
          url: credentiallessHttpsUrlSchema.parse(
            "https://storage.example.invalid/private?signature=fixture",
          ),
          headers: {
            "content-type": c.mimeType,
            "if-none-match": "*",
            "x-amz-checksum-sha256": Buffer.from(
              c.checksumSha256,
              "hex",
            ).toString("base64"),
          },
        },
      };
    },
  );
  const storage = { createUploadGrant } as unknown as MediaStoragePort;
  const inspect = vi.fn<MediaSourceInspectionPort["inspect"]>(async (c) => {
    events.push("inspect");
    expect(state.depth).toBe(0);
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      receipt: {
        schemaVersion: 1,
        profileVersion: 1,
        source: c.source,
        width: 30,
        height: 20,
        orientation: 6,
      },
    };
  });
  const inspector: MediaSourceInspectionPort = { inspect };
  const dependencies = { transactions, storage, inspector, tokenPepper };
  return {
    state,
    events,
    resources,
    authorize,
    begin,
    complete,
    createUploadGrant,
    inspect,
    dependencies,
    useCases: createResourceManagementUseCases(dependencies),
  };
}

describe("resource management application", () => {
  test("reserves the private upload before signing outside the transaction, retaining only a reference", async () => {
    const h = harness();
    const result = await h.useCases.execute(request(beginUpload));
    expect(result).toMatchObject({
      outcome: "SUCCESS",
      kind: "UPLOAD_GRANT",
      replayed: false,
    });
    expect(h.events).toEqual([
      "transaction",
      "authorize",
      "begin",
      "reserve",
      "complete",
      "commit",
      "sign",
    ]);
    expect(h.state.ticket.source.objectKey).toMatch(
      /^uploads\/v1\/[a-f0-9-]{36}$/u,
    );
    expect(h.state.ticket.expiresAt).toBe("2026-09-06T10:15:00.818789Z");
    expect(h.createUploadGrant.mock.calls[0]?.[0].expiresAt).toBe(
      "2026-09-06T10:05:00.818789Z",
    );
    expect(JSON.stringify(h.state.reservations)).not.toMatch(
      /signature|rights|checksum|storage\.example/u,
    );
  });
  test("binds signature and reservation expiry to an exact microsecond session cap", async () => {
    const h = harness();
    h.state.principal.expiresAt = "2026-09-06T10:00:30.818790Z";
    expect(await h.useCases.execute(request(beginUpload))).toMatchObject({
      outcome: "SUCCESS",
    });
    expect(h.state.ticket.expiresAt).toBe(h.state.principal.expiresAt);
    expect(h.createUploadGrant.mock.calls[0]?.[0].expiresAt).toBe(
      h.state.principal.expiresAt,
    );
  });
  test("accepts only a shorter database ticket deadline after wall clock rollback", async () => {
    const h = harness();
    const reserve = vi
      .mocked(h.resources.reserveUpload)
      .getMockImplementation()!;
    vi.mocked(h.resources.reserveUpload).mockImplementation(async (command) => {
      const result = await reserve(command);
      if (result.outcome === "SUCCESS") {
        result.value.expiresAt = "2026-09-06T10:15:00.656789Z";
        h.state.ticket.expiresAt = result.value.expiresAt;
      }
      return result;
    });
    expect(await h.useCases.execute(request(beginUpload))).toMatchObject({
      outcome: "SUCCESS",
      kind: "UPLOAD_GRANT",
    });
    expect(h.state.ticket.createdAt).toBe(principal.authorizedAt);
    expect(h.state.ticket.expiresAt).toBe("2026-09-06T10:15:00.656789Z");
  });
  test("rejects a database reservation extending the requested deadline by one microsecond", async () => {
    const h = harness();
    const reserve = vi
      .mocked(h.resources.reserveUpload)
      .getMockImplementation()!;
    vi.mocked(h.resources.reserveUpload).mockImplementation(async (command) => {
      const result = await reserve(command);
      if (result.outcome === "SUCCESS")
        result.value.expiresAt = "2026-09-06T10:15:00.818790Z";
      return result;
    });
    expect(await h.useCases.execute(request(beginUpload))).toEqual(
      failure("CONTENT_UNAVAILABLE"),
    );
    expect(h.createUploadGrant).not.toHaveBeenCalled();
    expect(h.state.mutations).toBe(0);
  });
  test("reissues a failed signature using the committed reservation without duplicating it", async () => {
    const h = harness();
    h.createUploadGrant.mockRejectedValueOnce(
      new Error("private capability must never escape"),
    );
    expect(await h.useCases.execute(request(beginUpload))).toEqual(
      failure("CONTENT_UNAVAILABLE"),
    );
    expect(
      await h.useCases.execute(request(beginUpload, id(51))),
    ).toMatchObject({
      outcome: "SUCCESS",
      kind: "UPLOAD_GRANT",
      replayed: true,
    });
    expect(h.resources.reserveUpload).toHaveBeenCalledTimes(1);
  });
  test("rejects changed upload content under the same idempotency key", async () => {
    const h = harness();
    await h.useCases.execute(request(beginUpload));
    expect(
      await h.useCases.execute(request({ ...beginUpload, byteSize: 201 })),
    ).toEqual(failure("IDEMPOTENCY_CONFLICT"));
    expect(h.createUploadGrant).toHaveBeenCalledTimes(1);
  });
  test("checks current permission before replaying or signing an upload", async () => {
    const h = harness();
    await h.useCases.execute(request(beginUpload));
    h.state.authorized = false;
    expect(await h.useCases.execute(request(beginUpload))).toEqual(
      failure("FORBIDDEN"),
    );
    expect(h.begin).toHaveBeenCalledTimes(1);
    expect(h.createUploadGrant).toHaveBeenCalledTimes(1);
  });
  test("fully inspects outside the transaction and authorizes again before registration", async () => {
    const h = harness();
    expect(await h.useCases.execute(request(completeUpload))).toEqual(
      mutation(id(60)),
    );
    expect(h.events).toEqual([
      "transaction",
      "authorize",
      "read-ticket",
      "commit",
      "inspect",
      "transaction",
      "authorize",
      "read-ticket",
      "begin",
      "register",
      "complete",
      "commit",
    ]);
    expect(h.inspect.mock.calls[0]?.[0]).toEqual({
      schemaVersion: 1,
      profileVersion: 1,
      source: ticket().source,
    });
    expect(h.resources.registerUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: principal.actorId,
        sessionId: principal.sessionId,
        requestId: id(50),
        receipt: expect.objectContaining({
          width: 30,
          height: 20,
          orientation: 6,
        }),
      }),
    );
  });
  test("refuses registration when permission was removed while decoding", async () => {
    const h = harness();
    const inspect = h.inspect.getMockImplementation()!;
    h.inspect.mockImplementation(async (c) => {
      const result = await inspect(c);
      h.state.authorized = false;
      return result;
    });
    expect(await h.useCases.execute(request(completeUpload))).toEqual(
      failure("FORBIDDEN"),
    );
    expect(h.begin).not.toHaveBeenCalled();
    expect(h.resources.registerUpload).not.toHaveBeenCalled();
  });
  test.each(["actorId", "sessionId", "expiresAt"] as const)(
    "refuses altered %s between preflight and registration",
    async (field) => {
      const h = harness();
      const inspect = h.inspect.getMockImplementation()!;
      h.inspect.mockImplementation(async (c) => {
        const result = await inspect(c);
        h.state.principal = {
          ...h.state.principal,
          [field]:
            field === "expiresAt" ? "2026-09-06T12:00:00.818789Z" : id(99),
        };
        return result;
      });
      expect(await h.useCases.execute(request(completeUpload))).toEqual(
        failure("CONTENT_UNAVAILABLE"),
      );
      expect(h.resources.registerUpload).not.toHaveBeenCalled();
    },
  );
  test("accepts canonical wall clock rollback while preserving exact session identity", async () => {
    const h = harness();
    const inspect = h.inspect.getMockImplementation()!;
    h.inspect.mockImplementation(async (c) => {
      const result = await inspect(c);
      h.state.principal = {
        ...h.state.principal,
        authorizedAt: "2026-09-06T10:00:00.656789Z",
      };
      return result;
    });
    expect(await h.useCases.execute(request(completeUpload))).toEqual(
      mutation(id(60)),
    );
  });
  test.each(["actorId", "sessionId"] as const)(
    "rejects a ticket with another %s before any network",
    async (field) => {
      const h = harness();
      h.state.ticket[field] = id(98);
      expect(await h.useCases.execute(request(completeUpload))).toEqual(
        failure("CONTENT_UNAVAILABLE"),
      );
      expect(h.inspect).not.toHaveBeenCalled();
    },
  );
  test("replays completed registration after ticket expiry without inspecting again", async () => {
    const h = harness();
    await h.useCases.execute(request(completeUpload));
    h.state.principal.authorizedAt = "2026-09-06T10:20:00.000001Z";
    expect(await h.useCases.execute(request(completeUpload, id(51)))).toEqual({
      ...mutation(id(60)),
      replayed: true,
    });
    expect(h.inspect).toHaveBeenCalledTimes(1);
    expect(h.resources.registerUpload).toHaveBeenCalledTimes(1);
  });
  test("rejects a new completion key for an already registered ticket without network", async () => {
    const h = harness();
    await h.useCases.execute(request(completeUpload));
    expect(
      await h.useCases.execute(
        request({ ...completeUpload, idempotencyKey: "another-complete-002" }),
      ),
    ).toEqual(failure("STALE_VERSION"));
    expect(h.inspect).toHaveBeenCalledTimes(1);
    expect(Object.keys(h.state.reservations)).toHaveLength(1);
  });
  test("does not decode an expired pending upload", async () => {
    const h = harness();
    h.state.principal.authorizedAt = h.state.ticket.expiresAt;
    expect(await h.useCases.execute(request(completeUpload))).toEqual(
      failure("STALE_VERSION"),
    );
    expect(h.inspect).not.toHaveBeenCalled();
  });
  test("rejects expiry reached during decoding without committing idempotency", async () => {
    const h = harness();
    const inspect = h.inspect.getMockImplementation()!;
    h.inspect.mockImplementation(async (c) => {
      const result = await inspect(c);
      h.state.principal = {
        ...h.state.principal,
        authorizedAt: h.state.ticket.expiresAt,
      };
      return result;
    });
    expect(await h.useCases.execute(request(completeUpload))).toEqual(
      failure("STALE_VERSION"),
    );
    expect(h.resources.registerUpload).not.toHaveBeenCalled();
    expect(h.state.reservations).toEqual({});
  });
  test("rejects a trusted-adapter receipt bound to different bytes", async () => {
    const h = harness();
    const inspect = h.inspect.getMockImplementation()!;
    h.inspect.mockImplementation(async (c) => {
      const result = await inspect(c);
      if (result.outcome === "SUCCESS") result.receipt.source.byteSize++;
      return result;
    });
    expect(await h.useCases.execute(request(completeUpload))).toEqual(
      failure("CONTENT_UNAVAILABLE"),
    );
    expect(h.resources.registerUpload).not.toHaveBeenCalled();
  });
  test("allows an explicit retry after transient inspection failure without poisoned state", async () => {
    const h = harness();
    h.inspect.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "STORAGE_UNAVAILABLE", retryable: true },
    });
    expect(await h.useCases.execute(request(completeUpload))).toEqual(
      failure("CONTENT_UNAVAILABLE"),
    );
    expect(h.state.reservations).toEqual({});
    expect(await h.useCases.execute(request(completeUpload))).toEqual(
      mutation(id(60)),
    );
  });
  test("maps a genuine rejected image to invalid content", async () => {
    const h = harness();
    h.inspect.mockResolvedValue({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "INVALID_IMAGE", retryable: false },
    });
    expect(await h.useCases.execute(request(completeUpload))).toEqual(
      failure("INVALID_CONTENT"),
    );
  });
  test("rolls registration back when final idempotency completion fails", async () => {
    const h = harness();
    h.complete.mockRejectedValue(new Error("database detail"));
    expect(await h.useCases.execute(request(completeUpload))).toEqual(
      failure("CONTENT_UNAVAILABLE"),
    );
    expect(h.state.ticket.status).toBe("PENDING");
    expect(h.state.mutations).toBe(0);
    expect(h.state.reservations).toEqual({});
  });
  test.each(["TRANSACTION_ABORTED", "VERSION_CONFLICT"] as const)(
    "maps begin %s result to conflict, preserving rollback",
    async (code) => {
      const h = harness();
      h.begin.mockResolvedValue({
        schemaVersion: 1,
        operation: "BEGIN_IDEMPOTENCY",
        outcome: "FAILURE",
        error: {
          schemaVersion: 1,
          code,
          recovery:
            code === "TRANSACTION_ABORTED" ? "RETRY_SAME_COMMAND" : "NONE",
          ...(code === "TRANSACTION_ABORTED" ? { retryAfterMs: 100 } : {}),
        },
      });
      expect(await h.useCases.execute(request(completeUpload))).toEqual(
        failure("CONFLICT"),
      );
      expect(h.state.ticket.status).toBe("PENDING");
    },
  );
  test("returns minimal upload reads and current resource permission without language scope", async () => {
    const h = harness();
    const result = await h.useCases.execute(
      request({ schemaVersion: 1, action: "READ_UPLOAD", uploadId: id(3) }),
    );
    expect(result).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "UPLOAD",
      upload: {
        schemaVersion: 1,
        uploadId: id(3),
        version: 1,
        status: "PENDING",
        assetId: null,
        expiresAt: ticket().expiresAt,
      },
    });
    expect(h.authorize.mock.calls[0]?.[0]).toEqual({
      schemaVersion: 1,
      permission: "content.media.upload",
      sessionTokenDigest: digestAdminContentToken({
        tokenPepper,
        purpose: "admin-session",
        token: sessionToken,
      }),
      csrfTokenDigest: digestAdminContentToken({
        tokenPepper,
        purpose: "admin-csrf",
        token: csrfToken,
      }),
    });
    expect(JSON.stringify(result)).not.toMatch(
      /actorId|sessionId|checksum|objectKey|rightsReference/u,
    );
  });
  const commandCases: Array<
    [AdminResourceCommand, AdminResourcePermission, string]
  > = [
    [
      { schemaVersion: 1, action: "READ_POLICY", policyKey: "privacy" },
      "content.policy.manage",
      "readPolicy",
    ],
    [
      adminResourceCommandSchema.parse({
        schemaVersion: 1,
        action: "REGISTER_POLICY",
        policyKey: "privacy",
        kind: "PRIVACY",
        expectedVersion: 0,
        idempotencyKey: "resource-policy-001",
        reasonCode: "POLICY_REGISTERED",
      }),
      "content.policy.manage",
      "registerPolicy",
    ],
    [
      { schemaVersion: 1, action: "READ_MEDIA", assetId: id(60) },
      "content.media.read",
      "readMedia",
    ],
    [
      adminResourceCommandSchema.parse({
        schemaVersion: 1,
        action: "SET_MEDIA_RIGHTS",
        assetId: id(60),
        expectedVersion: 0,
        rightsStatus: "APPROVED",
        evidenceReference: "rights:approved",
        idempotencyKey: "resource-rights-001",
        reasonCode: "RIGHTS_VERIFIED",
      }),
      "content.media.rights",
      "setRights",
    ],
    [
      adminResourceCommandSchema.parse({
        schemaVersion: 1,
        action: "ENQUEUE_MEDIA",
        sourceAssetId: id(60),
        metadataRevisionId: id(61),
        role: "GIFT_PRIMARY",
        fit: "COVER",
        expectedVersion: 0,
        idempotencyKey: "resource-enqueue-001",
        reasonCode: "MEDIA_PROCESSED",
      }),
      "content.media.process",
      "enqueueMedia",
    ],
    [
      { schemaVersion: 1, action: "READ_MEDIA_JOB", jobId: id(70) },
      "content.media.read",
      "readMediaJob",
    ],
    [
      adminResourceCommandSchema.parse({
        schemaVersion: 1,
        action: "RETRY_MEDIA_JOB",
        jobId: id(70),
        expectedVersion: 6,
        idempotencyKey: "resource-retry-001",
        reasonCode: "MEDIA_RETRIED",
      }),
      "content.media.process",
      "retryMediaJob",
    ],
  ];
  test.each(commandCases)(
    "authorizes %j with %s before %s",
    async (command, permission, method) => {
      const h = harness();
      expect(await h.useCases.execute(request(command))).toMatchObject({
        outcome: "SUCCESS",
      });
      expect(h.authorize.mock.calls[0]?.[0].permission).toBe(permission);
      expect(
        h.resources[method as keyof typeof h.resources],
      ).toHaveBeenCalledTimes(1);
      expect(h.inspect).not.toHaveBeenCalled();
      expect(h.createUploadGrant).not.toHaveBeenCalled();
    },
  );
  test.each(["actorId", "sessionId", "receipt", "objectKey", "width"])(
    "rejects injected %s before opening any transaction",
    async (field) => {
      const h = harness();
      expect(
        await h.useCases.execute(
          request({ ...beginUpload, [field]: "forged" }),
        ),
      ).toEqual(failure("INVALID_COMMAND"));
      expect(h.events).toEqual([]);
    },
  );
  test("rejects bad token configuration without leaking it or touching dependencies", () => {
    const h = harness();
    expect(() =>
      createResourceManagementUseCases({
        ...h.dependencies,
        tokenPepper: "secret-do-not-echo",
      }),
    ).toThrow("invalid admin token configuration");
    expect(h.events).toEqual([]);
  });
  test("uses TypeError for invalid token configuration before any dependency call", () => {
    const h = harness();
    expect(() =>
      createResourceManagementUseCases({
        ...h.dependencies,
        tokenPepper: undefined as unknown as string,
      }),
    ).toThrow(TypeError);
    expect(h.events).toEqual([]);
  });
  test.each(["transactions", "storage", "inspector"] as const)(
    "rejects missing %s capability at construction",
    (field) => {
      const h = harness();
      expect(() =>
        createResourceManagementUseCases({
          ...h.dependencies,
          [field]: {},
        } as unknown as typeof h.dependencies),
      ).toThrow(TypeError);
      expect(h.events).toEqual([]);
    },
  );
  test("accepts provider-neutral opaque headers while returning only the public grant projection", async () => {
    const h = harness();
    const sign = h.createUploadGrant.getMockImplementation()!;
    h.createUploadGrant.mockImplementation(async (c) => {
      const response = await sign(c);
      if (response.outcome === "SUCCESS")
        response.value.headers = { "x-provider-upload-proof": "opaque" };
      return response;
    });
    const response = await h.useCases.execute(request(beginUpload));
    expect(response).toMatchObject({
      outcome: "SUCCESS",
      kind: "UPLOAD_GRANT",
    });
    if (response.outcome !== "SUCCESS" || response.kind !== "UPLOAD_GRANT")
      return;
    expect(Object.keys(response.grant).sort()).toEqual([
      "expiresAt",
      "headers",
      "method",
      "url",
    ]);
  });
  test.each([
    "objectKey",
    "checksumSha256",
    "byteSize",
    "mimeType",
    "storageClass",
    "ttl",
    "zero",
  ])(
    "rejects signed grant with inconsistent %s after preserving the recoverable reservation",
    async (field) => {
      const h = harness();
      const sign = h.createUploadGrant.getMockImplementation()!;
      h.createUploadGrant.mockImplementation(async (c) => {
        const response = await sign(c);
        if (response.outcome === "SUCCESS") {
          const changes: Record<string, unknown> = {
            objectKey: "uploads/v1/another",
            checksumSha256: "b".repeat(64),
            byteSize: 201,
            mimeType: "image/webp",
            storageClass: "DERIVATIVE",
            ttl: "2026-09-06T10:05:00.818790Z",
            zero: principal.authorizedAt,
          };
          Object.assign(response.value, {
            [field === "ttl" || field === "zero" ? "expiresAt" : field]:
              changes[field],
          });
        }
        return response;
      });
      expect(await h.useCases.execute(request(beginUpload))).toEqual(
        failure("CONTENT_UNAVAILABLE"),
      );
      expect(h.state.ticket.status).toBe("PENDING");
      expect(h.state.mutations).toBe(1);
    },
  );
  test.each(["expired", "registered"])(
    "refuses BEGIN replay for %s reservation instead of signing a useless capability",
    async (state) => {
      const h = harness();
      await h.useCases.execute(request(beginUpload));
      if (state === "expired")
        h.state.principal.authorizedAt = h.state.ticket.expiresAt;
      else
        h.state.ticket = {
          ...h.state.ticket,
          version: 2,
          status: "REGISTERED",
          assetId: id(60),
        };
      expect(await h.useCases.execute(request(beginUpload))).toEqual(
        failure("STALE_VERSION"),
      );
      expect(h.createUploadGrant).toHaveBeenCalledTimes(1);
    },
  );
  test("replays a rights decision with current authorization and the original safe event reference", async () => {
    const h = harness();
    const command = commandCases.find(
      ([c]) => c.action === "SET_MEDIA_RIGHTS",
    )![0];
    const first = await h.useCases.execute(request(command));
    expect(first).toMatchObject({ outcome: "SUCCESS", kind: "MUTATION" });
    expect(await h.useCases.execute(request(command, id(51)))).toEqual({
      ...first,
      replayed: true,
    });
    expect(h.resources.setRights).toHaveBeenCalledTimes(1);
    expect(h.authorize).toHaveBeenCalledTimes(2);
    expect(h.begin.mock.calls[0]?.[0].expiresAt).toBe(
      "2026-09-07T10:00:00.818789Z",
    );
    h.state.authorized = false;
    expect(await h.useCases.execute(request(command))).toEqual(
      failure("FORBIDDEN"),
    );
    expect(h.begin).toHaveBeenCalledTimes(2);
  });
  test.each(["TRANSACTION_ABORTED", "VERSION_CONFLICT"] as const)(
    "maps complete %s to conflict and rolls the business write back",
    async (code) => {
      const h = harness();
      h.complete.mockResolvedValue({
        schemaVersion: 1,
        operation: "COMPLETE_IDEMPOTENCY",
        outcome: "FAILURE",
        error: {
          schemaVersion: 1,
          code,
          recovery:
            code === "TRANSACTION_ABORTED" ? "RETRY_SAME_COMMAND" : "NONE",
          ...(code === "TRANSACTION_ABORTED" ? { retryAfterMs: 100 } : {}),
        },
      });
      expect(await h.useCases.execute(request(completeUpload))).toEqual(
        failure("CONFLICT"),
      );
      expect(h.state.ticket.status).toBe("PENDING");
      expect(h.state.mutations).toBe(0);
    },
  );
  test("does not expose a canonical read accidentally bound to another asset", async () => {
    const h = harness();
    const read = vi.mocked(h.resources.readMedia).getMockImplementation()!;
    vi.mocked(h.resources.readMedia).mockImplementation((c) =>
      read({ ...c, assetId: id(99) }),
    );
    expect(
      await h.useCases.execute(
        request({ schemaVersion: 1, action: "READ_MEDIA", assetId: id(60) }),
      ),
    ).toEqual(failure("CONTENT_UNAVAILABLE"));
  });
});

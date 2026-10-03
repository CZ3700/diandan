import { expect, test, vi } from "vitest";
import * as application from "./index.js";
import {
  adminOrdersPrivateSnapshotSchema,
  encryptedValueSchema,
  type AdminOrdersResponse,
  type AdminOrdersPrivateResponse,
} from "@fan-support/contracts";
import type { AdminOrdersRepositories } from "@fan-support/persistence-port";
import type { KeyManagementPort } from "@fan-support/key-management-port";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const sessionToken = "a".repeat(42) + "A",
  csrfToken = "b".repeat(42) + "A",
  tokenPepper = "a".repeat(64);
const request = (command: unknown) => ({
  schemaVersion: 1,
  requestId: id,
  sessionToken,
  csrfToken,
  command,
});
const context: AdminOrdersResponse = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "CONTEXT",
  actorId: id,
  permissions: ["orders.read", "orders.note"],
  reviewLocales: ["ja"],
};
const failure = (code: string) => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const privateCommand = {
  schemaVersion: 1,
  action: "READ_MESSAGE",
  orderId: id,
  itemId: other,
  expectedIntentVersion: 2,
  reviewLocale: "ja",
} as const;
const ciphertext = encryptedValueSchema.parse(`enc:v1:${"A".repeat(40)}`);
const encryptedDataKey = encryptedValueSchema.parse(`enc:v1:${"B".repeat(40)}`);
const snapshot = adminOrdersPrivateSnapshotSchema.parse({
  schemaVersion: 1,
  kind: "MESSAGE",
  accessId: id,
  orderId: id,
  itemId: other,
  supportIntentId: id,
  intentVersion: 2,
  expiresAt: "2026-09-19T00:05:00Z",
  reviewLocale: "ja",
  displayMode: "anonymous",
  fanMessageLocale: "und",
  fanMessageCiphertext: ciphertext,
  displayNameCiphertext: null,
  encryptedDataKey,
  keyVersion: "test-1",
});

function setup() {
  let insideTransaction = false;
  const execute = vi.fn(async (): Promise<unknown> => context);
  const preparePrivate = vi.fn(async (): Promise<unknown> => snapshot);
  const confirmPrivate = vi.fn(async (): Promise<unknown> => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PRIVATE_CONFIRMED",
    accessId: id,
  }));
  const resend = vi.fn(async (): Promise<unknown> => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    orderId: id,
    resultId: other,
    replayed: false,
  }));
  const repositories = {
    adminOrders: {
      execute,
      preparePrivate,
      confirmPrivate,
      reserveProofUpload: vi.fn(),
      readProofUpload: vi.fn(),
      completeProofUpload: vi.fn(),
      readProofRendition: vi.fn(),
    },
    adminOrderResends: { request: resend },
  } as AdminOrdersRepositories;
  const run = vi.fn(
    async (
      work: (repositories: AdminOrdersRepositories) => Promise<unknown>,
    ) => {
      expect(insideTransaction).toBe(false);
      insideTransaction = true;
      try {
        return await work(repositories);
      } finally {
        insideTransaction = false;
      }
    },
  );
  const decryptEnvelope = vi.fn(async (): Promise<unknown> => {
    expect(insideTransaction).toBe(false);
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      operation: "DECRYPT_ENVELOPE",
      value: {
        plaintextBase64: Buffer.from("Private test message").toString(
          "base64url",
        ),
      },
    };
  });
  const encryptEnvelope = vi.fn(async (): Promise<unknown> => {
    expect(insideTransaction).toBe(false);
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      operation: "ENCRYPT_ENVELOPE",
      value: {
        ciphertext,
        encryptedDataKey,
        keyVersion: "test-1",
        algorithm: "AES_256_GCM",
      },
    };
  });
  type Factory = (deps: {
    tokenPepper: string;
    transactions: unknown;
    keys: KeyManagementPort;
  }) => {
    execute(
      input: unknown,
    ): Promise<AdminOrdersResponse | AdminOrdersPrivateResponse>;
  };
  const factory = (application as unknown as Record<string, Factory>)[
    "createAdminOrdersUseCases"
  ];
  expect(factory, "admin order application entry").toBeDefined();
  const useCases = factory!({
    tokenPepper,
    transactions: { runInAdminOrdersTransaction: run },
    keys: { encryptEnvelope, decryptEnvelope } as unknown as KeyManagementPort,
  });
  return {
    useCases,
    execute,
    preparePrivate,
    confirmPrivate,
    resend,
    run,
    decryptEnvelope,
    encryptEnvelope,
  };
}
test("ordinary reads pass only credential digests and validate repository output", async () => {
  const h = setup();
  expect(
    await h.useCases.execute(request({ schemaVersion: 1, action: "CONTEXT" })),
  ).toEqual(context);
  expect(JSON.stringify(h.execute.mock.calls)).not.toContain(sessionToken);
  expect(JSON.stringify(h.execute.mock.calls)).not.toContain(csrfToken);
  h.execute.mockResolvedValueOnce({ ...context, fanMessage: "private" });
  expect(
    await h.useCases.execute(request({ schemaVersion: 1, action: "CONTEXT" })),
  ).toEqual(failure("TEMPORARY_UNAVAILABLE"));
});
test("invalid client authority never reaches persistence or KMS", async () => {
  const h = setup();
  expect(
    await h.useCases.execute({
      ...request({ schemaVersion: 1, action: "CONTEXT" }),
      actorId: id,
    }),
  ).toEqual(failure("INVALID_COMMAND"));
  expect(h.run).not.toHaveBeenCalled();
  expect(h.decryptEnvelope).not.toHaveBeenCalled();
});
test("private access commits its audit before KMS and rechecks before returning plaintext", async () => {
  const h = setup();
  const result = await h.useCases.execute(request(privateCommand));
  expect(result).toMatchObject({
    outcome: "SUCCESS",
    kind: "MESSAGE",
    content: { fanMessage: "Private test message" },
  });
  expect(h.run).toHaveBeenCalledTimes(2);
  expect(h.decryptEnvelope).toHaveBeenCalledWith(
    expect.objectContaining({
      purpose: "SUPPORT_INTENT_MESSAGE",
      subjectId: id,
    }),
  );
  expect(h.confirmPrivate).toHaveBeenCalledWith(
    expect.objectContaining({ accessId: id }),
  );
});
test.each([
  "FORBIDDEN",
  "UNAUTHENTICATED",
  "PRIVATE_ACCESS_EXPIRED",
  "STALE_VERSION",
])("private read suppresses plaintext after %s during KMS", async (code) => {
  const h = setup();
  h.confirmPrivate.mockResolvedValueOnce(failure(code));
  const result = await h.useCases.execute(request(privateCommand));
  expect(result).toEqual(failure(code));
  expect(JSON.stringify(result)).not.toContain("Private test message");
});
test("private denial and wrong repository target do not decrypt", async () => {
  const h = setup();
  h.preparePrivate.mockResolvedValueOnce(failure("FORBIDDEN"));
  expect(await h.useCases.execute(request(privateCommand))).toEqual(
    failure("FORBIDDEN"),
  );
  h.preparePrivate.mockResolvedValueOnce({ ...snapshot, itemId: id });
  expect(await h.useCases.execute(request(privateCommand))).toEqual(
    failure("TEMPORARY_UNAVAILABLE"),
  );
  expect(h.decryptEnvelope).not.toHaveBeenCalled();
});
test("private note text is encrypted outside SQL and HMAC-bound before persistence", async () => {
  const h = setup();
  h.execute.mockResolvedValueOnce(context).mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    orderId: id,
    resultId: other,
    replayed: false,
  });
  const command = {
    schemaVersion: 1,
    action: "ADD_NOTE",
    orderId: id,
    expectedOrderVersion: 2,
    idempotencyKey: "notes-command-0001",
    reasonCode: "OPERATOR_NOTE",
    note: "Confidential preparation note",
  } as const;
  expect(await h.useCases.execute(request(command))).toMatchObject({
    outcome: "SUCCESS",
    kind: "MUTATION",
  });
  expect(h.encryptEnvelope).toHaveBeenCalledWith(
    expect.objectContaining({ purpose: "ADMIN_ORDER_NOTE" }),
  );
  expect(JSON.stringify(h.execute.mock.calls)).not.toContain(command.note);
  expect(h.execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      command: expect.objectContaining({
        envelope: expect.objectContaining({ ciphertext }),
      }),
    }),
  );
});
test("unprivileged note writer never invokes encryption", async () => {
  const h = setup();
  h.execute.mockResolvedValueOnce({ ...context, permissions: ["orders.read"] });
  expect(
    await h.useCases.execute(
      request({
        schemaVersion: 1,
        action: "ADD_NOTE",
        orderId: id,
        expectedOrderVersion: 2,
        idempotencyKey: "notes-command-0001",
        reasonCode: "OPERATOR_NOTE",
        note: "private",
      }),
    ),
  ).toEqual(failure("FORBIDDEN"));
  expect(h.encryptEnvelope).not.toHaveBeenCalled();
});
test("manual notification requests use separate durable dispatch repository", async () => {
  const h = setup();
  expect(
    await h.useCases.execute(
      request({
        schemaVersion: 1,
        action: "RESEND_NOTIFICATION",
        orderId: id,
        expectedOrderVersion: 2,
        idempotencyKey: "resend-command-0001",
        reasonCode: "CUSTOMER_REQUEST",
        expectedLatestNotificationId: other,
      }),
    ),
  ).toMatchObject({ kind: "MUTATION" });
  expect(h.resend).toHaveBeenCalledOnce();
  expect(h.execute).not.toHaveBeenCalled();
});
test("infrastructure errors never expose provider detail or private data", async () => {
  const h = setup();
  h.decryptEnvelope.mockRejectedValueOnce(
    new Error("RAW_SECRET_PROVIDER_RESPONSE"),
  );
  expect(await h.useCases.execute(request(privateCommand))).toEqual(
    failure("TEMPORARY_UNAVAILABLE"),
  );
});
test("ordinary result kinds and pagination must match their commands", async () => {
  const h = setup();
  h.execute.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    orderId: id,
    resultId: other,
    replayed: false,
  });
  expect(
    await h.useCases.execute(
      request({ schemaVersion: 1, action: "DETAIL", orderId: id }),
    ),
  ).toEqual(failure("TEMPORARY_UNAVAILABLE"));
  h.execute.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LIST",
    page: 2,
    pageSize: 20,
    totalItems: 0,
    items: [],
  });
  expect(
    await h.useCases.execute(
      request({
        schemaVersion: 1,
        action: "LIST",
        page: 1,
        pageSize: 20,
        query: "",
        fulfillment: "ALL",
        moderation: "ALL",
      }),
    ),
  ).toEqual(failure("TEMPORARY_UNAVAILABLE"));
});
test("private notes bind their own encryption purpose and are suppressed after revocation", async () => {
  const h = setup();
  h.preparePrivate.mockResolvedValue({
    schemaVersion: 1,
    kind: "NOTES",
    accessId: id,
    orderId: id,
    expiresAt: "2026-09-21T12:05:00Z",
    notes: [
      {
        noteId: other,
        actorId: id,
        createdAt: "2026-09-21T12:00:00Z",
        envelope: {
          noteId: other,
          ciphertext,
          encryptedDataKey,
          keyVersion: "test-1",
          algorithm: "AES_256_GCM",
        },
      },
    ],
  });
  h.confirmPrivate.mockResolvedValueOnce(failure("FORBIDDEN"));
  expect(
    await h.useCases.execute(
      request({ schemaVersion: 1, action: "READ_NOTES", orderId: id }),
    ),
  ).toEqual(failure("FORBIDDEN"));
  expect(h.decryptEnvelope).toHaveBeenCalledWith(
    expect.objectContaining({ purpose: "ADMIN_ORDER_NOTE", subjectId: other }),
  );
});

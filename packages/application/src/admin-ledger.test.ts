import { expect, test, vi } from "vitest";
import {
  adminOrdersPrivateSnapshotSchema,
  encryptedValueSchema,
} from "@fan-support/contracts";
import type { AdminLedgerRepositories } from "@fan-support/persistence-port";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import { createAdminLedgerUseCases } from "./index.js";

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
const readCommand = {
  schemaVersion: 1,
  action: "READ_MESSAGE",
  orderId: id,
  itemId: other,
  expectedIntentVersion: 2,
  reviewLocale: "zh-CN",
} as const;
const snapshot = adminOrdersPrivateSnapshotSchema.parse({
  schemaVersion: 1,
  kind: "MESSAGE",
  accessId: id,
  orderId: id,
  itemId: other,
  supportIntentId: id,
  intentVersion: 2,
  expiresAt: "2026-10-01T00:05:00Z",
  reviewLocale: "zh-CN",
  displayMode: "anonymous",
  fanMessageLocale: "ja",
  fanMessageCiphertext: encryptedValueSchema.parse(`enc:v1:${"A".repeat(40)}`),
  displayNameCiphertext: null,
  encryptedDataKey: encryptedValueSchema.parse(`enc:v1:${"B".repeat(40)}`),
  keyVersion: "test-1",
});
const context = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "CONTEXT",
  actorId: id,
  scope: "ASSIGNED",
  canReadMessages: true,
  timeZone: "Asia/Shanghai",
  today: "2026-10-01",
  brokers: [],
};

function setup(timeZone = "Asia/Shanghai") {
  let inside = false;
  const execute = vi.fn(async (): Promise<unknown> => context);
  const prepareMessage = vi.fn(async (): Promise<unknown> => snapshot);
  const confirmMessage = vi.fn(async (): Promise<unknown> => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PRIVATE_CONFIRMED",
    accessId: id,
  }));
  const repositories = {
    adminLedger: { execute, prepareMessage, confirmMessage },
  } as unknown as AdminLedgerRepositories;
  const run = vi.fn(
    async (
      work: (repositories: AdminLedgerRepositories) => Promise<unknown>,
    ) => {
      expect(inside).toBe(false);
      inside = true;
      try {
        return await work(repositories);
      } finally {
        inside = false;
      }
    },
  );
  const decryptEnvelope = vi.fn(async (): Promise<unknown> => {
    expect(inside, "decryption happens between transactions").toBe(false);
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      operation: "DECRYPT_ENVELOPE",
      value: {
        plaintextBase64: Buffer.from("Happy birthday").toString("base64url"),
      },
    };
  });
  const useCases = createAdminLedgerUseCases({
    tokenPepper,
    timeZone,
    transactions: { runInAdminLedgerTransaction: run } as never,
    keys: {
      decryptEnvelope,
      encryptEnvelope: vi.fn(),
    } as unknown as KeyManagementPort,
  });
  return {
    useCases,
    execute,
    prepareMessage,
    confirmMessage,
    run,
    decryptEnvelope,
  };
}

test("reads carry token digests and the configured time zone, never raw tokens", async () => {
  const h = setup("Asia/Shanghai");
  expect(
    await h.useCases.execute(request({ schemaVersion: 1, action: "CONTEXT" })),
  ).toEqual(context);
  const stored = h.execute.mock.calls[0] as unknown as [
    Record<string, unknown>,
  ];
  expect(stored[0]["timeZone"]).toBe("Asia/Shanghai");
  expect(JSON.stringify(stored)).not.toContain(sessionToken);
  expect(JSON.stringify(stored)).not.toContain(csrfToken);
  expect(h.run).toHaveBeenCalledTimes(1);
});

test("malformed requests, mismatched kinds and store faults never reach the page as data", async () => {
  const h = setup();
  expect(
    await h.useCases.execute(
      request({ schemaVersion: 1, action: "CONTEXT", scope: "ALL" }),
    ),
  ).toMatchObject({
    code: "INVALID_COMMAND",
  });
  expect(h.run).not.toHaveBeenCalled();
  const overview = {
    schemaVersion: 1,
    action: "OVERVIEW",
    period: { kind: "TODAY" },
    broker: { kind: "ALL" },
  };
  expect(await h.useCases.execute(request(overview))).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
  h.execute.mockRejectedValueOnce(new Error("database down"));
  expect(
    await h.useCases.execute(request({ schemaVersion: 1, action: "CONTEXT" })),
  ).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
  h.execute.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "FORBIDDEN",
  });
  expect(await h.useCases.execute(request(overview))).toMatchObject({
    code: "FORBIDDEN",
  });
});

test("a message read commits its audit, decrypts outside SQL, then reconfirms before returning plaintext", async () => {
  const h = setup();
  const response = await h.useCases.execute(request(readCommand));
  expect(response).toMatchObject({
    outcome: "SUCCESS",
    kind: "MESSAGE",
    itemId: other,
    content: { displayMode: "anonymous", fanMessage: "Happy birthday" },
  });
  expect(h.run).toHaveBeenCalledTimes(2);
  expect(h.prepareMessage.mock.invocationCallOrder[0]!).toBeLessThan(
    h.decryptEnvelope.mock.invocationCallOrder[0]!,
  );
  expect(h.decryptEnvelope.mock.invocationCallOrder[0]!).toBeLessThan(
    h.confirmMessage.mock.invocationCallOrder[0]!,
  );
  expect(h.execute).not.toHaveBeenCalled();
});

test("a refused, mismatched or revoked read returns no plaintext", async () => {
  const refused = setup();
  refused.prepareMessage.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  });
  expect(await refused.useCases.execute(request(readCommand))).toMatchObject({
    code: "NOT_FOUND",
  });
  expect(refused.decryptEnvelope).not.toHaveBeenCalled();

  const mismatched = setup();
  mismatched.prepareMessage.mockResolvedValueOnce({ ...snapshot, itemId: id });
  expect(await mismatched.useCases.execute(request(readCommand))).toMatchObject(
    { code: "TEMPORARY_UNAVAILABLE" },
  );
  expect(mismatched.decryptEnvelope).not.toHaveBeenCalled();

  const revoked = setup();
  revoked.confirmMessage.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "PRIVATE_ACCESS_EXPIRED",
  });
  const response = await revoked.useCases.execute(request(readCommand));
  expect(response).toMatchObject({ code: "PRIVATE_ACCESS_EXPIRED" });
  expect(JSON.stringify(response)).not.toContain("Happy birthday");
});

test("the ledger time zone must be a real IANA zone", () => {
  expect(() => setup("Mars/Olympus")).toThrow(TypeError);
  expect(() => setup("+08:00")).toThrow(TypeError);
  expect(() => setup("UTC")).not.toThrow();
});

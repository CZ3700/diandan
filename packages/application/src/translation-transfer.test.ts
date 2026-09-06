import { expect, test, vi } from "vitest";
import { createTranslationTransferUseCases } from "./translation-transfer.js";
import {
  translationTestEnvelope,
  translationTestId,
  translationTestPrincipal,
  translationTestSnapshot,
} from "./translation-test-support.js";
import type {
  TranslationTransferRepositories,
  TranslationTransferTransactionManager,
} from "@fan-support/persistence-port";
import type {
  TranslationExportReceipt,
  TranslationTransferCommand,
} from "@fan-support/contracts";
import { idempotencyKeySchema } from "@fan-support/contracts";
const path = "./translation-transfer.js";
test("translation exchange rejects injected approval before entering persistence", async () => {
  const module = await import(path).catch(() => ({}));
  expect(module.createTranslationTransferUseCases).toBeDefined();
  const run = vi.fn();
  const useCases = module.createTranslationTransferUseCases({
    transactions: { runInTranslationTransferTransaction: run },
    tokenPepper: "aa".repeat(32),
  });
  expect(await useCases.execute({ review: { status: "APPROVED" } })).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "INVALID_COMMAND",
  });
  expect(run).not.toHaveBeenCalled();
});
function exchangeHarness() {
  const snapshot = translationTestSnapshot();
  const state = {
    allowed: true,
    receipt: undefined as TranslationExportReceipt | undefined,
  };
  const reservations = new Map<string, { hash: string; reference: string }>();
  const write = vi.fn<
    TranslationTransferRepositories["contentAuthoring"]["write"]
  >(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    resultId: translationTestId(70),
    replayed: false,
  }));
  const begin = vi.fn<TranslationTransferRepositories["idempotency"]["begin"]>(
    async (command) => {
      const old = reservations.get(command.idempotencyKey);
      return {
        schemaVersion: 1,
        operation: "BEGIN_IDEMPOTENCY",
        outcome: "SUCCESS",
        value: !old
          ? { decision: "STARTED" }
          : old.hash === command.canonicalRequestHash
            ? { decision: "REPLAY", safeResultReference: old.reference }
            : { decision: "CONFLICT" },
      };
    },
  );
  const repositories: TranslationTransferRepositories = {
    authorization: {
      authorize: async () =>
        state.allowed
          ? {
              schemaVersion: 1,
              outcome: "SUCCESS",
              principal: translationTestPrincipal,
            }
          : { schemaVersion: 1, outcome: "FAILURE", code: "FORBIDDEN" },
    },
    contentAuthoring: {
      read: async () => ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "REVISION",
        snapshot,
      }),
      write,
    },
    translationTransfers: {
      createExport: async (command) => {
        state.receipt = {
          ...command.receipt,
          id: translationTestId(60),
          createdAt: translationTestPrincipal.authorizedAt,
        };
        return { schemaVersion: 1, outcome: "SUCCESS", receipt: state.receipt };
      },
      readExport: async () =>
        state.receipt
          ? { schemaVersion: 1, outcome: "SUCCESS", receipt: state.receipt }
          : { schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" },
      recordImport: async (command) => ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        resultId: command.revisionId,
        replayed: false,
      }),
    },
    idempotency: {
      begin,
      complete: async (command) => {
        reservations.set(command.idempotencyKey, {
          hash: command.canonicalRequestHash,
          reference: command.safeResultReference,
        });
        return {
          schemaVersion: 1,
          operation: "COMPLETE_IDEMPOTENCY",
          outcome: "SUCCESS",
          value: { completed: true },
        };
      },
    },
  };
  const transactions: TranslationTransferTransactionManager = {
    runInTranslationTransferTransaction: (work) => work(repositories),
  };
  const useCases = createTranslationTransferUseCases({
    transactions,
    tokenPepper: "aa".repeat(32),
  });
  const request = (command: TranslationTransferCommand) => ({
    ...translationTestEnvelope,
    command,
  });
  const command: TranslationTransferCommand = {
    schemaVersion: 1,
    action: "EXPORT",
    target: { owner: snapshot.target, revisionId: snapshot.revisionId },
    locales: ["ja"],
    reasonCode: "CONTENT_EXPORT",
    idempotencyKey: idempotencyKeySchema.parse("fixture-export-001"),
  };
  return { snapshot, state, write, begin, useCases, request, command };
}
test("export and edited JSON import use exact metadata, raw idempotency and current authorization", async () => {
  const h = exchangeHarness(),
    exported = await h.useCases.execute(h.request(h.command));
  if (exported.outcome !== "SUCCESS" || exported.kind !== "TRANSLATION_EXPORT")
    throw new Error("fixture export failed");
  const packet = structuredClone(exported.package);
  if (packet.entries[0]?.text?.kind !== "POLICY") throw new Error("fixture");
  packet.entries[0].text.fields.title = "新しい条件";
  const command: TranslationTransferCommand = {
    schemaVersion: 1,
    action: "IMPORT",
    package: packet,
    reasonCode: "CONTENT_IMPORT",
    idempotencyKey: idempotencyKeySchema.parse("fixture-import-001"),
  };
  const imported = await h.useCases.execute(h.request(command));
  expect(imported).toMatchObject({
    outcome: "SUCCESS",
    kind: "MUTATION",
    replayed: false,
  });
  expect(h.write.mock.calls[0]?.[0].command.action).toBe("COPY");
  h.snapshot.headVersion++;
  expect(await h.useCases.execute(h.request(command))).toMatchObject({
    outcome: "SUCCESS",
    replayed: true,
  });
  expect(
    await h.useCases.execute(
      h.request({
        ...command,
        idempotencyKey: idempotencyKeySchema.parse("fixture-import-002"),
      }),
    ),
  ).toMatchObject({ code: "STALE_VERSION" });
  const count = h.begin.mock.calls.length;
  h.state.allowed = false;
  expect(await h.useCases.execute(h.request(command))).toMatchObject({
    code: "FORBIDDEN",
  });
  expect(h.begin.mock.calls).toHaveLength(count);
});
test("a replay reference cannot widen the exported locale set", async () => {
  const h = exchangeHarness();
  expect((await h.useCases.execute(h.request(h.command))).outcome).toBe(
    "SUCCESS",
  );
  h.state.receipt!.locales = ["en"];
  expect(await h.useCases.execute(h.request(h.command))).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
});

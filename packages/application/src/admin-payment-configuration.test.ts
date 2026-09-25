import { expect, test, vi } from "vitest";
import type { AdminPaymentConfigurationRepository } from "@fan-support/persistence-port";
const module = await import("./admin-payment-configuration.js").catch(
  () => undefined,
);
const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const envelope = {
  schemaVersion: 1,
  requestId: id,
  sessionToken: "a".repeat(42) + "A",
  csrfToken: "b".repeat(42) + "A",
};
const save = {
  schemaVersion: 1,
  action: "SAVE",
  sourceRevisionId: null,
  expectedPublicationId: null,
  idempotencyKey: "payment-config-save-01",
  configuration: { schemaVersion: 1, channels: [], routes: [] },
};
const mutation = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MUTATION",
  action: "SAVE",
  revisionId: id,
  publicationId: null,
  generation: 0,
  replayed: false,
};
function setup() {
  const execute = vi.fn<AdminPaymentConfigurationRepository["execute"]>(
    async () => mutation as never,
  );
  const run = vi.fn(
    async (
      work: (
        repository: AdminPaymentConfigurationRepository,
      ) => Promise<unknown>,
    ) => work({ execute, readPublished: async () => null }),
  );
  expect(module?.createAdminPaymentConfigurationUseCases).toBeTypeOf(
    "function",
  );
  const app = module!.createAdminPaymentConfigurationUseCases({
    tokenPepper: "a".repeat(64),
    deployedAccounts: [],
    transactions: { runInAdminPaymentConfigurationTransaction: run as never },
  });
  return { app, run, execute };
}
test("configuration requests persist digests, canonical permanent receipts and trusted deployments only", async () => {
  const { app, execute } = setup();
  expect(await app.execute({ ...envelope, command: save })).toEqual(mutation);
  const request = execute.mock.calls[0]![0];
  expect(request.access.sessionTokenDigest).toMatch(/^[a-f0-9]{64}$/u);
  expect(request.access.csrfTokenDigest).not.toEqual(
    request.access.sessionTokenDigest,
  );
  expect(JSON.stringify(request)).not.toContain(envelope.sessionToken);
  expect(JSON.stringify(request)).not.toContain(envelope.csrfToken);
  expect(request.deployedAccounts).toEqual([]);
  await app.execute({
    ...envelope,
    command: {
      ...save,
      configuration: { routes: [], channels: [], schemaVersion: 1 },
    },
  });
  expect(execute.mock.calls[1]![0].requestHash).toBe(request.requestHash);
});
test("malformed requests cannot open a transaction or assert deployment authority", async () => {
  const { app, run } = setup();
  for (const value of [
    { ...envelope, command: save, deployedAccounts: [] },
    { ...envelope, command: { ...save, actorId: id } },
    { ...envelope, csrfToken: "invalid", command: save },
  ]) {
    expect(await app.execute(value)).toMatchObject({ code: "INVALID_COMMAND" });
  }
  expect(run).not.toHaveBeenCalled();
});
test("repository errors and responses for a different command cannot become accepted configuration receipts", async () => {
  const { app, execute } = setup();
  execute.mockRejectedValueOnce(new Error("private-storage-value"));
  expect(await app.execute({ ...envelope, command: save })).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
  execute.mockResolvedValue({ ...mutation, action: "APPROVE" } as never);
  expect(await app.execute({ ...envelope, command: save })).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
  execute.mockResolvedValue({
    ...mutation,
    action: "PUBLISH",
    revisionId: other,
    publicationId: other,
    generation: 1,
  } as never);
  expect(
    await app.execute({
      ...envelope,
      command: {
        schemaVersion: 1,
        action: "PUBLISH",
        revisionId: id,
        expectedPublicationId: null,
        idempotencyKey: "publish-key-000001",
        validationHash: "b".repeat(64),
        reasonCode: "OPERATOR_CHANGE",
        confirmed: true,
      },
    }),
  ).toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
});
test("validation binds revision, current publication and mode", async () => {
  const { app, execute } = setup();
  const command = {
    schemaVersion: 1,
    action: "VALIDATE",
    revisionId: id,
    expectedPublicationId: null,
    mode: "PUBLISH",
  };
  const response = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "VALIDATION",
    revisionId: id,
    expectedPublicationId: null,
    mode: "PUBLISH",
    valid: false,
    validationHash: null,
    issues: [],
    diff: [],
  };
  execute.mockResolvedValue(response as never);
  expect(await app.execute({ ...envelope, command })).toEqual(response);
  expect(execute.mock.calls[0]![0].requestHash).toBeNull();
  for (const changed of [
    { revisionId: other },
    { expectedPublicationId: other },
    { mode: "ROLLBACK" },
  ]) {
    execute.mockResolvedValue({ ...response, ...changed } as never);
    expect(await app.execute({ ...envelope, command })).toMatchObject({
      code: "TEMPORARY_UNAVAILABLE",
    });
  }
});
test("publication acceptance requires an actual publication identity and advancing generation", async () => {
  const { app, execute } = setup();
  const command = {
    schemaVersion: 1,
    action: "PUBLISH",
    revisionId: id,
    expectedPublicationId: null,
    idempotencyKey: "publish-proof-000001",
    validationHash: "b".repeat(64),
    reasonCode: "OPERATOR_CHANGE",
    confirmed: true,
  };
  execute.mockResolvedValue({ ...mutation, action: "PUBLISH" } as never);
  expect(await app.execute({ ...envelope, command })).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
});
test("draft and review receipts cannot claim a publication", async () => {
  const { app, execute } = setup();
  execute.mockResolvedValue({ ...mutation, publicationId: other } as never);
  expect(await app.execute({ ...envelope, command: save })).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
  execute.mockResolvedValue({
    ...mutation,
    action: "APPROVE",
    publicationId: other,
  } as never);
  expect(
    await app.execute({
      ...envelope,
      command: {
        schemaVersion: 1,
        action: "APPROVE",
        revisionId: id,
        providerAccountId: id,
        locale: "en",
        idempotencyKey: "approve-proof-000001",
      },
    }),
  ).toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
});

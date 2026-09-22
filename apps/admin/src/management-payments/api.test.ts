import { sourceHashSchema } from "@fan-support/contracts";
import { expect, test } from "vitest";
import { createAdminClient } from "../workspace/client";
const subject = await import("./api").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
test("configuration client binds validation to revision, head and mode", async () => {
  expect(subject?.createPaymentConfigurationApi).toBeTypeOf("function");
  const client = createAdminClient(
    () => "csrf",
    () => {},
    async () =>
      Response.json({
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
      }),
  );
  const api = subject!.createPaymentConfigurationApi(client);
  await expect(
    api.validate({
      revisionId: id,
      expectedPublicationId: null,
      mode: "ROLLBACK",
    }),
  ).rejects.toThrow("INVALID_RESPONSE");
  await expect(
    api.validate({
      revisionId: id,
      expectedPublicationId: id,
      mode: "PUBLISH",
    }),
  ).rejects.toThrow("INVALID_RESPONSE");
});
test("publication retry preserves caller key and rejects a mismatched receipt", async () => {
  expect(subject?.createPaymentConfigurationApi).toBeTypeOf("function");
  const requests: RequestInit[] = [];
  const client = createAdminClient(
    () => "csrf",
    () => {},
    (async (_url, init) => {
      requests.push(init!);
      return Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        action: "PUBLISH",
        revisionId: id,
        publicationId: id,
        generation: 1,
        replayed: false,
      });
    }) as typeof fetch,
  );
  const api = subject!.createPaymentConfigurationApi(client);
  const command = {
    action: "PUBLISH" as const,
    revisionId: id,
    expectedPublicationId: null,
    validationHash: sourceHashSchema.parse("a".repeat(64)),
    reasonCode: "OPERATIONS_UPDATE",
    confirmed: true as const,
  };
  await api.mutate(command, id);
  await api.mutate(command, id);
  expect(
    requests.map((value) => new Headers(value.headers).get("idempotency-key")),
  ).toEqual([id, id]);
  expect(requests[0]!.body).toEqual(requests[1]!.body);
  await expect(
    api.mutate({ ...command, action: "ROLLBACK" }, id),
  ).rejects.toThrow("INVALID_RESPONSE");
});
test("receipt semantics cannot invent a publication or confirm a zero generation", async () => {
  for (const action of ["PUBLISH", "ROLLBACK", "SAVE"] as const) {
    const client = createAdminClient(
      () => "csrf",
      () => {},
      async () =>
        Response.json({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MUTATION",
          action,
          revisionId: id,
          publicationId: id,
          generation: 0,
          replayed: false,
        }),
    );
    const api = subject!.createPaymentConfigurationApi(client);
    const command =
      action === "SAVE"
        ? {
            action,
            sourceRevisionId: null,
            expectedPublicationId: null,
            configuration: {
              schemaVersion: 1 as const,
              channels: [],
              routes: [],
            },
          }
        : {
            action,
            revisionId: id,
            expectedPublicationId: null,
            validationHash: sourceHashSchema.parse("a".repeat(64)),
            reasonCode: "OPERATIONS_UPDATE",
            confirmed: true as const,
          };
    await expect(api.mutate(command, id)).rejects.toThrow("INVALID_RESPONSE");
  }
});

import { expect, test } from "vitest";
import { createAdminClient } from "../workspace/client";
const subject = await import("./api").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
const target = { kind: "WEBHOOK" as const, id, consumerKey: null };
test("exception transport preserves original key and rejects a receipt for another target", async () => {
  expect(subject?.createExceptionsApi).toBeTypeOf("function");
  const calls: RequestInit[] = [];
  let wrong = false;
  const client = createAdminClient(
    () => "csrf",
    () => {},
    (async (_url, init) => {
      calls.push(init!);
      return Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        action: "REPLAY_WEBHOOK",
        target: {
          ...target,
          id: wrong ? "10000000-0000-4000-8000-000000000002" : id,
        },
        operationId: id,
        replayed: false,
      });
    }) as typeof fetch,
  );
  const api = subject!.createExceptionsApi(client);
  const command = {
    action: "REPLAY_WEBHOOK" as const,
    target,
    expectedVersion: "a".repeat(64) as never,
    reasonCode: "OPERATOR_REVIEW" as const,
    confirmed: true as const,
  };
  await api.mutate(command, id);
  expect(new Headers(calls[0]!.headers).get("idempotency-key")).toBe(id);
  expect(JSON.parse(calls[0]!.body as string)).not.toHaveProperty(
    "idempotencyKey",
  );
  wrong = true;
  await expect(api.mutate(command, id)).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});

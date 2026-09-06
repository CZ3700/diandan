import { describe, expect, it } from "vitest";
import { adminMutationResponseSchema } from "@fan-support/contracts";
import { createAdminClient } from "./client";
const success = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MUTATION",
  resultId: "10000000-0000-4000-8000-000000000001",
  replayed: false,
};
describe("browser administrative transport", () => {
  it("keeps uncertain mutation identity, strips authority from the URL and separates action/idempotency headers", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const transport = (async (
      url: RequestInfo | URL,
      init: RequestInit = {},
    ) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) throw new Error("connection lost");
      return Response.json(success);
    }) as typeof fetch;
    const client = createAdminClient(
      () => "csrf-private",
      () => {},
      transport,
    );
    const command = {
      schemaVersion: 1,
      action: "COPY",
      reasonCode: "CONTENT_UPDATE",
      sourceRevisionId: success.resultId,
    };
    await expect(
      client.call("authoring-copy", command, adminMutationResponseSchema, true),
    ).rejects.toThrow("NETWORK_ERROR");
    await client.call(
      "authoring-copy",
      command,
      adminMutationResponseSchema,
      true,
    );
    expect(calls[0]?.url).toBe("/api/admin/authoring-copy");
    expect(calls[1]?.init.headers).toEqual(calls[0]?.init.headers);
    expect(JSON.parse(String(calls[0]?.init.body))).not.toHaveProperty(
      "action",
    );
    expect(calls[0]?.init).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    expect(new Headers(calls[0]?.init.headers).get("X-CSRF-Token")).toBe(
      "csrf-private",
    );
  });
  it("does not turn authentication failures or invalid success shapes into a saved result", async () => {
    let expired = 0;
    const client = createAdminClient(
      () => "csrf-private",
      () => {
        expired++;
      },
      (async () =>
        Response.json(
          { schemaVersion: 1, outcome: "FAILURE", code: "UNAUTHENTICATED" },
          { status: 401 },
        )) as typeof fetch,
    );
    await expect(
      client.call(
        "authoring-read",
        { schemaVersion: 1 },
        adminMutationResponseSchema,
      ),
    ).rejects.toThrow();
    expect(expired).toBeGreaterThan(0);
    const malformed = createAdminClient(
      () => "csrf-private",
      () => {},
      (async () =>
        Response.json({ ...success, resultId: "invalid" })) as typeof fetch,
    );
    await expect(
      malformed.call(
        "authoring-copy",
        { schemaVersion: 1 },
        adminMutationResponseSchema,
        true,
      ),
    ).rejects.toThrow("INVALID_RESPONSE");
  });
});

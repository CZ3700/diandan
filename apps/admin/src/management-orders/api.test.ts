import { expect, test } from "vitest";
import { createAdminClient } from "../workspace/client";
import * as orders from "./api";
const id = "10000000-0000-4000-8000-000000000001";
test("order client binds list pagination and private read target to the requested command", async () => {
  expect(orders.createOrdersApi).toBeTypeOf("function");
  const client = createAdminClient(
    () => "csrf",
    () => {},
    async () =>
      Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "LIST",
        page: 2,
        pageSize: 12,
        totalItems: 0,
        items: [],
      }),
  );
  await expect(
    orders.createOrdersApi(client).list({
      page: 1,
      pageSize: 12,
      query: "",
      fulfillment: "ALL",
      moderation: "ALL",
    }),
  ).rejects.toThrow("INVALID_RESPONSE");
  const privateClient = createAdminClient(
    () => "csrf",
    () => {},
    async () =>
      Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MESSAGE",
        orderId: id,
        itemId: id,
        intentVersion: 2,
        accessId: id,
        expiresAt: "2026-09-19T00:00:00Z",
        reviewLocale: "en",
        content: {
          displayMode: "anonymous",
          fanMessage: "SYNTHETIC_PRIVATE",
          fanMessageLocale: "en",
        },
      }),
  );
  await expect(
    orders.createOrdersApi(privateClient).readMessage({
      orderId: id,
      itemId: id,
      expectedIntentVersion: 1,
      reviewLocale: "en",
    }),
  ).rejects.toThrow("INVALID_RESPONSE");
});

test("note submission supplies the panel-owned retry key and never requests automatic key caching", async () => {
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
        orderId: id,
        resultId: id,
        replayed: false,
      });
    }) as typeof fetch,
  );
  await orders.createOrdersApi(client).addNote(
    {
      orderId: id,
      expectedOrderVersion: 1,
      reasonCode: "OPERATOR_NOTE",
      note: "Synthetic note",
    },
    id,
  );
  expect(new Headers(requests[0]!.headers).get("idempotency-key")).toBe(id);
});

import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { registerCartEditRoute } from "./cart-edit-route.js";
import { createCartSessionCredentials } from "./cart-session-credentials.js";
const origin = "https://shop.example.invalid";
const itemId = "10000000-0000-4000-8000-000000000001";
const fields = {
  schemaVersion: 1,
  expectedCartVersion: 2,
  expectedItemVersion: 1,
  presentationLocale: "en",
};
const quantity = {
  ...fields,
  change: { kind: "QUANTITY", quantity: 2, observedPriceId: itemId },
};
function setup() {
  const app = Fastify({ logger: false });
  const credentials = createCartSessionCredentials({
    activePepperVersion: "test-v1",
    pepperVersions: ["test-v1"],
    keyManagement: {
      async computeBlindIndex(command) {
        return {
          schemaVersion: 1,
          operation: "COMPUTE_BLIND_INDEX",
          outcome: "SUCCESS",
          value: {
            algorithm: "HMAC_SHA_256",
            keyVersion: command.keyVersion!,
            digestBase64: createHmac("sha256", "TEST_KEY")
              .update(command.purpose)
              .update(command.valueBase64)
              .digest("base64url"),
          },
        };
      },
    },
  });
  const conflict = async () => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "VERSION_CONFLICT",
  });
  const useCases = {
    update: vi.fn<(...args: unknown[]) => Promise<unknown>>(conflict),
    remove: vi.fn<(...args: unknown[]) => Promise<unknown>>(conflict),
    readEditor: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "EDITOR_READ",
      cartItemId: itemId,
      cartVersion: 2,
      itemVersion: 1,
      content: {
        displayMode: "anonymous",
        fanMessageLocale: "en",
        fanMessage: String.fromCodePoint(0x79c1, 0x5bc6),
      },
    })),
  };
  registerCartEditRoute(app, { allowedOrigin: origin, credentials, useCases });
  const send = async (
    method: "PATCH" | "DELETE" | "POST",
    body: unknown = method === "PATCH" ? quantity : fields,
    overrides: Record<string, string> = {},
    pathId = itemId,
  ) => {
    const issued = await credentials.issue();
    const headers = {
      origin,
      "content-type": "application/json",
      cookie: `__Host-fan-cart=${issued.token}`,
      "x-csrf-token": issued.csrfToken,
      "idempotency-key": "cart-edit-test-key-0001",
      ...overrides,
    };
    return app.inject({
      method,
      url: `/api/v1/cart/items/${pathId}${method === "POST" ? "/editor" : ""}`,
      headers,
      payload: JSON.stringify(body),
    });
  };
  return { app, send, useCases };
}
test("edits derive item identity from path and require both versions and header-only idempotency", async () => {
  const { app, send, useCases } = setup();
  try {
    expect((await send("PATCH")).statusCode).toBe(409);
    const [command, context] = useCases.update.mock.calls[0]!;
    expect(command).toEqual({
      ...quantity,
      itemId,
      operation: "UPDATE_CART_ITEM",
    });
    expect(context).toMatchObject({
      schemaVersion: 1,
      idempotencyKey: "cart-edit-test-key-0001",
      accesses: [{ schemaVersion: 1, pepperVersion: "test-v1" }],
    });
    for (const body of [
      { ...quantity, itemId },
      { ...quantity, operation: "UPDATE_CART_ITEM" },
      { ...quantity, expectedCartVersion: undefined },
      { ...quantity, expectedItemVersion: 0 },
      { ...quantity, idempotencyKey: "forged" },
    ])
      expect((await send("PATCH", body)).statusCode).toBe(400);
    expect(
      (await send("PATCH", quantity, { "idempotency-key": "" })).statusCode,
    ).toBe(400);
    expect((await send("DELETE")).statusCode).toBe(409);
    expect(useCases.update).toHaveBeenCalledTimes(1);
    expect(useCases.remove).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
test("explicit editor read requires Origin plus cookie-bound CSRF and never logs or caches private content", async () => {
  const { app, send, useCases } = setup();
  try {
    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      for (const headers of [
        { origin: "https://other.example.invalid" },
        { "x-csrf-token": "wrong" },
        { "sec-fetch-site": "cross-site" },
      ])
        expect(
          (await send(method, method === "PATCH" ? quantity : fields, headers))
            .statusCode,
        ).toBe(403);
      expect(
        (
          await send(method, method === "PATCH" ? quantity : fields, {
            cookie: "",
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(useCases.readEditor).not.toHaveBeenCalled();
    const response = await send("POST", fields, { "idempotency-key": "" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      action: "EDITOR_READ",
      cartItemId: itemId,
      content: { displayMode: "anonymous" },
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(useCases.readEditor.mock.calls[0]![1]).not.toHaveProperty(
      "idempotencyKey",
    );
  } finally {
    await app.close();
  }
});
test("editor and mutation responses cannot cross item identity, versions, operation or privacy shapes", async () => {
  const { app, send, useCases } = setup();
  try {
    for (const override of [
      { cartItemId: "10000000-0000-4000-8000-000000000002" },
      { cartVersion: 3 },
      { itemVersion: 2 },
      { secret: "private-canary" },
    ]) {
      useCases.readEditor.mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "EDITOR_READ",
        cartItemId: itemId,
        cartVersion: 2,
        itemVersion: 1,
        content: { displayMode: "anonymous", fanMessageLocale: "en" },
        ...override,
      });
      const response = await send("POST");
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain("private-canary");
    }
    useCases.update.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "EDITOR_READ",
      cartItemId: itemId,
      cartVersion: 2,
      itemVersion: 1,
      content: { displayMode: "anonymous", fanMessageLocale: "en" },
    });
    expect((await send("PATCH")).statusCode).toBe(503);
    useCases.remove.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CART_EXPIRED",
    });
    const expired = await send("DELETE");
    expect(expired.statusCode).toBe(409);
    expect(expired.headers["set-cookie"]).toContain("Max-Age=0");
  } finally {
    await app.close();
  }
});

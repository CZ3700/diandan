import { describe, expect, it, vi } from "vitest";
import { createCartSession, createCartMutation } from "./cart-session";

const empty = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  action: "READ",
  cart: {
    schemaVersion: 1,
    kind: "CART_RUNTIME",
    version: 1,
    status: "ACTIVE",
    presentationLocale: "en",
    market: "TEST",
    currency: "USD",
    expiresAt: "2026-09-09T00:00:00Z",
    items: [],
  },
} as const;
const reply = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-csrf-token": "test-csrf",
    },
  });
describe("cart in-memory session", () => {
  it("keeps the exact body and key for an unknown mutation and never retries by itself", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(empty))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        reply({
          ...empty,
          action: "REMOVED",
          cartItemId: "10000000-0000-4000-8000-000000000001",
        }),
      );
    const session = createCartSession("en", fetcher);
    await session.read();
    const request = createCartMutation(
      "DELETE",
      "/api/storefront/cart/items/10000000-0000-4000-8000-000000000001",
      {
        schemaVersion: 1,
        expectedCartVersion: 1,
        expectedItemVersion: 1,
        presentationLocale: "en",
      },
    );
    expect((await session.mutate(request)).outcome).toBe("UNKNOWN");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await session.mutate(request)).outcome).toBe("SUCCESS");
    expect(fetcher.mock.calls[1]?.[1].body).toBe(
      fetcher.mock.calls[2]?.[1].body,
    );
    expect(fetcher.mock.calls[1]?.[1].headers["Idempotency-Key"]).toBe(
      fetcher.mock.calls[2]?.[1].headers["Idempotency-Key"],
    );
  });
  it("does not expose an editor response in the ordinary cart snapshot", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      reply({
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "EDITOR_READ",
        cartItemId: "10000000-0000-4000-8000-000000000001",
        cartVersion: 1,
        itemVersion: 1,
        content: {
          displayMode: "nickname",
          displayName: "PRIVATE_CANARY",
          fanMessageLocale: "en",
        },
      }),
    );
    const session = createCartSession("en", fetcher);
    await session.read();
    expect(session.snapshot().status).toBe("error");
    expect(JSON.stringify(session.snapshot())).not.toContain("PRIVATE_CANARY");
  });
  it("does not commit a late read after a newer authoritative response", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce(
        reply({ ...empty, cart: { ...empty.cart, version: 2 } }),
      );
    const session = createCartSession("en", fetcher);
    const first = session.read();
    await session.read();
    resolve(reply(empty));
    await first;
    expect(session.snapshot().cart?.version).toBe(2);
  });
});

it("refreshes after a successful write that was overtaken by a read", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(empty))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValueOnce(reply(empty))
    .mockResolvedValueOnce(
      reply({ ...empty, cart: { ...empty.cart, version: 2 } }),
    );
  const session = createCartSession("en", fetcher);
  await session.read();
  const mutation = session.mutate(
    createCartMutation(
      "DELETE",
      "/api/storefront/cart/items/10000000-0000-4000-8000-000000000001",
      { schemaVersion: 1 },
    ),
  );
  await session.read();
  resolve(
    reply({
      ...empty,
      action: "REMOVED",
      cartItemId: "10000000-0000-4000-8000-000000000001",
      cart: { ...empty.cart, version: 2 },
    }),
  );
  await mutation;
  expect(session.snapshot().cart?.version).toBe(2);
});

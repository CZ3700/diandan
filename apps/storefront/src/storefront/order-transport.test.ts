import { afterEach, expect, test, vi } from "vitest";
import {
  cartTestCsrf,
  checkoutTestId,
  orderTestCsrf,
  orderTestGrant,
  orderTestId,
  orderTestRead,
  orderTestResponse,
  orderTestRevoked,
  orderTestToken,
  otherOrderTestId,
} from "../server/order-test-support";
const load = () => import("./order-transport").catch(() => null);
const reply = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  orderTestResponse(data, status, {
    ...(status === 200 && data !== orderTestRevoked
      ? { "x-csrf-token": orderTestCsrf }
      : {}),
    ...headers,
  });
afterEach(() => vi.useRealTimers());
test("exchange, bootstrap, read and revoke have fixed routes and isolated in-memory CSRF", async () => {
  const mod = await load();
  expect(mod?.createOrderTransport).toBeTypeOf("function");
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply(orderTestGrant))
    .mockResolvedValueOnce(reply(orderTestRead))
    .mockResolvedValueOnce(reply(orderTestRevoked))
    .mockResolvedValueOnce(reply(orderTestGrant));
  const transport = mod!.createOrderTransport(fetcher);
  expect((await transport.exchange(orderTestToken)).outcome).toBe("SUCCESS");
  expect((await transport.read(orderTestId)).outcome).toBe("SUCCESS");
  expect((await transport.revoke(orderTestId)).outcome).toBe("SUCCESS");
  expect((await transport.revoke(orderTestId)).outcome).toBe("FAILURE");
  expect(
    (await transport.bootstrap(checkoutTestId, cartTestCsrf)).outcome,
  ).toBe("SUCCESS");
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
    "/api/storefront/order-access/exchange",
    `/api/storefront/orders/${orderTestId}`,
    "/api/storefront/order-access/revoke",
    `/api/storefront/checkout/sessions/${checkoutTestId}/order-access`,
  ]);
  for (const [, options] of fetcher.mock.calls) {
    expect(options).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(new Headers(options?.headers).has("authorization")).toBe(false);
  }
  expect(
    new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("x-csrf-token"),
  ).toBe(false);
  expect(
    new Headers(fetcher.mock.calls[1]?.[1]?.headers).has("x-csrf-token"),
  ).toBe(false);
  expect(
    new Headers(fetcher.mock.calls[2]?.[1]?.headers).get("x-csrf-token"),
  ).toBe(orderTestCsrf);
  expect(
    new Headers(fetcher.mock.calls[3]?.[1]?.headers).get("x-csrf-token"),
  ).toBe(cartTestCsrf);
});
test("unknown actions, forged status, wrong scope, extra private data and invalid CSRF become UNKNOWN", async () => {
  const mod = await load();
  expect(mod?.createOrderTransport).toBeTypeOf("function");
  for (const response of [
    reply(orderTestGrant),
    reply(orderTestRead, 201),
    reply({
      ...orderTestRead,
      order: { ...orderTestRead.order, publicOrderId: otherOrderTestId },
    }),
    reply({ ...orderTestRead, email: "secret@example.test" }),
    reply(orderTestRead, 200, { "x-csrf-token": "" }),
    reply(orderTestRead, 200, { "x-csrf-token": "B".repeat(43) }),
    reply(orderTestRead, 200, { "cache-control": "public" }),
  ]) {
    const transport = mod!.createOrderTransport(async () => response);
    expect(await transport.read(orderTestId)).toEqual({
      schemaVersion: 1,
      outcome: "UNKNOWN",
    });
    expect((await transport.revoke(orderTestId)).outcome).toBe("FAILURE");
  }
});
test("invalid inputs and cross-order revoke never dispatch", async () => {
  const mod = await load();
  expect(mod?.createOrderTransport).toBeTypeOf("function");
  const fetcher = vi.fn<typeof fetch>(async () => reply(orderTestRead));
  const transport = mod!.createOrderTransport(fetcher);
  for (const result of [
    await transport.exchange("invalid"),
    await transport.read("invalid"),
    await transport.bootstrap("invalid", cartTestCsrf),
    await transport.bootstrap(checkoutTestId, ""),
    await transport.revoke(orderTestId),
  ])
    expect(result.outcome).toBe("FAILURE");
  expect(fetcher).not.toHaveBeenCalled();
  await transport.read(orderTestId);
  expect((await transport.revoke(otherOrderTestId)).outcome).toBe("FAILURE");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("429 exposes validated retry delay and access denial clears authority", async () => {
  const mod = await load();
  expect(mod?.createOrderTransport).toBeTypeOf("function");
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply(orderTestRead))
    .mockResolvedValueOnce(
      reply(
        { schemaVersion: 1, outcome: "FAILURE", code: "RATE_LIMITED" },
        429,
        { "retry-after": "12" },
      ),
    )
    .mockResolvedValueOnce(
      reply(
        { schemaVersion: 1, outcome: "FAILURE", code: "ACCESS_DENIED" },
        401,
      ),
    );
  const transport = mod!.createOrderTransport(fetcher);
  await transport.read(orderTestId);
  expect(await transport.read(orderTestId)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "RATE_LIMITED",
    retryAfterSeconds: 12,
  });
  await transport.read(orderTestId);
  expect((await transport.revoke(orderTestId)).outcome).toBe("FAILURE");
  expect(fetcher).toHaveBeenCalledTimes(3);
  const invalid = mod!.createOrderTransport(async () =>
    reply({ schemaVersion: 1, outcome: "FAILURE", code: "RATE_LIMITED" }, 429, {
      "retry-after": "0",
    }),
  );
  expect((await invalid.read(orderTestId)).outcome).toBe("UNKNOWN");
});
test("dispose aborts an uncooperative late response and permanently disables the old transport", async () => {
  const mod = await load();
  expect(mod?.createOrderTransport).toBeTypeOf("function");
  let resolve!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    signal = options?.signal;
    return new Promise<Response>((done) => {
      resolve = done;
    });
  });
  const transport = mod!.createOrderTransport(fetcher);
  const pending = transport.exchange(orderTestToken);
  transport.dispose();
  expect(signal?.aborted).toBe(true);
  expect((await pending).outcome).toBe("UNKNOWN");
  resolve(reply(orderTestGrant));
  expect((await transport.read(orderTestId)).outcome).toBe("UNKNOWN");
  expect((await transport.revoke(orderTestId)).outcome).toBe("UNKNOWN");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("stale read cannot restore credentials after revoke or a newer grant", async () => {
  const mod = await load();
  expect(mod?.createOrderTransport).toBeTypeOf("function");
  let resolve!: (response: Response) => void;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply(orderTestRead))
    .mockImplementationOnce(
      async () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(reply(orderTestRevoked));
  const transport = mod!.createOrderTransport(fetcher);
  await transport.read(orderTestId);
  const pending = transport.read(orderTestId);
  await transport.revoke(orderTestId);
  resolve(reply(orderTestRead));
  expect((await pending).outcome).toBe("UNKNOWN");
  expect((await transport.revoke(orderTestId)).outcome).toBe("FAILURE");
  expect(fetcher).toHaveBeenCalledTimes(3);
});
test("deadline covers fetch and stalled response reading without a retry or resubmission", async () => {
  const mod = await load();
  expect(mod?.createOrderTransport).toBeTypeOf("function");
  vi.useFakeTimers();
  for (const fetcher of [
    vi.fn<typeof fetch>(async () => new Promise<Response>(() => {})),
    vi.fn<typeof fetch>(
      async () =>
        new Response(new ReadableStream(), {
          headers: {
            "content-type": "application/json",
            "cache-control": "private, no-store",
            "referrer-policy": "no-referrer",
            "x-robots-tag": "noindex, nofollow",
          },
        }),
    ),
  ]) {
    const transport = mod!.createOrderTransport(fetcher);
    const pending = transport.read(orderTestId);
    await vi.advanceTimersByTimeAsync(30_001);
    expect((await pending).outcome).toBe("UNKNOWN");
    expect(fetcher).toHaveBeenCalledTimes(1);
    transport.dispose();
  }
});

test("locate posts only the public number, keeps no authority and never dispatches malformed numbers", async () => {
  const mod = await load();
  expect(mod?.createOrderTransport).toBeTypeOf("function");
  const located = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "LOCATED",
    publicOrderId: orderTestId,
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(orderTestResponse(located, 200))
    .mockResolvedValueOnce(
      orderTestResponse(located, 200, { "x-csrf-token": orderTestCsrf }),
    );
  const transport = mod!.createOrderTransport(fetcher);
  for (const invalid of ["fs-7k3m9c", "7K3M9C", orderTestId])
    expect((await transport.locate(invalid)).outcome).toBe("FAILURE");
  expect(fetcher).not.toHaveBeenCalled();
  expect(await transport.locate("FS-7K3M9C")).toEqual(located);
  const [path, options] = fetcher.mock.calls[0]!;
  expect(path).toBe("/api/storefront/order-access/locate");
  expect(options).toMatchObject({ method: "POST", credentials: "same-origin" });
  expect(JSON.parse(String(options?.body))).toEqual({
    schemaVersion: 1,
    publicOrderNo: "FS-7K3M9C",
  });
  expect(new Headers(options?.headers).has("x-csrf-token")).toBe(false);
  // A located reply grants nothing: revocation still needs a real read's CSRF proof.
  expect((await transport.revoke(orderTestId)).outcome).toBe("FAILURE");
  // A locate reply carrying a CSRF proof is forged and becomes UNKNOWN.
  expect((await transport.locate("FS-7K3M9C")).outcome).toBe("UNKNOWN");
});

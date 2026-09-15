import { expect, it, vi } from "vitest";
import {
  currentFixture,
  checkoutTestId,
  attemptTestId,
} from "../test-support/checkout-fixtures";
const load = () => import("./checkout-transport").catch(() => null);
const reply = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
      "x-csrf-token": "a".repeat(43),
    },
  });
it("reads only same-origin endpoints and explicitly reuses a frozen mutation after response loss", async () => {
  const loaded = await load();
  expect(loaded?.createCheckoutTransport).toBeTypeOf("function");
  if (!loaded) return;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(currentFixture))
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(
      reply({
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "RECOVERED",
        attempt: currentFixture.attempt,
      }),
    );
  const transport = loaded.createCheckoutTransport("en", fetcher);
  await transport.request(loaded.checkoutCalls.current());
  const call = loaded.checkoutCalls.recover(checkoutTestId, attemptTestId);
  expect((await transport.request(call)).outcome).toBe("UNKNOWN");
  expect(fetcher).toHaveBeenCalledTimes(2);
  await transport.request(call);
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    body: '{"schemaVersion":1}',
  });
  expect(fetcher.mock.calls[1]?.[1].headers).toEqual(
    fetcher.mock.calls[2]?.[1].headers,
  );
  expect(fetcher.mock.calls[1]?.[1].headers["Idempotency-Key"]).toBeTruthy();
});
it("rejects wrong session, private additions and a forged success status", async () => {
  const loaded = await load();
  expect(loaded?.createCheckoutTransport).toBeTypeOf("function");
  if (!loaded) return;
  for (const data of [
    { ...currentFixture, email: "private@example.test" },
    {
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "READ",
      attempt: { ...currentFixture.attempt, checkoutSessionId: attemptTestId },
    },
  ]) {
    const transport = loaded.createCheckoutTransport(
      "ja",
      vi.fn().mockResolvedValue(reply(data)),
    );
    expect(
      (
        await transport.request(
          loaded.checkoutCalls.attempt(checkoutTestId, attemptTestId),
        )
      ).outcome,
    ).toBe("UNKNOWN");
  }
});
it("advertises REDIRECT only, without inferring country or sending schemaVersion as query", async () => {
  const loaded = await load();
  expect(loaded?.checkoutCalls).toBeTruthy();
  if (!loaded) return;
  const url = new URL(
    loaded.checkoutCalls.capabilities(checkoutTestId, "ja").path,
    "https://storefront.example",
  );
  expect([...url.searchParams]).toEqual([
    ["presentationLocale", "ja"],
    ["supportedActionTypes", "REDIRECT"],
  ]);
});

it("uses cart CSRF only in the explicit order bootstrap bridge and clears it on dispose", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing transport");
  const transport = loaded.createCheckoutTransport(
    "en",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(currentFixture), {
        headers: {
          "content-type": "application/json",
          "x-csrf-token": "A".repeat(43),
        },
      }),
    ),
  );
  const bootstrap = vi.fn().mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "PAYMENT_NOT_CONFIRMED",
  });
  expect(
    (transport as unknown as { authorizeOrder?: unknown }).authorizeOrder,
  ).toBeTypeOf("function");
  if (!("authorizeOrder" in transport)) return;
  await transport.request(loaded.checkoutCalls.current());
  await transport.authorizeOrder(checkoutTestId, bootstrap);
  expect(bootstrap).toHaveBeenCalledWith(checkoutTestId, "A".repeat(43));
  transport.dispose();
  await transport.authorizeOrder(checkoutTestId, bootstrap);
  expect(bootstrap).toHaveBeenCalledTimes(1);
});

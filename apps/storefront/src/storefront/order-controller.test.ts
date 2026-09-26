import { expect, it, vi } from "vitest";
const load = () => import("./order-controller").catch(() => null);
const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const denied = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "ACCESS_DENIED",
} as const;
const grant = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  action: "GRANTED",
  grant: {
    schemaVersion: 1,
    publicOrderId: id,
    expiresAt: "2099-01-01T00:00:00Z",
  },
} as const;
function transport() {
  return {
    read: vi.fn().mockResolvedValue(denied),
    exchange: vi.fn().mockResolvedValue(grant),
    bootstrap: vi.fn(),
    locate: vi.fn(),
    revoke: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "REVOKED",
      publicOrderId: id,
    }),
    dispose: vi.fn(),
  };
}
it("binds the exchanged grant to the link hint before attempting any read", async () => {
  const loaded = await load();
  expect(loaded?.createOrderController).toBeTypeOf("function");
  if (!loaded) return;
  const api = transport(),
    controller = loaded.createOrderController(() => api);
  await controller.exchange({ token: "A".repeat(43), publicOrderId: other });
  expect(api.read).not.toHaveBeenCalled();
  expect(controller.snapshot().error).toBe("ACCESS_DENIED");
  expect(JSON.stringify(controller.snapshot())).not.toContain("A".repeat(43));
});
it("recovers an unknown exchange only using the known ID and never retries a token", async () => {
  const loaded = await load();
  expect(loaded?.createOrderController).toBeTypeOf("function");
  if (!loaded) return;
  const api = transport();
  api.exchange.mockResolvedValue({ schemaVersion: 1, outcome: "UNKNOWN" });
  const controller = loaded.createOrderController(() => api);
  await controller.exchange({ token: "A".repeat(43), publicOrderId: id });
  await controller.retry();
  expect(api.exchange).toHaveBeenCalledTimes(1);
  expect(api.read.mock.calls).toEqual([[id], [id]]);
});
it("does not recover a definitely rejected token as a renewed authorization", async () => {
  const loaded = await load();
  expect(loaded?.createOrderController).toBeTypeOf("function");
  if (!loaded) return;
  const api = transport();
  api.exchange.mockResolvedValue(denied);
  const controller = loaded.createOrderController(() => api);
  await controller.exchange({ token: "A".repeat(43), publicOrderId: id });
  expect(api.read).not.toHaveBeenCalled();
  expect(controller.snapshot().error).toBe("ACCESS_DENIED");
});
it("disposal suppresses stale responses and actions; a new read validates afresh", async () => {
  const loaded = await load();
  expect(loaded?.createOrderController).toBeTypeOf("function");
  if (!loaded) return;
  const api = transport();
  let done!: (value: unknown) => void;
  api.read.mockImplementationOnce(
    () =>
      new Promise((r) => {
        done = r;
      }),
  );
  const controller = loaded.createOrderController(() => api);
  const reading = controller.read(id);
  controller.dispose();
  done(denied);
  await reading;
  await controller.retry();
  expect(api.read).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().error).toBeNull();
  await controller.read(other);
  expect(api.read).toHaveBeenCalledTimes(2);
  expect(controller.snapshot().publicOrderId).toBe(other);
});
it("honors Retry-After and does not rotate a session during a read-only retry", async () => {
  const loaded = await load();
  expect(loaded?.createOrderController).toBeTypeOf("function");
  if (!loaded) return;
  const api = transport();
  let now = 0;
  api.read.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "RATE_LIMITED",
    retryAfterSeconds: 20,
  });
  const controller = loaded.createOrderController(
    () => api,
    () => now,
  );
  await controller.read(id);
  await controller.retry();
  expect(api.read).toHaveBeenCalledTimes(1);
  now = 20001;
  await controller.retry();
  expect(api.read).toHaveBeenCalledTimes(2);
  expect(api.bootstrap).not.toHaveBeenCalled();
});
it("grants checkout access only after an existing session is rejected and checks the canonical order ID", async () => {
  const loaded = await load();
  expect(loaded?.createOrderController).toBeTypeOf("function");
  if (!loaded) return;
  const api = transport(),
    bootstrap = vi.fn().mockResolvedValue({
      ...grant,
      grant: { ...grant.grant, publicOrderId: other },
    });
  const controller = loaded.createOrderController(() => api);
  await controller.fromCheckout(id, bootstrap);
  expect(bootstrap).toHaveBeenCalledTimes(1);
  expect(api.read).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().error).toBe("ACCESS_DENIED");
});

it("uses an existing authorized order without rotating access and clears it when a later read is denied", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const { orderFixture } = await import("../test-support/order-fixtures");
  const api = transport();
  api.read.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "READ",
    order: orderFixture,
  });
  const bootstrap = vi.fn(),
    controller = loaded.createOrderController(() => api);
  await controller.fromCheckout(id, bootstrap);
  expect(controller.snapshot().order).toEqual(orderFixture);
  expect(bootstrap).not.toHaveBeenCalled();
  await controller.retry();
  expect(controller.snapshot().order).toBeNull();
  expect(controller.snapshot().error).not.toBeNull();
});
it("clears visible order data while revoke is pending and never resurrects it on a lost response", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const { orderFixture } = await import("../test-support/order-fixtures");
  const api = transport();
  api.read.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "READ",
    order: orderFixture,
  });
  let finish!: (value: unknown) => void;
  api.revoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = loaded.createOrderController(() => api);
  await controller.read(id);
  const pending = controller.revoke();
  expect(controller.snapshot().order).toBeNull();
  finish({ schemaVersion: 1, outcome: "UNKNOWN" });
  await pending;
  expect(controller.snapshot().order).toBeNull();
  expect(controller.snapshot().error).toBe("TEMPORARY_UNAVAILABLE");
});
it("a stale earlier order response cannot overwrite the newer order scope", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const { orderFixture } = await import("../test-support/order-fixtures");
  const api = transport();
  let finish!: (value: unknown) => void;
  api.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = loaded.createOrderController(() => api);
  const first = controller.read(id);
  await controller.read(other);
  finish({
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "READ",
    order: orderFixture,
  });
  await first;
  expect(controller.snapshot()).toMatchObject({
    publicOrderId: other,
    order: null,
    error: "ACCESS_DENIED",
  });
});

it("accepts uppercase UUID hints without consuming a valid link into an error", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const { orderFixture } = await import("../test-support/order-fixtures");
  const lower = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const api = transport();
  api.exchange.mockResolvedValue({
    ...grant,
    grant: { ...grant.grant, publicOrderId: lower },
  });
  api.read.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "READ",
    order: { ...orderFixture, publicOrderId: lower },
  });
  const controller = loaded.createOrderController(() => api);
  await controller.exchange({
    token: "A".repeat(43),
    publicOrderId: lower.toUpperCase(),
  });
  expect(controller.snapshot().order?.publicOrderId).toBe(lower);
  expect(controller.snapshot().error).toBeNull();
});
it("retry continues a lost revocation, keeping read data hidden while it refreshes CSRF", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const { orderFixture } = await import("../test-support/order-fixtures");
  const api = transport();
  api.read.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "READ",
    order: orderFixture,
  });
  api.revoke.mockResolvedValueOnce({ schemaVersion: 1, outcome: "UNKNOWN" });
  const controller = loaded.createOrderController(() => api);
  await controller.read(id);
  await controller.revoke();
  const visible: unknown[] = [];
  controller.subscribe(() => visible.push(controller.snapshot().order));
  await controller.retry();
  expect(api.revoke).toHaveBeenCalledTimes(2);
  expect(visible.every((value) => value === null)).toBe(true);
  expect(controller.snapshot().revoked).toBe(true);
});
it("suspension clears private details but preserves a pending close operation across page restoration", async () => {
  const loaded = await load();
  if (!loaded) throw new Error("Missing controller");
  const { orderFixture } = await import("../test-support/order-fixtures");
  const api = transport();
  api.read.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "READ",
    order: orderFixture,
  });
  api.revoke.mockResolvedValueOnce({ schemaVersion: 1, outcome: "UNKNOWN" });
  const controller = loaded.createOrderController(() => api);
  await controller.read(id);
  await controller.revoke();
  expect((controller as unknown as { suspend?: unknown }).suspend).toBeTypeOf(
    "function",
  );
  if (!("suspend" in controller)) return;
  controller.suspend();
  expect(controller.snapshot().order).toBeNull();
  await controller.resume();
  expect(controller.snapshot().revoked).toBe(true);
  expect(api.revoke).toHaveBeenCalledTimes(2);
});

it("locates a public number without reading or rotating access and reports denial", async () => {
  const loaded = await load();
  expect(loaded?.createOrderController).toBeTypeOf("function");
  if (!loaded) return;
  const api = transport();
  api.locate
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "LOCATED",
      publicOrderId: id,
    })
    .mockResolvedValueOnce(denied);
  const controller = loaded.createOrderController(() => api);
  expect(await controller.locate("FS-7K3M9C")).toBe(id);
  expect(controller.snapshot()).toMatchObject({ busy: false, error: null });
  expect(await controller.locate("FS-7K3M9C")).toBeNull();
  expect(controller.snapshot()).toMatchObject({
    busy: false,
    error: "ACCESS_DENIED",
    order: null,
  });
  expect(api.locate).toHaveBeenCalledWith("FS-7K3M9C");
  expect(api.read).not.toHaveBeenCalled();
  expect(api.exchange).not.toHaveBeenCalled();
});

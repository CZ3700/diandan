import { expect, test, vi } from "vitest";

const outboxJob = Object.freeze({
  schemaVersion: 1 as const,
  jobType: "DISPATCH_OUTBOX_EVENT" as const,
  outboxEventId: "10000000-0000-4000-8000-000000000001",
  consumerKey: "notification-provider",
  correlationId: "20000000-0000-4000-8000-000000000001",
  propagation: Object.freeze({
    schemaVersion: 1 as const,
    requestId: "30000000-0000-4000-8000-000000000001",
    traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
  }),
});

async function loadRuntimeFactory() {
  const module = (await import("./reliable-events-runtime.js").catch(
    () => undefined,
  )) as
    | Readonly<{
        createReliableEventsWorkerRuntime?: (options: unknown) => Readonly<{
          start(): Promise<void>;
          stop(): Promise<void>;
          runMaintenanceOnce(): Promise<void>;
        }>;
      }>
    | undefined;
  return module?.createReliableEventsWorkerRuntime;
}

function createHarness() {
  let scheduledTick: (() => void) | undefined;
  const cancel = vi.fn();
  const handlers: unknown[] = [];
  const queue = {
    start: vi.fn(async (nextHandlers: unknown) => {
      handlers.push(nextHandlers);
    }),
    stop: vi.fn(async () => undefined),
    publishOutboxDispatch: vi.fn(async () => undefined),
  };
  const processWebhookInbox = vi.fn(async () => undefined);
  const dispatchOutboxEvent = vi.fn(async () => undefined);
  const listReadyOutboxJobs = vi.fn(async () => [outboxJob]);
  const purgeExpiredWebhookPayloads = vi.fn(async () => ({
    purgedPayloadIds: [],
    purgedCount: 0,
  }));
  const notices: unknown[] = [];
  const options = {
    schemaVersion: 1,
    queue,
    processWebhookInbox,
    dispatchOutboxEvent,
    listReadyOutboxJobs,
    purgeExpiredWebhookPayloads,
    consumerKeys: ["notification-provider"],
    now: () => "2026-09-04T03:00:00.000Z",
    createPropagation: () => outboxJob.propagation,
    intervalMs: 5_000,
    batchSize: 100,
    schedule: (tick: () => void, intervalMs: number) => {
      expect(intervalMs).toBe(5_000);
      scheduledTick = tick;
      return { cancel };
    },
    onNotice: (notice: unknown) => {
      notices.push(notice);
    },
  };
  return {
    cancel,
    dispatchOutboxEvent,
    handlers,
    listReadyOutboxJobs,
    notices,
    options,
    processWebhookInbox,
    purgeExpiredWebhookPayloads,
    queue,
    scheduledTick: () => scheduledTick,
  };
}

test("starts queue handlers and relays ID-only outbox jobs on a scheduled tick", async () => {
  const factory = await loadRuntimeFactory();
  expect(factory, "the reliable event worker runtime must exist").toBeDefined();
  if (factory === undefined) {
    return;
  }
  const harness = createHarness();
  const runtime = factory(harness.options);

  await runtime.start();
  expect(harness.queue.start).toHaveBeenCalledTimes(1);
  expect(harness.handlers).toHaveLength(1);
  const registered = harness.handlers[0] as Readonly<{
    processWebhookInbox(job: unknown, delivery: unknown): Promise<void>;
    dispatchOutboxEvent(job: unknown, delivery: unknown): Promise<void>;
  }>;
  await registered.processWebhookInbox({ id: "inbox" }, { attemptNumber: 1 });
  await registered.dispatchOutboxEvent({ id: "outbox" }, { attemptNumber: 1 });
  expect(harness.processWebhookInbox).toHaveBeenCalledWith(
    { id: "inbox" },
    { attemptNumber: 1 },
  );
  expect(harness.dispatchOutboxEvent).toHaveBeenCalledWith(
    { id: "outbox" },
    { attemptNumber: 1 },
  );

  harness.scheduledTick()?.();
  await runtime.runMaintenanceOnce();

  expect(harness.listReadyOutboxJobs).toHaveBeenCalledWith({
    schemaVersion: 1,
    operation: "LIST_READY_OUTBOX_EVENTS",
    consumerKey: "notification-provider",
    availableAtOrBefore: "2026-09-04T03:00:00.000Z",
    limit: 100,
    propagation: outboxJob.propagation,
  });
  expect(harness.queue.publishOutboxDispatch).toHaveBeenCalledWith(outboxJob);
  expect(harness.purgeExpiredWebhookPayloads).toHaveBeenCalledWith({
    schemaVersion: 1,
    operation: "PURGE_EXPIRED_WEBHOOK_PAYLOADS",
    expiredAtOrBefore: "2026-09-04T03:00:00.000Z",
    purgedAt: "2026-09-04T03:00:00.000Z",
    limit: 100,
  });

  await runtime.stop();
  expect(harness.cancel).toHaveBeenCalledTimes(1);
  expect(harness.queue.stop).toHaveBeenCalledTimes(1);
});

test("contains maintenance failures and emits only allowlisted notices", async () => {
  const factory = await loadRuntimeFactory();
  expect(factory).toBeDefined();
  if (factory === undefined) {
    return;
  }
  const harness = createHarness();
  const canary = "PRIVATE_WEBHOOK_PAYLOAD_74219";
  harness.options.listReadyOutboxJobs = vi.fn(async () => {
    throw new Error(canary);
  });
  harness.options.purgeExpiredWebhookPayloads = vi.fn(async () => {
    throw new Error(canary);
  });
  harness.options.onNotice = (notice: unknown) => {
    harness.notices.push(notice);
    throw new Error(canary);
  };
  const runtime = factory(harness.options);

  await runtime.start();
  await expect(runtime.runMaintenanceOnce()).resolves.toBeUndefined();

  expect(harness.notices).toEqual([
    {
      schemaVersion: 1,
      severity: "WARNING",
      code: "OUTBOX_RELAY_FAILED",
    },
    {
      schemaVersion: 1,
      severity: "WARNING",
      code: "PAYLOAD_PURGE_FAILED",
    },
  ]);
  expect(JSON.stringify(harness.notices)).not.toContain(canary);
  await runtime.stop();
});

test("is idempotent and waits for an in-flight maintenance pass before stopping", async () => {
  const factory = await loadRuntimeFactory();
  expect(factory).toBeDefined();
  if (factory === undefined) {
    return;
  }
  const harness = createHarness();
  let finishList: (() => void) | undefined;
  harness.options.listReadyOutboxJobs = vi.fn(
    () =>
      new Promise<(typeof outboxJob)[]>((resolve) => {
        finishList = () => resolve([outboxJob]);
      }),
  );
  const runtime = factory(harness.options);

  const firstStart = runtime.start();
  const secondStart = runtime.start();
  expect(secondStart).toBe(firstStart);
  await firstStart;

  const maintenance = runtime.runMaintenanceOnce();
  await vi.waitFor(() => expect(finishList).toBeTypeOf("function"));
  const stop = runtime.stop();
  await Promise.resolve();
  expect(harness.queue.stop).not.toHaveBeenCalled();
  finishList?.();
  await maintenance;
  await stop;
  expect(harness.queue.stop).toHaveBeenCalledTimes(1);
  expect(runtime.stop()).toBe(stop);
});

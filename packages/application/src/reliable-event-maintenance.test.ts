import { expect, test, vi } from "vitest";
import type { ReliableEventTransactionManager } from "@fan-support/persistence-port";

import {
  createListReadyOutboxJobs,
  createPurgeExpiredWebhookPayloads,
  ReliableEventProcessingError,
} from "./reliable-event-maintenance.js";

const IDS = {
  outbox: "50000000-0000-4000-8000-000000000001",
  alternateOutbox: "50000000-0000-4000-8000-000000000005",
  payload: "50000000-0000-4000-8000-000000000002",
  request: "50000000-0000-4000-8000-000000000003",
  correlation: "50000000-0000-4000-8000-000000000004",
} as const;

const PROPAGATION = {
  schemaVersion: 1,
  requestId: IDS.request,
  traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
} as const;

function success(operation: string, value: unknown) {
  return { schemaVersion: 1, operation, outcome: "SUCCESS", value } as const;
}

function managerWith(repositories: unknown) {
  return {
    runInReliableEventTransaction: vi.fn(
      async (_options: unknown, work: (value: unknown) => unknown) =>
        work(repositories),
    ),
  } as unknown as ReliableEventTransactionManager;
}

test("lists only schema-validated ID-only outbox jobs", async () => {
  const job = {
    schemaVersion: 1,
    jobType: "DISPATCH_OUTBOX_EVENT",
    outboxEventId: IDS.outbox,
    consumerKey: "notification-provider",
    correlationId: IDS.correlation,
    propagation: PROPAGATION,
  } as const;
  const listReady = vi.fn(async () =>
    success("LIST_READY_OUTBOX_EVENTS", { jobs: [job] }),
  );
  const useCase = createListReadyOutboxJobs({
    transactionManager: managerWith({
      outboxDispatch: { listReady },
    }),
  });

  await expect(
    useCase({
      schemaVersion: 1,
      operation: "LIST_READY_OUTBOX_EVENTS",
      consumerKey: job.consumerKey,
      availableAtOrBefore: "2026-09-04T00:00:00.000Z",
      limit: 100,
      propagation: PROPAGATION,
    }),
  ).resolves.toEqual([job]);
});

test("rejects a queue projection that contains payload or sensitive extensions", async () => {
  const listReady = vi.fn(async () =>
    success("LIST_READY_OUTBOX_EVENTS", {
      jobs: [
        {
          schemaVersion: 1,
          jobType: "DISPATCH_OUTBOX_EVENT",
          outboxEventId: IDS.outbox,
          consumerKey: "notification-provider",
          correlationId: IDS.correlation,
          propagation: PROPAGATION,
          payload: "PRIVATE_EVENT_PAYLOAD_21735",
        },
      ],
    }),
  );
  const useCase = createListReadyOutboxJobs({
    transactionManager: managerWith({ outboxDispatch: { listReady } }),
  });

  const failure = await useCase({
    schemaVersion: 1,
    operation: "LIST_READY_OUTBOX_EVENTS",
    consumerKey: "notification-provider",
    availableAtOrBefore: "2026-09-04T00:00:00.000Z",
    limit: 100,
    propagation: PROPAGATION,
  }).catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "PERSISTENCE_FAILURE" });
});

test.each([
  {
    label: "a different consumer",
    command: { consumerKey: "notification-provider", limit: 100 },
    job: { consumerKey: "cache-purge-cdn", propagation: PROPAGATION },
  },
  {
    label: "different propagation",
    command: { consumerKey: "notification-provider", limit: 100 },
    job: {
      consumerKey: "notification-provider",
      propagation: {
        ...PROPAGATION,
        requestId: "50000000-0000-4000-8000-000000000009",
      },
    },
  },
])("rejects queue jobs bound to $label", async ({ command, job }) => {
  const projectedJob = {
    schemaVersion: 1,
    jobType: "DISPATCH_OUTBOX_EVENT",
    outboxEventId: IDS.outbox,
    correlationId: IDS.correlation,
    ...job,
  } as const;
  const useCase = createListReadyOutboxJobs({
    transactionManager: managerWith({
      outboxDispatch: {
        listReady: async () =>
          success("LIST_READY_OUTBOX_EVENTS", { jobs: [projectedJob] }),
      },
    }),
  });

  await expect(
    useCase({
      schemaVersion: 1,
      operation: "LIST_READY_OUTBOX_EVENTS",
      availableAtOrBefore: "2026-09-04T00:00:00.000Z",
      propagation: PROPAGATION,
      ...command,
    }),
  ).rejects.toMatchObject({ code: "PERSISTENCE_FAILURE" });
});

test("rejects a queue projection larger than the requested limit", async () => {
  const job = {
    schemaVersion: 1,
    jobType: "DISPATCH_OUTBOX_EVENT",
    outboxEventId: IDS.outbox,
    consumerKey: "notification-provider",
    correlationId: IDS.correlation,
    propagation: PROPAGATION,
  } as const;
  const useCase = createListReadyOutboxJobs({
    transactionManager: managerWith({
      outboxDispatch: {
        listReady: async () =>
          success("LIST_READY_OUTBOX_EVENTS", {
            jobs: [job, { ...job, outboxEventId: IDS.alternateOutbox }],
          }),
      },
    }),
  });

  await expect(
    useCase({
      schemaVersion: 1,
      operation: "LIST_READY_OUTBOX_EVENTS",
      consumerKey: job.consumerKey,
      availableAtOrBefore: "2026-09-04T00:00:00.000Z",
      limit: 1,
      propagation: PROPAGATION,
    }),
  ).rejects.toMatchObject({ code: "PERSISTENCE_FAILURE" });
});

test("purges expired webhook envelopes while returning identifiers only", async () => {
  const purgeExpired = vi.fn(async () =>
    success("PURGE_EXPIRED_WEBHOOK_PAYLOADS", {
      purgedPayloadIds: [IDS.payload],
      purgedCount: 1,
    }),
  );
  const useCase = createPurgeExpiredWebhookPayloads({
    transactionManager: managerWith({
      webhookPayloadRetention: { purgeExpired },
    }),
  });
  const command = {
    schemaVersion: 1,
    operation: "PURGE_EXPIRED_WEBHOOK_PAYLOADS",
    expiredAtOrBefore: "2026-09-04T00:00:00.000Z",
    purgedAt: "2026-09-04T00:00:00.000Z",
    limit: 100,
  } as const;

  await expect(useCase(command)).resolves.toEqual({
    purgedPayloadIds: [IDS.payload],
    purgedCount: 1,
  });
  expect(purgeExpired).toHaveBeenCalledWith(command);
});

test("rejects invalid maintenance commands before opening a transaction", async () => {
  const transactionManager = managerWith({});
  const list = createListReadyOutboxJobs({ transactionManager });

  const failure = await list({
    schemaVersion: 1,
    operation: "LIST_READY_OUTBOX_EVENTS",
    consumerKey: "INVALID CONSUMER",
    availableAtOrBefore: "2026-09-04T00:00:00.000Z",
    limit: 0,
    propagation: PROPAGATION,
  }).catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "INVALID_JOB" });
  expect(
    transactionManager.runInReliableEventTransaction,
  ).not.toHaveBeenCalled();
});

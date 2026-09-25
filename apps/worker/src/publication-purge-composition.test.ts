import { expect, test, vi } from "vitest";
import { createWorkerPublicationPurgeComposition } from "./publication-purge-composition.js";
const environment = {
  FAN_SUPPORT_DEPLOYMENT_ENV: "test",
  FAN_SUPPORT_DATABASE_URL:
    "postgresql://fixture:fixture@localhost:5432/fixture",
};
test("production purge runtime drains then closes its own pool exactly once", async () => {
  const events: string[] = [];
  const close = vi.fn(async () => {
    events.push("close");
  });
  const composition = await createWorkerPublicationPurgeComposition(
    environment,
    {
      factories: {
        createPersistence: () => ({
          publicationPurgeTransactionManager: {
            runInPublicationPurgeTransaction: async () => {
              throw new Error("not used");
            },
          },
          close,
        }),
        createRuntime: () => ({
          start: async () => {
            events.push("start");
          },
          runOnce: async () => {},
          stop: async () => {
            events.push("stop");
          },
        }),
      },
    },
  );
  await composition.start();
  await Promise.all([composition.stop(), composition.stop()]);
  expect(events).toEqual(["start", "stop", "close"]);
});
test("runtime construction failure closes persistence without exposing provider detail", async () => {
  const close = vi.fn(async () => {});
  await expect(
    createWorkerPublicationPurgeComposition(environment, {
      factories: {
        createPersistence: () => ({
          publicationPurgeTransactionManager: {
            runInPublicationPurgeTransaction: async () => {
              throw new Error("not used");
            },
          },
          close,
        }),
        createRuntime: () => {
          throw new Error("private provider configuration");
        },
      },
    }),
  ).rejects.toThrow("Worker publication purge composition failed");
  expect(close).toHaveBeenCalledOnce();
});

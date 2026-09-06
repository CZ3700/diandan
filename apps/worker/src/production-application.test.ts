import { expect, it, vi } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as production from "./production-application.js";
const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const resource = () => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
});

it("wires media and reliable event runtimes into the production worker", async () => {
  const reliable = resource(),
    media = resource();
  const application = {} as NestFastifyApplication;
  const createApplication = vi.fn(async () => application);
  expect(production.createProductionWorkerApplication).toBeTypeOf("function");
  await expect(
    production.createProductionWorkerApplication(
      {},
      {
        logger,
        factories: {
          createApplication,
          createReliableComposition: () => reliable,
          createMediaComposition: async () => media,
        },
      },
    ),
  ).resolves.toBe(application);
  expect(createApplication).toHaveBeenCalledWith(
    {},
    { logger, reliableEventsRuntime: reliable, mediaProcessingRuntime: media },
  );
});

it("releases constructed resources when worker creation fails", async () => {
  const reliable = resource(),
    media = resource();
  const failure = new Error("controlled startup failure");
  await expect(
    production.createProductionWorkerApplication(
      {},
      {
        logger,
        factories: {
          createApplication: async () => {
            throw failure;
          },
          createReliableComposition: () => reliable,
          createMediaComposition: async () => media,
        },
      },
    ),
  ).rejects.toBe(failure);
  expect(reliable.stop).toHaveBeenCalledTimes(1);
  expect(media.stop).toHaveBeenCalledTimes(1);
});

it("releases the reliable queue if media composition cannot be constructed", async () => {
  const reliable = resource();
  const failure = new Error("controlled composition failure");
  await expect(
    production.createProductionWorkerApplication(
      {},
      {
        logger,
        factories: {
          createApplication: vi.fn(),
          createReliableComposition: () => reliable,
          createMediaComposition: async () => {
            throw failure;
          },
        },
      },
    ),
  ).rejects.toBe(failure);
  expect(reliable.stop).toHaveBeenCalledTimes(1);
});

import "reflect-metadata";

import type { NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import {
  createStructuredLogger,
  type StructuredLogger,
} from "@fan-support/observability";
import { registerFastifyObservability } from "@fan-support/observability/fastify";

import { AppModule } from "./app.module.js";
import { assertWorkerRuntimeConfig } from "./runtime-config.js";
import { SafeHttpExceptionFilter } from "./safe-http-exception.filter.js";

export const workerNestApplicationOptions = Object.freeze({
  abortOnError: false,
  logger: false,
}) satisfies Readonly<NestApplicationOptions>;

export type WorkerLifecycleResource = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
}>;

export type CreateWorkerApplicationOptions = Readonly<{
  logger?: StructuredLogger;
  reliableEventsRuntime?: WorkerLifecycleResource;
}>;

function registerReliableEventsLifecycle(
  adapter: FastifyAdapter,
  runtime: WorkerLifecycleResource | undefined,
): void {
  if (runtime === undefined) {
    return;
  }
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= runtime.stop();
    return stopPromise;
  };
  adapter.getInstance().addHook("onReady", async () => {
    try {
      await runtime.start();
    } catch {
      await stop().catch(() => undefined);
      throw new Error("Worker reliable events failed to start");
    }
  });
  adapter.getInstance().addHook("onClose", async () => {
    try {
      await stop();
    } catch {
      throw new Error("Worker reliable events failed to stop");
    }
  });
}

export async function createWorkerApplication(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: CreateWorkerApplicationOptions = {},
): Promise<NestFastifyApplication> {
  assertWorkerRuntimeConfig(environment);
  const logger =
    options.logger ?? createStructuredLogger({ service: "worker" });
  const adapter = new FastifyAdapter({ logger: false });
  registerFastifyObservability(adapter.getInstance(), {
    service: "worker",
    logger,
  });
  registerReliableEventsLifecycle(adapter, options.reliableEventsRuntime);

  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    workerNestApplicationOptions,
  );
  application.useGlobalFilters(new SafeHttpExceptionFilter());
  return application;
}

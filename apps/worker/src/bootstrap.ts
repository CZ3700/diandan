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
  mediaProcessingRuntime?: WorkerLifecycleResource;
  publicationPurgeRuntime?: WorkerLifecycleResource;
}>;

function registerWorkerLifecycles(
  adapter: FastifyAdapter,
  resources: readonly Readonly<{
    name: string;
    runtime: WorkerLifecycleResource | undefined;
  }>[],
): void {
  const runtimes = resources.filter(
    (
      resource,
    ): resource is Readonly<{
      name: string;
      runtime: WorkerLifecycleResource;
    }> => resource.runtime !== undefined,
  );
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      const results = await Promise.allSettled(
        runtimes.map(({ runtime }) =>
          Promise.resolve().then(() => runtime.stop()),
        ),
      );
      if (results.some((result) => result.status === "rejected"))
        throw new Error("Worker resources failed to stop");
    })();
    return stopPromise;
  };
  adapter.getInstance().addHook("onReady", async () => {
    for (const { name, runtime } of runtimes) {
      try {
        await runtime.start();
      } catch {
        await stop().catch(() => undefined);
        throw new Error(`Worker ${name} failed to start`);
      }
    }
  });
  adapter.getInstance().addHook("onClose", async () => stop());
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
  registerWorkerLifecycles(adapter, [
    { name: "reliable events", runtime: options.reliableEventsRuntime },
    { name: "media processing", runtime: options.mediaProcessingRuntime },
    { name: "publication purge", runtime: options.publicationPurgeRuntime },
  ]);

  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    workerNestApplicationOptions,
  );
  application.useGlobalFilters(new SafeHttpExceptionFilter());
  return application;
}

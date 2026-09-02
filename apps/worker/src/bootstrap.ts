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

export async function createWorkerApplication(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: Readonly<{ logger?: StructuredLogger }> = {},
): Promise<NestFastifyApplication> {
  assertWorkerRuntimeConfig(environment);
  const logger =
    options.logger ?? createStructuredLogger({ service: "worker" });
  const adapter = new FastifyAdapter({ logger: false });
  registerFastifyObservability(adapter.getInstance(), {
    service: "worker",
    logger,
  });

  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    workerNestApplicationOptions,
  );
  application.useGlobalFilters(new SafeHttpExceptionFilter());
  return application;
}

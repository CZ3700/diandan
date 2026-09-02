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
import { assertApiRuntimeConfig } from "./runtime-config.js";
import { SafeHttpExceptionFilter } from "./safe-http-exception.filter.js";

export const apiNestApplicationOptions = Object.freeze({
  abortOnError: false,
  logger: false,
}) satisfies Readonly<NestApplicationOptions>;

export async function createApiApplication(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: Readonly<{ logger?: StructuredLogger }> = {},
): Promise<NestFastifyApplication> {
  assertApiRuntimeConfig(environment);
  const logger = options.logger ?? createStructuredLogger({ service: "api" });
  const adapter = new FastifyAdapter({ logger: false });
  registerFastifyObservability(adapter.getInstance(), {
    service: "api",
    logger,
  });

  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    apiNestApplicationOptions,
  );
  application.useGlobalFilters(new SafeHttpExceptionFilter());
  return application;
}

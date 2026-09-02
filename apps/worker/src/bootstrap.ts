import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";

import { AppModule } from "./app.module.js";
import { assertWorkerRuntimeConfig } from "./runtime-config.js";

export async function createWorkerApplication(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<NestFastifyApplication> {
  assertWorkerRuntimeConfig(environment);

  return NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: false },
  );
}

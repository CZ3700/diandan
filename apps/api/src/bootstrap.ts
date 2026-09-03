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
import {
  registerPaymentWebhookRoute,
  type PaymentWebhookRouteOptions,
} from "./payment-webhook-route.js";
import { assertApiRuntimeConfig } from "./runtime-config.js";
import { SafeHttpExceptionFilter } from "./safe-http-exception.filter.js";

export const apiNestApplicationOptions = Object.freeze({
  abortOnError: false,
  logger: false,
}) satisfies Readonly<NestApplicationOptions>;

export type ApiLifecycleResource = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
}>;

export type CreateApiApplicationOptions = Readonly<{
  logger?: StructuredLogger;
  paymentWebhookRoute?: PaymentWebhookRouteOptions;
  reliableEventsRuntime?: ApiLifecycleResource;
}>;

function registerReliableEventsLifecycle(
  adapter: FastifyAdapter,
  runtime: ApiLifecycleResource | undefined,
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
      throw new Error("API reliable events failed to start");
    }
  });
  adapter.getInstance().addHook("onClose", async () => {
    try {
      await stop();
    } catch {
      throw new Error("API reliable events failed to stop");
    }
  });
}

export async function createApiApplication(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: CreateApiApplicationOptions = {},
): Promise<NestFastifyApplication> {
  assertApiRuntimeConfig(environment);
  const logger = options.logger ?? createStructuredLogger({ service: "api" });
  const adapter = new FastifyAdapter({ logger: false });
  registerFastifyObservability(adapter.getInstance(), {
    service: "api",
    logger,
  });
  registerReliableEventsLifecycle(adapter, options.reliableEventsRuntime);
  if (options.paymentWebhookRoute !== undefined) {
    registerPaymentWebhookRoute(
      adapter.getInstance(),
      options.paymentWebhookRoute,
    );
  }

  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    apiNestApplicationOptions,
  );
  application.useGlobalFilters(new SafeHttpExceptionFilter());
  return application;
}

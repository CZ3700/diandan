import type { StructuredLogger } from "@fan-support/observability";

import { createApiApplication } from "./bootstrap.js";
import {
  createApiReliableEventsComposition,
  type ApiReliableEventsComposition,
  type ApiReliableEventsCompositionOptions,
} from "./reliable-events-composition.js";

type ApiApplicationFactory = typeof createApiApplication;
type ReliableEventsCompositionFactory = (
  environment: Readonly<Record<string, string | undefined>>,
  options: ApiReliableEventsCompositionOptions,
) => ApiReliableEventsComposition;

export type ProductionApiApplicationOptions = Readonly<{
  logger: StructuredLogger;
  factories?: Readonly<{
    createApplication?: ApiApplicationFactory;
    createComposition?: ReliableEventsCompositionFactory;
  }>;
}>;

export function createProductionApiApplication(
  environment: Readonly<Record<string, string | undefined>>,
  options: ProductionApiApplicationOptions,
): ReturnType<ApiApplicationFactory> {
  const createComposition =
    options.factories?.createComposition ?? createApiReliableEventsComposition;
  const createApplication =
    options.factories?.createApplication ?? createApiApplication;
  const composition = createComposition(environment, {
    logger: options.logger,
  });

  return createApplication(environment, {
    logger: options.logger,
    paymentWebhookRoute: composition.paymentWebhookRoute,
    reliableEventsRuntime: composition.reliableEventsRuntime,
  });
}

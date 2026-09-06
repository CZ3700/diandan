import type { StructuredLogger } from "@fan-support/observability";
import type {
  WorkerLifecycleResource,
  createWorkerApplication,
} from "./bootstrap.js";

type ApplicationFactory = typeof createWorkerApplication;
type Environment = Readonly<Record<string, string | undefined>>;
type CompositionOptions = Readonly<{ logger: StructuredLogger }>;
export type ProductionWorkerApplicationOptions = Readonly<{
  logger: StructuredLogger;
  factories?: Readonly<{
    createApplication?: ApplicationFactory;
    createReliableComposition?: (
      environment: Environment,
      options: CompositionOptions,
    ) => WorkerLifecycleResource;
    createMediaComposition?: (
      environment: Environment,
      options: CompositionOptions,
    ) => Promise<WorkerLifecycleResource>;
  }>;
}>;

export async function createProductionWorkerApplication(
  environment: Environment,
  options: ProductionWorkerApplicationOptions,
): ReturnType<ApplicationFactory> {
  const createApplication =
    options.factories?.createApplication ??
    (await import("./bootstrap.js")).createWorkerApplication;
  const createReliable =
    options.factories?.createReliableComposition ??
    (await import("./reliable-events-composition.js"))
      .createWorkerReliableEventsComposition;
  const reliable = createReliable(environment, { logger: options.logger });
  let media: WorkerLifecycleResource | undefined;
  try {
    const createMedia =
      options.factories?.createMediaComposition ??
      (await import("./media-processing-composition.js"))
        .createWorkerMediaProcessingComposition;
    media = await createMedia(environment, { logger: options.logger });
    return await createApplication(environment, {
      logger: options.logger,
      reliableEventsRuntime: reliable,
      mediaProcessingRuntime: media,
    });
  } catch (error) {
    await Promise.allSettled([
      Promise.resolve().then(() => reliable.stop()),
      Promise.resolve().then(() => media?.stop()),
    ]);
    throw error;
  }
}

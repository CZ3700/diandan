import { setTimeout as scheduleTimeout } from "node:timers";

import {
  createRuntimeFatalHandler,
  createRuntimeShutdownHandler,
  createRuntimeShutdownCoordinator,
  createStructuredLogger,
  launchObservedRuntime,
  type ObservedRuntimeApplication,
  type StructuredLogger,
} from "@fan-support/observability";
import { startNodeTelemetry } from "@fan-support/observability/node";

const SHUTDOWN_TIMEOUT_MS = 10_000;

export type ApiProcessRuntimeOptions = Readonly<{
  createApplication: (
    logger: StructuredLogger,
  ) => Promise<ObservedRuntimeApplication>;
}>;

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return 3002;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API port is invalid");
  }

  return port;
}

export async function startApiProcessRuntime(
  options: ApiProcessRuntimeOptions,
): Promise<void> {
  const logger = createStructuredLogger({ service: "api" });
  const shutdownCoordinator = createRuntimeShutdownCoordinator(() => {
    process.exitCode = 1;
  });
  const scheduleForcedExit = (defaultExitCode: number) => {
    scheduleTimeout(
      () => process.exit(process.exitCode ?? defaultExitCode),
      SHUTDOWN_TIMEOUT_MS,
    ).unref();
  };
  const shutdown = createRuntimeShutdownHandler({
    requestShutdown: () => shutdownCoordinator.requestShutdown(),
    scheduleForcedExit: () => scheduleForcedExit(0),
  });
  const handleFatalError = createRuntimeFatalHandler({
    logger,
    markProcessFailed: () => {
      process.exitCode = 1;
    },
    requestShutdown: () => shutdownCoordinator.requestShutdown(),
    scheduleForcedExit: () => scheduleForcedExit(1),
  });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.on("uncaughtException", handleFatalError);
  process.on("unhandledRejection", handleFatalError);

  try {
    const runtime = await launchObservedRuntime({
      host: "0.0.0.0",
      port: () => readPort(process.env["PORT"]),
      logger,
      startTelemetry: () => startNodeTelemetry({ service: "api" }),
      createApplication: () => options.createApplication(logger),
    });
    await shutdownCoordinator.attachRuntime(runtime);
  } catch {
    process.exitCode = 1;
  }
}

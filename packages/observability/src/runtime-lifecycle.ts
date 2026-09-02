import type { StructuredLogger } from "./logging.js";

export type ObservedRuntimeApplication = Readonly<{
  close: () => Promise<unknown>;
  listen: (port: number, host: string) => Promise<unknown>;
}>;

export type ObservedRuntimeHandle = Readonly<{
  shutdown: () => Promise<void>;
}>;

export type RuntimeShutdownCoordinator = Readonly<{
  attachRuntime: (runtime: ObservedRuntimeHandle) => Promise<void>;
  requestShutdown: () => Promise<void>;
}>;

type TelemetryHandle = Readonly<{
  shutdown: () => Promise<void>;
}>;

export type RuntimeFatalHandler = () => void;
export type RuntimeShutdownHandler = () => void;

function attemptRuntimeSafeguard(action: () => void): void {
  try {
    action();
  } catch {
    // Fatal safeguards are independent so one failure cannot skip the others.
  }
}

export function createRuntimeFatalHandler(
  options: Readonly<{
    logger: StructuredLogger;
    markProcessFailed: () => void;
    requestShutdown: () => Promise<void>;
    scheduleForcedExit: () => void;
  }>,
): RuntimeFatalHandler {
  let handled = false;

  return () => {
    if (handled) {
      return;
    }
    handled = true;

    attemptRuntimeSafeguard(options.markProcessFailed);
    attemptRuntimeSafeguard(() => {
      options.logger.error("runtime.fatal_error", {
        errorCode: "FATAL_RUNTIME_ERROR",
        outcome: "failure",
      });
    });
    attemptRuntimeSafeguard(options.scheduleForcedExit);
    attemptRuntimeSafeguard(() => {
      void options.requestShutdown().catch(() => {});
    });
  };
}

export function createRuntimeShutdownHandler(
  options: Readonly<{
    requestShutdown: () => Promise<void>;
    scheduleForcedExit: () => void;
  }>,
): RuntimeShutdownHandler {
  let handled = false;

  return () => {
    if (handled) {
      return;
    }
    handled = true;

    attemptRuntimeSafeguard(options.scheduleForcedExit);
    attemptRuntimeSafeguard(() => {
      void options.requestShutdown().catch(() => {});
    });
  };
}

async function settle(action: (() => Promise<unknown>) | undefined) {
  if (action === undefined) {
    return false;
  }
  try {
    await action();
    return false;
  } catch {
    return true;
  }
}

export function createRuntimeShutdownCoordinator(
  onFailure: () => void,
): RuntimeShutdownCoordinator {
  let runtime: ObservedRuntimeHandle | undefined;
  let shutdownRequested = false;
  let shutdownPromise: Promise<void> | undefined;

  function shutdownAttachedRuntime(): Promise<void> {
    if (runtime === undefined) {
      return Promise.resolve();
    }

    shutdownPromise ??= runtime.shutdown().catch(() => {
      try {
        onFailure();
      } catch {
        // A shutdown failure must never escape a process signal handler.
      }
    });
    return shutdownPromise;
  }

  return Object.freeze({
    async attachRuntime(nextRuntime) {
      if (runtime !== undefined && runtime !== nextRuntime) {
        throw new Error("Runtime is already attached");
      }
      runtime = nextRuntime;
      if (shutdownRequested) {
        await shutdownAttachedRuntime();
      }
    },
    async requestShutdown() {
      shutdownRequested = true;
      await shutdownAttachedRuntime();
    },
  });
}

export async function launchObservedRuntime(
  options: Readonly<{
    createApplication: () => Promise<ObservedRuntimeApplication>;
    host: string;
    logger: StructuredLogger;
    port: number | (() => number);
    startTelemetry: () => TelemetryHandle;
  }>,
): Promise<ObservedRuntimeHandle> {
  let telemetry: TelemetryHandle | undefined;
  let application: ObservedRuntimeApplication | undefined;

  try {
    telemetry = options.startTelemetry();
    const port =
      typeof options.port === "function" ? options.port() : options.port;
    application = await options.createApplication();
    await application.listen(port, options.host);
    options.logger.info("runtime.started", { outcome: "success" });
  } catch {
    const applicationToClose = application;
    const telemetryToClose = telemetry;
    await settle(
      applicationToClose === undefined
        ? undefined
        : () => applicationToClose.close(),
    );
    await settle(
      telemetryToClose === undefined
        ? undefined
        : () => telemetryToClose.shutdown(),
    );
    options.logger.error("runtime.start_failed", {
      errorCode: "STARTUP_FAILED",
      outcome: "failure",
    });
    throw new Error("Runtime failed to start");
  }

  let shutdownPromise: Promise<void> | undefined;
  return Object.freeze({
    shutdown: () => {
      shutdownPromise ??= (async () => {
        const closeFailed = await settle(() => application.close());
        const telemetryFailed = await settle(() => telemetry.shutdown());
        if (closeFailed || telemetryFailed) {
          options.logger.error("runtime.stop_failed", {
            errorCode: "SHUTDOWN_FAILED",
            outcome: "failure",
          });
          throw new Error("Runtime failed to stop");
        }
        options.logger.info("runtime.stopped", { outcome: "success" });
      })();
      return shutdownPromise;
    },
  });
}

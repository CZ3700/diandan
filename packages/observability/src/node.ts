import { context, propagation, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import type { StructuredLogger } from "./logging.js";

export type NodeTelemetryHandle = Readonly<{
  forceFlush: () => Promise<void>;
  shutdown: () => Promise<void>;
}>;

export type TelemetrySignalExitBoundary = Readonly<{
  restore: () => void;
}>;

type ProcessSignalExitTarget = {
  exit: (code?: number | string | null) => unknown;
  exitCode: NodeJS.Process["exitCode"];
  prependOnceListener: (
    signal: "SIGINT" | "SIGTERM",
    listener: () => void,
  ) => unknown;
  removeListener: (
    signal: "SIGINT" | "SIGTERM",
    listener: () => void,
  ) => unknown;
};

type ActiveTelemetry = Readonly<{
  handle: NodeTelemetryHandle;
  provider: NodeTracerProvider;
  service: string;
}>;

let activeTelemetry: ActiveTelemetry | undefined;

function attemptExitSafeguard(action: () => void): void {
  try {
    action();
  } catch {
    // Exit safeguards are independent so logging cannot prevent termination.
  }
}

export function installTelemetrySignalExitBoundary(
  options: Readonly<{
    logger: StructuredLogger;
    processTarget?: ProcessSignalExitTarget;
    telemetry: Pick<NodeTelemetryHandle, "shutdown">;
    timeoutMs?: number;
  }>,
): TelemetrySignalExitBoundary {
  const target = options.processTarget ?? process;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Telemetry process exit timeout is invalid");
  }

  const originalExit = target.exit;
  let active = true;
  let deferredExit: ProcessSignalExitTarget["exit"] | undefined;
  let exitFinished = false;
  let shutdownStarted = false;
  let timeout: NodeJS.Timeout | undefined;

  const finish = (
    code: number | string | null | undefined,
    result: "failed" | "stopped" | "timeout",
  ): void => {
    if (exitFinished) {
      return;
    }
    exitFinished = true;
    active = false;
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (deferredExit !== undefined && target.exit === deferredExit) {
      target.exit = originalExit;
    }

    if (result === "stopped") {
      attemptExitSafeguard(() => {
        options.logger.info("runtime.stopped", { outcome: "success" });
      });
    } else {
      attemptExitSafeguard(() => {
        options.logger.error("runtime.stop_failed", {
          errorCode: "SHUTDOWN_FAILED",
          outcome: "failure",
        });
      });
    }

    originalExit.call(target, code);
  };

  const beginSignalShutdown = (signal: "SIGINT" | "SIGTERM"): void => {
    if (!active || timeout !== undefined) {
      return;
    }
    target.removeListener("SIGINT", handleSigint);
    target.removeListener("SIGTERM", handleSigterm);

    const signalExitCode = signal === "SIGINT" ? 130 : 143;
    let requestedExitCode: number | string | null | undefined = signalExitCode;
    target.exitCode = signalExitCode;
    deferredExit = (code?: number | string | null) => {
      requestedExitCode = code ?? target.exitCode ?? signalExitCode;
      target.exitCode = requestedExitCode;
      if (!shutdownStarted) {
        shutdownStarted = true;
        void Promise.resolve()
          .then(() => options.telemetry.shutdown())
          .then(
            () => finish(requestedExitCode, "stopped"),
            () => finish(requestedExitCode, "failed"),
          );
      }
    };
    target.exit = deferredExit;
    timeout = setTimeout(() => {
      finish(requestedExitCode, "timeout");
    }, timeoutMs);
  };

  const handleSigint = () => beginSignalShutdown("SIGINT");
  const handleSigterm = () => beginSignalShutdown("SIGTERM");
  target.prependOnceListener("SIGINT", handleSigint);
  target.prependOnceListener("SIGTERM", handleSigterm);

  return Object.freeze({
    restore() {
      if (!active) {
        return;
      }
      active = false;
      target.removeListener("SIGINT", handleSigint);
      target.removeListener("SIGTERM", handleSigterm);
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (deferredExit !== undefined && target.exit === deferredExit) {
        target.exit = originalExit;
      }
    },
  });
}

function normalizeService(value: string): string | undefined {
  return /^[a-z][a-z0-9-]{0,31}$/u.test(value) ? value : undefined;
}

export function startNodeTelemetry(
  options: Readonly<{
    service: string;
  }>,
): NodeTelemetryHandle {
  const service = normalizeService(options.service);
  if (service === undefined) {
    throw new Error("Telemetry service name is invalid");
  }
  if (activeTelemetry !== undefined) {
    if (activeTelemetry.service !== service) {
      throw new Error("Telemetry is already active for another service");
    }
    return activeTelemetry.handle;
  }

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: service }),
    spanProcessors: [],
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });

  let shutdownPromise: Promise<void> | undefined;
  const handle: NodeTelemetryHandle = Object.freeze({
    forceFlush: () => provider.forceFlush(),
    shutdown: () => {
      shutdownPromise ??= provider.shutdown().finally(() => {
        if (activeTelemetry?.provider === provider) {
          activeTelemetry = undefined;
          context.disable();
          propagation.disable();
          trace.disable();
        }
      });
      return shutdownPromise;
    },
  });
  activeTelemetry = Object.freeze({ handle, provider, service });
  return handle;
}

export {
  createPropagationHeaders,
  currentRequestContext,
  runWithServerRequest,
  runWithServerRequestOutcome,
} from "./request-context.js";
export type {
  RequestContext,
  ServerRequestErrorCode,
  ServerRequestOutcome,
} from "./request-context.js";

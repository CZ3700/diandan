import type { Instrumentation } from "next";
import type { StructuredLogger } from "@fan-support/observability";

let errorLogger: StructuredLogger | undefined;
let runtimeBoundariesInstalled = false;

export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") {
    return;
  }

  const [nodeObservability, observability] = await Promise.all([
    import("@fan-support/observability/node"),
    import("@fan-support/observability"),
  ]);
  const telemetry = nodeObservability.startNodeTelemetry({ service: "admin" });
  errorLogger ??= observability.createStructuredLogger({ service: "admin" });
  if (!runtimeBoundariesInstalled) {
    observability.installSafeConsoleErrorBoundary(errorLogger);
    nodeObservability.installTelemetrySignalExitBoundary({
      logger: errorLogger,
      telemetry,
    });
    runtimeBoundariesInstalled = true;
  }
}

export const onRequestError: Instrumentation.onRequestError = () => {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") {
    return;
  }

  errorLogger?.error("next.request.failed", {
    errorCode: "INTERNAL_ERROR",
    outcome: "failure",
  });
};

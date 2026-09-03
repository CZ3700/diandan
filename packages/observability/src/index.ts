export const workspacePackageName = "@fan-support/observability" as const;

export {
  createStructuredLogger,
  installSafeConsoleErrorBoundary,
  structuredLogRecordSchema,
} from "./logging.js";
export type {
  ConsoleErrorBoundary,
  StructuredLogger,
  StructuredLogFields,
  StructuredLogRecord,
} from "./logging.js";
export {
  isCanonicalRequestId,
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "./request-id.js";
export {
  createSafeRuntimeError,
  safeRuntimeErrorSchema,
} from "./safe-error.js";
export type { SafeRuntimeError } from "./safe-error.js";
export {
  createQueuePropagationCarrier,
  parseQueuePropagationCarrier,
} from "./propagation-carrier.js";
export type { QueuePropagationCarrier } from "@fan-support/contracts";
export {
  createRuntimeFatalHandler,
  createRuntimeShutdownHandler,
  createRuntimeShutdownCoordinator,
  launchObservedRuntime,
} from "./runtime-lifecycle.js";
export type {
  ObservedRuntimeApplication,
  ObservedRuntimeHandle,
  RuntimeFatalHandler,
  RuntimeShutdownHandler,
  RuntimeShutdownCoordinator,
} from "./runtime-lifecycle.js";

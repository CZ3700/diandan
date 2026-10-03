import { resolveAdminRuntimeConfig } from "@fan-support/config/server";

/**
 * Fails admin startup on invalid configuration. Instrumentation loads it before
 * telemetry; like the proxy-facing storefront modules it stays free of `server-only`.
 */
export function assertAdminStartupConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  resolveAdminRuntimeConfig({ environment });
}

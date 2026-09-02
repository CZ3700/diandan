import {
  resolveDatabaseRuntimeConfig,
  resolveObjectStorageRuntimeConfig,
  resolveServerRuntimeConfig,
} from "@fan-support/config/server";

export function assertWorkerRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const sources = { environment } as const;

  resolveServerRuntimeConfig(sources);
  resolveDatabaseRuntimeConfig(sources);
  resolveObjectStorageRuntimeConfig(sources);
}

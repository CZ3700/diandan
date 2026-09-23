import "server-only";
import { resolveRumConfig } from "@fan-support/config/server";
import type { SupportedLocale } from "@fan-support/contracts";

export async function renderRumCollector(
  locale: SupportedLocale,
  sensitiveEntry: boolean,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (sensitiveEntry) return null;
  const config = resolveRumConfig({ environment });
  if (config.mode === "disabled" || config.samplePermille === 0) return null;
  const { RumCollector } = await import("../storefront/rum-collector");
  return (
    <RumCollector locale={locale} samplePermille={config.samplePermille} />
  );
}

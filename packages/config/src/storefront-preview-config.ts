import {
  resolveConfigLayers,
  type RuntimeConfigSources,
} from "./config-layers.js";
import { ConfigValidationError } from "./configuration-error.js";
import {
  isLoopbackHttpOrigin,
  isObjectStorageEndpoint,
} from "./url-validation.js";

/** The preview bridge is opt-in and trusts exactly one configured admin origin. */
export function resolveStorefrontPreviewConfig(
  sources: RuntimeConfigSources,
): Readonly<{ adminOrigin: string | null }> {
  const values = resolveConfigLayers(sources, [
    "FAN_SUPPORT_ADMIN_ORIGIN",
    "FAN_SUPPORT_DEPLOYMENT_ENV",
  ]);
  const origin = values.FAN_SUPPORT_ADMIN_ORIGIN;
  if (origin === undefined || origin === "")
    return Object.freeze({ adminOrigin: null });
  const local =
    values.FAN_SUPPORT_DEPLOYMENT_ENV === "development" ||
    values.FAN_SUPPORT_DEPLOYMENT_ENV === "test";
  if (
    typeof origin !== "string" ||
    !isObjectStorageEndpoint(origin) ||
    (new URL(origin).protocol !== "https:" &&
      !(local && isLoopbackHttpOrigin(origin)))
  )
    throw new ConfigValidationError(["FAN_SUPPORT_ADMIN_ORIGIN"]);
  return Object.freeze({ adminOrigin: origin });
}

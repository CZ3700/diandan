export const workspacePackageName = "@fan-support/i18n" as const;
export * from "./admin/messages.js";

export {
  DEFAULT_LOCALE,
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  supportedLocaleSchema,
} from "@fan-support/contracts";
export type { SupportedLocale } from "@fan-support/contracts";

export {
  loadStorefrontCopy,
  type StorefrontCopy,
} from "./storefront/messages.js";

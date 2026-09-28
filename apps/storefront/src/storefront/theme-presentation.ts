import {
  createDefaultStorefrontTheme,
  type PublicStorefrontThemeResponse,
} from "@fan-support/contracts";
import { storefrontThemeAttributes } from "@fan-support/design-tokens";

/** Failure stays observable and never masquerades as a published/default configuration. */
export function themePresentation(result: PublicStorefrontThemeResponse) {
  const available = result.outcome === "SUCCESS";
  return {
    ...storefrontThemeAttributes(
      available ? result.theme : createDefaultStorefrontTheme(),
    ),
    "data-theme-source": available ? result.source : "FALLBACK",
    "data-theme-status": available ? "AVAILABLE" : "UNAVAILABLE",
    ...(available ? { "data-theme-version": result.version } : {}),
  };
}

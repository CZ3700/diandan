import {
  resolveStorefrontPresentation,
  resolveStorefrontDetailTemplates,
  storefrontThemeSchema,
} from "@fan-support/contracts";
import { DESIGN_TOKEN_CONTRACT } from "./tokens.js";

const defaults = DESIGN_TOKEN_CONTRACT.values;
/** Deployed dark palettes. Semantic feedback and locale font tokens are protected. */
export const STOREFRONT_THEME_PALETTES = Object.freeze({
  BLACK_GOLD: {
    "--color-accent": defaults["--color-accent"],
    "--color-bg": defaults["--color-bg"],
    "--color-surface": defaults["--color-surface"],
    "--color-surface-raised": defaults["--color-surface-raised"],
    "--color-text": defaults["--color-text"],
    "--color-text-muted": defaults["--color-text-muted"],
  },
  GRAPHITE_PEARL: {
    "--color-accent": "#d7dfe5",
    "--color-bg": "#0d1012",
    "--color-surface": "#15191c",
    "--color-surface-raised": "#1c2226",
    "--color-text": "#f1f4f5",
    "--color-text-muted": "#abb5bc",
  },
  MIDNIGHT_BLUE: {
    "--color-accent": "#a7c8ed",
    "--color-bg": "#090f19",
    "--color-surface": "#111b29",
    "--color-surface-raised": "#192538",
    "--color-text": "#eff3fa",
    "--color-text-muted": "#aebbd0",
  },
});

export function storefrontThemeAttributes(input: unknown) {
  const theme = storefrontThemeSchema.parse(input);
  const presentation = resolveStorefrontPresentation(theme);
  const details = resolveStorefrontDetailTemplates(theme);
  return {
    "data-storefront-palette": theme.palette,
    "data-storefront-typography": theme.typography,
    "data-storefront-density": theme.density,
    "data-storefront-corners": theme.corners,
    "data-storefront-hero-layout": presentation.heroLayout,
    "data-storefront-gift-layout": presentation.giftLayout,
    "data-storefront-motion": presentation.motion,
    "data-storefront-motion-speed": presentation.motionSpeed,
    "data-storefront-artist-template": details.artist,
    "data-storefront-gift-template": details.gift,
  } as const;
}

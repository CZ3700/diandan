import {
  resolveStorefrontPresentation,
  resolveStorefrontDetailTemplates,
  storefrontThemeSchema,
  type StorefrontPalette,
} from "@fan-support/contracts";
import { DESIGN_TOKEN_CONTRACT } from "./tokens.js";

const defaults = DESIGN_TOKEN_CONTRACT.values;
/** Light pages need darker feedback states; hues stay red, green and amber (L2-16). */
const LIGHT_FEEDBACK = {
  "--color-danger": "#b42318",
  "--color-success": "#16703f",
  "--color-warning": "#8a5300",
} as const;
/**
 * Deployed palettes. Dark presets inherit the protected semantic feedback tokens; light presets
 * must carry a complete readable set plus a border and shadow tinted by their own ink.
 */
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
  SAKURA_PINK: {
    "--color-accent": "#b0305c",
    "--color-bg": "#fcf3f5",
    "--color-surface": "#fff8fa",
    "--color-surface-raised": "#ffffff",
    "--color-text": "#3b1f2b",
    "--color-text-muted": "#765462",
    "--color-border": "rgb(59 31 43 / 14%)",
    "--shadow-raised": "0 1rem 3rem rgb(59 31 43 / 12%)",
    ...LIGHT_FEEDBACK,
  },
  SKY_BLUE: {
    "--color-accent": "#1c64b0",
    "--color-bg": "#f1f6fc",
    "--color-surface": "#f8fbff",
    "--color-surface-raised": "#ffffff",
    "--color-text": "#10243a",
    "--color-text-muted": "#4d6179",
    "--color-border": "rgb(16 36 58 / 14%)",
    "--shadow-raised": "0 1rem 3rem rgb(16 36 58 / 12%)",
    ...LIGHT_FEEDBACK,
  },
  IVORY_GOLD: {
    "--color-accent": "#86600f",
    "--color-bg": "#faf6ec",
    "--color-surface": "#fdfaf2",
    "--color-surface-raised": "#fffdf8",
    "--color-text": "#2b2417",
    "--color-text-muted": "#6b604b",
    "--color-border": "rgb(43 36 23 / 14%)",
    "--shadow-raised": "0 1rem 3rem rgb(43 36 23 / 12%)",
    ...LIGHT_FEEDBACK,
  },
  PEARL_GRAY: {
    "--color-accent": "#4a5670",
    "--color-bg": "#f2f3f5",
    "--color-surface": "#f8f9fa",
    "--color-surface-raised": "#ffffff",
    "--color-text": "#1c1f24",
    "--color-text-muted": "#585f69",
    "--color-border": "rgb(28 31 36 / 14%)",
    "--shadow-raised": "0 1rem 3rem rgb(28 31 36 / 12%)",
    ...LIGHT_FEEDBACK,
  },
} satisfies Record<StorefrontPalette, Record<string, string>>);

/** Whether a palette paints light ink on a dark page or dark ink on a light page. */
export const STOREFRONT_PALETTE_SCHEMES = Object.freeze({
  BLACK_GOLD: "DARK",
  GRAPHITE_PEARL: "DARK",
  MIDNIGHT_BLUE: "DARK",
  SAKURA_PINK: "LIGHT",
  SKY_BLUE: "LIGHT",
  IVORY_GOLD: "LIGHT",
  PEARL_GRAY: "LIGHT",
} as const satisfies Record<StorefrontPalette, "DARK" | "LIGHT">);

export function storefrontThemeAttributes(input: unknown) {
  const theme = storefrontThemeSchema.parse(input);
  const presentation = resolveStorefrontPresentation(theme);
  const details = resolveStorefrontDetailTemplates(theme);
  return {
    "data-storefront-palette": theme.palette,
    "data-storefront-scheme": STOREFRONT_PALETTE_SCHEMES[theme.palette],
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

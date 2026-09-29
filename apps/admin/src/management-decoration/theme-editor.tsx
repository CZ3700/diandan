"use client";
import type { CSSProperties } from "react";
import {
  storefrontPaletteSchema,
  storefrontThemeSchema,
  resolveStorefrontPresentation,
  resolveStorefrontDetailTemplates,
  type StorefrontDetailTemplates,
  type StorefrontPalette,
  type StorefrontPresentation,
  type StorefrontTheme,
} from "@fan-support/contracts";
import {
  STOREFRONT_PALETTE_SCHEMES,
  STOREFRONT_THEME_PALETTES,
} from "@fan-support/design-tokens";
import type { ThemeCopy } from "./theme-copy";

/** A preview chip painted with the palette's own page, ink and accent tokens. */
function paletteSwatch(palette: StorefrontPalette) {
  const tokens = STOREFRONT_THEME_PALETTES[palette];
  return {
    "--swatch-bg": tokens["--color-bg"],
    "--swatch-text": tokens["--color-text"],
    "--swatch-accent": tokens["--color-accent"],
  } as CSSProperties;
}

export function ThemeEditor({
  theme,
  onChange,
  disabled,
  copy,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
  disabled: boolean;
  copy: ThemeCopy;
}) {
  const presentation = resolveStorefrontPresentation(theme);
  const detailTemplates = resolveStorefrontDetailTemplates(theme);
  function change(field: keyof StorefrontTheme, value: string) {
    const next = storefrontThemeSchema.safeParse({ ...theme, [field]: value });
    if (next.success) onChange(next.data);
  }
  function changePresentation(
    field: keyof StorefrontPresentation,
    value: string,
  ) {
    const next = storefrontThemeSchema.safeParse({
      ...theme,
      presentation: { ...presentation, [field]: value },
    });
    if (next.success) onChange(next.data);
  }
  function changeDetailTemplate(
    field: keyof StorefrontDetailTemplates,
    value: string,
  ) {
    const next = storefrontThemeSchema.safeParse({
      ...theme,
      detailTemplates: { ...detailTemplates, [field]: value },
    });
    if (next.success) onChange(next.data);
  }
  return (
    <div data-theme-editor>
      <fieldset disabled={disabled} className="decoration-theme-palettes">
        <legend>{copy.palette}</legend>
        {(["DARK", "LIGHT"] as const).map((scheme) => (
          <fieldset key={scheme} data-palette-group={scheme}>
            <legend>{copy.paletteGroups[scheme]}</legend>
            {storefrontPaletteSchema.options
              .filter((value) => STOREFRONT_PALETTE_SCHEMES[value] === scheme)
              .map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="storefront-palette"
                    data-theme-palette={value}
                    value={value}
                    checked={theme.palette === value}
                    onChange={() => change("palette", value)}
                  />
                  <span
                    className="decoration-theme-swatch"
                    aria-hidden="true"
                    style={paletteSwatch(value)}
                  />
                  <span>{copy.palettes[value]}</span>
                </label>
              ))}
          </fieldset>
        ))}
      </fieldset>
      <details className="decoration-theme-settings">
        <summary>{copy.advanced}</summary>
        {(
          [
            ["heroLayout", copy.heroLayout, copy.heroLayoutOptions],
            ["giftLayout", copy.giftLayout, copy.giftLayoutOptions],
          ] as const
        ).map(([field, label, options]) => (
          <label key={field}>
            <span>{label}</span>
            <select
              data-theme-setting={field}
              disabled={disabled}
              value={presentation[field]}
              onChange={(event) =>
                changePresentation(field, event.currentTarget.value)
              }
            >
              {Object.entries(options).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        ))}
        {(
          [
            [
              "artist",
              "artistTemplate",
              copy.artistTemplate,
              copy.artistTemplateOptions,
            ],
            [
              "gift",
              "giftTemplate",
              copy.giftTemplate,
              copy.giftTemplateOptions,
            ],
          ] as const
        ).map(([field, setting, label, options]) => (
          <label key={field}>
            <span>{label}</span>
            <select
              data-theme-setting={setting}
              disabled={disabled}
              value={detailTemplates[field]}
              onChange={(event) =>
                changeDetailTemplate(field, event.currentTarget.value)
              }
            >
              {Object.entries(options).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        ))}
        {(
          [
            ["typography", copy.typography, copy.typographyOptions],
            ["density", copy.density, copy.densityOptions],
            ["corners", copy.corners, copy.cornerOptions],
          ] as const
        ).map(([field, label, options]) => (
          <label key={field}>
            <span>{label}</span>
            <select
              data-theme-setting={field}
              disabled={disabled}
              value={theme[field]}
              onChange={(event) => change(field, event.currentTarget.value)}
            >
              {Object.entries(options).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        ))}
        {(
          [
            ["motion", copy.motion, copy.motionOptions],
            ["motionSpeed", copy.motionSpeed, copy.motionSpeedOptions],
          ] as const
        ).map(([field, label, options]) => (
          <label key={field}>
            <span>{label}</span>
            <select
              data-theme-setting={field}
              disabled={
                disabled ||
                (field === "motionSpeed" && presentation.motion === "NONE")
              }
              value={presentation[field]}
              aria-describedby="theme-motion-hint"
              onChange={(event) =>
                changePresentation(field, event.currentTarget.value)
              }
            >
              {Object.entries(options).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        ))}
        <p className="mc-hint" id="theme-motion-hint">
          {copy.motionHint}
        </p>
      </details>
    </div>
  );
}

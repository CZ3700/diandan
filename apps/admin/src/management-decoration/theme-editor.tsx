"use client";
import {
  storefrontThemeSchema,
  type StorefrontTheme,
} from "@fan-support/contracts";
import type { ThemeCopy } from "./theme-copy";

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
  function change(field: keyof StorefrontTheme, value: string) {
    const next = storefrontThemeSchema.safeParse({ ...theme, [field]: value });
    if (next.success) onChange(next.data);
  }
  return (
    <div data-theme-editor>
      <fieldset disabled={disabled} className="decoration-theme-palettes">
        <legend>{copy.palette}</legend>
        {Object.entries(copy.palettes).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="storefront-palette"
              data-theme-palette={value}
              value={value}
              checked={theme.palette === value}
              onChange={() => change("palette", value)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <details className="decoration-theme-settings">
        <summary>{copy.advanced}</summary>
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
      </details>
    </div>
  );
}

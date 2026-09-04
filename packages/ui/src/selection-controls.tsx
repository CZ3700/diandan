"use client";

import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@fan-support/contracts";
import type { ReactElement } from "react";

import { Menu, type MenuOption } from "./menu.js";

export type LanguageControlProps = Readonly<{
  label: string;
  onValueChange: (locale: SupportedLocale) => void;
  value: SupportedLocale;
}>;

export type RegionOption<Value extends string = string> = MenuOption<Value>;

export type RegionControlProps<Value extends string = string> = Readonly<{
  label: string;
  onValueChange: (value: Value) => void;
  options: readonly RegionOption<Value>[];
  value: Value;
}>;

const LANGUAGE_OPTIONS = Object.freeze(
  SUPPORTED_LOCALES.map((locale) =>
    Object.freeze({ label: LOCALE_NATIVE_NAMES[locale], value: locale }),
  ),
) satisfies readonly MenuOption<SupportedLocale>[];

export function LanguageControl({
  label,
  onValueChange,
  value,
}: LanguageControlProps): ReactElement {
  return (
    <Menu
      label={label}
      onValueChange={onValueChange}
      options={LANGUAGE_OPTIONS}
      value={value}
    />
  );
}

export function RegionControl<Value extends string>({
  label,
  onValueChange,
  options,
  value,
}: RegionControlProps<Value>): ReactElement {
  return (
    <Menu
      label={label}
      onValueChange={onValueChange}
      options={options}
      value={value}
    />
  );
}

import { DESIGN_TOKEN_CONTRACT } from "./tokens.js";

type Rgb = readonly [red: number, green: number, blue: number];

export type IdolAccentResolution = Readonly<{
  accent: string;
  contrastRatio: number;
  fallbackUsed: boolean;
  schemaVersion: 1;
  style: Readonly<{
    "--idol-accent": string;
  }>;
}>;

const MINIMUM_ACCENT_CONTRAST = 4.5;
const SIX_DIGIT_HEX = /^#[\dA-Fa-f]{6}$/u;
const DEFAULT_ACCENT = DESIGN_TOKEN_CONTRACT.values["--color-accent"];
const ACCENT_BACKDROPS = Object.freeze([
  DESIGN_TOKEN_CONTRACT.values["--color-bg"],
  DESIGN_TOKEN_CONTRACT.values["--color-surface"],
  DESIGN_TOKEN_CONTRACT.values["--color-surface-raised"],
]);

function parseHexColor(value: string): Rgb {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function linearize(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: Rgb): number {
  return (
    linearize(color[0]) * 0.2126 +
    linearize(color[1]) * 0.7152 +
    linearize(color[2]) * 0.0722
  );
}

function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(parseHexColor(left));
  const rightLuminance = relativeLuminance(parseHexColor(right));
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function roundContrast(value: number): number {
  return Math.round(value * 100) / 100;
}

function minimumAccentContrast(accent: string): number {
  return Math.min(
    ...ACCENT_BACKDROPS.map((backdrop) => contrastRatio(accent, backdrop)),
  );
}

export function resolveIdolAccent(input: unknown): IdolAccentResolution {
  const normalized =
    typeof input === "string" && SIX_DIGIT_HEX.test(input)
      ? input.toLowerCase()
      : undefined;
  const requestedContrast =
    normalized === undefined ? 0 : minimumAccentContrast(normalized);
  const useRequestedAccent =
    normalized !== undefined && requestedContrast >= MINIMUM_ACCENT_CONTRAST;
  const fallbackUsed = !useRequestedAccent;
  const accent = useRequestedAccent ? normalized : DEFAULT_ACCENT;
  const style = Object.freeze({
    "--idol-accent": accent,
  });

  return Object.freeze({
    accent,
    contrastRatio: roundContrast(minimumAccentContrast(accent)),
    fallbackUsed,
    schemaVersion: 1,
    style,
  });
}

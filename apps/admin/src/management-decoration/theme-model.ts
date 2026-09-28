import {
  createDefaultStorefrontTheme,
  type StorefrontTheme,
  type StorefrontThemeState,
} from "@fan-support/contracts";

export function editableTheme(state: StorefrontThemeState): StorefrontTheme {
  return (
    state.draft?.theme ??
    state.published?.theme ??
    createDefaultStorefrontTheme()
  );
}
export function sameTheme(
  left: StorefrontTheme,
  right: StorefrontTheme,
): boolean {
  return (
    left.palette === right.palette &&
    left.typography === right.typography &&
    left.density === right.density &&
    left.corners === right.corners
  );
}

import {
  createDefaultStorefrontTheme,
  resolveStorefrontPresentation,
  resolveStorefrontDetailTemplates,
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
  const leftPresentation = resolveStorefrontPresentation(left);
  const rightPresentation = resolveStorefrontPresentation(right);
  const leftDetails = resolveStorefrontDetailTemplates(left);
  const rightDetails = resolveStorefrontDetailTemplates(right);
  return (
    left.palette === right.palette &&
    left.typography === right.typography &&
    left.density === right.density &&
    left.corners === right.corners &&
    leftPresentation.heroLayout === rightPresentation.heroLayout &&
    leftPresentation.giftLayout === rightPresentation.giftLayout &&
    leftPresentation.motion === rightPresentation.motion &&
    leftPresentation.motionSpeed === rightPresentation.motionSpeed &&
    (leftPresentation.heroEffect ?? "STARLIGHT") ===
      (rightPresentation.heroEffect ?? "STARLIGHT") &&
    leftDetails.artist === rightDetails.artist &&
    leftDetails.gift === rightDetails.gift
  );
}

import {
  STOREFRONT_LOGO_PROFILE,
  createDefaultStorefrontBrand,
  createDefaultStorefrontBrandView,
  type StorefrontBrand,
  type StorefrontBrandState,
  type StorefrontBrandView,
} from "@fan-support/contracts";

export type BrandSlot = "lightLogo" | "darkLogo";
export const emptyBrand = createDefaultStorefrontBrand;
export const emptyBrandView = createDefaultStorefrontBrandView;
export function editableBrand(state: StorefrontBrandState): StorefrontBrand {
  return state.draft?.brand ?? state.published?.brand ?? emptyBrand();
}
export function editableBrandView(
  state: StorefrontBrandState,
): StorefrontBrandView {
  return state.draft?.view ?? state.published?.view ?? emptyBrandView();
}
export function sameBrand(
  left: StorefrontBrand,
  right: StorefrontBrand,
): boolean {
  return (
    left.lightLogoAssetId === right.lightLogoAssetId &&
    left.darkLogoAssetId === right.darkLogoAssetId
  );
}
export function brandFromView(view: StorefrontBrandView): StorefrontBrand {
  return {
    schemaVersion: 1,
    lightLogoAssetId: view.lightLogo?.assetId ?? null,
    darkLogoAssetId: view.darkLogo?.assetId ?? null,
  };
}
export function logoSelectionIssue(
  file: Pick<File, "type" | "size">,
): "imageFormat" | "imageSize" | null {
  if (
    !["image/png", "image/webp", "image/jpeg", "image/avif"].includes(file.type)
  )
    return "imageFormat";
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > STOREFRONT_LOGO_PROFILE.sourceByteLimit
  )
    return "imageSize";
  return null;
}

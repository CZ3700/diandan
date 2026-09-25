import "server-only";
import type { ComponentProps } from "react";
import { GiftDirectorySection } from "./gift-directory-section";
import { readCommerceContext } from "./storefront-page-reads";

/** Resolve gift eligibility after the artist's existence is already proven. */
export async function ArtistGiftDirectory(
  props: Omit<ComponentProps<typeof GiftDirectorySection>, "context">,
) {
  return (
    <GiftDirectorySection {...props} context={await readCommerceContext()} />
  );
}

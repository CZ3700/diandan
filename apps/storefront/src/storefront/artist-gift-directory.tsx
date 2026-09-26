import "server-only";
import type { ComponentProps } from "react";
import { GiftDirectorySection } from "./gift-directory-section";
import { readCommerceContext } from "./storefront-page-reads";
import { soleCommerceScope } from "./commerce-scope";

/** Resolve gift eligibility after the artist's existence is already proven. */
export async function ArtistGiftDirectory(
  props: Omit<ComponentProps<typeof GiftDirectorySection>, "context">,
) {
  const context = await readCommerceContext();
  const scope = soleCommerceScope(context);
  // One published market prices the artist's gifts without a region step or a market in the URL.
  return (
    <GiftDirectorySection
      {...props}
      context={context}
      {...(scope ? { implicitScope: scope } : {})}
    />
  );
}

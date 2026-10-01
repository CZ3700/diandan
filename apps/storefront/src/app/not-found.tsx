import { headers } from "next/headers";
import { DEFAULT_LOCALE, supportedLocaleSchema } from "@fan-support/contracts";
import { createStorefrontNotFound } from "../storefront/route-states";
import "../storefront/storefront.css";

/** Unmatched URLs do not enter a locale route's nested not-found boundary. */
export default async function NotFound() {
  const requestHeaders = await headers();
  const parsed = supportedLocaleSchema.safeParse(
    requestHeaders.get("x-storefront-locale"),
  );
  return createStorefrontNotFound(
    parsed.success ? parsed.data : DEFAULT_LOCALE,
  )();
}
